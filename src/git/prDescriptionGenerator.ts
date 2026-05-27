import type * as vscode from 'vscode';
import * as log from '../util/logger';
import type { LLMProvider } from '../providers/base';
import { getProviderForFeature } from '../providers/manager';

const TITLE_SYSTEM_PROMPT = [
  'You are an expert software engineer writing a pull request title.',
  'Rules:',
  '- Output ONLY the PR title text. No quotes, no markdown, no preamble.',
  '- Keep it concise, specific, and under 72 characters.',
  '- Use imperative mood.',
  '- Prefer conventional prefixes like feat, fix, refactor, chore, docs, test, perf, ci, build when they fit the change.',
  '- Do not invent context not present in the diff or commit log.',
].join('\n');

const BODY_SYSTEM_PROMPT = [
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

type PrContext = {
  diff: string;
  commitLog: string;
  branch: string;
  baseBranch: string;
  instructions?: string;
  template?: string;
};

export async function generatePrDescription(
  context: vscode.ExtensionContext,
  opts: PrContext,
  signal: AbortSignal,
): Promise<{ title: string; body: string }> {
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
    opts.instructions?.trim() ? '' : null,
    opts.instructions?.trim() ? 'User instructions:' : null,
    opts.instructions?.trim() ? opts.instructions.trim() : null,
    opts.template?.trim() ? '' : null,
    opts.template?.trim() ? 'Requested template:' : null,
    opts.template?.trim() ? opts.template.trim() : null,
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
  ].filter((part): part is string => part !== null).join('\n');

  log.info('pr description: requesting', {
    provider: provider.id,
    diffChars: opts.diff.length,
    logChars: opts.commitLog.length,
    diffTruncated,
    logTruncated,
  });

  const t0 = Date.now();
  const [title, body] = await Promise.all([
    collectResponse(provider, TITLE_SYSTEM_PROMPT, userContent, signal, 120),
    collectResponse(provider, BODY_SYSTEM_PROMPT, userContent, signal, 1500),
  ]);

  const cleanTitle = cleanTitleText(title) || fallbackTitle(opts.branch);
  const cleanBody = stripFences(body);
  log.info('pr description: ready', { ms: Date.now() - t0, titleChars: cleanTitle.length, bodyChars: cleanBody.length });
  return { title: cleanTitle, body: cleanBody };
}

async function collectResponse(
  provider: LLMProvider,
  systemPrompt: string,
  userContent: string,
  signal: AbortSignal,
  maxTokens: number,
): Promise<string> {
  const chunks: string[] = [];
  for await (const chunk of provider.chat(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ],
    { maxTokens, temperature: 0.3 },
    signal,
  )) {
    chunks.push(chunk);
  }
  return chunks.join('').trim();
}

function cleanTitleText(raw: string): string {
  let out = stripFences(raw).replace(/^#+\s*/, '').trim();
  if (
    (out.startsWith('"') && out.endsWith('"')) ||
    (out.startsWith("'") && out.endsWith("'")) ||
    (out.startsWith('`') && out.endsWith('`'))
  ) {
    out = out.slice(1, -1).trim();
  }
  return out.replace(/\s+/g, ' ').trim();
}

function fallbackTitle(branch: string): string {
  const cleaned = branch.replace(/^refs\/heads\//, '').replace(/[\/_-]+/g, ' ').trim();
  return cleaned ? `Update ${cleaned}` : 'PR from dev-code';
}

function stripFences(raw: string): string {
  let out = raw.trim();
  out = out.replace(/^```(?:markdown|md)?\r?\n?/, '').replace(/\r?\n?```\s*$/, '');
  return out.trim();
}
