/**
 * Streaming diff algorithm — computes line-level diffs between an original
 * and a proposed version, yielding results incrementally.
 *
 * Based on concepts from Continue's streamDiff algorithm:
 * https://github.com/continuedev/continue
 *
 * Two modes of operation:
 * 1. **Batch mode** (`computeDiff`): Takes two complete line arrays and
 *    returns a DiffLine[] — useful for rendering a full diff at once.
 * 2. **Stream mode** (`streamDiff`): Takes old lines + an async generator of
 *    new lines, yielding DiffLines as each new line arrives — useful for
 *    showing progress during lazy-edit expansion or multi-edit application.
 */

import { distance } from 'fastest-levenshtein';

export type DiffLineType = 'old' | 'new' | 'same';

export type DiffLine = {
  type: DiffLineType;
  line: string;
};

/**
 * Get the leading whitespace of a line.
 */
function getLeadingIndentation(line: string): string {
  const match = line.match(/^(\s*)/);
  return match ? match[1] : '';
}

/**
 * Dynamic similarity threshold based on how many lines apart a candidate is
 * from the expected position. Tighter for distant lines to reduce false positives.
 */
function dynamicThreshold(linesBetween: number): number {
  return Math.max(0, 0.48 - linesBetween * 0.06);
}

/**
 * Check if two lines match after trimming, with Levenshtein fallback when
 * they differ slightly. Used by the streaming matcher to associate incoming
 * new lines with their original counterpart.
 */
export function linesMatch(
  lineA: string,
  lineB: string,
  linesBetween: number,
): boolean {
  const trimmedA = lineA.trim();
  const trimmedB = lineB.trim();

  // Exact trim match
  if (trimmedA === trimmedB) return true;

  // If the content is identical after stripping indentation, prefer existing indent
  if (trimmedA === trimmedB && getLeadingIndentation(lineA) !== getLeadingIndentation(lineB)) {
    return true;
  }

  // Levenshtein fallback for small differences
  const threshold = dynamicThreshold(linesBetween);
  const maxLen = Math.max(trimmedA.length, trimmedB.length);
  if (maxLen < 4) return false;
  const dist = distance(trimmedA, trimmedB);
  const sim = 1 - dist / maxLen;
  return sim >= threshold;
}

/**
 * Compute a simple LCS-based diff between two line arrays.
 * Returns an array of DiffLines that, when rendered sequentially,
 * transform `oldLines` into `newLines`.
 *
 * Uses a longest-common-subsequence approach for accurate line matching
 * rather than a naive left-to-right scan.
 */
export function computeDiff(oldLines: string[], newLines: string[]): DiffLine[] {
  const result: DiffLine[] = [];
  const m = oldLines.length;
  const n = newLines.length;

  // Build LCS table for trimmed comparison
  const lcs: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1].trim() === newLines[j - 1].trim()) {
        lcs[i][j] = lcs[i - 1][j - 1] + 1;
      } else {
        lcs[i][j] = Math.max(lcs[i - 1][j], lcs[i][j - 1]);
      }
    }
  }

  // Backtrack through LCS to produce diff
  let i = m;
  let j = n;
  const diffStack: DiffLine[] = [];

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1].trim() === newLines[j - 1].trim()) {
      // Lines match — prefer original line content (preserves existing indentation)
      diffStack.push({ type: 'same', line: oldLines[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || lcs[i][j - 1] >= lcs[i - 1][j])) {
      diffStack.push({ type: 'new', line: newLines[j - 1] });
      j--;
    } else if (i > 0) {
      diffStack.push({ type: 'old', line: oldLines[i - 1] });
      i--;
    }
  }

  // Reverse to get chronological order
  return diffStack.reverse();
}

/**
 * Stream version of diff computation.
 *
 * Takes the original lines and an async generator that yields new lines
 * incrementally (e.g., from lazily filled sections). For each incoming
 * batch of lines, re-computes the diff against the original and yields
 * the updated DiffLine array.
 *
 * This lets a consumer (e.g., a VS Code decoration updater) show progress
 * as the result evolves.
 */
export async function* streamDiff(
  oldLines: string[],
  newLines: AsyncGenerator<string, void, unknown>,
): AsyncGenerator<DiffLine[]> {
  const accumulated: string[] = [];

  for await (const line of newLines) {
    accumulated.push(line);
    yield computeDiff(oldLines, accumulated);
  }
}

/**
 * Format DiffLine[] as a unified-diff-style string (for display/logging).
 */
export function formatDiffLines(diffLines: DiffLine[]): string {
  return diffLines
    .map((dl) => {
      switch (dl.type) {
        case 'old':
          return `- ${dl.line}`;
        case 'new':
          return `+ ${dl.line}`;
        case 'same':
          return `  ${dl.line}`;
      }
    })
    .join('\n');
}

/**
 * Statistics about a diff — counts of additions, deletions, and unchanged lines.
 */
export interface DiffStats {
  added: number;
  removed: number;
  unchanged: number;
  totalOld: number;
  totalNew: number;
}

export function computeDiffStats(diffLines: DiffLine[]): DiffStats {
  let added = 0;
  let removed = 0;
  let unchanged = 0;

  for (const dl of diffLines) {
    if (dl.type === 'new') added++;
    else if (dl.type === 'old') removed++;
    else unchanged++;
  }

  return {
    added,
    removed,
    unchanged,
    totalOld: unchanged + removed,
    totalNew: unchanged + added,
  };
}

/**
 * Check if a diff is "trivial" — only whitespace/indentation changes.
 */
export function isTrivialDiff(diffLines: DiffLine[]): boolean {
  for (const dl of diffLines) {
    if (dl.type === 'same') continue;
    if (dl.type === 'old') {
      const newLine = diffLines.find((d) => d.type === 'new' && d.line.trim() === dl.line.trim());
      if (!newLine) return false;
    }
    if (dl.type === 'new') {
      const oldLine = diffLines.find((d) => d.type === 'old' && d.line.trim() === dl.line.trim());
      if (!oldLine) return false;
    }
  }
  return true;
}
