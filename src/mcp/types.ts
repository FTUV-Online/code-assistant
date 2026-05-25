export type McpServerConfig = {
  command: string;
  args?: string[];
  env?: Record<string, string>;
};

export type McpServerStatus = 'idle' | 'connecting' | 'connected' | 'error';

export type McpToolSummary = {
  name: string; // raw name from server, without prefix
  description: string;
};

export type McpServerSummary = {
  name: string;
  status: McpServerStatus;
  toolCount: number;
  tools: McpToolSummary[];
  error?: string;
};
