export function parseBranchList(raw: string): string[] {
  const result = new Map<string, string>();
  for (const name of raw.split('\n').map((s) => s.trim()).filter(Boolean)) {
    // Skip symbolic HEAD refs like "remotes/origin/HEAD -> origin/main"
    if (name.includes(' -> ')) continue;
    const short = name.replace(/^remotes\//, '');
    result.set(short, name);
  }
  return Array.from(result.keys()).sort();
}
