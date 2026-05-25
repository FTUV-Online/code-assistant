import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanCompletion } from '../src/completion/outputParser';

test('cleanCompletion: returns plain text unchanged', () => {
  assert.equal(cleanCompletion('const x = 1;'), 'const x = 1;');
});

test('cleanCompletion: strips leading fence with language', () => {
  assert.equal(cleanCompletion('```typescript\nconst x = 1;'), 'const x = 1;');
});

test('cleanCompletion: strips leading fence without language', () => {
  assert.equal(cleanCompletion('```\nconst x = 1;'), 'const x = 1;');
});

test('cleanCompletion: strips leading fence preceded by whitespace', () => {
  assert.equal(cleanCompletion('  ```ts\nfoo()'), 'foo()');
});

test('cleanCompletion: strips trailing fence', () => {
  assert.equal(cleanCompletion('const x = 1;\n```'), 'const x = 1;');
});

test('cleanCompletion: strips both fences', () => {
  assert.equal(cleanCompletion('```ts\nconst x = 1;\n```'), 'const x = 1;');
});

test('cleanCompletion: truncates at inline closing fence followed by prose', () => {
  const input = '```ts\nconst x = 1;\n```\nThis is the explanation.';
  assert.equal(cleanCompletion(input), 'const x = 1;');
});

test('cleanCompletion: preserves leading indentation', () => {
  const input = '  if (x) {\n    return 1;\n  }';
  assert.equal(cleanCompletion(input), input);
});

test('cleanCompletion: preserves multiline body when no fences', () => {
  const input = 'function add(a, b) {\n  return a + b;\n}';
  assert.equal(cleanCompletion(input), input);
});

test('cleanCompletion: handles dash and plus in language tag', () => {
  assert.equal(cleanCompletion('```c++\nint x = 0;'), 'int x = 0;');
  assert.equal(cleanCompletion('```objective-c\nNSLog(@"hi");'), 'NSLog(@"hi");');
});

test('cleanCompletion: empty input', () => {
  assert.equal(cleanCompletion(''), '');
});

test('cleanCompletion: only a leading fence', () => {
  assert.equal(cleanCompletion('```ts\n'), '');
});
