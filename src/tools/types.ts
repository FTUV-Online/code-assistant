import type * as vscode from 'vscode';
import type { ToolDef } from '../providers/base';

export type ToolExecutionContext = {
  workspaceRoot: string;
  signal: AbortSignal;
  blacklist: string[];
  runSubAgent?: (task: string, signal: AbortSignal) => Promise<string>;
};

export type ToolResult = {
  content: string;
  isError?: boolean;
};

export type ToolExecutor = (input: unknown, ctx: ToolExecutionContext) => Promise<ToolResult>;

export type Tool = {
  def: ToolDef;
  execute: ToolExecutor;
  destructive?: boolean;
  /** Which user-controlled flag gates this tool's presence in the AI's tool list. */
  gateFlag?: 'allowWriteTools' | 'allowShell';
};

export type WorkspaceFsLike = Pick<typeof vscode.workspace.fs, 'readDirectory' | 'readFile'>;
