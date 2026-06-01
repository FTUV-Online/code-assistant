import { buildMemoryPromptSection } from '../../memory/manager';
import * as log from '../../util/logger';

let memoryPromptCache = '';
let memoryPromptLoaded = false;

export async function ensureMemoryPromptLoaded(): Promise<void> {
  if (memoryPromptLoaded) return;
  memoryPromptLoaded = true;
  try {
    memoryPromptCache = await buildMemoryPromptSection();
  } catch (err) {
    log.warn('memory prompt load failed', err);
    memoryPromptCache = '';
  }
}

export async function refreshMemoryPrompt(): Promise<void> {
  memoryPromptLoaded = true;
  try {
    memoryPromptCache = await buildMemoryPromptSection();
  } catch (err) {
    log.warn('memory prompt refresh failed', err);
  }
}

export function memorySectionAffix(): string {
  return memoryPromptCache ? '\n\n' + memoryPromptCache : '';
}
