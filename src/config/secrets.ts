import type * as vscode from 'vscode';

const KEY_PREFIX = 'devCode.apiKey.';

export function getApiKey(
  context: vscode.ExtensionContext,
  providerId: string,
): Thenable<string | undefined> {
  return context.secrets.get(`${KEY_PREFIX}${providerId}`);
}

export function setApiKey(
  context: vscode.ExtensionContext,
  providerId: string,
  key: string,
): Thenable<void> {
  return context.secrets.store(`${KEY_PREFIX}${providerId}`, key);
}

export function deleteApiKey(
  context: vscode.ExtensionContext,
  providerId: string,
): Thenable<void> {
  return context.secrets.delete(`${KEY_PREFIX}${providerId}`);
}

const MCP_TOKEN_PREFIX = 'devCode.mcpToken.';

export function getMcpToken(
  context: vscode.ExtensionContext,
  serverName: string,
): Thenable<string | undefined> {
  return context.secrets.get(`${MCP_TOKEN_PREFIX}${serverName}`);
}

export function setMcpToken(
  context: vscode.ExtensionContext,
  serverName: string,
  token: string,
): Thenable<void> {
  return context.secrets.store(`${MCP_TOKEN_PREFIX}${serverName}`, token);
}

export function deleteMcpToken(
  context: vscode.ExtensionContext,
  serverName: string,
): Thenable<void> {
  return context.secrets.delete(`${MCP_TOKEN_PREFIX}${serverName}`);
}
