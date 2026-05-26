import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBranchList } from '../src/git/branchListParser';

test('parseBranchList: local branches only', () => {
  const raw = 'main\nfeature/foo\nbugfix/bar\n';
  const result = parseBranchList(raw);
  assert.deepEqual(result, ['bugfix/bar', 'feature/foo', 'main']);
});

test('parseBranchList: strips remotes/ prefix, keeps remote name', () => {
  const raw = 'remotes/origin/main\nremotes/origin/feature/foo\n';
  const result = parseBranchList(raw);
  assert.deepEqual(result, ['origin/feature/foo', 'origin/main']);
});

test('parseBranchList: local and remote branches coexist', () => {
  // Local "main" and remote "remotes/origin/main" → "origin/main" are different entries
  const raw = 'main\nremotes/origin/main\nfeature/x\nremotes/origin/feature/x\n';
  const result = parseBranchList(raw);
  assert.deepEqual(result, ['feature/x', 'main', 'origin/feature/x', 'origin/main']);
});

test('parseBranchList: deduplicates identical short names', () => {
  // Both "remotes/origin/main" and "remotes/upstream/main" → "origin/main" vs "upstream/main"
  // Same-origin duplicate: "remotes/origin/main" appearing twice dedup into one "origin/main"
  const raw = 'remotes/origin/main\nremotes/origin/main\nremotes/upstream/main\n';
  const result = parseBranchList(raw);
  assert.deepEqual(result, ['origin/main', 'upstream/main']);
});

test('parseBranchList: empty input returns empty array', () => {
  assert.deepEqual(parseBranchList(''), []);
  assert.deepEqual(parseBranchList('\n\n'), []);
});

test('parseBranchList: single branch', () => {
  assert.deepEqual(parseBranchList('main'), ['main']);
});

test('parseBranchList: sorts alphabetically', () => {
  const raw = 'develop\nmain\nfeature/a\nrelease/1.0\nhotfix/urgent\n';
  const result = parseBranchList(raw);
  assert.deepEqual(result, ['develop', 'feature/a', 'hotfix/urgent', 'main', 'release/1.0']);
});

test('parseBranchList: trims whitespace around names', () => {
  const raw = '  main  \n  feature/foo\t\n';
  const result = parseBranchList(raw);
  assert.deepEqual(result, ['feature/foo', 'main']);
});

test('parseBranchList: skips symbolic HEAD refs', () => {
  const raw = 'main\nremotes/origin/HEAD -> origin/main\nfeature/x\n';
  const result = parseBranchList(raw);
  assert.deepEqual(result, ['feature/x', 'main']);
});

test('parseBranchList: keeps HEAD ref when not symbolic', () => {
  const raw = 'main\nHEAD\nfeature/x\n';
  const result = parseBranchList(raw);
  assert.deepEqual(result, ['HEAD', 'feature/x', 'main']);
});

test('parseBranchList: handles large input', () => {
  const names = [];
  for (let i = 0; i < 200; i++) {
    names.push(`feature/branch-${String(i).padStart(3, '0')}`);
  }
  const raw = names.join('\n');
  const result = parseBranchList(raw);
  assert.equal(result.length, 200);
  assert.equal(result[0], 'feature/branch-000');
  assert.equal(result[199], 'feature/branch-199');
});
