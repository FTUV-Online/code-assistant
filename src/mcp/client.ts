import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import * as log from '../util/logger';
import type { McpServerConfig, McpServerStatus, McpToolSummary } from './types';

export type RemoteTool = {
  name: string;
  description: string;
  inputSchema: unknown;
};

export class McpClient {
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;
  private _status: McpServerStatus = 'idle';
  private _tools: RemoteTool[] = [];
  private _error: string | undefined;

  constructor(public readonly name: string, public readonly config: McpServerConfig) {}

  get status(): McpServerStatus {
    return this._status;
  }
  get tools(): RemoteTool[] {
    return this._tools;
  }
  get error(): string | undefined {
    return this._error;
  }

  async connect(): Promise<void> {
    if (this._status === 'connected' || this._status === 'connecting') return;
    this._status = 'connecting';
    this._error = undefined;
    try {
      const env: Record<string, string> = {};
      for (const [k, v] of Object.entries(process.env)) {
        if (typeof v === 'string') env[k] = v;
      }
      Object.assign(env, this.config.env ?? {});

      this.transport = new StdioClientTransport({
        command: this.config.command,
        args: this.config.args ?? [],
        env,
      });

      this.client = new Client(
        { name: 'dev-code', version: '0.1.5' },
        { capabilities: {} },
      );

      log.info('mcp: connecting', { server: this.name, command: this.config.command });
      await this.client.connect(this.transport);

      const result = await this.client.listTools();
      this._tools = (result.tools ?? []).map((t: any) => ({
        name: t.name,
        description: t.description ?? '',
        inputSchema: t.inputSchema ?? {},
      }));
      this._status = 'connected';
      log.info('mcp: connected', { server: this.name, tools: this._tools.length });
    } catch (err) {
      this._status = 'error';
      this._error = err instanceof Error ? err.message : String(err);
      log.error(`mcp: connect failed for ${this.name}`, err);
      await this.disconnect();
    }
  }

  async callTool(toolName: string, args: unknown): Promise<{ content: string; isError: boolean }> {
    if (!this.client || this._status !== 'connected') {
      throw new Error(`MCP server "${this.name}" not connected`);
    }
    const result = await this.client.callTool({ name: toolName, arguments: args as any });
    const parts = Array.isArray(result.content) ? result.content : [];
    const text = parts
      .filter((p: any) => p?.type === 'text' && typeof p.text === 'string')
      .map((p: any) => p.text)
      .join('\n');
    return { content: text || '(no text content returned)', isError: !!result.isError };
  }

  async disconnect(): Promise<void> {
    try {
      if (this.client) {
        await this.client.close();
      }
    } catch (err) {
      log.warn(`mcp: error closing client ${this.name}`, err);
    }
    this.client = null;
    this.transport = null;
    if (this._status !== 'error') this._status = 'idle';
  }

  toolSummaries(): McpToolSummary[] {
    return this._tools.map((t) => ({ name: t.name, description: t.description }));
  }
}
