import type { ToolDef } from '../providers/base';
import * as log from '../util/logger';
import { McpClient } from './client';
import type { McpServerSummary } from './types';

const PREFIX = 'mcp__';

export class McpManager {
  private clients = new Map<string, McpClient>();
  private readonly listeners = new Set<() => void>();

  /** Reload server configuration. Disconnects removed servers, adds new ones. */
  async configure(servers: Record<string, { command: string; args?: string[]; env?: Record<string, string> }>): Promise<void> {
    const wantedNames = new Set(Object.keys(servers));
    // Remove servers no longer wanted
    for (const [name, client] of this.clients) {
      if (!wantedNames.has(name)) {
        await client.disconnect();
        this.clients.delete(name);
      }
    }
    // Add new servers (don't reconnect existing ones whose config hasn't changed — simple impl: keep)
    for (const [name, cfg] of Object.entries(servers)) {
      if (!this.clients.has(name)) {
        this.clients.set(name, new McpClient(name, cfg));
      }
    }
    this.notify();
  }

  /** Kick off connection for any idle server. Runs concurrently, doesn't throw. */
  async connectAll(): Promise<void> {
    const promises: Promise<void>[] = [];
    for (const client of this.clients.values()) {
      if (client.status === 'idle' || client.status === 'error') {
        promises.push(
          client.connect().then(() => this.notify()),
        );
      }
    }
    await Promise.allSettled(promises);
    this.notify();
  }

  /** Force-reconnect all servers. Used by Config UI. */
  async reconnect(): Promise<void> {
    for (const client of this.clients.values()) {
      await client.disconnect();
    }
    this.notify();
    await this.connectAll();
  }

  /** All available MCP tool defs, with names prefixed by server. */
  getAllToolDefs(): ToolDef[] {
    const out: ToolDef[] = [];
    for (const client of this.clients.values()) {
      if (client.status !== 'connected') continue;
      for (const tool of client.tools) {
        const safeServer = sanitize(client.name);
        const safeTool = sanitize(tool.name);
        const fullName = `${PREFIX}${safeServer}__${safeTool}`;
        if (fullName.length > 128) {
          log.warn('mcp: tool name too long, skipped', { server: client.name, tool: tool.name });
          continue;
        }
        out.push({
          name: fullName,
          description: `[${client.name}] ${tool.description || tool.name}`,
          input_schema: (tool.inputSchema as any) ?? {
            type: 'object',
            properties: {},
            required: [],
          },
        });
      }
    }
    return out;
  }

  /** Check whether a tool name belongs to MCP (prefix-based). */
  isMcpTool(name: string): boolean {
    return name.startsWith(PREFIX);
  }

  /** Execute a tool call routed to the right server. */
  async executeTool(
    fullName: string,
    input: unknown,
  ): Promise<{ content: string; isError: boolean }> {
    if (!this.isMcpTool(fullName)) {
      return { content: `Not an MCP tool: ${fullName}`, isError: true };
    }
    const rest = fullName.slice(PREFIX.length);
    const sep = rest.indexOf('__');
    if (sep === -1) {
      return { content: `Bad MCP tool name: ${fullName}`, isError: true };
    }
    const serverSan = rest.slice(0, sep);
    const toolSan = rest.slice(sep + 2);

    // Find the client by sanitized name
    const client = [...this.clients.values()].find(
      (c) => sanitize(c.name) === serverSan,
    );
    if (!client) {
      return { content: `MCP server "${serverSan}" not found`, isError: true };
    }
    if (client.status !== 'connected') {
      try {
        await client.connect();
        this.notify();
      } catch {
        return {
          content: `MCP server "${client.name}" failed to connect`,
          isError: true,
        };
      }
    }

    // Match raw tool name from sanitized
    const realTool = client.tools.find((t) => sanitize(t.name) === toolSan);
    if (!realTool) {
      return { content: `MCP tool "${toolSan}" not found on server`, isError: true };
    }
    try {
      return await client.callTool(realTool.name, input);
    } catch (err) {
      return {
        content: `MCP call failed: ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
      };
    }
  }

  getServerSummaries(): McpServerSummary[] {
    return [...this.clients.values()].map((c) => ({
      name: c.name,
      status: c.status,
      toolCount: c.tools.length,
      tools: c.toolSummaries(),
      error: c.error,
    }));
  }

  onChange(listener: () => void): { dispose: () => void } {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  async dispose(): Promise<void> {
    for (const c of this.clients.values()) {
      await c.disconnect();
    }
    this.clients.clear();
    this.listeners.clear();
  }

  private notify(): void {
    for (const fn of this.listeners) {
      try {
        fn();
      } catch (err) {
        log.warn('mcp listener error', err);
      }
    }
  }
}

/** Sanitize a name for use in `mcp__<server>__<tool>`. Keep [a-zA-Z0-9_-]. */
function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_');
}
