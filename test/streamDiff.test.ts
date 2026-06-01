import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeDiff, computeDiffStats, formatDiffLines, isTrivialDiff, linesMatch, streamDiff } from '../src/tools/streamDiff';

test('computeDiff: identical lines', () => {
  const oldLines = ['hello', 'world'];
  const newLines = ['hello', 'world'];
  const diff = computeDiff(oldLines, newLines);
  assert.equal(diff.length, 2);
  assert.equal(diff[0].type, 'same');
  assert.equal(diff[1].type, 'same');
});

test('computeDiff: single deletion', () => {
  const oldLines = ['a', 'b', 'c'];
  const newLines = ['a', 'c'];
  const diff = computeDiff(oldLines, newLines);
  const deletions = diff.filter((d) => d.type === 'old');
  assert.equal(deletions.length, 1);
  assert.equal(deletions[0].line, 'b');
});

test('computeDiff: single insertion', () => {
  const oldLines = ['a', 'c'];
  const newLines = ['a', 'b', 'c'];
  const diff = computeDiff(oldLines, newLines);
  const insertions = diff.filter((d) => d.type === 'new');
  assert.equal(insertions.length, 1);
  assert.equal(insertions[0].line, 'b');
});

test('computeDiff: replacement (delete + insert)', () => {
  const oldLines = ['a', 'old', 'c'];
  const newLines = ['a', 'new', 'c'];
  const diff = computeDiff(oldLines, newLines);
  assert.equal(diff.filter((d) => d.type === 'old').length, 1);
  assert.equal(diff.filter((d) => d.type === 'new').length, 1);
});

test('computeDiff: empty old → all new', () => {
  const diff = computeDiff([], ['a', 'b']);
  assert.equal(diff.length, 2);
  assert.equal(diff.every((d) => d.type === 'new'), true);
});

test('computeDiff: empty new → all old', () => {
  const diff = computeDiff(['a', 'b'], []);
  assert.equal(diff.length, 2);
  assert.equal(diff.every((d) => d.type === 'old'), true);
});

test('computeDiff: both empty', () => {
  const diff = computeDiff([], []);
  assert.equal(diff.length, 0);
});

test('computeDiff: trims when comparing (prefers original content on match)', () => {
  const oldLines = ['  hello  ', 'world'];
  const newLines = ['hello', 'world'];
  const diff = computeDiff(oldLines, newLines);
  // Lines match (trimmed equality), so they should be 'same' with original content
  const first = diff[0];
  assert.equal(first.type, 'same');
  assert.equal(first.line, '  hello  ');
});

test('computeDiff: preserves chronology', () => {
  const oldLines = ['a', 'b', 'c'];
  const newLines = ['x', 'a', 'y', 'c'];
  const diff = computeDiff(oldLines, newLines);
  const types = diff.map((d) => d.type);
  // x new, a same, b deleted, y new, c same
  assert.deepEqual(types, ['new', 'same', 'old', 'new', 'same']);
});

test('computeDiff: complete rewrite (no common lines)', () => {
  const oldLines = ['a', 'b', 'c'];
  const newLines = ['x', 'y', 'z'];
  const diff = computeDiff(oldLines, newLines);
  assert.equal(diff.filter((d) => d.type === 'old').length, 3);
  assert.equal(diff.filter((d) => d.type === 'new').length, 3);
});

test('computeDiff: single element arrays', () => {
  assert.equal(computeDiff(['a'], ['b']).length, 2);
  assert.equal(computeDiff(['a'], ['a']).length, 1);
  assert.equal(computeDiff(['a'], []).length, 1);
  assert.equal(computeDiff([], ['a']).length, 1);
});

test('computeDiff: tab vs space (LCS should still match)', () => {
  // Tab-indented vs space-indented — same content after trim
  const diff = computeDiff(['\tfunction() {}', '\t\treturn 1;'], ['    function() {}', '        return 1;']);
  assert.equal(diff.every((d) => d.type === 'same'), true);
});

test('computeDiff: only trailing whitespace differs', () => {
  const diff = computeDiff(['hello ', 'world  '], ['hello', 'world']);
  assert.equal(diff.every((d) => d.type === 'same'), true);
  // Original content preserved (including trailing spaces)
  assert.equal(diff[0].line, 'hello ');
});

test('computeDiff: duplicate lines (LCS ambiguity)', () => {
  // With "a" appearing multiple times, LCS must still produce a valid diff
  const oldLines = ['a', 'b', 'a', 'c'];
  const newLines = ['a', 'x', 'a', 'y'];
  const diff = computeDiff(oldLines, newLines);
  // The two "a" lines should be matched as 'same'
  const sameLines = diff.filter((d) => d.type === 'same');
  assert.equal(sameLines.length, 2);
  assert.equal(sameLines.every((d) => d.line === 'a'), true);
});

test('computeDiff: many consecutive deletions then insertions', () => {
  const oldLines = ['a', 'b', 'c', 'd', 'e'];
  const newLines = ['x', 'y', 'z'];
  const diff = computeDiff(oldLines, newLines);
  assert.equal(diff.filter((d) => d.type === 'old').length, 5);
  assert.equal(diff.filter((d) => d.type === 'new').length, 3);
});

test('computeDiff: reordered lines', () => {
  const oldLines = ['a', 'b', 'c'];
  const newLines = ['c', 'b', 'a'];
  const diff = computeDiff(oldLines, newLines);
  // Some lines may match (LCS = "b" or "c" or "a")
  const sameCount = diff.filter((d) => d.type === 'same').length;
  assert.ok(sameCount >= 1, 'LCS should find at least one common line');
  assert.ok(sameCount <= 3);
});

test('computeDiff: empty string lines vs content', () => {
  const diff = computeDiff([''], ['content']);
  assert.equal(diff.length, 2);
  assert.equal(diff[0].type, 'old');
  assert.equal(diff[1].type, 'new');
});

test('computeDiffStats: counts correctly', () => {
  const oldLines = ['a', 'b', 'c'];
  const newLines = ['a', 'x', 'c', 'd'];
  const diff = computeDiff(oldLines, newLines);
  const stats = computeDiffStats(diff);
  assert.equal(stats.added, 2);  // x, d
  assert.equal(stats.removed, 1); // b
  assert.equal(stats.unchanged, 2); // a, c
  assert.equal(stats.totalOld, 3);
  assert.equal(stats.totalNew, 4);
});

test('computeDiffStats: all same', () => {
  const diff = computeDiff(['a', 'b'], ['a', 'b']);
  const stats = computeDiffStats(diff);
  assert.equal(stats.added, 0);
  assert.equal(stats.removed, 0);
  assert.equal(stats.unchanged, 2);
});

test('computeDiffStats: all additions', () => {
  const diff = computeDiff([], ['a', 'b']);
  const stats = computeDiffStats(diff);
  assert.equal(stats.added, 2);
  assert.equal(stats.removed, 0);
  assert.equal(stats.unchanged, 0);
});

test('computeDiffStats: all deletions', () => {
  const diff = computeDiff(['a', 'b'], []);
  const stats = computeDiffStats(diff);
  assert.equal(stats.added, 0);
  assert.equal(stats.removed, 2);
  assert.equal(stats.unchanged, 0);
});

test('computeDiffStats: empty diff', () => {
  const stats = computeDiffStats([]);
  assert.equal(stats.added, 0);
  assert.equal(stats.removed, 0);
  assert.equal(stats.unchanged, 0);
  assert.equal(stats.totalOld, 0);
  assert.equal(stats.totalNew, 0);
});

test('isTrivialDiff: only whitespace changes → true', () => {
  const oldLines = ['  hello', 'world'];
  const newLines = ['hello', '  world'];
  // After LCS matching, only indent changed
  const diff = computeDiff(oldLines, newLines);
  assert.equal(isTrivialDiff(diff), true);
});

test('isTrivialDiff: content changes → false', () => {
  const oldLines = ['hello', 'world'];
  const newLines = ['hi', 'world'];
  const diff = computeDiff(oldLines, newLines);
  assert.equal(isTrivialDiff(diff), false);
});

test('isTrivialDiff: empty diff → true', () => {
  assert.equal(isTrivialDiff([]), true);
});

test('isTrivialDiff: only additions (no paired deletion) → false', () => {
  // New lines with no corresponding old line → not trivial
  const diff = [
    { type: 'same' as const, line: 'a' },
    { type: 'new' as const, line: 'b' },     // no "b" in old → real addition
  ];
  assert.equal(isTrivialDiff(diff), false);
});

test('isTrivialDiff: only deletions (no paired addition) → false', () => {
  const diff = [
    { type: 'old' as const, line: 'a' },   // no "a" in new → real deletion
    { type: 'same' as const, line: 'b' },
  ];
  assert.equal(isTrivialDiff(diff), false);
});

test('isTrivialDiff: paired whitespace changes across adjacent lines', () => {
  // Two adjacent lines each change indent — both have a pair in the opposite type
  const diff = [
    { type: 'old' as const, line: '  hello' },
    { type: 'old' as const, line: '  world' },
    { type: 'new' as const, line: 'hello' },
    { type: 'new' as const, line: 'world' },
  ];
  // Each old has a trim-match in new, and vice versa → trivial
  assert.equal(isTrivialDiff(diff), true);
});

test('linesMatch: exact trim match', () => {
  assert.equal(linesMatch('  hello  ', 'hello', 0), true);
});

test('linesMatch: same content, different indent', () => {
  assert.equal(linesMatch('  hello', 'hello', 0), true);
});

test('linesMatch: small typo with Levenshtein fallback', () => {
  assert.equal(linesMatch('hello', 'hellx', 0), true);
});

test('linesMatch: too different', () => {
  assert.equal(linesMatch('hello', 'goodbye', 0), false);
});

test('linesMatch: short strings dont fuzzy match', () => {
  assert.equal(linesMatch('ab', 'cd', 0), false);
});

test('linesMatch: empty strings', () => {
  assert.equal(linesMatch('', '', 0), true);
  assert.equal(linesMatch('', 'a', 0), false);
  assert.equal(linesMatch('a', '', 0), false);
});

test('linesMatch: distant lines have stricter threshold', () => {
  // Same single-char difference but at distance 0 vs distance 10
  // At distance 0: threshold = 0.48 → "hello"/"hellx" (sim=0.8) passes
  // At distance 3: threshold = 0.48 - 3*0.06 = 0.30 → "hello"/"hellx" (sim=0.8) passes
  // At distance 8: threshold = 0.48 - 8*0.06 = 0.0 → anything passes
  assert.equal(linesMatch('function foo()', 'function foo(', 0), true);

  // "abcdefghij" vs "xyzpqwerty" — very different, 10 chars
  assert.equal(linesMatch('abcdefghij', 'xyzpqwerty', 3), false);
});

test('linesMatch: exactly at dynamic threshold boundary', () => {
  // linesBetween = 8 → threshold = 0.48 - 8*0.06 = 0.0
  assert.equal(linesMatch('hello', 'hellx', 8), true); // sim=0.8 ≥ 0.0
  // linesBetween = 9 → threshold = max(0, 0.48-9*0.06) = 0 (clamped)
  assert.equal(linesMatch('hello', 'hellx', 9), true); // sim=0.8 ≥ 0.0
});

test('formatDiffLines: produces readable output', () => {
  const diff = [
    { type: 'old' as const, line: 'a' },
    { type: 'new' as const, line: 'b' },
    { type: 'same' as const, line: 'c' },
  ];
  const formatted = formatDiffLines(diff);
  assert.equal(formatted, '- a\n+ b\n  c');
});

test('formatDiffLines: empty array', () => {
  assert.equal(formatDiffLines([]), '');
});

test('formatDiffLines: single element', () => {
  assert.equal(formatDiffLines([{ type: 'new' as const, line: 'hello' }]), '+ hello');
});

test('computeDiff: large indent change should still match', () => {
  const oldLines = ['    if (x) {', '        foo();'];
  const newLines = ['if (x) {', '    foo();'];
  const diff = computeDiff(oldLines, newLines);
  assert.equal(diff.every((d) => d.type === 'same'), true);
  assert.equal(diff[0].line, '    if (x) {');
});

test('computeDiff: real-world code edit', () => {
  const oldLines = [
    'function add(a, b) {',
    '  return a + b;',
    '}',
  ];
  const newLines = [
    'function add(a, b) {',
    '  const result = a + b;',
    '  return result;',
    '}',
  ];
  const diff = computeDiff(oldLines, newLines);
  const same = diff.filter((d) => d.type === 'same');
  const added = diff.filter((d) => d.type === 'new');
  const removed = diff.filter((d) => d.type === 'old');

  assert.equal(same.length, 2);
  assert.equal(removed.length, 1);
  assert.equal(added.length, 2);
});

// ─── streamDiff tests ───────────────────────────────────────────────────────

test('streamDiff: yields incremental results', async () => {
  async function* gen(): AsyncGenerator<string, void, unknown> {
    yield 'line1';
    yield 'line2';
    yield 'line3';
  }
  const results: Array<{ length: number; newCount: number }> = [];
  for await (const snapshot of streamDiff(['old1', 'old2'], gen())) {
    results.push({
      length: snapshot.length,
      newCount: snapshot.filter((d) => d.type === 'new').length,
    });
  }
  // After yield 1: 1 new line among 3 total
  // After yield 2: 2 new lines among 4 total
  // After yield 3: 3 new lines among 5 total
  assert.equal(results.length, 3);
  assert.equal(results[0].newCount, 1);
  assert.equal(results[1].newCount, 2);
  assert.equal(results[2].newCount, 3);
});

test('streamDiff: empty generator yields nothing', async () => {
  async function* emptyGen(): AsyncGenerator<string, void, unknown> {
    // yields nothing
  }
  let count = 0;
  for await (const _ of streamDiff(['a', 'b'], emptyGen())) {
    count++;
  }
  assert.equal(count, 0);
});

test('streamDiff: no old lines, progressive additions', async () => {
  async function* gen(): AsyncGenerator<string, void, unknown> {
    yield 'a';
    yield 'b';
  }
  const snapshots: number[][] = [];
  for await (const snapshot of streamDiff([], gen())) {
    snapshots.push(snapshot.map((d) => d.type === 'new' ? 1 : 0));
  }
  assert.equal(snapshots.length, 2);
  assert.deepEqual(snapshots[0], [1]);       // ['a'] → all new
  assert.deepEqual(snapshots[1], [1, 1]);     // ['a','b'] → all new
});

test('streamDiff: lines that converge to identical', async () => {
  async function* gen(): AsyncGenerator<string, void, unknown> {
    yield 'different';
    yield 'old1';
    yield 'old2';
  }
  const snapshots: string[][] = [];
  for await (const snapshot of streamDiff(['old1', 'old2'], gen())) {
    snapshots.push(snapshot.map((d) => d.type));
  }
  // Snapshot 1: ['different'] vs ['old1','old2'] → 1 new, 2 old
  // Snapshot 2: ['different','old1'] vs ['old1','old2'] → 1 new, 1 same, 1 old
  // Snapshot 3: ['different','old1','old2'] vs ['old1','old2']
  //   → LCS matches old1↔old1, old2↔old2, "different" is new, 0 old
  assert.equal(snapshots.length, 3);
  const newCount = snapshots[2].filter((t) => t === 'new').length;
  const sameCount = snapshots[2].filter((t) => t === 'same').length;
  assert.equal(newCount, 1, 'final snapshot: "different" is new');
  assert.equal(sameCount, 2, 'final snapshot: old1 + old2 matched');
});
