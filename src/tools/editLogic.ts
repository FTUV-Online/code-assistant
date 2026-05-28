export type FindReplace = {
  find: string;
  replace: string;
  /** When true, replace ALL occurrences of `find`. Default false (unique-match required). */
  replaceAll?: boolean;
};

export type ApplyEditsResult =
  | { ok: true; result: string; appliedCount: number }
  | { ok: false; error: string };

/**
 * Return 1-based line numbers where `needle` appears in `haystack`.
 * Up to `limit` matches.
 */
function findLineNumbers(haystack: string, needle: string, limit = 5): number[] {
  const out: number[] = [];
  let from = 0;
  while (out.length < limit) {
    const idx = haystack.indexOf(needle, from);
    if (idx === -1) break;
    // 1-based line = (newlines before idx) + 1
    let nl = 0;
    for (let i = 0; i < idx; i++) if (haystack.charCodeAt(i) === 10) nl++;
    out.push(nl + 1);
    from = idx + needle.length;
  }
  return out;
}

/**
 * Apply find/replace edits sequentially. By default each `find` must occur
 * exactly once in the current result (after previous edits) so edits stay
 * unambiguous. Pass `replaceAll: true` on an edit to substitute every match.
 * Pure function, no I/O.
 */
export function applyEdits(original: string, edits: FindReplace[]): ApplyEditsResult {
  if (!Array.isArray(edits) || edits.length === 0) {
    return { ok: false, error: 'no edits supplied' };
  }
  let result = original;
  for (let i = 0; i < edits.length; i++) {
    const { find, replace, replaceAll } = edits[i];
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

    if (replaceAll) {
      // Split-join is the simplest correct way to replace all occurrences of
      // a literal string (no regex escaping needed).
      result = result.split(find).join(replace);
      continue;
    }

    const second = result.indexOf(find, idx + find.length);
    if (second !== -1) {
      const preview = find.length > 80 ? find.slice(0, 80) + '…' : find;
      const lineNums = findLineNumbers(result, find);
      const linesStr = lineNums.length > 0 ? ` (matches at lines ${lineNums.join(', ')})` : '';
      return {
        ok: false,
        error:
          `edit #${i + 1}: "find" matches multiple times${linesStr}. ` +
          `Either add surrounding context to make it unique, or set "replaceAll": true to update every occurrence: ${preview}`,
      };
    }
    result = result.slice(0, idx) + replace + result.slice(idx + find.length);
  }
  return { ok: true, result, appliedCount: edits.length };
}
