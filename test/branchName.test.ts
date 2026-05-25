import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanBranchName, parseBranchSuggestions } from '../src/git/branchNameParser';

test('cleanBranchName: spaces → hyphens', () => {
  assert.equal(cleanBranchName('feat Inline Edit'), 'feat-inline-edit');
});

test('cleanBranchName: drops invalid chars', () => {
  assert.equal(cleanBranchName('feat/foo!bar@baz'), 'feat/foobarbaz');
});

test('cleanBranchName: collapses multiple hyphens', () => {
  assert.equal(cleanBranchName('feat--foo---bar'), 'feat-foo-bar');
});

test('cleanBranchName: trims leading/trailing hyphens', () => {
  assert.equal(cleanBranchName('-foo-bar-'), 'foo-bar');
});

test('parseBranchSuggestions: direct JSON', () => {
  const raw = '["feat/a","fix/b","chore/c"]';
  assert.deepEqual(parseBranchSuggestions(raw), ['feat/a', 'fix/b', 'chore/c']);
});

test('parseBranchSuggestions: JSON in markdown fence', () => {
  const raw = '```json\n["feat/a","fix/b"]\n```';
  assert.deepEqual(parseBranchSuggestions(raw), ['feat/a', 'fix/b']);
});

test('parseBranchSuggestions: JSON embedded in chatter', () => {
  const raw = 'Sure, here are some ideas:\n["feat/a","fix/b"]\nLet me know if you need more.';
  assert.deepEqual(parseBranchSuggestions(raw), ['feat/a', 'fix/b']);
});

test('parseBranchSuggestions: line-based fallback', () => {
  const raw = '1. feat/inline-edit\n2. fix/auth-redirect\n- chore/cleanup-tests';
  assert.deepEqual(parseBranchSuggestions(raw), [
    'feat/inline-edit',
    'fix/auth-redirect',
    'chore/cleanup-tests',
  ]);
});

test('parseBranchSuggestions: caps at 5', () => {
  const raw = JSON.stringify(['a-one', 'a-two', 'a-three', 'a-four', 'a-five', 'a-six']);
  assert.equal(parseBranchSuggestions(raw).length, 5);
});

test('parseBranchSuggestions: filters implausible entries', () => {
  const raw = JSON.stringify(['', 'a', '!!!', 'has space', 'feat/ok']);
  // 'a' is too short, '!!!' starts with non-alphanumeric, 'has space' has space
  // cleanBranchName('has space') → 'has-space' which IS plausible, so it stays
  const out = parseBranchSuggestions(raw);
  assert.ok(out.includes('feat/ok'));
  assert.ok(!out.includes(''));
  assert.ok(!out.includes('!!!'));
});
