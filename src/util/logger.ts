import type * as vscode from 'vscode';

let channel: vscode.OutputChannel | null = null;

export function initLogger(context: vscode.ExtensionContext): void {
  // Lazy require so this module is importable from unit tests
  // running outside the VS Code extension host (no "vscode" module available).
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const runtime: typeof vscode = require('vscode');
  channel = runtime.window.createOutputChannel('dev-code');
  context.subscriptions.push(channel);
}

function ts(): string {
  return new Date().toISOString().slice(11, 23);
}

function fmt(d: unknown): string {
  if (d === undefined) return '';
  if (typeof d === 'string') return d;
  try {
    return JSON.stringify(d);
  } catch {
    return String(d);
  }
}

export function info(message: string, data?: unknown): void {
  if (!channel) return;
  const extra = data !== undefined ? ' ' + fmt(data) : '';
  channel.appendLine(`[${ts()}] ${message}${extra}`);
}

export function warn(message: string, data?: unknown): void {
  if (!channel) return;
  const extra = data !== undefined ? ' ' + fmt(data) : '';
  channel.appendLine(`[${ts()}] WARN  ${message}${extra}`);
}

export function error(message: string, err: unknown): void {
  if (!channel) return;
  const detail =
    err instanceof Error
      ? `${err.message}${err.stack ? '\n' + err.stack : ''}`
      : String(err);
  channel.appendLine(`[${ts()}] ERROR ${message}: ${detail}`);
}

export function show(): void {
  channel?.show(true);
}
