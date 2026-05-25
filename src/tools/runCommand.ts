import { spawn } from 'child_process';
import * as os from 'os';
import {
  getShellAutoApprove,
  getShellTimeoutMs,
} from '../config/settings';
import { resolveSafePath, truncate } from './common';
import { confirmDestructive } from './confirmation';
import { hasShellMetachars, isAutoApproved } from './shellSafety';
import type { Tool } from './types';

const MAX_TIMEOUT = 300_000; // 5 minutes
const MIN_TIMEOUT = 1000;
const MAX_OUTPUT_CHARS = 50_000;

type Input = {
  command?: string;
  cwd?: string;
  timeoutMs?: number;
};

export const runCommandTool: Tool = {
  destructive: true,
  gateFlag: 'allowShell',
  def: {
    name: 'run_command',
    description:
      'Run a shell command (PowerShell on Windows, sh on Linux/Mac). Each call asks for user approval ' +
      'unless the command matches an entry in devCode.toolUse.shellAutoApprove. Working directory ' +
      'defaults to the workspace root and is constrained inside it. Stdout, stderr, and exit code ' +
      'are returned. Use for build/test/lint commands, package managers, git, etc.',
    input_schema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The shell command to execute.' },
        cwd: {
          type: 'string',
          description:
            'Optional working directory (relative to workspace root). Must stay inside the workspace.',
        },
        timeoutMs: {
          type: 'number',
          description: 'Per-call timeout in milliseconds (max 300000).',
        },
      },
      required: ['command'],
    },
  },
  async execute(input, ctx) {
    const { command, cwd: cwdInput, timeoutMs } = (input ?? {}) as Input;
    if (!command || typeof command !== 'string' || !command.trim()) {
      return { content: 'Error: "command" is required.', isError: true };
    }

    let cwd = ctx.workspaceRoot;
    if (cwdInput && cwdInput !== '.') {
      const safe = resolveSafePath(ctx.workspaceRoot, cwdInput);
      if (!safe) {
        return {
          content: `Error: cwd "${cwdInput}" resolves outside the workspace.`,
          isError: true,
        };
      }
      cwd = safe;
    }

    const defaultTimeout = getShellTimeoutMs();
    const timeout = Math.min(
      MAX_TIMEOUT,
      Math.max(MIN_TIMEOUT, timeoutMs ?? defaultTimeout),
    );

    const autoApprovePatterns = getShellAutoApprove();
    const auto = isAutoApproved(command, autoApprovePatterns);
    if (!auto) {
      const meta = hasShellMetachars(command);
      const outcome = await confirmDestructive(
        'run_command',
        `Run: ${command.length > 80 ? command.slice(0, 80) + '…' : command}`,
        `Working dir: ${cwd}\nTimeout: ${timeout}ms` +
          (meta
            ? '\n\n⚠ Contains shell operators (&, |, ;, >, $(, etc.). Auto-approve is blocked for safety — review carefully.'
            : ''),
      );
      if (outcome === 'deny') {
        return { content: 'Denied by user.', isError: true };
      }
    }

    return await new Promise((resolve) => {
      const startedAt = Date.now();
      let stdout = '';
      let stderr = '';
      let stdoutTruncated = false;
      let stderrTruncated = false;

      const isWindows = os.platform() === 'win32';
      // shell: true uses platform default (cmd.exe on Windows, sh on Unix).
      // For Windows we explicitly use PowerShell because it's the modern default
      // and matches what most devs expect.
      const child = spawn(command, [], {
        cwd,
        shell: isWindows ? 'powershell.exe' : true,
        windowsHide: true,
        env: process.env,
      });

      let finished = false;
      const finish = (result: { content: string; isError: boolean }) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        if (abortHandler) ctx.signal.removeEventListener?.('abort', abortHandler);
        resolve(result);
      };

      const timer = setTimeout(() => {
        try {
          child.kill();
        } catch {
          /* ignore */
        }
        finish({
          content: buildOutput({
            stdout,
            stderr,
            stdoutTruncated,
            stderrTruncated,
            exitCode: null,
            signal: 'timeout',
            tookMs: Date.now() - startedAt,
          }),
          isError: true,
        });
      }, timeout);

      const abortHandler = () => {
        try {
          child.kill();
        } catch {
          /* ignore */
        }
      };
      try {
        ctx.signal.addEventListener?.('abort', abortHandler);
      } catch {
        /* ignore */
      }

      child.stdout?.on('data', (chunk: Buffer) => {
        if (!stdoutTruncated) {
          const room = MAX_OUTPUT_CHARS - stdout.length;
          if (room <= 0) {
            stdoutTruncated = true;
          } else {
            const piece = chunk.toString('utf8');
            stdout += piece.length > room ? piece.slice(0, room) : piece;
            if (stdout.length >= MAX_OUTPUT_CHARS) stdoutTruncated = true;
          }
        }
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        if (!stderrTruncated) {
          const room = MAX_OUTPUT_CHARS - stderr.length;
          if (room <= 0) {
            stderrTruncated = true;
          } else {
            const piece = chunk.toString('utf8');
            stderr += piece.length > room ? piece.slice(0, room) : piece;
            if (stderr.length >= MAX_OUTPUT_CHARS) stderrTruncated = true;
          }
        }
      });

      child.on('error', (err) => {
        finish({
          content: `Error spawning shell: ${err.message}`,
          isError: true,
        });
      });

      child.on('close', (code, signal) => {
        finish({
          content: buildOutput({
            stdout,
            stderr,
            stdoutTruncated,
            stderrTruncated,
            exitCode: code,
            signal: signal ?? null,
            tookMs: Date.now() - startedAt,
          }),
          isError: code !== 0,
        });
      });
    });
  },
};

function buildOutput(opts: {
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  exitCode: number | null;
  signal: string | null;
  tookMs: number;
}): string {
  const parts: string[] = [];
  if (opts.stdout) {
    parts.push(
      `[stdout]\n${opts.stdout}${opts.stdoutTruncated ? '\n... [truncated]' : ''}`,
    );
  }
  if (opts.stderr) {
    parts.push(
      `[stderr]\n${opts.stderr}${opts.stderrTruncated ? '\n... [truncated]' : ''}`,
    );
  }
  const exitInfo =
    opts.exitCode === null
      ? `signal=${opts.signal ?? 'unknown'}`
      : `exit=${opts.exitCode}${opts.signal ? `, signal=${opts.signal}` : ''}`;
  parts.push(`[${exitInfo}, took ${opts.tookMs}ms]`);
  return truncate(parts.join('\n'), MAX_OUTPUT_CHARS * 2);
}
