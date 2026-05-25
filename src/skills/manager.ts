import * as vscode from 'vscode';
import * as log from '../util/logger';
import { loadAllSkills } from './loader';
import type { Skill, SkillSummary } from './types';

export class SkillManager {
  private skills: Skill[] = [];
  private readonly listeners = new Set<() => void>();
  private watcher: vscode.FileSystemWatcher | null = null;

  async init(): Promise<void> {
    await this.reload();
    // Watch both flat .md and nested SKILL.md for changes.
    this.watcher = vscode.workspace.createFileSystemWatcher(
      '**/{.dev-code,.claude}/skills/**/*.md',
    );
    const onChange = () => {
      void this.reload();
    };
    this.watcher.onDidChange(onChange);
    this.watcher.onDidCreate(onChange);
    this.watcher.onDidDelete(onChange);
  }

  async reload(): Promise<void> {
    try {
      this.skills = await loadAllSkills();
      log.info('skill manager reloaded', { count: this.skills.length });
    } catch (err) {
      log.error('skill reload failed', err);
      this.skills = [];
    }
    this.notify();
  }

  getAll(): Skill[] {
    return [...this.skills];
  }

  getSummaries(): SkillSummary[] {
    return this.skills.map((s) => ({
      name: s.name,
      description: s.description,
      filePath: s.filePath,
    }));
  }

  getByName(name: string): Skill | null {
    return this.skills.find((s) => s.name === name) ?? null;
  }

  /** System-prompt addition: short list of available skills + how to load them. */
  buildSystemPromptAddition(): string {
    if (this.skills.length === 0) return '';
    const lines = [
      '',
      '## Available skills',
      'You have access to user-defined skills. Call the `load_skill` tool with the skill name when the user\'s task matches one of these:',
    ];
    for (const s of this.skills) {
      lines.push(`- **${s.name}**: ${s.description}`);
    }
    return lines.join('\n');
  }

  onChange(listener: () => void): { dispose: () => void } {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  dispose(): void {
    this.watcher?.dispose();
    this.watcher = null;
    this.listeners.clear();
  }

  private notify(): void {
    for (const fn of this.listeners) {
      try {
        fn();
      } catch (err) {
        log.warn('skill listener error', err);
      }
    }
  }
}
