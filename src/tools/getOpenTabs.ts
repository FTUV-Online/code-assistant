import * as vscode from 'vscode';
import type { Tool } from './types';

export const getOpenTabsTool: Tool = {
  def: {
    name: 'get_open_tabs',
    description:
      'List relative file paths currently open in editor tabs. ' +
      'The active tab is marked with "*". ' +
      'Useful to learn what the user is currently working on.',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  async execute() {
    const paths: string[] = [];
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        const tabInput = tab.input as { uri?: vscode.Uri } | undefined;
        const uri = tabInput?.uri;
        if (uri && uri.scheme === 'file') {
          paths.push(vscode.workspace.asRelativePath(uri));
        }
      }
    }
    const seen = new Set<string>();
    const unique = paths.filter((p) => (seen.has(p) ? false : (seen.add(p), true)));
    if (unique.length === 0) return { content: '(no file tabs are open)' };
    const activeUri = vscode.window.activeTextEditor?.document.uri;
    const activeRel = activeUri ? vscode.workspace.asRelativePath(activeUri) : '';
    const lines = unique.map((p) => (p === activeRel ? `* ${p} (active)` : `  ${p}`));
    return { content: lines.join('\n') };
  },
};
