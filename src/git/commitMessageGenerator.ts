import type * as vscode from 'vscode';
import * as log from '../util/logger';
import { getProviderForFeature } from '../providers/manager';

const SYSTEM_PROMPT =
  'You are an expert software engineer writing a concise git commit message ' +
  'from a staged diff. Follow Conventional Commits when applicable ' +
  '(types: feat, fix, refactor, docs, test, chore, perf, style, ci, build).\n' +
  'Rules:\n' +
  '- Output ONLY the commit message — no quotes, no markdown, no preamble.\n' +
  '- First line is a short summary in imperative mood, <= 72 characters.\n' +
  '- If the diff has multiple concerns, add a blank line then a brief bullet list.\n' +
  '- Do not invent changes that are not in the diff.';

const MAX_DIFF_CHARS = 20000;

export async function generateCommitMessage(
  context: vscode.ExtensionContext,
  diff: string,
  signal: AbortSignal,
): Promise<string> {
  const provider = await getProviderForFeature(context, 'commitMessage');
  if (!provider) {
    throw new Error('No provider configured for "commitMessage". Configure one in the Config tab.');
  }

  const truncated = diff.length > MAX_DIFF_CHARS;
  const userContent =
    'Generate a commit message for the following staged diff:\n\n```diff\n' +
    (truncated ? diff.slice(0, MAX_DIFF_CHARS) + '\n... [truncated]' : diff) +
    '\n```';

  log.info('commit message: requesting', {
    provider: provider.id,
    diffChars: diff.length,
    truncated,
  });

  const t0 = Date.now();
  const chunks: string[] = [];
  for await (const chunk of provider.chat(
    [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userContent },
    ],
    { maxTokens: 400, temperature: 0.3 },
    signal,
  )) {
    chunks.push(chunk);
  }
  const text = chunks.join('').trim();
  log.info('commit message: ready', { ms: Date.now() - t0, chars: text.length });
  return cleanMessage(text);
}

function cleanMessage(raw: string): string {
  let out = raw.trim();
  // Strip surrounding code fences if the model added them
  out = out.replace(/^```[a-zA-Z0-9_+-]*\r?\n?/, '').replace(/\r?\n?```\s*$/, '');
  // Strip a single pair of surrounding quotes/backticks if any
  if (
    (out.startsWith('"') && out.endsWith('"')) ||
    (out.startsWith("'") && out.endsWith("'")) ||
    (out.startsWith('`') && out.endsWith('`'))
  ) {
    out = out.slice(1, -1);
  }
  return out.trim();
}
