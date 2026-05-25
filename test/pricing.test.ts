import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimateCostUsd, getModelPricing } from '../src/providers/pricing';

test('getModelPricing: known anthropic prefix', () => {
  const p = getModelPricing('claude-sonnet-4-5');
  assert.ok(p);
  assert.equal(p!.input, 3);
  assert.equal(p!.output, 15);
});

test('getModelPricing: known anthropic with date suffix', () => {
  const p = getModelPricing('claude-opus-4-1-20250120');
  assert.ok(p);
  assert.equal(p!.input, 15);
  assert.equal(p!.output, 75);
});

test('getModelPricing: known openai prefix', () => {
  const p = getModelPricing('gpt-4o-2024-08-06');
  assert.ok(p);
  assert.equal(p!.input, 2.5);
});

test('getModelPricing: case insensitive', () => {
  const p = getModelPricing('Claude-Sonnet-4-5');
  assert.ok(p);
});

test('getModelPricing: unknown model → null', () => {
  assert.equal(getModelPricing('llama-3-70b'), null);
  assert.equal(getModelPricing(''), null);
});

test('estimateCostUsd: basic input + output', () => {
  // sonnet: input $3/M, output $15/M
  const cost = estimateCostUsd('claude-sonnet-4-5', {
    inputTokens: 1_000_000,
    outputTokens: 1_000_000,
  });
  assert.equal(cost, 18);
});

test('estimateCostUsd: with cache write and read', () => {
  // sonnet cacheWrite $3.75/M, cacheRead $0.30/M
  const cost = estimateCostUsd('claude-sonnet-4-5', {
    inputTokens: 100_000,
    outputTokens: 50_000,
    cacheCreationInputTokens: 1_000_000,
    cacheReadInputTokens: 1_000_000,
  });
  // 0.1*3 + 0.05*15 + 1*3.75 + 1*0.30 = 0.3 + 0.75 + 3.75 + 0.30 = 5.10
  assert.equal(Math.round(cost * 100) / 100, 5.1);
});

test('estimateCostUsd: unknown model → 0', () => {
  const cost = estimateCostUsd('llama-3-70b', {
    inputTokens: 1_000_000,
    outputTokens: 1_000_000,
  });
  assert.equal(cost, 0);
});

test('estimateCostUsd: small token counts', () => {
  const cost = estimateCostUsd('gpt-4o-mini', {
    inputTokens: 1000,
    outputTokens: 500,
  });
  // 0.001*0.15 + 0.0005*0.6 = 0.00015 + 0.0003 = 0.00045
  assert.ok(cost > 0 && cost < 0.001);
});
