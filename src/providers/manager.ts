import type * as vscode from 'vscode';
import type { LLMProvider } from './base';
import { AnthropicProvider } from './anthropic';
import { OpenAIProvider } from './openai';
import { getApiKey } from '../config/secrets';
import {
  getActiveProviderId,
  getFeatureProviderId,
  getProviderConfigs,
  type FeatureName,
} from '../config/settings';

export async function getProviderById(
  context: vscode.ExtensionContext,
  id: string,
): Promise<LLMProvider | null> {
  if (!id) return null;
  const config = getProviderConfigs().find((c) => c.id === id);
  if (!config) return null;

  const apiKey = await getApiKey(context, id);

  switch (config.protocol) {
    case 'anthropic':
      return new AnthropicProvider(id, config, apiKey);
    case 'openai':
      return new OpenAIProvider(id, config, apiKey);
    case 'gemini':
    case 'ollama':
      throw new Error(
        `Protocol "${config.protocol}" is not implemented yet. Supported: anthropic, openai.`,
      );
    default: {
      const exhaustive: never = config.protocol;
      throw new Error(`Unknown protocol: ${exhaustive}`);
    }
  }
}

export async function getActiveProvider(
  context: vscode.ExtensionContext,
): Promise<LLMProvider | null> {
  const id = getActiveProviderId();
  if (!id) return null;
  return getProviderById(context, id);
}

export async function getProviderForFeature(
  context: vscode.ExtensionContext,
  feature: FeatureName,
): Promise<LLMProvider | null> {
  const featureProviderId = getFeatureProviderId(feature);
  if (featureProviderId) {
    const p = await getProviderById(context, featureProviderId);
    if (p) return p;
  }
  return getActiveProvider(context);
}
