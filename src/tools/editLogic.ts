export type FindReplace = {
  find: string;
  replace: string;
  /** When true, replace ALL occurrences of `find`. Default false (unique-match required). */
  replaceAll?: boolean;
};

export type ApplyEditsResult =
  | { ok: true; result: string; appliedCount: number }
  | { ok: false; error: string };

type NormalizationMode = 'exact' | 'normalize-line-endings' | 'trim-trailing-whitespace';

type NormalizedText = {
  text: string;
  indexMap: number[];
};

type SimilarLineCandidate = {
  lineNumber: number;
  text: string;
  score: number;
};

const MAX_SIMILAR_CANDIDATES = 3;
const MAX_SIMILAR_LINE_LENGTH = 80;
const MAX_SIMILARITY_INPUT_LENGTH = 200;
const MIN_SIMILARITY_SCORE = 0.5;
const MAX_NEEDLE_LINES_TO_COMPARE = 5;

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

function normalizeForMatch(text: string, mode: NormalizationMode): NormalizedText {
  if (mode === 'exact') {
    return {
      text,
      indexMap: Array.from({ length: text.length + 1 }, (_, i) => i),
    };
  }

  let normalized = '';
  const indexMap: number[] = [];
  let i = 0;

  while (i < text.length) {
    indexMap.push(i);
    const char = text[i];

    if (char === '\r' && text[i + 1] === '\n') {
      normalized += '\n';
      i += 2;
      continue;
    }

    if (mode === 'trim-trailing-whitespace' && (char === ' ' || char === '\t')) {
      let j = i;
      while (j < text.length && (text[j] === ' ' || text[j] === '\t')) j++;
      const next = text[j];
      if (j > i && (next === '\n' || next === undefined || (next === '\r' && text[j + 1] === '\n'))) {
        i = j;
        continue;
      }
    }

    normalized += char;
    i += 1;
  }

  indexMap.push(text.length);
  return { text: normalized, indexMap };
}

function getMatchCandidates(haystack: string, needle: string): number[] {
  const matches: number[] = [];
  let from = 0;
  while (true) {
    const idx = haystack.indexOf(needle, from);
    if (idx === -1) break;
    matches.push(idx);
    from = idx + Math.max(needle.length, 1);
  }
  return matches;
}

function buildBigrams(text: string): Set<string> {
  const normalized = text.slice(0, MAX_SIMILARITY_INPUT_LENGTH).toLowerCase();
  if (normalized.length < 2) return new Set(normalized ? [normalized] : []);

  const bigrams = new Set<string>();
  for (let i = 0; i < normalized.length - 1; i++) {
    bigrams.add(normalized.slice(i, i + 2));
  }
  return bigrams;
}

function similarityScore(a: string, b: string): number {
  if (a === b) return 1;
  if (!a || !b) return 0;

  const aBigrams = buildBigrams(a);
  const bBigrams = buildBigrams(b);
  if (aBigrams.size === 0 || bBigrams.size === 0) return 0;

  let overlap = 0;
  for (const bigram of aBigrams) {
    if (bBigrams.has(bigram)) overlap++;
  }

  return (2 * overlap) / (aBigrams.size + bBigrams.size);
}

function truncatePreview(text: string, maxLength = MAX_SIMILAR_LINE_LENGTH): string {
  return text.length > maxLength ? text.slice(0, maxLength) + '…' : text;
}

function findSimilarLines(haystack: string, needle: string): SimilarLineCandidate[] {
  const needleLines = needle
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, MAX_NEEDLE_LINES_TO_COMPARE);

  if (needleLines.length === 0) return [];

  const candidates: SimilarLineCandidate[] = [];
  const seenLineNumbers = new Set<number>();
  const lines = haystack.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const originalLine = lines[i].trimEnd();
    const candidateLine = originalLine.trim();
    if (!candidateLine) continue;

    let bestScore = 0;
    for (const needleLine of needleLines) {
      bestScore = Math.max(bestScore, similarityScore(needleLine, candidateLine));
    }

    if (bestScore < MIN_SIMILARITY_SCORE || seenLineNumbers.has(i + 1)) continue;

    seenLineNumbers.add(i + 1);
    candidates.push({
      lineNumber: i + 1,
      text: truncatePreview(originalLine),
      score: bestScore,
    });
  }

  candidates.sort((a, b) => b.score - a.score || a.lineNumber - b.lineNumber);
  return candidates.slice(0, MAX_SIMILAR_CANDIDATES);
}

function formatSimilarLineHints(candidates: SimilarLineCandidate[]): string {
  if (candidates.length === 0) return '';

  const hints = candidates.map((candidate) => `Line ${candidate.lineNumber}: "${candidate.text}"`);
  return ` Similar text in file (not an exact match): ${hints.join(' | ')}`;
}

export function isRetryableEditMatchError(error: string): boolean {
  return error.includes('"find" not found') || error.includes('"find" matches multiple times');
}

function findMatch(result: string, find: string):
  | { kind: 'found'; start: number; end: number }
  | { kind: 'missing'; normalized: boolean }
  | { kind: 'ambiguous'; normalized: boolean; lineNums: number[] } {
  const modes: NormalizationMode[] = ['exact', 'normalize-line-endings', 'trim-trailing-whitespace'];

  for (const mode of modes) {
    const normalizedResult = normalizeForMatch(result, mode);
    const normalizedFind = normalizeForMatch(find, mode);
    const matches = getMatchCandidates(normalizedResult.text, normalizedFind.text);

    if (matches.length === 0) continue;
    if (matches.length > 1) {
      return {
        kind: 'ambiguous',
        normalized: mode !== 'exact',
        lineNums: findLineNumbers(normalizedResult.text, normalizedFind.text),
      };
    }

    const start = normalizedResult.indexMap[matches[0]];
    const end = normalizedResult.indexMap[matches[0] + normalizedFind.text.length];
    return { kind: 'found', start, end };
  }

  return { kind: 'missing', normalized: true };
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

    if (replaceAll) {
      const idx = result.indexOf(find);
      if (idx === -1) {
        const preview = find.length > 80 ? find.slice(0, 80) + '…' : find;
        const similarHints = formatSimilarLineHints(findSimilarLines(result, find));
        return {
          ok: false,
          error:
            `edit #${i + 1}: "find" not found: ${preview}. ` +
            'Check line endings or trailing spaces, or provide a more exact snippet.' +
            similarHints,
        };
      }
      result = result.split(find).join(replace);
      continue;
    }

    const match = findMatch(result, find);
    if (match.kind === 'missing') {
      const preview = find.length > 80 ? find.slice(0, 80) + '…' : find;
      const similarHints = formatSimilarLineHints(findSimilarLines(result, find));
      return {
        ok: false,
        error:
          `edit #${i + 1}: "find" not found: ${preview}. ` +
          'Check line endings or trailing spaces, or provide a more exact snippet.' +
          similarHints,
      };
    }

    if (match.kind === 'ambiguous') {
      const preview = find.length > 80 ? find.slice(0, 80) + '…' : find;
      const linesStr = match.lineNums.length > 0 ? ` (matches at lines ${match.lineNums.join(', ')})` : '';
      return {
        ok: false,
        error:
          `edit #${i + 1}: "find" matches multiple times${linesStr}. ` +
          `Either add surrounding context to make it unique, or set "replaceAll": true to update every occurrence: ${preview}`,
      };
    }

    result = result.slice(0, match.start) + replace + result.slice(match.end);
  }
  return { ok: true, result, appliedCount: edits.length };
}
