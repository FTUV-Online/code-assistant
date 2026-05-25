export function parseBranchSuggestions(raw: string): string[] {
  let body = raw.trim();
  body = body.replace(/^```(?:json)?\r?\n?/, '').replace(/\r?\n?```\s*$/, '');
  let arr: unknown = null;
  try {
    arr = JSON.parse(body);
  } catch {
    const m = body.match(/\[[\s\S]*\]/);
    if (m) {
      try {
        arr = JSON.parse(m[0]);
      } catch {
        arr = null;
      }
    }
  }
  if (!Array.isArray(arr)) {
    return body
      .split(/\r?\n/)
      .map((line) => line.replace(/^[\s\-*\d.)\]"'`]+/, '').replace(/[\s"',`]+$/, '').trim())
      .filter((s) => isPlausibleBranchName(s))
      .slice(0, 5);
  }
  const out: string[] = [];
  for (const item of arr) {
    if (typeof item === 'string') {
      const cleaned = cleanBranchName(item);
      if (cleaned && isPlausibleBranchName(cleaned)) out.push(cleaned);
    }
  }
  return out.slice(0, 5);
}

export function cleanBranchName(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9/\-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

export function isPlausibleBranchName(s: string): boolean {
  if (!s || s.length < 2 || s.length > 80) return false;
  if (!/^[a-z0-9]/.test(s)) return false;
  if (s.includes(' ')) return false;
  return true;
}
