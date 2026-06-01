import type * as vscode from 'vscode';
import type { ToolDef } from '../providers/base';

export type ApprovalRequest = {
  toolName: string;
  summary: string;
  detail?: string;
  /** Tool-call id from the LLM; lets the UI tie the prompt to the right tool card. */
  callId?: string;
};

export type ApprovalDecision = 'approve' | 'approveAll' | 'deny';

export type ToolExecutionContext = {
  workspaceRoot: string;
  signal: AbortSignal;
  blacklist: string[];
  runSubAgent?: (task: string, signal: AbortSignal) => Promise<string>;
  /** Inline approval channel — when set, tools should prefer this over modal dialogs. */
  requestApproval?: (req: ApprovalRequest) => Promise<ApprovalDecision>;
  /** Current LLM tool-call id (set per-call by the executor). */
  callId?: string;
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
  /** When true, the tool only reads state and can safely run in parallel with other readonly tools. */
  readonly?: boolean;
  /** Which user-controlled flag gates this tool's presence in the AI's tool list. */
  gateFlag?: 'allowWriteTools' | 'allowShell';
};

export type WorkspaceFsLike = Pick<typeof vscode.workspace.fs, 'readDirectory' | 'readFile'>;
