import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyEdits } from '../src/tools/editLogic';

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
    assert.match(r.error, /1.*3.*5/); // lines 1, 3, 5
    assert.match(r.error, /replaceAll/);
  }
});

test('applyEdits: mixed edits — unique + replaceAll in one call', () => {
  const r = applyEdits('VERSION = 1\nname: foo\nname: bar\nname: baz', [
    { find: 'VERSION = 1', replace: 'VERSION = 2' },
    { find: 'name:', replace: 'title:', replaceAll: true },
  ]);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(
      r.result,
      'VERSION = 2\ntitle: foo\ntitle: bar\ntitle: baz',
    );
  }
});
