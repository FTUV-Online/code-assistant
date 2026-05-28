export type McpTransportType = 'stdio' | 'streamable-http' | 'websocket';

export type McpHttpAuthMode = 'none' | 'bearer' | 'oauth';

export type McpServerConfig =
  | {
      transport: 'stdio';
      command: string;
      args?: string[];
      env?: Record<string, string>;
    }
  | {
      transport: 'streamable-http';
      url: string;
      headers?: Record<string, string>;
      auth?: McpHttpAuthMode;
      oauthScope?: string;
    }
  | {
      transport: 'websocket';
      url: string;
    };

// User-facing config shape in settings.json (transport optional for backward compat)
export type McpServerConfigSetting = {
  transport?: 'stdio';
  command: string;
  args?: string[];
  env?: Record<string, string>;
} | {
  transport: 'streamable-http';
  url: string;
  headers?: Record<string, string>;
  auth?: McpHttpAuthMode;
  oauthScope?: string;
} | {
  transport: 'websocket';
  url: string;
};

export function normalizeMcpServers(raw: Record<string, McpServerConfigSetting> | undefined | null): Record<string, McpServerConfig> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, McpServerConfig> = {};
  for (const [name, cfg] of Object.entries(raw)) {
    if (!cfg || typeof cfg !== 'object') continue;
    const transport: McpTransportType = (cfg as any).transport || 'stdio';
    if (transport === 'stdio') {
      const c = cfg as { command: string; args?: string[]; env?: Record<string, string> };
      if (!c.command) continue;
      out[name] = { transport, command: c.command, args: c.args, env: c.env };
    } else if (transport === 'streamable-http') {
      const c = cfg as { url: string; headers?: Record<string, string>; auth?: McpHttpAuthMode; oauthScope?: string };
      if (!c.url) continue;
      const auth: McpHttpAuthMode = c.auth === 'oauth' || c.auth === 'bearer' || c.auth === 'none' ? c.auth : 'bearer';
      out[name] = { transport, url: c.url, headers: c.headers, auth, oauthScope: c.oauthScope };
    } else if (transport === 'websocket') {
      const c = cfg as { url: string };
      if (!c.url) continue;
      out[name] = { transport: 'websocket', url: c.url };
    }
  }
  return out;
}

export type McpServerStatus = 'idle' | 'connecting' | 'connected' | 'error';

export type McpToolSummary = {
  name: string; // raw name from server, without prefix
  description: string;
};

export type McpServerSummary = {
  name: string;
  transport: McpTransportType;
  status: McpServerStatus;
  toolCount: number;
  tools: McpToolSummary[];
  error?: string;
  configScope?: 'global' | 'workspace';
  auth?: McpHttpAuthMode;
  needsAuth?: boolean;
};
