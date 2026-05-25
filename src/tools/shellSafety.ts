// Pure helpers for run_command safety. No I/O, easy to unit-test.

const META_PATTERNS: RegExp[] = [
  /[&|;<>`\n\r]/, // shell operators + newlines
  /\$\(/, // command substitution
  /\$\{/, // variable interpolation that could expand to unsafe content
];

/** Returns true if the command contains shell operators that change its behaviour. */
export function hasShellMetachars(command: string): boolean {
  return META_PATTERNS.some((re) => re.test(command));
}

/**
 * Whether the command is auto-approved by the user-defined allowlist.
 * Commands with shell metacharacters are NEVER auto-approved, regardless of the allowlist.
 */
export function isAutoApproved(command: string, allowlist: string[]): boolean {
  if (!Array.isArray(allowlist) || allowlist.length === 0) return false;
  if (hasShellMetachars(command)) return false;
  const trimmed = command.trim();
  if (!trimmed) return false;
  for (const raw of allowlist) {
    if (typeof raw !== 'string') continue;
    const p = raw.trim();
    if (!p) continue;
    if (trimmed === p) return true;
    if (trimmed.startsWith(p + ' ') || trimmed.startsWith(p + '\t')) return true;
  }
  return false;
}
