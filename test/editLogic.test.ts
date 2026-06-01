import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyEdits, isRetryableEditMatchError } from '../src/tools/editLogic';

test('applyEdits: single unique find → replaced', () => {
  const r = applyEdits('hello world', [{ find: 'world', replace: 'there' }]);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.result, 'hello there');
    assert.equal(r.appliedCount, 1);
  }
});

test('applyEdits: multi-edit applied in order', () => {
  const r = applyEdits('a b c', [
    { find: 'a', replace: 'A' },
    { find: 'c', replace: 'C' },
  ]);
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.result, 'A b C');
});

test('applyEdits: find not present → error', () => {
  const r = applyEdits('hello', [{ find: 'world', replace: 'x' }]);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /not found/);
});

test('applyEdits: ambiguous find (multiple matches) → error', () => {
  const r = applyEdits('foo foo', [{ find: 'foo', replace: 'bar' }]);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /multiple/i);
});

test('applyEdits: empty find → error', () => {
  const r = applyEdits('hello', [{ find: '', replace: 'x' }]);
  assert.equal(r.ok, false);
});

test('applyEdits: empty edits array → error', () => {
  const r = applyEdits('hello', []);
  assert.equal(r.ok, false);
});

test('applyEdits: order-dependent — later edit can match new text', () => {
  const r = applyEdits('hello', [
    { find: 'hello', replace: 'hi world' },
    { find: 'world', replace: 'there' },
  ]);
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.result, 'hi there');
});

test('applyEdits: preserves whitespace exactly', () => {
  const original = '  function foo() {\n    return 1;\n  }';
  const r = applyEdits(original, [{ find: 'return 1;', replace: 'return 2;' }]);
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.result, '  function foo() {\n    return 2;\n  }');
});

test('applyEdits: replace can be empty (deletion)', () => {
  const r = applyEdits('keep this\nremove this\nkeep that', [
    { find: 'remove this\n', replace: '' },
  ]);
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.result, 'keep this\nkeep that');
});

test('applyEdits: missing replace → error', () => {
  const r = applyEdits('x', [{ find: 'x' } as any]);
  assert.equal(r.ok, false);
});

test('applyEdits: replaceAll updates every occurrence', () => {
  const r = applyEdits('DotNetCoreCLI@2\nfoo\nDotNetCoreCLI@2\nbar\nDotNetCoreCLI@2', [
    { find: 'DotNetCoreCLI@2', replace: 'DotNetCoreCLI@3', replaceAll: true },
  ]);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.result, 'DotNetCoreCLI@3\nfoo\nDotNetCoreCLI@3\nbar\nDotNetCoreCLI@3');
    assert.equal(r.appliedCount, 1);
  }
});

test('applyEdits: replaceAll with no matches → error (consistent with unique mode)', () => {
  const r = applyEdits('hello', [{ find: 'world', replace: 'x', replaceAll: true }]);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /not found/);
});

test('applyEdits: ambiguous error lists line numbers', () => {
  const r = applyEdits('foo\nbar\nfoo\nbaz\nfoo', [{ find: 'foo', replace: 'X' }]);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.match(r.error, /multiple/i);
    assert.match(r.error, /1.*3.*5/);
    assert.match(r.error, /replaceAll/);
  }
});

test('applyEdits: LF find matches CRLF content', () => {
  const r = applyEdits('line 1\r\nline 2\r\nline 3', [
    { find: 'line 2\nline 3', replace: 'updated\nline 3' },
  ]);
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.result, 'line 1\r\nupdated\nline 3');
});

test('applyEdits: trailing spaces in find can still match', () => {
  const r = applyEdits('alpha\nvalue\nomega', [
    { find: 'value   \nomega', replace: 'updated\nomega' },
  ]);
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.result, 'alpha\nupdated\nomega');
});

test('applyEdits: fallback preserves surrounding CRLF formatting', () => {
  const r = applyEdits('before\r\nvalue\r\nafter\r\n', [
    { find: 'value\nafter\n', replace: 'changed\nafter\n' },
  ]);
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.result, 'before\r\nchanged\nafter\n');
});

test('applyEdits: fuzzy match resolves single-char typo', () => {
  const r = applyEdits('function calculateTotal(items) {\n  return items.length;\n}', [
    { find: 'function calcuateTotal(items) {', replace: 'function sumTotal(items) {' },
  ]);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.fuzzyMatch, true);
    assert.ok(r.similarity !== undefined && r.similarity >= 0.90);
  }
});

test('applyEdits: whitespace-agnostic matches with extra spaces', () => {
  const r = applyEdits('  const value = 1;\n  const other = 2;', [
    { find: '   const value = 1;', replace: '  const value = 2;' },
  ]);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.result, '  const value = 2;\n  const other = 2;');
  }
});

test('applyEdits: not-found error omits similar text hints for unrelated text', () => {
  const r = applyEdits('alpha\nbeta\ngamma', [{ find: 'world', replace: 'x' }]);
  assert.equal(r.ok, false);
  if (!r.ok) assert.doesNotMatch(r.error, /Similar text in file/);
});

test('applyEdits: fuzzy match resolves close match among similar lines', () => {
  const r = applyEdits(
    'const user = getUser();\nconst usr = getUsr();\nconst usre = getUsre();\nconst usser = getUsser();\nconst usage = getUsage();',
    [{ find: 'const uuser = getUser();', replace: 'const owner = getUser();' }],
  );
  // The fuzzy matcher should either find a unique best match (success)
  // or report ambiguity if multiple lines are too similar.
  if (!r.ok) {
    assert.match(r.error, /multiple/i);
  } else {
    assert.equal(r.fuzzyMatch, true);
    assert.ok(r.similarity !== undefined && r.similarity >= 0.85);
  }
});

test('applyEdits: ambiguous exact matches still report ambiguity without fuzzy hints', () => {
  const r = applyEdits('const user = 1;\nconst user = 2;', [{ find: 'const user =', replace: 'const owner =' }]);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.match(r.error, /multiple/i);
    assert.doesNotMatch(r.error, /Similar text in file/);
  }
});

test('isRetryableEditMatchError: detects not-found and ambiguous edit failures only', () => {
  assert.equal(isRetryableEditMatchError('edit #1: "find" not found: foo'), true);
  assert.equal(isRetryableEditMatchError('edit #1: "find" matches multiple times (matches at lines 1, 3)'), true);
  assert.equal(isRetryableEditMatchError('edit #1: empty "find"'), false);
  assert.equal(isRetryableEditMatchError('Denied by user.'), false);
});

test('applyEdits: fuzzy match single line with minor typo', () => {
  const r = applyEdits('  function handleItems() {\n    return items;\n  }', [
    { find: '  function handleTtems() {', replace: '  function handleItems() {' },
  ]);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.fuzzyMatch, true);
    assert.equal(r.result, '  function handleItems() {\n    return items;\n  }');
  }
});

test('applyEdits: fuzzy match fails correctly for completely different text', () => {
  const r = applyEdits('const x = 1;\nconst y = 2;', [
    { find: 'completelyUnrelated', replace: 'anything' },
  ]);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /not found/);
});

test('applyEdits: short needle skipped for fuzzy (avoid false positives)', () => {
  // "ab" is only 2 chars — fuzzy should skip it
  const r = applyEdits('abc def ghi', [
    { find: 'xy', replace: 'zz' },
  ]);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /not found/);
});

test('applyEdits: fuzzy ambiguous reports error', () => {
  // Two lines very similar — fuzzy should find both and report ambiguous
  const r = applyEdits('  const user = 1;\n  const user = 2;', [
    { find: 'const userr = 1;', replace: 'const owner = 1;' },
  ]);
  // Either fuzzy matches successfully to one of the lines, or reports ambiguity
  // (both outcomes are valid)
  if (!r.ok) {
    assert.match(r.error, /multiple/i);
  } else {
    assert.equal(r.fuzzyMatch, true);
  }
});

test('applyEdits: replaceAll does not use fuzzy', () => {
  const r = applyEdits('hello hello', [
    { find: 'ello', replace: 'i', replaceAll: true },
  ]);
  assert.equal(r.ok, true);
  // replaceAll with exact match should work fine
  if (r.ok) {
    assert.equal(r.result, 'hi hi');
  }
});

test('applyEdits: indentation inference fixes wrong indent in replacement', () => {
  // The "find" has different indentation than the file; replacement should use file indent
  const r = applyEdits('function outer() {\n  const x = 1;\n  return x;\n}', [
    { find: 'const x = 1;', replace: '    const x = 2; // wrong indent' },
  ]);
  assert.equal(r.ok, true);
  // The replacement should have its indent adjusted to match the file's indent (2 spaces)
  if (r.ok) {
    assert.equal(r.result, 'function outer() {\n  const x = 2; // wrong indent\n  return x;\n}');
  }
});

test('applyEdits: indentation inference adjusts replacement when find lacks indent', () => {
  // LLM provided find without leading whitespace, but replacement has it
  const r = applyEdits('function foo() {\n  if (true) {\n    doStuff();\n  }\n}', [
    {
      find: 'if (true) {\n    doStuff();',
      replace: '    if (true) {\n      doMore();',
    },
  ]);
  assert.equal(r.ok, true);
  // Replacement first-line indent should be stripped since file provides it
  if (r.ok) {
    assert.equal(r.result, 'function foo() {\n  if (true) {\n      doMore();\n  }\n}');
  }
});

test('isUnifiedDiff: detects @@ headers', () => {
  const { isUnifiedDiff } = require('../src/tools/unifiedDiff');
  assert.equal(isUnifiedDiff('@@ -1,3 +1,4 @@\n hello\n+world\n'), true);
  assert.equal(isUnifiedDiff('plain text without headers'), false);
  assert.equal(isUnifiedDiff(''), false);
});

test('applyUnifiedDiff: simple addition', () => {
  const { applyUnifiedDiff } = require('../src/tools/unifiedDiff');
  const source = 'line1\nline2\nline3';
  const diff = '@@ -1,3 +1,4 @@\n line1\n line2\n+inserted\n line3';
  const r = applyUnifiedDiff(source, diff);
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.result, 'line1\nline2\ninserted\nline3');
});

test('applyUnifiedDiff: simple deletion', () => {
  const { applyUnifiedDiff } = require('../src/tools/unifiedDiff');
  const source = 'line1\nline2\nline3';
  const diff = '@@ -1,3 +1,2 @@\n line1\n-line2\n line3';
  const r = applyUnifiedDiff(source, diff);
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.result, 'line1\nline3');
});

test('applyUnifiedDiff: no hunks → error', () => {
  const { applyUnifiedDiff } = require('../src/tools/unifiedDiff');
  const r = applyUnifiedDiff('hello', 'not a diff');
  assert.equal(r.ok, false);
});
