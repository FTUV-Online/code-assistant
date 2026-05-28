import * as vscode from 'vscode';
import { normalizeMcpServers } from '../mcp/types';
import type { McpServerConfig, McpServerConfigSetting } from '../mcp/types';
import type { ProviderConfig } from '../providers/base';

const NS = 'devCode';

export function getProviderConfigs(): ProviderConfig[] {
  return vscode.workspace.getConfiguration(NS).get<ProviderConfig[]>('providers') ?? [];
}

export function getActiveProviderId(): string {
  return vscode.workspace.getConfiguration(NS).get<string>('activeProvider') ?? '';
}

export async function setActiveProviderId(id: string): Promise<void> {
  await vscode.workspace
    .getConfiguration(NS)
    .update('activeProvider', id, vscode.ConfigurationTarget.Global);
}

export async function setProviderConfigs(configs: ProviderConfig[]): Promise<void> {
  await vscode.workspace
    .getConfiguration(NS)
    .update('providers', configs, vscode.ConfigurationTarget.Global);
}

export function isEnabled(): boolean {
  return vscode.workspace.getConfiguration(NS).get<boolean>('enabled') ?? true;
}

export async function setEnabled(value: boolean): Promise<void> {
  await vscode.workspace
    .getConfiguration(NS)
    .update('enabled', value, vscode.ConfigurationTarget.Global);
}

export function getDebounceMs(): number {
  return vscode.workspace.getConfiguration(NS).get<number>('debounceMs') ?? 400;
}

export function getContextLines(): { before: number; after: number } {
  return (
    vscode.workspace
      .getConfiguration(NS)
      .get<{ before: number; after: number }>('contextLines') ?? { before: 50, after: 20 }
  );
}

export function getToolUseEnabled(): boolean {
  return (
    vscode.workspace.getConfiguration(NS).get<boolean>('toolUse.enabled') ?? true
  );
}

export function getToolUseBlacklist(): string[] {
  const v = vscode.workspace.getConfiguration(NS).get<string[]>('toolUse.blacklist');
  if (Array.isArray(v) && v.every((s) => typeof s === 'string')) return v;
  return DEFAULT_TOOL_BLACKLIST_SETTING;
}

const DEFAULT_TOOL_BLACKLIST_SETTING = [
  '.env',
  '.env.*',
  '*.pem',
  '*.key',
  '*_rsa',
  '*_dsa',
  '*_ecdsa',
  '*_ed25519',
  '**/secrets/**',
  '**/.ssh/**',
  '.aws/credentials',
  '.kube/config',
];

export type { McpServerConfigSetting } from '../mcp/types';

export function getMcpServers(): Record<string, McpServerConfig> {
  const raw = vscode.workspace.getConfiguration(NS).get<Record<string, McpServerConfigSetting>>('mcp.servers');
  return normalizeMcpServers(raw);
}

export function getMcpDisabledTools(): Record<string, string[]> {
  const v = vscode.workspace.getConfiguration(NS).get<Record<string, string[]>>('mcp.disabledTools');
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const clean: Record<string, string[]> = {};
    for (const [server, tools] of Object.entries(v)) {
      if (Array.isArray(tools)) clean[server] = tools.filter((t) => typeof t === 'string');
    }
    return clean;
  }
  return {};
}

export async function setMcpDisabledTools(value: Record<string, string[]>): Promise<void> {
  await vscode.workspace
    .getConfiguration(NS)
    .update('mcp.disabledTools', value, vscode.ConfigurationTarget.Global);
}

export function getAllowWriteTools(): boolean {
  return (
    vscode.workspace.getConfiguration(NS).get<boolean>('toolUse.allowWriteTools') ?? true
  );
}

export function getShowDiffPreview(): boolean {
  return (
    vscode.workspace.getConfiguration(NS).get<boolean>('toolUse.showDiffPreview') ?? true
  );
}

export async function setAllowWriteTools(value: boolean): Promise<void> {
  await vscode.workspace
    .getConfiguration(NS)
    .update('toolUse.allowWriteTools', value, vscode.ConfigurationTarget.Global);
}

export async function setShowDiffPreview(value: boolean): Promise<void> {
  await vscode.workspace
    .getConfiguration(NS)
    .update('toolUse.showDiffPreview', value, vscode.ConfigurationTarget.Global);
}

export async function setAllowShell(value: boolean): Promise<void> {
  await vscode.workspace
    .getConfiguration(NS)
    .update('toolUse.allowShell', value, vscode.ConfigurationTarget.Global);
}

export async function setShellAutoApprove(value: string[]): Promise<void> {
  await vscode.workspace
    .getConfiguration(NS)
    .update('toolUse.shellAutoApprove', value, vscode.ConfigurationTarget.Global);
}

export function getAllowShell(): boolean {
  return vscode.workspace.getConfiguration(NS).get<boolean>('toolUse.allowShell') ?? true;
}

export function getShellAutoApprove(): string[] {
  const v = vscode.workspace.getConfiguration(NS).get<string[]>('toolUse.shellAutoApprove');
  if (Array.isArray(v) && v.every((s) => typeof s === 'string')) return v;
  return [];
}

export function getShellTimeoutMs(): number {
  const v = vscode.workspace.getConfiguration(NS).get<number>('toolUse.shellTimeoutMs');
  if (typeof v !== 'number' || v < 1000) return 30000;
  return Math.min(v, 300000);
}

export function getToolUseMaxIterations(): number {
  const v = vscode.workspace.getConfiguration(NS).get<number>('toolUse.maxIterations');
  if (typeof v !== 'number' || v < 1) return 10;
  return Math.min(v, 30);
}

export function getIncludeFullFile(): boolean {
  return vscode.workspace.getConfiguration(NS).get<boolean>('includeFullFileInAnalysis') ?? true;
}

export async function setIncludeFullFile(value: boolean): Promise<void> {
  await vscode.workspace
    .getConfiguration(NS)
    .update('includeFullFileInAnalysis', value, vscode.ConfigurationTarget.Global);
}

export type FeatureName =
  | 'completion'
  | 'explain'
  | 'review'
  | 'rewrite'
  | 'commitMessage'
  | 'prDescription'
  | 'branchName';

export type FeatureConfig = { enabled: boolean; providerId: string };
export type FeaturesMap = Record<FeatureName, FeatureConfig>;

export const FEATURE_LIST: { name: FeatureName; label: string; hint: string }[] = [
  { name: 'completion', label: 'Inline code completion', hint: 'Ghost text while typing' },
  { name: 'explain', label: 'Explain change / selection', hint: 'AI explains the diff or code' },
  { name: 'review', label: 'Review change / selection', hint: 'AI reviews the diff or code' },
  { name: 'rewrite', label: 'Rewrite selection', hint: 'AI rewrites code preserving behavior' },
  { name: 'commitMessage', label: 'Generate commit message', hint: '✨ button in Git tab' },
  { name: 'prDescription', label: 'Generate PR description', hint: 'Summarize branch changes for a PR' },
  { name: 'branchName', label: 'Suggest branch name', hint: 'Short kebab-case from work-in-progress' },
];

const DEFAULT_FEATURES: FeaturesMap = {
  completion: { enabled: true, providerId: '' },
  explain: { enabled: true, providerId: '' },
  review: { enabled: true, providerId: '' },
  rewrite: { enabled: true, providerId: '' },
  commitMessage: { enabled: true, providerId: '' },
  prDescription: { enabled: true, providerId: '' },
  branchName: { enabled: true, providerId: '' },
};

export function getFeatures(): FeaturesMap {
  const raw =
    vscode.workspace.getConfiguration(NS).get<Partial<FeaturesMap>>('features') ?? {};
  const out: FeaturesMap = { ...DEFAULT_FEATURES };
  for (const f of FEATURE_LIST) {
    const supplied = (raw as any)[f.name];
    if (supplied && typeof supplied === 'object') {
      out[f.name] = {
        enabled: typeof supplied.enabled === 'boolean' ? supplied.enabled : true,
        providerId: typeof supplied.providerId === 'string' ? supplied.providerId : '',
      };
    }
  }
  return out;
}

export function isFeatureEnabled(feature: FeatureName): boolean {
  if (!isEnabled()) return false;
  const cfg = getFeatures()[feature];
  return cfg ? cfg.enabled : true;
}

export function getFeatureProviderId(feature: FeatureName): string {
  return getFeatures()[feature]?.providerId ?? '';
}

export async function setFeature(
  feature: FeatureName,
  change: Partial<FeatureConfig>,
): Promise<void> {
  const current = getFeatures();
  const next: FeaturesMap = {
    ...current,
    [feature]: { ...current[feature], ...change },
  };
  await vscode.workspace
    .getConfiguration(NS)
    .update('features', next, vscode.ConfigurationTarget.Global);
}

export const SUPPORTED_OUTPUT_LANGUAGES = [
  'English',
  'Vietnamese',
  'Chinese (Simplified)',
  'Chinese (Traditional)',
  'Japanese',
  'Korean',
  'French',
  'German',
  'Spanish',
  'Portuguese',
  'Russian',
] as const;

export function getOutputLanguage(): string {
  return vscode.workspace.getConfiguration(NS).get<string>('outputLanguage') ?? 'English';
}

export async function setOutputLanguage(value: string): Promise<void> {
  await vscode.workspace
    .getConfiguration(NS)
    .update('outputLanguage', value, vscode.ConfigurationTarget.Global);
}
