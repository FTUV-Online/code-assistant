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
