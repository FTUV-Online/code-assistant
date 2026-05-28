import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMcpServers } from '../src/mcp/types';

test('normalizeMcpServers: legacy stdio config (no transport field)', () => {
  const raw = {
    filesystem: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem'] },
  };
  const result = normalizeMcpServers(raw);
  assert.deepEqual(result, {
    filesystem: {
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem'],
      env: undefined,
    },
  });
});

test('normalizeMcpServers: explicit stdio with env', () => {
  const raw = {
    github: {
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
      env: { GITHUB_TOKEN: 'ghp_xxx' },
    },
  };
  const result = normalizeMcpServers(raw);
  assert.deepEqual(result, {
    github: {
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
      env: { GITHUB_TOKEN: 'ghp_xxx' },
    },
  });
});

test('normalizeMcpServers: streamable-http transport', () => {
  const raw = {
    remote: {
      transport: 'streamable-http',
      url: 'https://example.com/mcp',
      headers: { Authorization: 'Bearer sk-xxx' },
    },
  };
  const result = normalizeMcpServers(raw);
  assert.deepEqual(result, {
    remote: {
      transport: 'streamable-http',
      url: 'https://example.com/mcp',
      headers: { Authorization: 'Bearer sk-xxx' },
      auth: 'bearer',
      oauthScope: undefined,
    },
  });
});

test('normalizeMcpServers: streamable-http without headers', () => {
  const raw = {
    remote: { transport: 'streamable-http', url: 'https://example.com/mcp' },
  };
  const result = normalizeMcpServers(raw);
  assert.deepEqual(result, {
    remote: {
      transport: 'streamable-http',
      url: 'https://example.com/mcp',
      headers: undefined,
      auth: 'bearer',
      oauthScope: undefined,
    },
  });
});

test('normalizeMcpServers: streamable-http with oauth auth mode', () => {
  const raw = {
    atlassian: {
      transport: 'streamable-http',
      url: 'https://mcp.atlassian.com/v1/sse',
      auth: 'oauth',
      oauthScope: 'read:jira-work offline_access',
    },
  };
  const result = normalizeMcpServers(raw as any);
  assert.deepEqual(result, {
    atlassian: {
      transport: 'streamable-http',
      url: 'https://mcp.atlassian.com/v1/sse',
      headers: undefined,
      auth: 'oauth',
      oauthScope: 'read:jira-work offline_access',
    },
  });
});

test('normalizeMcpServers: streamable-http invalid auth mode falls back to bearer', () => {
  const raw = {
    remote: {
      transport: 'streamable-http',
      url: 'https://example.com/mcp',
      auth: 'invalid-mode',
    },
  };
  const result = normalizeMcpServers(raw as any);
  assert.equal(result.remote.auth, 'bearer');
});

test('normalizeMcpServers: websocket transport', () => {
  const raw = {
    ws: { transport: 'websocket', url: 'wss://example.com/mcp' },
  };
  const result = normalizeMcpServers(raw);
  assert.deepEqual(result, {
    ws: { transport: 'websocket', url: 'wss://example.com/mcp' },
  });
});

test('normalizeMcpServers: mixed transports', () => {
  const raw = {
    local: { command: 'node', args: ['server.js'] },
    remote: { transport: 'streamable-http', url: 'https://api.example.com/mcp' },
    ws: { transport: 'websocket', url: 'wss://ws.example.com/mcp' },
  };
  const result = normalizeMcpServers(raw);
  assert.equal(Object.keys(result).length, 3);
  assert.equal(result.local.transport, 'stdio');
  assert.equal(result.remote.transport, 'streamable-http');
  assert.equal(result.ws.transport, 'websocket');
});

test('normalizeMcpServers: skips stdio without command', () => {
  const raw = {
    broken: { transport: 'stdio', args: ['-y'] },
    good: { command: 'node' },
  };
  const result = normalizeMcpServers(raw);
  assert.deepEqual(Object.keys(result), ['good']);
});

test('normalizeMcpServers: skips streamable-http without url', () => {
  const raw = {
    broken: { transport: 'streamable-http' },
    good: { transport: 'streamable-http', url: 'https://example.com/mcp' },
  };
  const result = normalizeMcpServers(raw);
  assert.deepEqual(Object.keys(result), ['good']);
});

test('normalizeMcpServers: skips websocket without url', () => {
  const raw = {
    broken: { transport: 'websocket' },
    good: { transport: 'websocket', url: 'wss://example.com/mcp' },
  };
  const result = normalizeMcpServers(raw);
  assert.deepEqual(Object.keys(result), ['good']);
});

test('normalizeMcpServers: skips non-object entries', () => {
  const raw = {
    nullVal: null,
    strVal: 'not-an-object',
    numVal: 42,
    good: { command: 'node' },
  };
  const result = normalizeMcpServers(raw as any);
  assert.deepEqual(Object.keys(result), ['good']);
});

test('normalizeMcpServers: empty/null/undefined input', () => {
  assert.deepEqual(normalizeMcpServers(null), {});
  assert.deepEqual(normalizeMcpServers(undefined), {});
  assert.deepEqual(normalizeMcpServers({}), {});
});

test('normalizeMcpServers: unknown transport type skipped', () => {
  const raw = {
    weird: { transport: 'magic', foo: 'bar' },
    good: { command: 'node' },
  };
  const result = normalizeMcpServers(raw as any);
  assert.deepEqual(Object.keys(result), ['good']);
});
