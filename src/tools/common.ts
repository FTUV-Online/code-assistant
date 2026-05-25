import * as path from 'path';

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'out',
  'build',
  'target',
  'vendor',
  '__pycache__',
  '.next',
  '.nuxt',
  '.cache',
  '.venv',
  'venv',
  '.idea',
  'bin',
  'obj',
  'coverage',
]);

export const TOOL_SKIP_GLOB =
  '{**/node_modules/**,**/.git/**,**/dist/**,**/out/**,**/build/**,**/target/**,**/vendor/**,**/.next/**,**/.cache/**,**/.venv/**,**/venv/**,**/coverage/**}';

export function isSkipDir(name: string): boolean {
  return SKIP_DIRS.has(name) || name.startsWith('.git');
}

export function isBinary(bytes: Uint8Array): boolean {
  // Heuristic: presence of null byte in first 8KB → binary
  const limit = Math.min(bytes.length, 8192);
  for (let i = 0; i < limit; i++) {
    if (bytes[i] === 0) return true;
  }
  return false;
}

export function resolveSafePath(workspaceRoot: string, relOrAbs: string): string | null {
  const abs = path.isAbsolute(relOrAbs) ? relOrAbs : path.resolve(workspaceRoot, relOrAbs);
  const normalized = path.normalize(abs);
  const root = path.normalize(workspaceRoot);
  if (
    normalized !== root &&
    !normalized.startsWith(root + path.sep) &&
    !normalized.startsWith(root + '/')
  ) {
    return null;
  }
  return normalized;
}

export function truncate(text: string, max: number, suffix = '\n... [truncated]'): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + suffix;
}

export function globToRegex(pattern: string): RegExp {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*' && pattern[i + 1] === '*') {
      re += '.*';
      i++;
      if (pattern[i + 1] === '/') i++;
    } else if (c === '*') {
      re += '[^/]*';
    } else if (c === '?') {
      re += '[^/]';
    } else if ('.+^$(){}|\\[]'.includes(c)) {
      re += '\\' + c;
    } else {
      re += c;
    }
  }
  return new RegExp('^' + re + '$', 'i');
}

export function matchesGlob(relPath: string, pattern: string): boolean {
  if (!pattern) return false;
  const path = relPath.replace(/\\/g, '/').replace(/^\.\//, '');
  // If pattern has no slash, match it against the basename only.
  if (!pattern.includes('/')) {
    const base = path.split('/').pop() ?? '';
    return globToRegex(pattern).test(base);
  }
  return globToRegex(pattern).test(path);
}

export function matchesAnyGlob(relPath: string, patterns: string[]): boolean {
  for (const p of patterns) {
    if (matchesGlob(relPath, p)) return true;
  }
  return false;
}

export const DEFAULT_TOOL_BLACKLIST = [
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
