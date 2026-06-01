/**
 * Unified diff support — detect and apply git-style unified diff format.
 * Useful when models output diffs instead of find/replace pairs.
 */

/**
 * Check if text looks like a unified diff (has @@ hunk headers).
 */
export function isUnifiedDiff(text: string): boolean {
  return /^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/m.test(text.trim());
}

/**
 * A parsed hunk from a unified diff.
 */
interface Hunk {
  oldStart: number; // 1-based line number in original file
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: HunkLine[];
}

interface HunkLine {
  type: 'context' | 'add' | 'delete';
  text: string;
}

/**
 * Parse raw unified diff text into hunks.
 */
function parseUnifiedDiff(diffText: string): Hunk[] {
  const lines = diffText.split('\n');
  const hunks: Hunk[] = [];
  let currentHunk: Hunk | null = null;

  for (const line of lines) {
    const hunkHeader = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (hunkHeader) {
      if (currentHunk) hunks.push(currentHunk);
      currentHunk = {
        oldStart: parseInt(hunkHeader[1], 10),
        oldCount: parseInt(hunkHeader[2] || '1', 10),
        newStart: parseInt(hunkHeader[3], 10),
        newCount: parseInt(hunkHeader[4] || '1', 10),
        lines: [],
      };
      continue;
    }

    if (!currentHunk) continue;

    if (line.startsWith('+')) {
      currentHunk.lines.push({ type: 'add', text: line.slice(1) });
    } else if (line.startsWith('-')) {
      currentHunk.lines.push({ type: 'delete', text: line.slice(1) });
    } else if (line.startsWith(' ')) {
      currentHunk.lines.push({ type: 'context', text: line.slice(1) });
    }
    // Skip lines that don't match (diff metadata, etc.)
  }

  if (currentHunk) hunks.push(currentHunk);
  return hunks;
}

/**
 * Result of applying a unified diff to source code.
 */
export type UnifiedDiffResult =
  | { ok: true; result: string }
  | { ok: false; error: string };

/**
 * Apply a unified diff to source code.
 * Walks through hunks sequentially, matching context/deletion lines
 * against the source and producing the modified result.
 */
export function applyUnifiedDiff(
  sourceCode: string,
  diffText: string,
): UnifiedDiffResult {
  const hunks = parseUnifiedDiff(diffText);

  if (hunks.length === 0) {
    return { ok: false, error: 'unified diff: no hunks found in diff text' };
  }

  const sourceLines = sourceCode.split('\n');
  const resultLines: string[] = [];
  let sourceIdx = 0; // current position in sourceLines

  for (let h = 0; h < hunks.length; h++) {
    const hunk = hunks[h];

    // Hunk headers use 1-based line numbers; convert to 0-based index
    const hunkTargetLine = hunk.oldStart - 1;

    // Copy source lines before this hunk
    while (sourceIdx < hunkTargetLine && sourceIdx < sourceLines.length) {
      resultLines.push(sourceLines[sourceIdx]);
      sourceIdx++;
    }

    // Walk through hunk lines, matching against source
    let hunkSourceIdx = 0; // position within source for this hunk
    let hunkOk = true;

    for (const hl of hunk.lines) {
      if (hl.type === 'add') {
        // Addition: just add the line, don't consume a source line
        resultLines.push(hl.text);
      } else if (hl.type === 'delete') {
        // Deletion: consume a source line, don't add to result
        const sourceLine = sourceLines[sourceIdx + hunkSourceIdx];
        if (sourceLine === undefined) {
          return {
            ok: false,
            error: `unified diff hunk ${h + 1}: source line ${sourceIdx + hunkSourceIdx + 1} not found (unexpected EOF)`,
          };
        }
        // Match context/deletion lines by trimmed content
        if (sourceLine.trim() !== hl.text.trim()) {
          return {
            ok: false,
            error:
              `unified diff hunk ${h + 1}: delete line mismatch at source line ${sourceIdx + hunkSourceIdx + 1}. ` +
              `Expected: "${hl.text}", found: "${sourceLine}"`,
          };
        }
        hunkSourceIdx++;
      } else {
        // Context line: must match the source, then copy to result
        const sourceLine = sourceLines[sourceIdx + hunkSourceIdx];
        if (sourceLine === undefined) {
          return {
            ok: false,
            error: `unified diff hunk ${h + 1}: source line ${sourceIdx + hunkSourceIdx + 1} not found (unexpected EOF)`,
          };
        }
        if (sourceLine.trim() !== hl.text.trim()) {
          return {
            ok: false,
            error:
              `unified diff hunk ${h + 1}: context line mismatch at source line ${sourceIdx + hunkSourceIdx + 1}. ` +
              `Expected: "${hl.text}", found: "${sourceLine}"`,
          };
        }
        resultLines.push(sourceLine);
        hunkSourceIdx++;
      }
    }

    // Advance sourceIdx past the lines consumed by this hunk
    sourceIdx += hunkSourceIdx;

    if (!hunkOk) break;
  }

  // Copy remaining source lines after last hunk
  while (sourceIdx < sourceLines.length) {
    resultLines.push(sourceLines[sourceIdx]);
    sourceIdx++;
  }

  return { ok: true, result: resultLines.join('\n') };
}
