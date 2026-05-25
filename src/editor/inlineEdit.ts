import * as vscode from 'vscode';
import { isFeatureEnabled } from '../config/settings';
import { getProviderForFeature } from '../providers/manager';
import * as log from '../util/logger';

const SYSTEM_PROMPT = [
  'You are a precise code-rewriting assistant invoked from an inline editor command.',
  'The user selected a code range and is asking you to transform it.',
  'Rules:',
  '- Output ONLY the new code that should replace the selection — no markdown fences, no explanation, no preamble.',
  '- Preserve the surrounding indentation style and language idioms.',
  '- Do not add comments unless the user explicitly asks for them.',
  '- If the request is ambiguous, make the smallest reasonable change.',
].join('\n');

const MAX_INPUT_CHARS = 8000;

export async function runInlineEdit(context: vscode.ExtensionContext): Promise<void> {
  if (!isFeatureEnabled('rewrite')) {
    vscode.window.showInformationMessage(
      'dev-code: the "rewrite" feature is disabled. Enable it in the Config tab.',
    );
    return;
  }
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showInformationMessage('dev-code: open a file first.');
    return;
  }
  let range: vscode.Range = editor.selection;
  if (range.isEmpty) {
    // Default to the current line if no selection
    const line = editor.document.lineAt(range.start.line);
    range = line.range;
  }
  const code = editor.document.getText(range);
  if (!code.trim()) {
    vscode.window.showInformationMessage('dev-code: selection is empty.');
    return;
  }
  if (code.length > MAX_INPUT_CHARS) {
    vscode.window.showWarningMessage(
      `dev-code: selection is large (${code.length} chars). Inline edit works best with ≤ ${MAX_INPUT_CHARS} chars.`,
    );
  }

  const instruction = await vscode.window.showInputBox({
    title: 'dev-code · Inline edit',
    prompt: 'Describe how to transform the selection',
    placeHolder: 'e.g. add types · extract helper · fix bug · convert to async',
    ignoreFocusOut: true,
  });
  if (!instruction || !instruction.trim()) return;

  const provider = await getProviderForFeature(context, 'rewrite');
  if (!provider) {
    vscode.window.showErrorMessage(
      'dev-code: no provider configured for "rewrite". Configure one in the Config tab.',
    );
    return;
  }

  const languageId = editor.document.languageId;
  const userContent = [
    `Language: ${languageId}`,
    `Instruction: ${instruction.trim()}`,
    '',
    'Current code (replace this exactly):',
    '```' + languageId,
    code,
    '```',
  ].join('\n');

  const ctrl = new AbortController();
  const docVersionAtStart = editor.document.version;

  return await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'dev-code · generating inline edit…',
      cancellable: true,
    },
    async (progress, token) => {
      token.onCancellationRequested(() => ctrl.abort());
      log.info('inline edit: start', {
        provider: provider.id,
        chars: code.length,
        lang: languageId,
      });
      const t0 = Date.now();
      const chunks: string[] = [];
      try {
        for await (const chunk of provider.chat(
          [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: userContent },
          ],
          { maxTokens: 2000, temperature: 0.3 },
          ctrl.signal,
        )) {
          chunks.push(chunk);
        }
      } catch (err) {
        if (ctrl.signal.aborted) {
          log.info('inline edit: cancelled');
          return;
        }
        const m = err instanceof Error ? err.message : String(err);
        log.error('inline edit', err);
        vscode.window.showErrorMessage('dev-code: inline edit failed — ' + m);
        return;
      }
      const replacement = stripFences(chunks.join(''));
      log.info('inline edit: done', { ms: Date.now() - t0, chars: replacement.length });
      if (!replacement) {
        vscode.window.showWarningMessage('dev-code: model returned an empty replacement.');
        return;
      }
      if (editor.document.version !== docVersionAtStart) {
        const proceed = await vscode.window.showWarningMessage(
          'dev-code: the document changed during generation. Apply anyway?',
          { modal: false },
          'Apply',
          'Discard',
        );
        if (proceed !== 'Apply') return;
      }
      const ok = await editor.edit((b) => b.replace(range, replacement));
      if (!ok) {
        vscode.window.showErrorMessage('dev-code: failed to apply edit.');
        return;
      }
      progress.report({ message: 'Applied. Use Ctrl+Z to undo.' });
    },
  );
}

function stripFences(raw: string): string {
  let out = raw.trim();
  // Remove a single leading code fence (optionally with language tag)
  out = out.replace(/^```[a-zA-Z0-9_+\-.]*\r?\n/, '');
  // Remove a trailing fence
  out = out.replace(/\r?\n```\s*$/, '');
  return out;
}
