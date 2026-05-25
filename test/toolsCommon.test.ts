import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'path';
import {
  globToRegex,
  isBinary,
  isSkipDir,
  matchesAnyGlob,
  matchesGlob,
  resolveSafePath,
  truncate,
} from '../src/tools/common';

test('isBinary: ASCII text → false', () => {
  const bytes = new TextEncoder().encode('hello world\nfoo bar');
  assert.equal(isBinary(bytes), false);
});

test('isBinary: bytes containing null → true', () => {
  const bytes = new Uint8Array([0x48, 0x69, 0x00, 0x21]);
  assert.equal(isBinary(bytes), true);
});

test('isBinary: large text → false (only scans first 8KB)', () => {
  const text = 'a'.repeat(50_000);
  assert.equal(isBinary(new TextEncoder().encode(text)), false);
});

test('isSkipDir: known build dirs → true', () => {
  assert.equal(isSkipDir('node_modules'), true);
  assert.equal(isSkipDir('dist'), true);
  assert.equal(isSkipDir('.git'), true);
});

test('isSkipDir: ordinary dirs → false', () => {
  assert.equal(isSkipDir('src'), false);
  assert.equal(isSkipDir('packages'), false);
  assert.equal(isSkipDir('lib'), false);
});

test('truncate: short string returned unchanged', () => {
  assert.equal(truncate('hello', 100), 'hello');
});

test('truncate: long string gets suffix', () => {
  const result = truncate('abcdefghij', 5);
  assert.equal(result, 'abcde\n... [truncated]');
});

test('truncate: custom suffix honored', () => {
  assert.equal(truncate('abcdef', 3, '…'), 'abc…');
});

test('resolveSafePath: relative path inside workspace → resolved abs', () => {
  const root = path.resolve('/tmp/ws');
  const result = resolveSafePath(root, 'src/foo.ts');
  assert.equal(result, path.join(root, 'src/foo.ts'));
});

test('resolveSafePath: workspace root itself → same path', () => {
  const root = path.resolve('/tmp/ws');
  const result = resolveSafePath(root, '.');
  assert.equal(result, root);
});

test('resolveSafePath: parent-traversal escapes → null', () => {
  const root = path.resolve('/tmp/ws');
  assert.equal(resolveSafePath(root, '../etc/passwd'), null);
  assert.equal(resolveSafePath(root, 'foo/../../escape'), null);
});

test('resolveSafePath: absolute path inside workspace → ok', () => {
  const root = path.resolve('/tmp/ws');
  const inside = path.join(root, 'sub/file.ts');
  assert.equal(resolveSafePath(root, inside), inside);
});

test('resolveSafePath: absolute path outside workspace → null', () => {
  const root = path.resolve('/tmp/ws');
  assert.equal(resolveSafePath(root, '/etc/passwd'), null);
});

test('globToRegex: literal name matches', () => {
  assert.equal(globToRegex('.env').test('.env'), true);
  assert.equal(globToRegex('.env').test('config.env'), false);
});

test('globToRegex: single-star does not cross /', () => {
  const re = globToRegex('src/*.ts');
  assert.equal(re.test('src/foo.ts'), true);
  assert.equal(re.test('src/nested/foo.ts'), false);
});

test('globToRegex: double-star crosses /', () => {
  const re = globToRegex('src/**/foo.ts');
  assert.equal(re.test('src/foo.ts'), true);
  assert.equal(re.test('src/a/b/foo.ts'), true);
  assert.equal(re.test('lib/foo.ts'), false);
});

test('matchesGlob: bare pattern matches basename', () => {
  assert.equal(matchesGlob('config/secrets/.env', '.env'), true);
  assert.equal(matchesGlob('foo/bar/baz.pem', '*.pem'), true);
});

test('matchesGlob: pattern with slash matches full path', () => {
  assert.equal(matchesGlob('secrets/api.txt', 'secrets/*'), true);
  assert.equal(matchesGlob('config/secrets/api.txt', 'secrets/*'), false);
  assert.equal(matchesGlob('config/secrets/api.txt', '**/secrets/**'), true);
});

test('matchesAnyGlob: any-match across patterns', () => {
  const patterns = ['.env', '*.pem', '**/secrets/**'];
  assert.equal(matchesAnyGlob('.env', patterns), true);
  assert.equal(matchesAnyGlob('certs/server.pem', patterns), true);
  assert.equal(matchesAnyGlob('config/secrets/key.txt', patterns), true);
  assert.equal(matchesAnyGlob('src/foo.ts', patterns), false);
});

test('matchesAnyGlob: empty patterns array → false', () => {
  assert.equal(matchesAnyGlob('anything', []), false);
});

test('matchesGlob: windows-style backslash path normalized', () => {
  assert.equal(matchesGlob('config\\secrets\\api.txt', '**/secrets/**'), true);
});
