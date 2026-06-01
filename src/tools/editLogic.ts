import { distance } from 'fastest-levenshtein';

export type FindReplace = {
  find: string;
  replace: string;
  /** When true, replace ALL occurrences of `find`. Default false (unique-match required). */
  replaceAll?: boolean;
};

export type ApplyEditsResult =
  | { ok: true; result: string; appliedCount: number; fuzzyMatch?: boolean; similarity?: number }
  | { ok: false; error: string };

type NormalizationMode = 'exact' | 'normalize-line-endings' | 'trim-trailing-whitespace' | 'whitespace-agnostic';

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

    if (mode === 'whitespace-agnostic') {
      // Don't use the indexMap approach for whitespace-agnostic.
      // It's handled directly in findMatch() via findWhitespaceAgnosticMatch().
      i++;
      continue;
    }

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

/**
 * Find a line in `haystack` that has the most bigram overlap with `needle`.
 * Returns { lineNumber, line } for the best match, or undefined if none above threshold.
 */
function findBestContextMatch(
  haystack: string,
  needle: string,
): { lineNumber: number; line: string } | undefined {
  const needleTrimmed = needle.trim();
  if (needleTrimmed.length <= 3) return undefined;

  const lines = haystack.split('\n');
  let bestScore = 0;
  let bestIdx = -1;

  for (let i = 0; i < lines.length; i++) {
    const score = similarityScore(needleTrimmed, lines[i]);
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }

  if (bestIdx === -1 || bestScore < 0.4) return undefined;
  return { lineNumber: bestIdx + 1, line: truncatePreview(lines[bestIdx]) };
}

/**
 * Format an enhanced "find not found" error that includes:
 * - The usual preview
 * - Similar line hints (existing)
 * - Context lines around the best-guess match area
 * - A concrete tip
 */
function formatFindError(
  find: string,
  originalContent: string,
): string {
  const preview = find.length > 80 ? find.slice(0, 80) + '…' : find;
  const similarHints = formatSimilarLineHints(findSimilarLines(originalContent, find));
  const contextMatch = findBestContextMatch(originalContent, find);

  let msg = `edit: "find" not found: ${preview}.`;

  if (contextMatch) {
    // Show 5 context lines (2 before, the line, 2 after) around the best guess
    const lines = originalContent.split('\n');
    const fromLine = Math.max(0, contextMatch.lineNumber - 3);
    const toLine = Math.min(lines.length, contextMatch.lineNumber + 2);
    const contextLines = lines.slice(fromLine, toLine);
    const contextStr = contextLines
      .map((l, i) => {
        const lineNum = fromLine + i + 1;
        const marker = lineNum === contextMatch.lineNumber ? '>' : ' ';
        return `${marker} ${lineNum}: ${truncatePreview(l)}`;
      })
      .join('\n');
    msg += `\n  Best context match near line ${contextMatch.lineNumber}:\n${contextStr}`;
  }

  if (similarHints) {
    msg += `\n${similarHints}`;
  }

  msg += `\n  Tip: copy the exact text from the file, preserving whitespace and indentation.`;
  return msg;
}

/**
 * Try to find a fuzzy (Levenshtein-based) match for `needle` in `haystack`.
 * Uses sliding window over lines with a dynamic similarity threshold.
 * Returns all matches above threshold, sorted by similarity descending.
 * Only matches if needle is long enough (> 3 chars trimmed) to avoid false positives.
 */
type FuzzyMatchResult = {
  start: number;
  end: number;
  similarity: number;
};

const FUZZY_SINGLE_LINE_THRESHOLD = 0.90;
const FUZZY_MULTI_LINE_THRESHOLD = 0.85;
const FUZZY_MIN_NEEDLE_LENGTH = 3;

function fuzzyFindMatch(haystack: string, needle: string): FuzzyMatchResult[] {
  const trimmed = needle.trim();
  if (trimmed.length <= FUZZY_MIN_NEEDLE_LENGTH) return [];

  const needleLines = needle.split('\n');
  const haystackLines = haystack.split('\n');
  const nonEmptyNeedleLines = needleLines.filter((l) => l.trim().length > 0);
  if (nonEmptyNeedleLines.length === 0) return [];

  const matches: FuzzyMatchResult[] = [];
  const isSingleLine = nonEmptyNeedleLines.length === 1;

  if (isSingleLine) {
    const needleTrimmed = nonEmptyNeedleLines[0].trim();
    if (needleTrimmed.length <= FUZZY_MIN_NEEDLE_LENGTH) return [];

    for (let i = 0; i < haystackLines.length; i++) {
      const candidateTrimmed = haystackLines[i].trim();
      if (candidateTrimmed.length <= FUZZY_MIN_NEEDLE_LENGTH) continue;

      const dist = distance(needleTrimmed, candidateTrimmed);
      const sim = 1 - dist / Math.max(needleTrimmed.length, candidateTrimmed.length);

      if (sim >= FUZZY_SINGLE_LINE_THRESHOLD) {
        // Map line index to character range in original haystack
        const lineStart = haystackLines.slice(0, i).join('\n').length + (i > 0 ? 1 : 0);
        const lineEnd = lineStart + haystackLines[i].length;
        matches.push({ start: lineStart, end: lineEnd, similarity: sim });
      }
    }
  } else {
    // Multi-line: sliding window
    const needleBlock = nonEmptyNeedleLines.join('\n');
    for (let i = 0; i <= haystackLines.length - nonEmptyNeedleLines.length; i++) {
      const candidateBlock = haystackLines.slice(i, i + nonEmptyNeedleLines.length).join('\n');

      const dist = distance(needleBlock, candidateBlock);
      const sim = 1 - dist / Math.max(needleBlock.length, candidateBlock.length);

      if (sim >= FUZZY_MULTI_LINE_THRESHOLD) {
        const blockStart = haystackLines.slice(0, i).join('\n').length + (i > 0 ? 1 : 0);
        const blockEnd = blockStart + candidateBlock.length;
        matches.push({ start: blockStart, end: blockEnd, similarity: sim });
      }
    }
  }

  matches.sort((a, b) => b.similarity - a.similarity);
  return matches;
}

export function isRetryableEditMatchError(error: string): boolean {
  return error.includes('"find" not found') || error.includes('"find" matches multiple times');
}

/**
 * Get the leading whitespace of a line of text.
 */
function getLeadingIndentation(line: string): string {
  const match = line.match(/^(\s*)/);
  return match ? match[1] : '';
}

/**
 * Get the indentation of the line in `text` that contains the `charPos`-th character.
 */
function getIndentAtPosition(text: string, charPos: number): string {
  const lineStart = text.lastIndexOf('\n', charPos - 1) + 1;
  const lineEnd = text.indexOf('\n', lineStart);
  const line = text.substring(lineStart, lineEnd === -1 ? text.length : lineEnd);
  return getLeadingIndentation(line);
}

/**
 * Adjust the indentation of `newCode` so it aligns with the indentation at `matchPos`
 * in the original file. Uses the actual matched text's indentation as the reference,
 * so replacements get proper indentation even when the LLM-provided `find` string
 * doesn't include leading whitespace.
 */
function adjustReplacementIndentation(
  fileContent: string,
  matchStart: number,
  matchEnd: number,
  matchedText: string,
  newCode: string,
): string {
  const fileIndent = getIndentAtPosition(fileContent, matchStart);

  // Get the actual indent from the matched text in the file (first non-empty line)
  const matchedLines = matchedText.split('\n');
  let actualOldIndent = '';
  for (const line of matchedLines) {
    if (line.trim().length > 0) {
      actualOldIndent = getLeadingIndentation(line);
      break;
    }
  }

  // No indentation to adjust
  if (!actualOldIndent && !fileIndent) return newCode;
  if (fileIndent && actualOldIndent && fileIndent === actualOldIndent) return newCode;

  const newLines = newCode.split('\n');
  const adjusted = newLines.map((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) return line; // preserve empty lines

    const lineIndent = getLeadingIndentation(line);

    if (index === 0) {
      // First line: fileIndent is already present in text before matchStart.
      // When actualOldIndent is empty, the LLM's find didn't include leading
      // whitespace, so strip any leading indent from the replacement.
      if (!actualOldIndent) {
        return trimmed;
      }
      if (line.startsWith(actualOldIndent)) {
        return line.slice(actualOldIndent.length);
      }
      return trimmed;
    }

    // Subsequent lines: shift indentation
    if (!actualOldIndent) {
      // LLM's find had no leading indent — use fileIndent as base
      return line;
    }
    if (line.startsWith(actualOldIndent)) {
      return fileIndent + line.slice(actualOldIndent.length);
    }
    // Extra indentation relative to actualOldIndent
    if (lineIndent.startsWith(actualOldIndent)) {
      return fileIndent + line.slice(actualOldIndent.length);
    }

    return line;
  });

  return adjusted.join('\n');
}

/**
 * Try to match needle in haystack ignoring ALL whitespace.
 * Strips \s from both, finds the match, then maps positions back.
 * Returns undefined if no match or multiple matches.
 */
function findWhitespaceAgnosticMatch(
  haystack: string,
  needle: string,
): { start: number; end: number } | undefined {
  const strippedHaystack = haystack.replace(/\s/g, '');
  const strippedNeedle = needle.replace(/\s/g, '');
  if (strippedNeedle.length === 0) return undefined;

  // Find all occurrences in stripped text
  const indices: number[] = [];
  let pos = 0;
  while (true) {
    const idx = strippedHaystack.indexOf(strippedNeedle, pos);
    if (idx === -1) break;
    indices.push(idx);
    pos = idx + 1;
  }
  if (indices.length !== 1) return undefined; // 0 or >1 → not usable

  const matchStrippedPos = indices[0];

  // Map stripped position back to original character position in haystack
  let origPos = 0;
  let strippedCount = 0;
  while (origPos < haystack.length && strippedCount < matchStrippedPos) {
    if (!/\s/.test(haystack[origPos])) strippedCount++;
    origPos++;
  }

  // Now advance through the match, consuming non-whitespace chars
  let matchedCount = 0;
  let endPos = origPos;
  while (endPos < haystack.length && matchedCount < strippedNeedle.length) {
    if (!/\s/.test(haystack[endPos])) matchedCount++;
    endPos++;
  }

  return { start: origPos, end: endPos };
}

function findMatch(result: string, find: string):
  | { kind: 'found'; start: number; end: number; similarity?: number }
  | { kind: 'missing'; normalized: boolean }
  | { kind: 'ambiguous'; normalized: boolean; lineNums: number[] } {
  const modes: NormalizationMode[] = [
    'exact',
    'normalize-line-endings',
    'trim-trailing-whitespace',
  ];

  // First pass: try normalization modes (exact matching after normalization)
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
    return { kind: 'found', start, end, similarity: 1 };
  }

  // Second pass: whitespace-agnostic matching
  const wsMatch = findWhitespaceAgnosticMatch(result, find);
  if (wsMatch) {
    return { kind: 'found', start: wsMatch.start, end: wsMatch.end, similarity: 1 };
  }

  // Third pass: fuzzy (Levenshtein) matching — only for single, unique matches
  const fuzzyMatches = fuzzyFindMatch(result, find);
  if (fuzzyMatches.length === 1) {
    return {
      kind: 'found',
      start: fuzzyMatches[0].start,
      end: fuzzyMatches[0].end,
      similarity: fuzzyMatches[0].similarity,
    };
  }
  if (fuzzyMatches.length > 1) {
    // Deduplicate very close similarity scores (within 0.02) — report them all
    const topSimilarity = fuzzyMatches[0].similarity;
    const ambiguous = fuzzyMatches.filter((m) => topSimilarity - m.similarity < 0.02);
    const lineNums = ambiguous.map((m) => {
      const before = result.slice(0, m.start);
      return (before.match(/\n/g) || []).length + 1;
    });
    return {
      kind: 'ambiguous',
      normalized: true,
      lineNums,
    };
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
  let fuzzyMatched = false;
  let lastSimilarity: number | undefined;
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
        return {
          ok: false,
          error: `edit #${i + 1}: ${formatFindError(find, result)} (replaceAll mode)`,
        };
      }
      result = result.split(find).join(replace);
      continue;
    }

    const match = findMatch(result, find);
    if (match.kind === 'missing') {
      return {
        ok: false,
        error: `edit #${i + 1}: ${formatFindError(find, result)}`,
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

    const matchedText = result.slice(match.start, match.end);
    const adjustedReplace = adjustReplacementIndentation(result, match.start, match.end, matchedText, replace);
    result = result.slice(0, match.start) + adjustedReplace + result.slice(match.end);
    if (match.similarity !== undefined && match.similarity < 1) {
      fuzzyMatched = true;
      lastSimilarity = match.similarity;
    }
  }
  return { ok: true, result, appliedCount: edits.length, fuzzyMatch: fuzzyMatched ? true : undefined, similarity: lastSimilarity };
}
