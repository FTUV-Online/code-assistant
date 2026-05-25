import { execFile } from 'child_process';
import { promisify } from 'util';
import * as vscode from 'vscode';
import * as log from '../util/logger';

const execFileAsync = promisify(execFile);
const MAX_BUFFER = 10 * 1024 * 1024; // 10 MB

function getGitExecutable(): string {
  const cfg = vscode.workspace.getConfiguration('git').get<string | string[]>('path');
  if (Array.isArray(cfg) && cfg.length > 0 && typeof cfg[0] === 'string') return cfg[0];
  if (typeof cfg === 'string' && cfg.length > 0) return cfg;
  return 'git';
}

export async function gitRun(cwd: string, args: string[]): Promise<string> {
  const bin = getGitExecutable();
  log.info('git cli', { bin, cwd, args });
  try {
    const { stdout } = await execFileAsync(bin, args, {
      cwd,
      maxBuffer: MAX_BUFFER,
      windowsHide: true,
    });
    return stdout;
  } catch (err) {
    const stderr = (err as { stderr?: string })?.stderr ?? '';
    const message = stderr.trim() || (err instanceof Error ? err.message : String(err));
    log.error('git cli failed', { args, stderr: stderr.slice(0, 500) });
    throw new Error(`git ${args[0]} failed: ${message}`);
  }
}

export function gitAdd(cwd: string, paths: string[]): Promise<unknown> {
  if (paths.length === 0) return Promise.resolve();
  return gitRun(cwd, ['add', '--', ...paths]);
}

export function gitReset(cwd: string, paths: string[]): Promise<unknown> {
  if (paths.length === 0) return Promise.resolve();
  // `git reset HEAD -- <paths>` works on any git version that supports the API
  // (older alias for `git restore --staged`).
  return gitRun(cwd, ['reset', 'HEAD', '--', ...paths]);
}

export function gitCheckoutFile(cwd: string, paths: string[]): Promise<unknown> {
  if (paths.length === 0) return Promise.resolve();
  return gitRun(cwd, ['checkout', 'HEAD', '--', ...paths]);
}

export function gitCleanFile(cwd: string, paths: string[]): Promise<unknown> {
  if (paths.length === 0) return Promise.resolve();
  return gitRun(cwd, ['clean', '-f', '--', ...paths]);
}
