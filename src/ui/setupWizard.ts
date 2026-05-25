import * as vscode from 'vscode';
import {
  getProviderConfigs,
  setActiveProviderId,
  setEnabled,
  setProviderConfigs,
  isEnabled,
} from '../config/settings';
import { deleteApiKey, setApiKey } from '../config/secrets';
import type { ProviderConfig, ProviderProtocol } from '../providers/base';

type Preset = {
  label: string;
  description: string;
  protocol: ProviderProtocol;
  baseURL: string;
  defaultModel: string;
};

const PRESETS: Preset[] = [
  {
    label: 'Anthropic Claude (official)',
    description: 'api.anthropic.com',
    protocol: 'anthropic',
    baseURL: 'https://api.anthropic.com',
    defaultModel: 'claude-haiku-4-5',
  },
  {
    label: 'OpenAI (official)',
    description: 'api.openai.com',
    protocol: 'openai',
    baseURL: 'https://api.openai.com',
    defaultModel: 'gpt-4o-mini',
  },
  {
    label: 'Groq (OpenAI-compatible)',
    description: 'api.groq.com — fast inference',
    protocol: 'openai',
    baseURL: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile',
  },
  {
    label: 'OpenRouter (OpenAI-compatible)',
    description: 'openrouter.ai — many models',
    protocol: 'openai',
    baseURL: 'https://openrouter.ai/api/v1',
    defaultModel: 'anthropic/claude-sonnet-4-6',
  },
  {
    label: 'LM Studio (local, OpenAI-compatible)',
    description: 'localhost:1234',
    protocol: 'openai',
    baseURL: 'http://localhost:1234/v1',
    defaultModel: '',
  },
  {
    label: 'Ollama (OpenAI-compatible /v1)',
    description: 'localhost:11434/v1',
    protocol: 'openai',
    baseURL: 'http://localhost:11434/v1',
    defaultModel: 'qwen2.5-coder:7b',
  },
  {
    label: 'Custom Anthropic-compatible endpoint',
    description: 'LiteLLM, Bedrock proxy, Vertex proxy, ...',
    protocol: 'anthropic',
    baseURL: '',
    defaultModel: '',
  },
  {
    label: 'Custom OpenAI-compatible endpoint',
    description: 'Azure OpenAI, vLLM, Together AI, custom proxy, ...',
    protocol: 'openai',
    baseURL: '',
    defaultModel: '',
  },
];

export function registerSetupWizard(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('devCode.setupProvider', () => setupProvider(context)),
    vscode.commands.registerCommand('devCode.switchProvider', () => switchProvider()),
    vscode.commands.registerCommand('devCode.removeApiKey', () => removeApiKeyCommand(context)),
    vscode.commands.registerCommand('devCode.toggleEnabled', () => toggleEnabled()),
  );
}

async function setupProvider(context: vscode.ExtensionContext): Promise<void> {
  const picked = await vscode.window.showQuickPick(
    PRESETS.map((p) => ({ label: p.label, description: p.description, preset: p })),
    { title: 'dev-code: choose a provider preset', placeHolder: 'Preset' },
  );
  if (!picked) return;

  const id = await vscode.window.showInputBox({
    title: 'Name this provider',
    prompt: 'An identifier used later to switch between providers (e.g. "my-claude").',
    validateInput: (v) => (/^[a-z0-9_-]+$/i.test(v) ? null : 'Only letters, digits, "-" and "_".'),
  });
  if (!id) return;

  const displayName = await vscode.window.showInputBox({
    title: 'Display name (optional)',
    prompt: 'A friendly label shown in the UI. Leave blank to use the ID.',
    placeHolder: 'My Personal Claude',
  });

  const baseURL = await vscode.window.showInputBox({
    title: 'Base URL',
    value: picked.preset.baseURL,
    prompt: 'API endpoint root.',
    validateInput: (v) => (v.startsWith('http') ? null : 'Must start with http:// or https://'),
  });
  if (!baseURL) return;

  const model = await vscode.window.showInputBox({
    title: 'Model',
    value: picked.preset.defaultModel,
    prompt: 'Model name (e.g. claude-haiku-4-5).',
    validateInput: (v) => (v.trim().length > 0 ? null : 'Model is required.'),
  });
  if (!model) return;

  const apiKey = await vscode.window.showInputBox({
    title: 'API Key (optional)',
    prompt: 'Leave empty for local or no-auth endpoints. Stored in VS Code SecretStorage.',
    password: true,
  });

  const newConfig: ProviderConfig = {
    id,
    protocol: picked.preset.protocol,
    baseURL,
    model,
    promptCaching: picked.preset.protocol === 'anthropic',
  };
  if (displayName && displayName.trim()) {
    newConfig.displayName = displayName.trim();
  }

  const others = getProviderConfigs().filter((c) => c.id !== id);
  await setProviderConfigs([...others, newConfig]);

  if (apiKey) {
    await setApiKey(context, id, apiKey);
  }

  await setActiveProviderId(id);
  vscode.window.showInformationMessage(`dev-code: provider "${id}" saved and activated.`);
}

async function switchProvider(): Promise<void> {
  const configs = getProviderConfigs();
  if (configs.length === 0) {
    vscode.window.showInformationMessage(
      'dev-code: no providers configured. Run "dev-code: Setup Provider" first.',
    );
    return;
  }
  const picked = await vscode.window.showQuickPick(
    configs.map((c) => ({
      label: (c.displayName && c.displayName.trim()) || c.id,
      description: `${c.protocol} - ${c.model}`,
      detail: c.baseURL + (c.displayName ? ` · id: ${c.id}` : ''),
      id: c.id,
    })),
    { title: 'dev-code: switch active provider' },
  );
  if (picked) {
    await setActiveProviderId(picked.id);
    vscode.window.showInformationMessage(`dev-code: activated provider "${picked.id}".`);
  }
}

async function removeApiKeyCommand(context: vscode.ExtensionContext): Promise<void> {
  const configs = getProviderConfigs();
  if (configs.length === 0) {
    vscode.window.showInformationMessage('dev-code: no providers configured.');
    return;
  }
  const picked = await vscode.window.showQuickPick(
    configs.map((c) => ({ label: c.id, description: c.protocol, id: c.id })),
    { title: 'dev-code: remove API key for which provider?' },
  );
  if (picked) {
    await deleteApiKey(context, picked.id);
    vscode.window.showInformationMessage(`dev-code: API key removed for "${picked.id}".`);
  }
}

async function toggleEnabled(): Promise<void> {
  const next = !isEnabled();
  await setEnabled(next);
  vscode.window.showInformationMessage(`dev-code: ${next ? 'enabled' : 'disabled'}.`);
}
