import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasShellMetachars, isAutoApproved } from '../src/tools/shellSafety';

test('hasShellMetachars: plain command → false', () => {
  assert.equal(hasShellMetachars('npm install'), false);
  assert.equal(hasShellMetachars('git status'), false);
  assert.equal(hasShellMetachars('echo hello'), false);
});

test('hasShellMetachars: pipe → true', () => {
  assert.equal(hasShellMetachars('ls | grep foo'), true);
});

test('hasShellMetachars: redirect → true', () => {
  assert.equal(hasShellMetachars('echo hi > out.txt'), true);
});

test('hasShellMetachars: chain (&&, ;) → true', () => {
  assert.equal(hasShellMetachars('npm test && echo done'), true);
  assert.equal(hasShellMetachars('cd /tmp; ls'), true);
});

test('hasShellMetachars: command substitution → true', () => {
  assert.equal(hasShellMetachars('echo $(date)'), true);
  assert.equal(hasShellMetachars('echo `date`'), true);
});

test('hasShellMetachars: variable expansion ${VAR} → true', () => {
  assert.equal(hasShellMetachars('echo ${PATH}'), true);
});

test('hasShellMetachars: newline → true', () => {
  assert.equal(hasShellMetachars('npm test\necho done'), true);
});

test('isAutoApproved: exact match → true', () => {
  assert.equal(isAutoApproved('npm', ['npm']), true);
});

test('isAutoApproved: prefix with space → true', () => {
  assert.equal(isAutoApproved('npm install foo', ['npm']), true);
  assert.equal(isAutoApproved('git status', ['git']), true);
});

test('isAutoApproved: more specific prefix → true', () => {
  assert.equal(isAutoApproved('dotnet test --no-build', ['dotnet test']), true);
});

test('isAutoApproved: prefix without space boundary → false', () => {
  // "npm" prefix shouldn't match "npm-check-updates"
  assert.equal(isAutoApproved('npm-check-updates', ['npm']), false);
});

test('isAutoApproved: command with metachars → false (never auto-approve)', () => {
  assert.equal(isAutoApproved('npm test && rm -rf /', ['npm']), false);
  assert.equal(isAutoApproved('git log | head', ['git']), false);
});

test('isAutoApproved: empty allowlist → false', () => {
  assert.equal(isAutoApproved('npm install', []), false);
});

test('isAutoApproved: leading/trailing whitespace on pattern OK', () => {
  assert.equal(isAutoApproved('npm install', ['  npm  ']), true);
});

test('isAutoApproved: not in allowlist → false', () => {
  assert.equal(isAutoApproved('curl example.com', ['npm', 'git']), false);
});

test('isAutoApproved: empty command → false', () => {
  assert.equal(isAutoApproved('', ['npm']), false);
  assert.equal(isAutoApproved('   ', ['npm']), false);
});

test('isAutoApproved: invalid allowlist entries (non-string) ignored', () => {
  // @ts-expect-error testing runtime tolerance
  assert.equal(isAutoApproved('npm install', ['npm', 123, null, '']), true);
});
