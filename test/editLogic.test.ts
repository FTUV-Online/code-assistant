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

test('applyEdits: not-found error includes similar text hints for typo', () => {
  const r = applyEdits('function calculateTotal(items) {\n  return items.length;\n}', [
    { find: 'function calcuateTotal(items) {', replace: 'function sumTotal(items) {' },
  ]);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.match(r.error, /not found/);
    assert.match(r.error, /Similar text in file/);
    assert.match(r.error, /Line 1/);
    assert.match(r.error, /calculateTotal/);
  }
});

test('applyEdits: not-found error includes similar text hints for whitespace mismatch', () => {
  const r = applyEdits('  const value = 1;\n  const other = 2;', [
    { find: '   const value = 1;', replace: '  const value = 2;' },
  ]);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.match(r.error, /Similar text in file/);
    assert.match(r.error, /Line 1/);
  }
});

test('applyEdits: not-found error omits similar text hints for unrelated text', () => {
  const r = applyEdits('alpha\nbeta\ngamma', [{ find: 'world', replace: 'x' }]);
  assert.equal(r.ok, false);
  if (!r.ok) assert.doesNotMatch(r.error, /Similar text in file/);
});

test('applyEdits: similar text hints are capped to top 3 candidates', () => {
  const r = applyEdits(
    'const user = getUser();\nconst usr = getUsr();\nconst usre = getUsre();\nconst usser = getUsser();\nconst usage = getUsage();',
    [{ find: 'const uuser = getUser();', replace: 'const owner = getUser();' }],
  );
  assert.equal(r.ok, false);
  if (!r.ok) {
    const lineMatches = r.error.match(/Line \d+/g) ?? [];
    assert.ok(lineMatches.length <= 3);
    assert.ok(lineMatches.length > 0);
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
