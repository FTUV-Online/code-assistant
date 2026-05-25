// USD per 1M tokens. Numbers are approximate published prices.
// When unknown, returns zero so cost UI degrades to "—".
export type ModelPricing = {
  input: number;
  output: number;
  cacheWrite?: number;
  cacheRead?: number;
};

const ANTHROPIC_PRICES: Record<string, ModelPricing> = {
  'claude-opus-4-7': { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.5 },
  'claude-opus-4-6': { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.5 },
  'claude-opus-4-5': { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.5 },
  'claude-opus-4-1': { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.5 },
  'claude-opus-4': { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.5 },
  'claude-sonnet-4-6': { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
  'claude-sonnet-4-5': { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
  'claude-sonnet-4': { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
  'claude-3-7-sonnet': { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
  'claude-3-5-sonnet': { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
  'claude-haiku-4-5': { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 },
  'claude-haiku-4': { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 },
  'claude-3-5-haiku': { input: 0.8, output: 4, cacheWrite: 1, cacheRead: 0.08 },
};

const OPENAI_PRICES: Record<string, ModelPricing> = {
  'gpt-5': { input: 5, output: 20, cacheRead: 1.25 },
  'gpt-5-mini': { input: 0.25, output: 2, cacheRead: 0.0625 },
  'gpt-4o': { input: 2.5, output: 10, cacheRead: 1.25 },
  'gpt-4o-mini': { input: 0.15, output: 0.6, cacheRead: 0.075 },
  'gpt-4.1': { input: 2, output: 8, cacheRead: 0.5 },
  'gpt-4.1-mini': { input: 0.4, output: 1.6, cacheRead: 0.1 },
  'gpt-4.1-nano': { input: 0.1, output: 0.4, cacheRead: 0.025 },
  'o1': { input: 15, output: 60 },
  'o1-mini': { input: 1.1, output: 4.4 },
  'o3': { input: 2, output: 8 },
  'o3-mini': { input: 1.1, output: 4.4 },
};

export function getModelPricing(model: string): ModelPricing | null {
  if (!model) return null;
  const lower = model.toLowerCase();
  let bestKey = '';
  let bestPrice: ModelPricing | null = null;
  for (const table of [ANTHROPIC_PRICES, OPENAI_PRICES]) {
    for (const [key, price] of Object.entries(table)) {
      if (lower.startsWith(key) && key.length > bestKey.length) {
        bestKey = key;
        bestPrice = price;
      }
    }
  }
  return bestPrice;
}

export function estimateCostUsd(
  model: string,
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheCreationInputTokens?: number;
    cacheReadInputTokens?: number;
  },
): number {
  const p = getModelPricing(model);
  if (!p) return 0;
  const M = 1_000_000;
  let cost = (usage.inputTokens / M) * p.input + (usage.outputTokens / M) * p.output;
  if (usage.cacheCreationInputTokens && p.cacheWrite) {
    cost += (usage.cacheCreationInputTokens / M) * p.cacheWrite;
  }
  if (usage.cacheReadInputTokens && p.cacheRead) {
    cost += (usage.cacheReadInputTokens / M) * p.cacheRead;
  }
  return cost;
}
