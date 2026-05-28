import { auth as oauthOrchestrate } from '@modelcontextprotocol/sdk/client/auth.js';
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import type { ToolDef } from '../providers/base';
import * as log from '../util/logger';
import { McpClient } from './client';
import { McpOAuthProvider } from './oauth';
import { startOAuthListener } from './oauthListener';
import type { McpServerConfig, McpServerSummary } from './types';

const PREFIX = 'mcp__';

export type OAuthProviderFactory = (name: string, cfg: McpServerConfig) => OAuthClientProvider | undefined;

export class McpManager {
  private clients = new Map<string, McpClient>();
  private readonly listeners = new Set<() => void>();
  private disabledTools: Record<string, string[]> = {};
  private oauthFactory?: OAuthProviderFactory;

  /** Register a factory used to build OAuth providers for servers with `auth: 'oauth'`. */
  setOAuthProviderFactory(factory: OAuthProviderFactory): void {
    this.oauthFactory = factory;
  }

  /** Reload server configuration. Disconnects removed servers, adds new ones. */
  async configure(
    servers: Record<string, McpServerConfig>,
    tokens?: Record<string, string>,
  ): Promise<void> {
    const wantedNames = new Set(Object.keys(servers));
    // Remove servers no longer wanted
    for (const [name, client] of this.clients) {
      if (!wantedNames.has(name)) {
        await client.disconnect();
        this.clients.delete(name);
      }
    }
    // Add new servers. Replace existing ones whose config changed (URL, transport, or auth mode).
    for (const [name, cfg] of Object.entries(servers)) {
      const existing = this.clients.get(name);
      if (existing && !configsEqual(existing.config, cfg)) {
        await existing.disconnect();
        this.clients.delete(name);
      }
      if (!this.clients.has(name)) {
        const provider = cfg.transport === 'streamable-http' && cfg.auth === 'oauth'
          ? this.oauthFactory?.(name, cfg)
          : undefined;
        this.clients.set(name, new McpClient(name, cfg, tokens?.[name], provider));
      }
    }
    this.notify();
  }

  /**
   * Run the full OAuth flow for a server end-to-end:
   *   1. open a loopback HTTP listener,
   *   2. set its redirect URL on the provider,
   *   3. run the SDK auth() orchestrator (opens browser),
   *   4. await the authorization code on the listener,
   *   5. exchange code → tokens, reconnect the client.
   * Resolves once the server is reconnected (or already authorized).
   */
  async startOAuth(name: string): Promise<void> {
    const client = this.clients.get(name);
    if (!client) throw new Error(`MCP server "${name}" not found`);
    if (client.config.transport !== 'streamable-http' || !client.oauthProvider) {
      throw new Error(`MCP server "${name}" is not configured for OAuth`);
    }
    const provider = client.oauthProvider;
    if (!(provider instanceof McpOAuthProvider)) {
      throw new Error(`MCP server "${name}" OAuth provider is not an McpOAuthProvider`);
    }

    const listener = await startOAuthListener(name);
    provider.setRedirectUrl(listener.redirectUrl);
    provider.setBrowserRedirectAllowed(true);

    try {
      const result = await oauthOrchestrate(provider, {
        serverUrl: client.config.url,
        scope: client.config.oauthScope,
      });
      if (result === 'AUTHORIZED') {
        // Already had valid tokens — no browser round-trip needed.
        log.info(`oauth: ${name} already authorized`);
        return;
      }
      // SDK opened the browser; wait for the loopback callback.
      const code = await listener.codePromise;
      await client.finishOAuth(code);
      await client.disconnect();
      await client.connect();
      this.notify();
    } catch (err) {
      log.error(`oauth: flow failed for ${name}`, err);
      throw err;
    } finally {
      provider.setBrowserRedirectAllowed(false);
      listener.close();
    }
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
      const disabled = new Set(this.disabledTools[client.name] ?? []);
      for (const tool of client.tools) {
        if (disabled.has(tool.name)) continue;
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
        await withTimeout(client.connect(), 15_000, `MCP server "${client.name}" connection timed out`);
        this.notify();
      } catch (err) {
        return {
          content: `MCP server "${client.name}" failed to connect: ${err instanceof Error ? err.message : String(err)}`,
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

  setDisabledTools(tools: Record<string, string[]>): void {
    this.disabledTools = tools;
  }

  buildToolName(serverName: string, toolName: string): string {
    return `${PREFIX}${sanitize(serverName)}__${sanitize(toolName)}`;
  }

  getServerSummaries(): McpServerSummary[] {
    return [...this.clients.values()].map((c) => ({
      name: c.name,
      transport: c.config.transport,
      status: c.status,
      toolCount: c.tools.length,
      tools: c.toolSummaries(),
      error: c.error,
      auth: c.config.transport === 'streamable-http' ? c.config.auth : undefined,
      needsAuth: c.needsAuth || undefined,
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

function configsEqual(a: McpServerConfig, b: McpServerConfig): boolean {
  if (a.transport !== b.transport) return false;
  if (a.transport === 'stdio' && b.transport === 'stdio') {
    return a.command === b.command
      && JSON.stringify(a.args ?? []) === JSON.stringify(b.args ?? [])
      && JSON.stringify(a.env ?? {}) === JSON.stringify(b.env ?? {});
  }
  if (a.transport === 'streamable-http' && b.transport === 'streamable-http') {
    return a.url === b.url
      && (a.auth ?? 'bearer') === (b.auth ?? 'bearer')
      && (a.oauthScope ?? '') === (b.oauthScope ?? '')
      && JSON.stringify(a.headers ?? {}) === JSON.stringify(b.headers ?? {});
  }
  if (a.transport === 'websocket' && b.transport === 'websocket') {
    return a.url === b.url;
  }
  return false;
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(message)), ms),
  );
  return Promise.race([promise, timeout]);
}
