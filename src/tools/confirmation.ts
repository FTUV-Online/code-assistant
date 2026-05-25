import * as vscode from 'vscode';

// Tool names the user has pre-approved for this VS Code window's lifetime.
const sessionApproved = new Set<string>();

export type ConfirmOutcome = 'approve' | 'deny';

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
