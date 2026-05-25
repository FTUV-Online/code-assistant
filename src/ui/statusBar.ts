import * as vscode from 'vscode';
import { getActiveProviderId, getProviderConfigs, isEnabled } from '../config/settings';

export type StatusBar = vscode.Disposable & { refresh: () => void };

export function createStatusBar(_context: vscode.ExtensionContext): StatusBar {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  item.command = 'devCode.switchProvider';

  const refresh = () => {
    const enabled = isEnabled();

    const id = getActiveProviderId();
    if (!enabled) {
      item.text = '$(circle-slash) dev-code';
      item.tooltip = 'dev-code is disabled. Run "dev-code: Toggle Enable/Disable" to turn it on.';
    } else if (!id) {
      item.text = '$(warning) dev-code: not configured';
      item.tooltip = 'Run "dev-code: Setup Provider" to get started.';
    } else {
      const active = getProviderConfigs().find((p) => p.id === id);
      const label = (active && active.displayName && active.displayName.trim()) || id;
      item.text = `$(sparkle) dev-code: ${label}`;
      item.tooltip = `Active provider: ${label} (${id}). Click to switch.`;
    }
    item.show();
  };

  refresh();

  return Object.assign(item, { refresh });
}
