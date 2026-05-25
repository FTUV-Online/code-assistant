import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyAuthHeaders } from '../src/providers/base';
import type { ProviderConfig } from '../src/providers/base';

function baseConfig(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: 'test',
    protocol: 'anthropic',
    baseURL: 'https://example.com',
    model: 'm',
    ...overrides,
  };
}

// ============= No-op cases =============

test('applyAuthHeaders: undefined apiKey → no header added', () => {
  const headers: Record<string, string> = {};
  applyAuthHeaders(headers, undefined, baseConfig(), 'x-api-key');
  assert.deepEqual(headers, {});
});

test('applyAuthHeaders: empty string apiKey → no header added', () => {
  const headers: Record<string, string> = {};
  applyAuthHeaders(headers, '', baseConfig(), 'x-api-key');
  assert.deepEqual(headers, {});
});

// ============= Default scheme via protocol =============

test('applyAuthHeaders: anthropic default → x-api-key header set', () => {
  const headers: Record<string, string> = {};
  applyAuthHeaders(headers, 'sk-ant-123', baseConfig(), 'x-api-key');
  assert.equal(headers['x-api-key'], 'sk-ant-123');
  assert.equal(headers['authorization'], undefined);
});

test('applyAuthHeaders: openai default → Authorization Bearer set', () => {
  const headers: Record<string, string> = {};
  applyAuthHeaders(headers, 'sk-abc', baseConfig({ protocol: 'openai' }), 'bearer');
  assert.equal(headers['authorization'], 'Bearer sk-abc');
  assert.equal(headers['x-api-key'], undefined);
});

// ============= Explicit authScheme overrides default =============

test('applyAuthHeaders: authScheme=bearer on anthropic → Bearer (not x-api-key)', () => {
  const headers: Record<string, string> = {};
  applyAuthHeaders(headers, 'tok', baseConfig({ authScheme: 'bearer' }), 'x-api-key');
  assert.equal(headers['authorization'], 'Bearer tok');
  assert.equal(headers['x-api-key'], undefined);
});

test('applyAuthHeaders: authScheme=x-api-key on openai → x-api-key (not Bearer)', () => {
  const headers: Record<string, string> = {};
  applyAuthHeaders(headers, 'tok', baseConfig({ authScheme: 'x-api-key' }), 'bearer');
  assert.equal(headers['x-api-key'], 'tok');
  assert.equal(headers['authorization'], undefined);
});

// ============= User override via existing custom header =============

test('applyAuthHeaders: x-api-key default + user-set x-api-key → no overwrite', () => {
  const headers: Record<string, string> = { 'x-api-key': 'user-token' };
  applyAuthHeaders(headers, 'secret', baseConfig(), 'x-api-key');
  assert.equal(headers['x-api-key'], 'user-token');
});

test('applyAuthHeaders: x-api-key default + user-set Authorization → x-api-key NOT added', () => {
  const headers: Record<string, string> = { authorization: 'Bearer user-token' };
  applyAuthHeaders(headers, 'secret', baseConfig(), 'x-api-key');
  assert.equal(headers['authorization'], 'Bearer user-token');
  assert.equal(headers['x-api-key'], undefined);
});

test('applyAuthHeaders: bearer default + user-set Authorization (case-insensitive) → no overwrite', () => {
  const headers: Record<string, string> = { Authorization: 'Bearer user-token' };
  applyAuthHeaders(headers, 'secret', baseConfig({ protocol: 'openai' }), 'bearer');
  assert.equal(headers['Authorization'], 'Bearer user-token');
  assert.equal(headers['authorization'], undefined);
});

test('applyAuthHeaders: bearer default + user-set api-key → no Bearer added', () => {
  const headers: Record<string, string> = { 'api-key': 'azure-style' };
  applyAuthHeaders(headers, 'secret', baseConfig({ protocol: 'openai' }), 'bearer');
  assert.equal(headers['api-key'], 'azure-style');
  assert.equal(headers['authorization'], undefined);
});

test('applyAuthHeaders: case variants of x-api-key user-set → respected', () => {
  const headers: Record<string, string> = { 'X-API-KEY': 'shouty' };
  applyAuthHeaders(headers, 'secret', baseConfig(), 'x-api-key');
  assert.equal(headers['X-API-KEY'], 'shouty');
  assert.equal(headers['x-api-key'], undefined);
});

// ============= Custom-header scheme =============

test('applyAuthHeaders: custom-header scheme uses authHeaderName', () => {
  const headers: Record<string, string> = {};
  applyAuthHeaders(
    headers,
    'tok',
    baseConfig({ authScheme: 'custom-header', authHeaderName: 'X-Auth-Token' }),
    'x-api-key',
  );
  assert.equal(headers['X-Auth-Token'], 'tok');
});

test('applyAuthHeaders: custom-header scheme prepends authValuePrefix', () => {
  const headers: Record<string, string> = {};
  applyAuthHeaders(
    headers,
    'tok',
    baseConfig({
      authScheme: 'custom-header',
      authHeaderName: 'X-Auth',
      authValuePrefix: 'Token ',
    }),
    'x-api-key',
  );
  assert.equal(headers['X-Auth'], 'Token tok');
});

test('applyAuthHeaders: custom-header scheme without authHeaderName → no header added', () => {
  const headers: Record<string, string> = {};
  applyAuthHeaders(headers, 'tok', baseConfig({ authScheme: 'custom-header' }), 'x-api-key');
  assert.deepEqual(headers, {});
});

test('applyAuthHeaders: custom-header scheme with empty/whitespace authHeaderName → no header added', () => {
  const headers: Record<string, string> = {};
  applyAuthHeaders(
    headers,
    'tok',
    baseConfig({ authScheme: 'custom-header', authHeaderName: '   ' }),
    'x-api-key',
  );
  assert.deepEqual(headers, {});
});

test('applyAuthHeaders: custom-header scheme respects pre-existing user header (case-insensitive)', () => {
  const headers: Record<string, string> = { 'x-auth-token': 'user-set' };
  applyAuthHeaders(
    headers,
    'tok',
    baseConfig({ authScheme: 'custom-header', authHeaderName: 'X-Auth-Token' }),
    'x-api-key',
  );
  assert.equal(headers['x-auth-token'], 'user-set');
  assert.equal(headers['X-Auth-Token'], undefined);
});

test('applyAuthHeaders: custom-header empty prefix → bare token value', () => {
  const headers: Record<string, string> = {};
  applyAuthHeaders(
    headers,
    'raw-token',
    baseConfig({ authScheme: 'custom-header', authHeaderName: 'X-Token', authValuePrefix: '' }),
    'x-api-key',
  );
  assert.equal(headers['X-Token'], 'raw-token');
});

// ============= Coexistence with other headers =============

test('applyAuthHeaders: preserves other unrelated headers', () => {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-region': 'us-east-1',
  };
  applyAuthHeaders(headers, 'tok', baseConfig(), 'x-api-key');
  assert.equal(headers['content-type'], 'application/json');
  assert.equal(headers['x-region'], 'us-east-1');
  assert.equal(headers['x-api-key'], 'tok');
});
