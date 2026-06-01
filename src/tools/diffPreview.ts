import * as path from 'path';
import * as vscode from 'vscode';
import * as log from '../util/logger';

const SCHEME = 'dev-code-preview';

const contents = new Map<string, string>();
let registered = false;
let counter = 0;

class PreviewContentProvider implements vscode.TextDocumentContentProvider {
  private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this._onDidChange.event;

  provideTextDocumentContent(uri: vscode.Uri): string {
    return contents.get(uri.toString()) ?? '';
  }

  /** Fire the content change event for a URI (used by live-updating previews). */
  fireContentChanged(uri: vscode.Uri): void {
    this._onDidChange.fire(uri);
  }
}

const provider = new PreviewContentProvider();

export function registerDiffPreviewProvider(context: vscode.ExtensionContext): void {
  if (registered) return;
  registered = true;
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(SCHEME, provider),
  );
}

function buildUri(role: 'original' | 'proposed', id: number, relPath: string): vscode.Uri {
  // Preserve the basename (and extension) so VS Code picks up the right language mode.
  const base = path.basename(relPath) || 'file';
  return vscode.Uri.from({
    scheme: SCHEME,
    path: `/${id}/${role}/${base}`,
  });
}

/**
 * Open a side-by-side diff editor showing original vs proposed content for `relPath`.
 * Returns a function that closes the diff tab and frees the cached content.
 * The close function is idempotent and never throws.
 */
export async function showDiffPreview(opts: {
  relPath: string;
  original: string;
  proposed: string;
  isNewFile: boolean;
}): Promise<() => Promise<void>> {
  const id = ++counter;
  const originalUri = buildUri('original', id, opts.relPath);
  const proposedUri = buildUri('proposed', id, opts.relPath);

  contents.set(originalUri.toString(), opts.original);
  contents.set(proposedUri.toString(), opts.proposed);

  const verb = opts.isNewFile ? 'create' : 'edit';
  const title = `dev-code AI: ${verb} ${opts.relPath} (preview)`;

  try {
    await vscode.commands.executeCommand(
      'vscode.diff',
      originalUri,
      proposedUri,
      title,
      { preview: true, preserveFocus: false } satisfies vscode.TextDocumentShowOptions,
    );
  } catch (err) {
    log.warn('diff preview open failed', err);
  }

  let closed = false;
  return async () => {
    if (closed) return;
    closed = true;
    try {
      for (const group of vscode.window.tabGroups.all) {
        for (const tab of group.tabs) {
          const input = tab.input;
          if (
            input instanceof vscode.TabInputTextDiff &&
            input.modified.toString() === proposedUri.toString()
          ) {
            await vscode.window.tabGroups.close(tab);
          }
        }
      }
    } catch (err) {
      log.warn('diff preview close failed', err);
    } finally {
      contents.delete(originalUri.toString());
      contents.delete(proposedUri.toString());
    }
  };
}

/**
 * Live-update a diff preview tab for the given path.
 * This reuses the same `dev-code-preview` content provider registered by
 * registerDiffPreviewProvider, but fires the onDidChange event so the
 * diff tab updates in place — giving a streaming / real-time effect.
 *
 * The diff tab must already be open (via showDiffPreview or openLiveDiffPreview).
 */
export function updateDiffPreviewContent(relPath: string, proposed: string): void {
  // Find the proposed URI for this path among active diff tabs
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      const input = tab.input;
      if (
        input instanceof vscode.TabInputTextDiff &&
        input.modified.scheme === SCHEME &&
        input.modified.path.includes(`/${relPath.replace(/\\/g, '/')}`) &&
        !input.modified.path.includes('/original/')
      ) {
        const uriStr = input.modified.toString();
        contents.set(uriStr, proposed);
        provider.fireContentChanged(input.modified);
        return;
      }
    }
  }
}

/**
 * Open a live-updating diff preview. Unlike showDiffPreview (which returns
 * a close function), this returns an object with updateProposed() so the
 * diff tab's proposed side can be updated incrementally.
 */
export async function openLiveDiffPreview(opts: {
  relPath: string;
  original: string;
  proposed?: string;
  isNewFile: boolean;
}): Promise<{ updateProposed: (proposed: string) => void; getCurrentProposed: () => string; close: () => Promise<void> }> {
  const id = ++counter;
  const originalUri = buildUri('original', id, opts.relPath);
  const proposedUri = buildUri('proposed', id, opts.relPath);

  const verb = opts.isNewFile ? 'create' : 'edit';
  const title = `dev-code AI: ${verb} ${opts.relPath} (preview)`;

  let proposedContent = opts.proposed ?? opts.original;

  contents.set(originalUri.toString(), opts.original);
  contents.set(proposedUri.toString(), proposedContent);

  try {
    await vscode.commands.executeCommand(
      'vscode.diff',
      originalUri,
      proposedUri,
      title,
      { preview: true, preserveFocus: false } satisfies vscode.TextDocumentShowOptions,
    );
  } catch (err) {
    log.warn('live diff preview open failed', err);
  }

  let closed = false;

  return {
    updateProposed(proposed: string): void {
      if (closed) return;
      proposedContent = proposed;
      contents.set(proposedUri.toString(), proposed);
      provider.fireContentChanged(proposedUri);
    },

    getCurrentProposed(): string {
      return proposedContent;
    },

    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      try {
        for (const group of vscode.window.tabGroups.all) {
          for (const tab of group.tabs) {
            const input = tab.input;
            if (
              input instanceof vscode.TabInputTextDiff &&
              input.modified.toString() === proposedUri.toString()
            ) {
              await vscode.window.tabGroups.close(tab);
            }
          }
        }
      } catch (err) {
        log.warn('live diff preview close failed', err);
      } finally {
        contents.delete(originalUri.toString());
        contents.delete(proposedUri.toString());
      }
    },
  };
}

/**
 * Open a diff preview for one file in a multi-file batch.
 *
 * VS Code only keeps ONE editor tab with `preview: true` — opening a second
 * preview tab replaces the first. For multi-file diffs we open the first N-1
 * files as non-preview tabs (`preview: false`) so they stay open, and only
 * the last file uses `preview: true` so it doesn't clutter the tab bar.
 */
export async function openMultiFileDiff(opts: {
  relPath: string;
  original: string;
  proposed: string;
  isNewFile: boolean;
  /** When true, opens as a preview tab (replaces any existing preview). */
  isLast: boolean;
}): Promise<() => Promise<void>> {
  const id = ++counter;
  const originalUri = buildUri('original', id, opts.relPath);
  const proposedUri = buildUri('proposed', id, opts.relPath);

  contents.set(originalUri.toString(), opts.original);
  contents.set(proposedUri.toString(), opts.proposed);

  const verb = opts.isNewFile ? 'create' : 'edit';
  const label = opts.isLast ? opts.relPath : `✎ ${opts.relPath}`;
  const title = `dev-code AI: ${verb} ${opts.relPath} (preview)`;

  try {
    await vscode.commands.executeCommand(
      'vscode.diff',
      originalUri,
      proposedUri,
      title,
      { preview: opts.isLast, preserveFocus: false } satisfies vscode.TextDocumentShowOptions,
    );
  } catch (err) {
    log.warn('multi-file diff preview open failed', err);
  }

  let closed = false;
  return async () => {
    if (closed) return;
    closed = true;
    try {
      for (const group of vscode.window.tabGroups.all) {
        for (const tab of group.tabs) {
          const input = tab.input;
          if (
            input instanceof vscode.TabInputTextDiff &&
            input.modified.toString() === proposedUri.toString()
          ) {
            await vscode.window.tabGroups.close(tab);
          }
        }
      }
    } catch (err) {
      log.warn('multi-file diff preview close failed', err);
    } finally {
      contents.delete(originalUri.toString());
      contents.delete(proposedUri.toString());
    }
  };
}
