import * as vscode from 'vscode';
import { isEnabled, isFeatureEnabled } from '../config/settings';

const LENS_KINDS: vscode.SymbolKind[] = [
  vscode.SymbolKind.Function,
  vscode.SymbolKind.Method,
  vscode.SymbolKind.Class,
  vscode.SymbolKind.Constructor,
  vscode.SymbolKind.Interface,
];

const NS = 'devCode';

export class DevCodeLensProvider implements vscode.CodeLensProvider {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.emitter.event;

  constructor() {
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration(`${NS}.codeLens`) || e.affectsConfiguration(`${NS}.features`)) {
        this.emitter.fire();
      }
    });
  }

  async provideCodeLenses(
    document: vscode.TextDocument,
    token: vscode.CancellationToken,
  ): Promise<vscode.CodeLens[]> {
    if (!isEnabled()) return [];
    if (!isCodeLensEnabled()) return [];
    if (document.uri.scheme !== 'file') return [];

    let symbols: vscode.DocumentSymbol[] | undefined;
    try {
      symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
        'vscode.executeDocumentSymbolProvider',
        document.uri,
      );
    } catch {
      return [];
    }
    if (!symbols || token.isCancellationRequested) return [];

    const lenses: vscode.CodeLens[] = [];
    const visit = (nodes: vscode.DocumentSymbol[]): void => {
      for (const sym of nodes) {
        if (LENS_KINDS.includes(sym.kind)) {
          const line = sym.selectionRange.start.line;
          const range = new vscode.Range(line, 0, line, 0);
          if (isFeatureEnabled('explain')) {
            lenses.push(
              new vscode.CodeLens(range, {
                title: '✨ Explain',
                command: 'devCode.lens.explain',
                arguments: [document.uri, sym.range],
              }),
            );
          }
          if (isFeatureEnabled('review')) {
            lenses.push(
              new vscode.CodeLens(range, {
                title: '✨ Review',
                command: 'devCode.lens.review',
                arguments: [document.uri, sym.range],
              }),
            );
          }
        }
        if (sym.children && sym.children.length > 0) visit(sym.children);
      }
    };
    visit(symbols);
    return lenses;
  }
}

export function isCodeLensEnabled(): boolean {
  return vscode.workspace.getConfiguration(NS).get<boolean>('codeLens.enabled', true);
}
