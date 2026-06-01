import * as vscode from 'vscode';
import { getShowDiffPreview } from '../config/settings';
import { isBinary, matchesAnyGlob, resolveSafePath } from './common';
import { isSessionApproved, requestToolApproval } from './confirmation';
import { openMultiFileDiff } from './diffPreview';
import { applyEdits, type FindReplace } from './editLogic';
import type { Tool } from './types';

type FileEdit = {
  path?: string;
  edits?: FindReplace[];
};

type Input = {
  files?: FileEdit[];
};

type PreparedEdit = {
  relPath: string;
  abs: string;
  original: string;
  proposed: string;
  appliedCount: number;
  netDelta: number;
};

function fullDocumentRange(document: vscode.TextDocument): vscode.Range {
  const lastLine = Math.max(0, document.lineCount - 1);
  return new vscode.Range(0, 0, lastLine, document.lineAt(lastLine).text.length);
}

export const multiEditTool: Tool = {
  destructive: true,
  gateFlag: 'allowWriteTools',
  def: {
    name: 'multi_edit',
    description:
      'Apply find/replace edits across MULTIPLE files in a single call. Use this instead of ' +
      'several edit_file calls when a change spans more than one file (renames, signature changes, ' +
      'refactors). All edits are validated first; if ANY edit fails to match, NOTHING is written ' +
      '(atomic). Each file follows the same matching rules as edit_file (exact match tolerant of ' +
      'LF/CRLF and trailing spaces; set "replaceAll": true to update every occurrence). Asks for ' +
      'approval once before writing all files.',
    input_schema: {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          description: 'List of per-file edit groups. Each entry targets one file.',
          items: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'Relative path from workspace root.' },
              edits: {
                type: 'array',
                description: 'Ordered find/replace operations for this file.',
                items: {
                  type: 'object',
                  properties: {
                    find: {
                      type: 'string',
                      minLength: 1,
                      description:
                        'Text to find. Matching tolerates LF/CRLF and trailing spaces. Include enough context to be unique.',
                    },
                    replace: { type: 'string', description: 'Replacement text.' },
                    replaceAll: {
                      type: 'boolean',
                      description: 'Replace every occurrence of "find". Default false.',
                    },
                  },
                  required: ['find', 'replace'],
                },
              },
            },
            required: ['path', 'edits'],
          },
        },
      },
      required: ['files'],
    },
  },
  async execute(input, ctx) {
    const { files } = (input ?? {}) as Input;
    if (!Array.isArray(files) || files.length === 0) {
      return { content: 'Error: "files" must be a non-empty array.', isError: true };
    }

    // Phase 1: validate + compute all results. Write nothing yet.
    const prepared: PreparedEdit[] = [];
    const seen = new Set<string>();
    for (let f = 0; f < files.length; f++) {
      const { path: relPath, edits } = files[f] ?? {};
      const label = `files[${f}]`;
      if (!relPath || typeof relPath !== 'string') {
        return { content: `Error: ${label}: "path" is required.`, isError: true };
      }
      if (seen.has(relPath)) {
        return {
          content: `Error: ${label}: duplicate path "${relPath}". Combine its edits into one entry.`,
          isError: true,
        };
      }
      seen.add(relPath);
      if (!Array.isArray(edits) || edits.length === 0) {
        return { content: `Error: ${label} ("${relPath}"): "edits" must be a non-empty array.`, isError: true };
      }
      const abs = resolveSafePath(ctx.workspaceRoot, relPath);
      if (!abs) {
        return { content: `Error: "${relPath}" resolves outside the workspace.`, isError: true };
      }
      if (matchesAnyGlob(relPath, ctx.blacklist)) {
        return { content: `Error: "${relPath}" is blacklisted.`, isError: true };
      }

      let original: string;
      try {
        const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(abs));
        if (isBinary(bytes)) {
          return { content: `Error: "${relPath}" appears to be binary.`, isError: true };
        }
        original = new TextDecoder().decode(bytes);
      } catch (err) {
        return {
          content: `Error reading "${relPath}": ${err instanceof Error ? err.message : String(err)}`,
          isError: true,
        };
      }

      const applied = applyEdits(original, edits);
      if (!applied.ok) {
        return { content: `Error in "${relPath}": ${applied.error}`, isError: true };
      }
      if (applied.result === original) continue; // no-op file, skip

      prepared.push({
        relPath,
        abs,
        original,
        proposed: applied.result,
        appliedCount: applied.appliedCount,
        netDelta: applied.result.length - original.length,
      });
    }

    if (prepared.length === 0) {
      return { content: 'No-op: edits produced no changes.' };
    }

    // Phase 2: approval (single prompt for the whole batch).
    const totalEdits = prepared.reduce((n, p) => n + p.appliedCount, 0);
    const totalDelta = prepared.reduce((n, p) => n + p.netDelta, 0);
    const summary = `Apply ${totalEdits} edit${totalEdits === 1 ? '' : 's'} across ${prepared.length} file${prepared.length === 1 ? '' : 's'}?`;
    const fileList = prepared.map((p) => `  • ${p.relPath} (${p.netDelta >= 0 ? '+' : ''}${p.netDelta})`).join('\n');

    const wantDiff = !isSessionApproved('multi_edit') && getShowDiffPreview();
    const closers: Array<() => Promise<void>> = [];
    if (wantDiff) {
      for (let i = 0; i < prepared.length; i++) {
        const p = prepared[i];
        const isLast = i === prepared.length - 1;
        const close = await openMultiFileDiff({
          relPath: p.relPath,
          original: p.original,
          proposed: p.proposed,
          isNewFile: false,
          isLast,
        });
        if (close) closers.push(close);
      }
    }

    let outcome: 'approve' | 'deny';
    try {
      outcome = await requestToolApproval(
        ctx,
        'multi_edit',
        summary,
        `${fileList}\n\nNet ${totalDelta >= 0 ? '+' : ''}${totalDelta} chars across all files.`,
      );
    } finally {
      for (const close of closers) await close();
    }
    if (outcome === 'deny') {
      return { content: 'Denied by user.', isError: true };
    }

    // Phase 3: write all files. Report per-file outcomes.
    const written: string[] = [];
    const failures: string[] = [];
    for (const p of prepared) {
      try {
        const uri = vscode.Uri.file(p.abs);
        const document = await vscode.workspace.openTextDocument(uri);
        const edit = new vscode.WorkspaceEdit();
        edit.replace(uri, fullDocumentRange(document), p.proposed);
        const ok = await vscode.workspace.applyEdit(edit);
        if (!ok) {
          failures.push(`${p.relPath}: applyEdit returned false`);
          continue;
        }
        const saved = document.isDirty ? await document.save() : true;
        if (!saved) {
          failures.push(`${p.relPath}: save failed`);
          continue;
        }
        written.push(p.relPath);
      } catch (err) {
        failures.push(`${p.relPath}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    const lines = [`OK: edited ${written.length}/${prepared.length} files (net ${totalDelta >= 0 ? '+' : ''}${totalDelta} chars).`];
    if (written.length > 0) lines.push('Written: ' + written.join(', '));
    if (failures.length > 0) lines.push('Failed: ' + failures.join('; '));
    return { content: lines.join('\n'), isError: failures.length > 0 };
  },
};
