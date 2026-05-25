import * as vscode from 'vscode';
import { buildContext } from './contextBuilder';
import { cleanCompletion } from './outputParser';
import { getDebounceMs, isFeatureEnabled } from '../config/settings';
import * as log from '../util/logger';
import { getProviderForFeature } from '../providers/manager';

export class DevCodeInlineProvider implements vscode.InlineCompletionItemProvider {
  private currentAbort: AbortController | null = null;

  constructor(private readonly context: vscode.ExtensionContext) {}

  refresh(): void {
    this.currentAbort?.abort();
    this.currentAbort = null;
  }

  async provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    _context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken,
  ): Promise<vscode.InlineCompletionItem[] | null> {
    if (!isFeatureEnabled('completion')) {
      log.info('trigger: skipped (completion disabled)');
      return null;
    }

    await sleep(getDebounceMs());
    if (token.isCancellationRequested) return null;

    this.currentAbort?.abort();
    const abort = new AbortController();
    this.currentAbort = abort;
    token.onCancellationRequested(() => abort.abort());

    let provider;
    try {
      provider = await getProviderForFeature(this.context, 'completion');
    } catch (err) {
      log.error('failed to resolve provider', err);
      const msg = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`dev-code: ${msg}`);
      return null;
    }
    if (!provider) {
      log.info('trigger: skipped (no active provider configured)');
      return null;
    }

    const req = buildContext(document, position);
    log.info('trigger', {
      provider: provider.id,
      language: req.language,
      file: req.filePath,
      prefixLen: req.prefix.length,
      suffixLen: req.suffix.length,
    });

    const t0 = Date.now();
    try {
      const chunks: string[] = [];
      for await (const chunk of provider.complete(req, abort.signal)) {
        if (token.isCancellationRequested) return null;
        chunks.push(chunk);
      }
      const raw = chunks.join('');
      const text = cleanCompletion(raw);
      const ms = Date.now() - t0;
      if (!text.trim()) {
        log.warn(`completion empty after clean`, { ms, rawChars: raw.length });
        return null;
      }
      log.info(`completion ready`, { ms, chars: text.length });
      return [new vscode.InlineCompletionItem(text)];
    } catch (err) {
      if (isAbortError(err)) {
        log.info('aborted');
        return null;
      }
      log.error('completion failed', err);
      return null;
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && (err.name === 'AbortError' || err.message.includes('aborted'));
}
