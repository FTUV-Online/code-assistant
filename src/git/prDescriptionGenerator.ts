import type * as vscode from 'vscode';
import * as log from '../util/logger';
import { getProviderForFeature } from '../providers/manager';

const SYSTEM_PROMPT = [
  'You are an expert software engineer writing a pull request description.',
  'Rules:',
  '- Output ONLY the description body in markdown — no surrounding code fences.',
  '- Use this template:',
  '  ## Summary',
  '  <2-4 sentences explaining the change and motivation>',
  '',
  '  ## Changes',
  '  - <bullet list of notable changes>',
  '',
  '  ## Testing',
  '  - <how the change was verified, or what reviewer should test>',
  '- Be specific about what changed and why. Reference code paths when helpful.',
  '- Do not invent context not present in the diff or commit log.',
  '- Keep it concise; avoid filler.',
].join('\n');

const MAX_DIFF_CHARS = 40000;
const MAX_LOG_CHARS = 6000;

export async function generatePrDescription(
  context: vscode.ExtensionContext,
  opts: { diff: string; commitLog: string; branch: string; baseBranch: string },
  signal: AbortSignal,
): Promise<string> {
  const provider = await getProviderForFeature(context, 'prDescription');
  if (!provider) {
    throw new Error(
      'No provider configured for "prDescription". Configure one in the Config tab.',
    );
  }

  const diffTruncated = opts.diff.length > MAX_DIFF_CHARS;
  const logTruncated = opts.commitLog.length > MAX_LOG_CHARS;
  const userContent = [
    `Branch: ${opts.branch}`,
    `Base branch: ${opts.baseBranch}`,
    '',
    'Commit log (newest first):',
    '```',
    (logTruncated ? opts.commitLog.slice(0, MAX_LOG_CHARS) + '\n... [truncated]' : opts.commitLog) || '(no commits found between branch and base)',
    '```',
    '',
    'Diff against base:',
    '```diff',
    diffTruncated ? opts.diff.slice(0, MAX_DIFF_CHARS) + '\n... [truncated]' : opts.diff,
    '```',
  ].join('\n');

  log.info('pr description: requesting', {
    provider: provider.id,
    diffChars: opts.diff.length,
    logChars: opts.commitLog.length,
    diffTruncated,
    logTruncated,
  });

  const t0 = Date.now();
  const chunks: string[] = [];
  for await (const chunk of provider.chat(
    [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userContent },
    ],
    { maxTokens: 1500, temperature: 0.3 },
    signal,
  )) {
    chunks.push(chunk);
  }
  const text = chunks.join('').trim();
  log.info('pr description: ready', { ms: Date.now() - t0, chars: text.length });
  return stripFences(text);
}

function stripFences(raw: string): string {
  let out = raw.trim();
  out = out.replace(/^```(?:markdown|md)?\r?\n?/, '').replace(/\r?\n?```\s*$/, '');
  return out.trim();
}
