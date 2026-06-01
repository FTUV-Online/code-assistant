import { applyEdits, type FindReplace, type ApplyEditsResult } from './editLogic';

/**
 * Regex patterns for lazy edit placeholders (e.g. "// ... existing code ...").
 * Supports single-line comment styles and some block-comment styles.
 */
const LAZY_PLACEHOLDER_PATTERNS = [
  // Single-line comment styles
  /^\s*\/\/\s*\.{3,}\s*(?:existing\s+code|unchanged)?\s*\.{0,}\s*$/im,
  /^\s*#\s*\.{3,}\s*(?:existing\s+code|unchanged)?\s*\.{0,}\s*$/im,
  /^\s*--\s*\.{3,}\s*(?:existing\s+code|unchanged)?\s*\.{0,}\s*$/im,
  /^\s*;\s*\.{3,}\s*(?:existing\s+code|unchanged)?\s*\.{0,}\s*$/im,
  // Block comment styles
  /^\s*\/\*{2,}\s*\.{3,}\s*(?:existing\s+code|unchanged)?\s*\.{0,}\s*\*{0,}\/\s*$/im,
  /^\s*<!--\s*\.{3,}\s*(?:existing\s+code|unchanged)?\s*\.{0,}\s*-->\s*$/im,
  // Generic "..." on its own line (at least 3 dots, possibly with whitespace)
  /^\s*\.{3,}\s+existing\s+code\s*\.{3,}\s*$/im,
  /^\s*\.{3,}\s+unchanged\s*\.{3,}\s*$/im,
  // Any line that is just "...", ".....", etc.
  /^\s*\.{3,}\s*$/m,
];

const MIN_ANCHOR_LINES = 1;
const MAX_CONTEXT_LINES = 3;

export function isLazyEdit(code: string): boolean {
  return LAZY_PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(code));
}

type LazyBlock =
  | { type: 'placeholder'; lines: string[] }
  | { type: 'code'; lines: string[] };

/**
 * Parse lazy code into alternating blocks of code and placeholders.
 * E.g.:
 *   ["code line 1", "// ... existing code ...", "code line 2"]
 * → [{ type: 'code', lines: ["code line 1"] },
 *    { type: 'placeholder', lines: ["// ... existing code ..."] },
 *    { type: 'code', lines: ["code line 2"] }]
 */
function parseLazyCode(code: string): LazyBlock[] {
  const lines = code.split('\n');
  const blocks: LazyBlock[] = [];
  let currentBlock: string[] = [];

  for (const line of lines) {
    const isPlaceholder = LAZY_PLACEHOLDER_PATTERNS.some((p) => p.test(line));

    if (isPlaceholder) {
      if (currentBlock.length > 0) {
        blocks.push({ type: 'code', lines: currentBlock });
        currentBlock = [];
      }
      blocks.push({ type: 'placeholder', lines: [line] });
    } else {
      currentBlock.push(line);
    }
  }

  if (currentBlock.length > 0) {
    blocks.push({ type: 'code', lines: currentBlock });
  }

  return blocks;
}

/**
 * Try to find the same anchor text in the original content.
 * Returns the line range (start, end) in the original content, or undefined.
 */
function findAnchorInOriginal(
  originalLines: string[],
  anchorLines: string[],
  searchFromLine: number,
): number | undefined {
  const firstAnchor = anchorLines[0].trim();
  if (!firstAnchor) return undefined;

  for (let i = searchFromLine; i < originalLines.length - anchorLines.length + 1; i++) {
    let allMatch = true;
    for (let j = 0; j < anchorLines.length; j++) {
      // Match trimmed content — the LLM might add/remove subtle whitespace
      if (originalLines[i + j].trim() !== anchorLines[j].trim()) {
        allMatch = false;
        break;
      }
    }
    if (allMatch) return i;
  }

  // Fallback: try fuzzy matching (first anchor line only)
  // For lines longer than 10 chars, allow Levenshtein-based fuzzy match
  if (firstAnchor.length > 10) {
    const { distance } = require('fastest-levenshtein');
    for (let i = searchFromLine; i < originalLines.length; i++) {
      const dist = distance(firstAnchor.toLocaleLowerCase(), originalLines[i].trim().toLocaleLowerCase());
      const sim = 1 - dist / Math.max(firstAnchor.length, originalLines[i].trim().length);
      if (sim >= 0.85) {
        return i;
      }
    }
  }

  return undefined;
}

/**
 * Apply a lazy edit: reconstruct the full file content by filling placeholder
 * sections with the corresponding code from the original file.
 *
 * @param originalContent - The complete current file content.
 * @param lazyCode - The LLM's output with "// ... existing code ..." placeholders.
 * @returns The reconstructed file content, or an error.
 */
export function applyLazyEdit(
  originalContent: string,
  lazyCode: string,
): ApplyEditsResult {
  const blocks = parseLazyCode(lazyCode);

  // No placeholders found — this is a normal full-file rewrite
  if (!blocks.some((b) => b.type === 'placeholder')) {
    return applyEdits(originalContent, [
      { find: originalContent, replace: lazyCode },
    ]);
  }

  const originalLines = originalContent.split('\n');
  const resultLines: string[] = [];
  let originalCursor = 0; // line index in original we've consumed up to
  let needAnchorAbove = false;
  let anchorAbove: string[] = [];

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];

    if (block.type === 'code') {
      if (needAnchorAbove && block.lines.length > 0) {
        anchorAbove = block.lines.slice(
          0,
          Math.min(MAX_CONTEXT_LINES, block.lines.length),
        );
        needAnchorAbove = false;
      }
      resultLines.push(...block.lines);
    } else {
      // Placeholder block — need to fill from original

      // Gather anchor lines: above (from previous code block) + below (from next code block)
      const anchorBelow: string[] = [];
      for (let j = i + 1; j < blocks.length; j++) {
        if (blocks[j].type === 'code' && blocks[j].lines.length > 0) {
          const below = blocks[j].lines.slice(
            0,
            Math.min(MAX_CONTEXT_LINES, blocks[j].lines.length),
          );
          anchorBelow.push(...below);
          break;
        }
      }

      // Require at least one anchor above and one below
      if (anchorAbove.length === 0 || anchorBelow.length === 0) {
        return {
          ok: false,
          error:
            `lazy edit: placeholder at block ${i} needs anchor lines above and below. ` +
            'Include at least 1 line of context surrounding each placeholder.',
        };
      }

      // Find anchorAbove in original (starting from where we left off)
      const aboveMatch = findAnchorInOriginal(
        originalLines,
        anchorAbove,
        originalCursor,
      );
      if (aboveMatch === undefined) {
        return {
          ok: false,
          error:
            `lazy edit: could not find anchor lines in original file near line ${originalCursor + 1}. ` +
            `Expected: "${anchorAbove[0].trim()}". Check that the edit context matches the current file.`,
        };
      }

      // Find anchorBelow in original (starting from aboveMatch + anchorAbove.length)
      const belowMatch = findAnchorInOriginal(
        originalLines,
        anchorBelow,
        aboveMatch + anchorAbove.length,
      );
      if (belowMatch === undefined) {
        return {
          ok: false,
          error:
            `lazy edit: could not find closing anchor lines in original file. ` +
            `Expected: "${anchorBelow[0].trim()}".`,
        };
      }

      // Extract the original code between the anchors (this is the "existing code")
      const placeholderStart = aboveMatch + anchorAbove.length;
      const placeholderEnd = belowMatch - 1; // end index, inclusive

      if (placeholderStart <= placeholderEnd) {
        const existingLines = originalLines.slice(placeholderStart, placeholderEnd + 1);
        resultLines.push(...existingLines);
      }

      // Advance cursor past the block we just consumed
      originalCursor = belowMatch + anchorBelow.length;
      needAnchorAbove = false;
    }
  }

  const result = resultLines.join('\n');
  return { ok: true, result, appliedCount: 1 };
}
