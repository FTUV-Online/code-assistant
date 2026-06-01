import * as vscode from 'vscode';
import { truncate } from './common';
import type { Tool } from './types';

const MAX_CHARS = 8000;

export const getSelectionTool: Tool = {
  readonly: true,
  def: {
    name: 'get_selection',
    description:
      "Return the user's current text selection in the active editor (with file path and line range). " +
      'Returns "(no selection)" if nothing is selected.',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  async execute() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return { content: '(no active editor)' };
    const sel = editor.selection;
    if (sel.isEmpty) return { content: '(no selection)' };
    const text = editor.document.getText(sel);
    const file = vscode.workspace.asRelativePath(editor.document.uri);
    const startLine = sel.start.line + 1;
    const endLine = sel.end.line + 1;
    const languageId = editor.document.languageId;
    const header = `${file} (${languageId}, lines ${startLine}-${endLine}):\n`;
    return { content: header + truncate(text, MAX_CHARS) };
  },
};
