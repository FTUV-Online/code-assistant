import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  coerceArgsToSchema,
  normalizeToolArgs,
  safeParseToolArgs,
} from '../src/tools/parseArgs';
import type { ToolDef } from '../src/providers/base';

const def: ToolDef = {
  name: 'demo',
  description: 'demo',
  input_schema: {
    type: 'object',
    properties: {
      path: { type: 'string' },
      count: { type: 'number' },
      flag: { type: 'boolean' },
      edits: { type: 'array' },
      opts: { type: 'object' },
    },
    required: ['path'],
  },
};

test('safeParseToolArgs: plain object passes through', () => {
  assert.deepEqual(safeParseToolArgs({ a: 1 }), { a: 1 });
});

test('safeParseToolArgs: JSON string is parsed', () => {
  assert.deepEqual(safeParseToolArgs('{"a":1}'), { a: 1 });
});

test('safeParseToolArgs: double-encoded JSON string is parsed', () => {
  assert.deepEqual(safeParseToolArgs('"{\\"a\\":1}"'), { a: 1 });
});

test('safeParseToolArgs: invalid JSON → empty object', () => {
  assert.deepEqual(safeParseToolArgs('not json'), {});
});

test('safeParseToolArgs: empty string → empty object', () => {
  assert.deepEqual(safeParseToolArgs(''), {});
});

test('safeParseToolArgs: array → empty object', () => {
  assert.deepEqual(safeParseToolArgs([1, 2]), {});
});

test('coerceArgsToSchema: numeric string → number', () => {
  assert.deepEqual(coerceArgsToSchema({ path: 'a', count: '5' }, def), {
    path: 'a',
    count: 5,
  });
});

test('coerceArgsToSchema: boolean strings → boolean', () => {
  assert.deepEqual(coerceArgsToSchema({ path: 'a', flag: 'true' }, def).flag, true);
  assert.deepEqual(coerceArgsToSchema({ path: 'a', flag: 'false' }, def).flag, false);
});

test('coerceArgsToSchema: non-numeric string left intact', () => {
  assert.deepEqual(coerceArgsToSchema({ path: 'a', count: 'abc' }, def).count, 'abc');
});

test('coerceArgsToSchema: stringified array → array', () => {
  assert.deepEqual(coerceArgsToSchema({ path: 'a', edits: '[{"find":"x"}]' }, def).edits, [
    { find: 'x' },
  ]);
});

test('coerceArgsToSchema: stringified object → object', () => {
  assert.deepEqual(coerceArgsToSchema({ path: 'a', opts: '{"k":1}' }, def).opts, { k: 1 });
});

test('coerceArgsToSchema: unknown keys pass through', () => {
  assert.deepEqual(coerceArgsToSchema({ path: 'a', extra: 'z' }, def).extra, 'z');
});

test('coerceArgsToSchema: empty numeric string left intact', () => {
  assert.deepEqual(coerceArgsToSchema({ path: 'a', count: '' }, def).count, '');
});

test('normalizeToolArgs: JSON-string input fully normalized', () => {
  assert.deepEqual(normalizeToolArgs('{"path":"a","count":"3"}', def), {
    path: 'a',
    count: 3,
  });
});

test('normalizeToolArgs: object input coerced', () => {
  assert.deepEqual(normalizeToolArgs({ path: 'a', flag: 'true' }, def), {
    path: 'a',
    flag: true,
  });
});
