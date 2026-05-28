import * as vscode from 'vscode';
import type { ToolExecutionContext } from './types';

// Tool names the user has pre-approved for this VS Code window's lifetime.
const sessionApproved = new Set<string>();

export type ConfirmOutcome = 'approve' | 'deny';

export function isSessionApproved(toolName: string): boolean {
  return sessionApproved.has(toolName);
}

export function markSessionApproved(toolName: string): void {
  sessionApproved.add(toolName);
}

export async function confirmDestructive(
  toolName: string,
  summary: string,
  detail?: string,
): Promise<ConfirmOutcome> {
  if (sessionApproved.has(toolName)) return 'approve';
  const choice = await vscode.window.showWarningMessage(
    `dev-code AI: ${summary}`,
    { modal: true, detail: detail ?? 'Approve only if this matches what you expected.' },
    'Approve',
    'Approve all this session',
  );
  if (choice === 'Approve') return 'approve';
  if (choice === 'Approve all this session') {
    sessionApproved.add(toolName);
    return 'approve';
  }
  return 'deny';
}

export function resetSessionApprovals(): void {
  sessionApproved.clear();
}

/**
 * Unified approval entry point for destructive tools.
 *  - If the tool is already session-approved → approve.
 *  - Else if the executor provided an inline channel → use the chat card.
 *  - Else fall back to a VS Code modal dialog.
 * Treats `approveAll` as approve + remember.
 */
export async function requestToolApproval(
  ctx: ToolExecutionContext,
  toolName: string,
  summary: string,
  detail?: string,
): Promise<ConfirmOutcome> {
  if (sessionApproved.has(toolName)) return 'approve';
  if (ctx.requestApproval) {
    const decision = await ctx.requestApproval({
      toolName,
      summary,
      detail,
      callId: ctx.callId,
    });
    if (decision === 'approveAll') {
      sessionApproved.add(toolName);
      return 'approve';
    }
    return decision === 'approve' ? 'approve' : 'deny';
  }
  return confirmDestructive(toolName, summary, detail);
}
