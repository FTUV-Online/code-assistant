export type FindReplace = { find: string; replace: string };

export type ApplyEditsResult =
  | { ok: true; result: string; appliedCount: number }
  | { ok: false; error: string };

/**
 * Apply find/replace edits sequentially. Each `find` must occur exactly once
 * in the current result (after previous edits) — to keep edits unambiguous.
 * Pure function, no I/O.
 */
export function applyEdits(original: string, edits: FindReplace[]): ApplyEditsResult {
  if (!Array.isArray(edits) || edits.length === 0) {
    return { ok: false, error: 'no edits supplied' };
  }
  let result = original;
  for (let i = 0; i < edits.length; i++) {
    const { find, replace } = edits[i];
    if (typeof find !== 'string' || find.length === 0) {
      return { ok: false, error: `edit #${i + 1}: empty "find"` };
    }
    if (typeof replace !== 'string') {
      return { ok: false, error: `edit #${i + 1}: missing "replace"` };
    }
    const idx = result.indexOf(find);
    if (idx === -1) {
      const preview = find.length > 80 ? find.slice(0, 80) + '…' : find;
      return { ok: false, error: `edit #${i + 1}: "find" not found: ${preview}` };
    }
    const second = result.indexOf(find, idx + find.length);
    if (second !== -1) {
      const preview = find.length > 80 ? find.slice(0, 80) + '…' : find;
      return {
        ok: false,
        error: `edit #${i + 1}: "find" matches multiple times (ambiguous). Add more context: ${preview}`,
      };
    }
    result = result.slice(0, idx) + replace + result.slice(idx + find.length);
  }
  return { ok: true, result, appliedCount: edits.length };
}
