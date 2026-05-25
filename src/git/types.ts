import type * as vscode from 'vscode';

export type GitStatusCode =
  | 'INDEX_MODIFIED'
  | 'INDEX_ADDED'
  | 'INDEX_DELETED'
  | 'INDEX_RENAMED'
  | 'INDEX_COPIED'
  | 'MODIFIED'
  | 'DELETED'
  | 'UNTRACKED'
  | 'IGNORED'
  | 'INTENT_TO_ADD'
  | 'ADDED_BY_US'
  | 'ADDED_BY_THEM'
  | 'DELETED_BY_US'
  | 'DELETED_BY_THEM'
  | 'BOTH_ADDED'
  | 'BOTH_DELETED'
  | 'BOTH_MODIFIED';

const STATUS_MAP: Record<number, GitStatusCode> = {
  0: 'INDEX_MODIFIED',
  1: 'INDEX_ADDED',
  2: 'INDEX_DELETED',
  3: 'INDEX_RENAMED',
  4: 'INDEX_COPIED',
  5: 'MODIFIED',
  6: 'DELETED',
  7: 'UNTRACKED',
  8: 'IGNORED',
  9: 'INTENT_TO_ADD',
  10: 'ADDED_BY_US',
  11: 'ADDED_BY_THEM',
  12: 'DELETED_BY_US',
  13: 'DELETED_BY_THEM',
  14: 'BOTH_ADDED',
  15: 'BOTH_DELETED',
  16: 'BOTH_MODIFIED',
};

export function statusFromCode(code: number): GitStatusCode {
  return STATUS_MAP[code] ?? 'MODIFIED';
}

export function shortStatusLabel(s: GitStatusCode): string {
  switch (s) {
    case 'INDEX_MODIFIED':
    case 'MODIFIED':
    case 'BOTH_MODIFIED':
      return 'M';
    case 'INDEX_ADDED':
    case 'INTENT_TO_ADD':
    case 'ADDED_BY_US':
    case 'ADDED_BY_THEM':
    case 'BOTH_ADDED':
      return 'A';
    case 'INDEX_DELETED':
    case 'DELETED':
    case 'DELETED_BY_US':
    case 'DELETED_BY_THEM':
    case 'BOTH_DELETED':
      return 'D';
    case 'INDEX_RENAMED':
      return 'R';
    case 'INDEX_COPIED':
      return 'C';
    case 'UNTRACKED':
      return 'U';
    case 'IGNORED':
      return 'I';
  }
}

export type FileChange = {
  uri: vscode.Uri;
  path: string;
  relPath: string;
  status: GitStatusCode;
  staged: boolean;
};

export type RepoSummary = {
  id: string;
  rootPath: string;
  rootName: string;
  branch: string | null;
  ahead: number;
  behind: number;
  staged: FileChange[];
  unstaged: FileChange[];
  merge: FileChange[];
};

// Minimal interface for VS Code's built-in git extension API
// Reference: https://github.com/microsoft/vscode/blob/main/extensions/git/src/api/git.d.ts
export interface GitAPI {
  readonly repositories: GitRepository[];
  readonly onDidOpenRepository: vscode.Event<GitRepository>;
  readonly onDidCloseRepository: vscode.Event<GitRepository>;
  openRepository(root: vscode.Uri): Promise<GitRepository | null>;
}

export interface GitRepository {
  readonly rootUri: vscode.Uri;
  readonly state: GitRepositoryState;
  add(resources: vscode.Uri[]): Promise<void>;
  revert(resources: vscode.Uri[]): Promise<void>;
  clean(paths: string[]): Promise<void>;
  diff(cached?: boolean): Promise<string>;
  diffWithHEAD(path: string): Promise<string>;
  diffIndexWithHEAD(path: string): Promise<string>;
  commit(message: string, opts?: { all?: boolean; signoff?: boolean; amend?: boolean }): Promise<void>;
}

export interface GitRepositoryState {
  readonly HEAD: GitBranch | undefined;
  readonly workingTreeChanges: GitChange[];
  readonly indexChanges: GitChange[];
  readonly mergeChanges: GitChange[];
  readonly onDidChange: vscode.Event<void>;
}

export interface GitChange {
  readonly uri: vscode.Uri;
  readonly originalUri: vscode.Uri;
  readonly renameUri: vscode.Uri | undefined;
  readonly status: number;
}

export interface GitBranch {
  readonly name?: string;
  readonly upstream?: { name: string; remote: string };
  readonly ahead?: number;
  readonly behind?: number;
}

export interface GitExtension {
  enabled: boolean;
  getAPI(version: 1): GitAPI;
}
