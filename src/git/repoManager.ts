import * as path from 'path';
import * as vscode from 'vscode';
import * as log from '../util/logger';
import { parseBranchList } from './branchListParser';
import { gitAdd, gitCheckoutFile, gitCleanFile, gitReset, gitRun } from './gitCli';
import {
  FileChange,
  GitAPI,
  GitExtension,
  GitRepository,
  RepoSummary,
  shortStatusLabel,
  statusFromCode,
} from './types';

const SCAN_MAX_DEPTH = 6;
const SCAN_MAX_REPOS = 50;
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'out',
  'build',
  'target',
  'vendor',
  '__pycache__',
  '.next',
  '.nuxt',
  '.cache',
  '.venv',
  'venv',
  'env',
  '.tox',
  '.gradle',
  '.idea',
  '.vscode-test',
  'bin',
  'obj',
  'coverage',
]);

export class RepoManager {
  private api: GitAPI | null = null;
  private disposables: vscode.Disposable[] = [];
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;
  private _loading = false;

  get loading(): boolean {
    return this._loading;
  }

  async init(): Promise<boolean> {
    const ext = vscode.extensions.getExtension<GitExtension>('vscode.git');
    if (!ext) {
      log.warn('vscode.git extension not found');
      return false;
    }
    if (!ext.isActive) {
      await ext.activate();
    }
    const api = ext.exports.getAPI(1);
    this.api = api;

    this.disposables.push(
      api.onDidOpenRepository((r) => this.attachRepo(r)),
      api.onDidCloseRepository(() => this._onDidChange.fire()),
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        void this.rescan();
      }),
    );
    for (const repo of api.repositories) {
      this.attachRepo(repo);
    }
    log.info('git repo manager initialized', { reposBeforeScan: api.repositories.length });

    // Scan workspace folders for nested repos
    void this.rescan();
    return true;
  }

  async rescan(): Promise<void> {
    if (!this.api) return;
    this._loading = true;
    this._onDidChange.fire();

    try {
      const folders = vscode.workspace.workspaceFolders ?? [];
      const found: vscode.Uri[] = [];
      for (const folder of folders) {
        await findRepos(folder.uri, SCAN_MAX_DEPTH, found, SCAN_MAX_REPOS);
      }
      log.info('git scan found candidates', { count: found.length });

      const existing = new Set(this.api.repositories.map((r) => r.rootUri.fsPath));
      for (const uri of found) {
        if (existing.has(uri.fsPath)) continue;
        try {
          await this.api.openRepository(uri);
        } catch (err) {
          log.warn('git openRepository failed', { uri: uri.toString() });
        }
      }
      log.info('git scan complete', { repos: this.api.repositories.length });
    } catch (err) {
      log.error('git rescan', err);
    } finally {
      this._loading = false;
      this._onDidChange.fire();
    }
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
    this._onDidChange.dispose();
  }

  hasGit(): boolean {
    return this.api !== null;
  }

  listRepos(): RepoSummary[] {
    if (!this.api) return [];
    return this.api.repositories.map((r) => this.toSummary(r));
  }

  getRepo(id: string): GitRepository | null {
    if (!this.api) return null;
    return this.api.repositories.find((r) => r.rootUri.toString() === id) ?? null;
  }

  async stage(repoId: string, paths: string[]): Promise<void> {
    const safe = sanitizePaths(paths);
    if (safe.length === 0) throw new Error('No valid file paths to stage.');
    const groups = this.groupByRepo(safe, repoId);
    if (groups.size === 0) throw new Error('No matching repository for these files.');
    try {
      for (const [id, files] of groups) {
        const repo = this.getRepo(id);
        if (!repo) continue;
        const cwd = repo.rootUri.fsPath;
        const relPaths = files.map((p) => toRel(cwd, p));
        await gitAdd(cwd, relPaths);
      }
    } finally {
      this._onDidChange.fire();
    }
  }

  async unstage(repoId: string, paths: string[]): Promise<void> {
    const safe = sanitizePaths(paths);
    if (safe.length === 0) throw new Error('No valid file paths to unstage.');
    const groups = this.groupByRepo(safe, repoId);
    if (groups.size === 0) throw new Error('No matching repository for these files.');
    try {
      for (const [id, files] of groups) {
        const repo = this.getRepo(id);
        if (!repo) continue;
        const cwd = repo.rootUri.fsPath;
        const relPaths = files.map((p) => toRel(cwd, p));
        await gitReset(cwd, relPaths);
      }
    } finally {
      this._onDidChange.fire();
    }
  }

  async discard(repoId: string, filePath: string): Promise<void> {
    const safe = sanitizePaths([filePath]);
    if (safe.length === 0) throw new Error('Invalid file path.');
    const target = this.findRepoForFile(safe[0]) ?? this.getRepo(repoId);
    if (!target) throw new Error('No matching repository for this file.');
    const cwd = target.rootUri.fsPath;
    const rel = toRel(cwd, safe[0]);

    // Determine if the file is tracked (modified/added) or untracked.
    const change =
      target.state.workingTreeChanges.find(
        (c) => c.uri.fsPath.toLowerCase() === safe[0].toLowerCase(),
      ) ??
      target.state.indexChanges.find(
        (c) => c.uri.fsPath.toLowerCase() === safe[0].toLowerCase(),
      );
    const status = change ? statusFromCode(change.status) : 'MODIFIED';
    const isUntracked = status === 'UNTRACKED' || status === 'IGNORED';

    try {
      if (isUntracked) {
        await gitCleanFile(cwd, [rel]);
      } else {
        await gitCheckoutFile(cwd, [rel]);
      }
    } finally {
      this._onDidChange.fire();
    }
  }

  private groupByRepo(paths: string[], fallbackRepoId: string): Map<string, string[]> {
    const groups = new Map<string, string[]>();
    for (const p of paths) {
      const repo = this.findRepoForFile(p) ?? this.getRepo(fallbackRepoId);
      if (!repo) {
        log.warn('git: no repo found for path', { p });
        continue;
      }
      const id = repo.rootUri.toString();
      const arr = groups.get(id) ?? [];
      arr.push(p);
      groups.set(id, arr);
    }
    return groups;
  }

  private findRepoForFile(filePath: string): GitRepository | null {
    if (!this.api) return null;
    const target = filePath.toLowerCase();
    let best: GitRepository | null = null;
    let bestLen = -1;
    for (const r of this.api.repositories) {
      const root = r.rootUri.fsPath.toLowerCase();
      const sep = root.endsWith('\\') || root.endsWith('/') ? '' : path.sep.toLowerCase();
      if (target === root || target.startsWith(root + sep) || target.startsWith(root + '/') || target.startsWith(root + '\\')) {
        if (root.length > bestLen) {
          best = r;
          bestLen = root.length;
        }
      }
    }
    return best;
  }

  async getFileDiff(repoId: string, filePath: string, staged: boolean): Promise<string> {
    const repo = this.getRepo(repoId);
    if (!repo) throw new Error('Repository not found.');
    if (staged) {
      return repo.diffIndexWithHEAD(filePath);
    }
    return repo.diffWithHEAD(filePath);
  }

  async stageAll(repoId: string): Promise<void> {
    const summary = this.listRepos().find((r) => r.id === repoId);
    if (!summary) return;
    await this.stage(
      repoId,
      summary.unstaged.map((c) => c.path),
    );
  }

  async unstageAll(repoId: string): Promise<void> {
    const summary = this.listRepos().find((r) => r.id === repoId);
    if (!summary) return;
    await this.unstage(
      repoId,
      summary.staged.map((c) => c.path),
    );
  }

  async getStagedDiff(repoId: string): Promise<string> {
    const repo = this.getRepo(repoId);
    if (!repo) throw new Error('Repository not found.');
    return repo.diff(true);
  }

  async getBranchInfo(repoId: string): Promise<{ branch: string; cwd: string }> {
    const repo = this.getRepo(repoId);
    if (!repo) throw new Error('Repository not found.');
    const cwd = repo.rootUri.fsPath;
    let branch = '';
    try {
      branch = (await gitRun(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
    } catch {
      branch = '';
    }
    return { branch, cwd };
  }

  async getDiffAgainstBase(
    repoId: string,
    base: string,
  ): Promise<{ diff: string; commitLog: string; branch: string; baseBranch: string }> {
    const { branch, cwd } = await this.getBranchInfo(repoId);
    const resolvedBase = await this.resolveBaseBranch(cwd, base, branch);
    let diff = '';
    let commitLog = '';
    try {
      diff = await gitRun(cwd, ['diff', '--no-color', `${resolvedBase}...HEAD`]);
    } catch (err) {
      log.warn('diff against base failed', { repoId, base: resolvedBase, err: String(err) });
    }
    try {
      commitLog = await gitRun(cwd, [
        'log',
        '--no-color',
        '--pretty=format:%h %s',
        `${resolvedBase}..HEAD`,
      ]);
    } catch (err) {
      log.warn('log against base failed', { repoId, base: resolvedBase, err: String(err) });
    }
    return { diff, commitLog, branch, baseBranch: resolvedBase };
  }

  async listBranches(repoId: string): Promise<string[]> {
    const repo = this.getRepo(repoId);
    if (!repo) throw new Error('Repository not found.');
    const cwd = repo.rootUri.fsPath;
    try {
      const raw = await gitRun(cwd, ['branch', '--no-color', '-a', '--format=%(refname:short)']);
      return parseBranchList(raw);
    } catch {
      // fallback to just local branches
      try {
        const raw = await gitRun(cwd, ['branch', '--no-color', '--format=%(refname:short)']);
        return parseBranchList(raw);
      } catch {
        return [];
      }
    }
  }

  async checkoutBranch(repoId: string, branch: string): Promise<void> {
    const repo = this.getRepo(repoId);
    if (!repo) throw new Error('Repository not found.');
    if (!branch.trim()) throw new Error('Branch name is required.');
    const cwd = repo.rootUri.fsPath;
    await gitRun(cwd, ['checkout', branch.trim()]);
    this._onDidChange.fire();
  }

  async getUnstagedDiff(repoId: string): Promise<string> {
    const repo = this.getRepo(repoId);
    if (!repo) throw new Error('Repository not found.');
    const cwd = repo.rootUri.fsPath;
    let staged = '';
    let unstaged = '';
    try {
      staged = await gitRun(cwd, ['diff', '--no-color', '--cached']);
    } catch {}
    try {
      unstaged = await gitRun(cwd, ['diff', '--no-color']);
    } catch {}
    return [staged, unstaged].filter(Boolean).join('\n');
  }

  private async resolveBaseBranch(
    cwd: string,
    requested: string,
    currentBranch: string,
  ): Promise<string> {
    const candidates = requested.trim()
      ? [requested.trim()]
      : ['origin/main', 'origin/master', 'main', 'master', 'develop'];
    for (const c of candidates) {
      if (c === currentBranch) continue;
      try {
        await gitRun(cwd, ['rev-parse', '--verify', c]);
        return c;
      } catch {
        // try next
      }
    }
    // Last resort: HEAD~10 so we still produce some diff
    return 'HEAD~10';
  }

  async commit(repoId: string, message: string): Promise<void> {
    const repo = this.getRepo(repoId);
    if (!repo) throw new Error('Repository not found.');
    if (!message.trim()) throw new Error('Commit message is empty.');
    log.info('git commit', { repoId, msgChars: message.length });
    await repo.commit(message);
    this._onDidChange.fire();
  }

  private attachRepo(repo: GitRepository): void {
    this.disposables.push(repo.state.onDidChange(() => this._onDidChange.fire()));
    this._onDidChange.fire();
  }

  private toSummary(repo: GitRepository): RepoSummary {
    const rootPath = repo.rootUri.fsPath;
    const rootName = path.basename(rootPath);
    const head = repo.state.HEAD;

    return {
      id: repo.rootUri.toString(),
      rootPath,
      rootName,
      branch: head?.name ?? null,
      ahead: head?.ahead ?? 0,
      behind: head?.behind ?? 0,
      staged: repo.state.indexChanges.map((c) => toFileChange(c, rootPath, true)),
      unstaged: repo.state.workingTreeChanges.map((c) => toFileChange(c, rootPath, false)),
      merge: repo.state.mergeChanges.map((c) => toFileChange(c, rootPath, false)),
    };
  }
}

async function findRepos(
  root: vscode.Uri,
  depth: number,
  results: vscode.Uri[],
  max: number,
): Promise<void> {
  if (depth < 0 || results.length >= max) return;

  let entries: [string, vscode.FileType][];
  try {
    entries = await vscode.workspace.fs.readDirectory(root);
  } catch {
    return;
  }

  // If this dir contains a .git entry, treat it as a repo root and stop recursing.
  if (entries.some(([name]) => name === '.git')) {
    results.push(root);
    return;
  }

  for (const [name, type] of entries) {
    if (results.length >= max) return;
    if ((type & vscode.FileType.Directory) === 0) continue;
    if (SKIP_DIRS.has(name)) continue;
    if (name.startsWith('.')) continue;
    const subUri = vscode.Uri.joinPath(root, name);
    await findRepos(subUri, depth - 1, results, max);
  }
}

function toFileChange(
  c: { uri: vscode.Uri; status: number },
  rootPath: string,
  staged: boolean,
): FileChange {
  try {
    const filePath = c.uri.fsPath;
    const rel = typeof filePath === 'string' ? path.relative(rootPath, filePath) : '';
    return {
      uri: c.uri,
      path: typeof filePath === 'string' ? filePath : '',
      relPath: typeof rel === 'string' ? rel.replace(/\\/g, '/') : '',
      status: statusFromCode(c.status),
      staged,
    };
  } catch (err) {
    log.error('toFileChange failed', err);
    return {
      uri: c.uri,
      path: '',
      relPath: '(unreadable)',
      status: statusFromCode(c.status),
      staged,
    };
  }
}

function toRel(cwd: string, abs: string): string {
  // Use forward slashes — git CLI accepts both on Windows but forward slashes
  // are the safer cross-platform choice.
  return path.relative(cwd, abs).replace(/\\/g, '/');
}

function sanitizePaths(paths: unknown): string[] {
  if (!Array.isArray(paths)) return [];
  const out: string[] = [];
  for (const p of paths) {
    if (typeof p === 'string' && p.length > 0) out.push(p);
  }
  return out;
}

export { shortStatusLabel };
