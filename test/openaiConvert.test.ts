import { test } from 'node:test';
import assert from 'node:assert/strict';
import { convertMessages, convertToolDef } from '../src/providers/openai';

test('convertMessages: string content user → role:user, content:string', () => {
  const r = convertMessages([{ role: 'user', content: 'hi' }]);
  assert.deepEqual(r, [{ role: 'user', content: 'hi' }]);
});

test('convertMessages: system message preserved', () => {
  const r = convertMessages([
    { role: 'system', content: 'You are helpful' },
    { role: 'user', content: 'hello' },
  ]);
  assert.equal(r.length, 2);
  assert.equal(r[0].role, 'system');
});

test('convertMessages: user text + image → array content with image_url', () => {
  const r = convertMessages([
    {
      role: 'user',
      content: [
        { type: 'text', text: 'what is this' },
        {
          type: 'image',
          source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo' },
        },
      ],
    },
  ]);
  assert.equal(r.length, 1);
  const m = r[0] as any;
  assert.equal(m.role, 'user');
  assert.ok(Array.isArray(m.content));
  assert.equal(m.content[0].type, 'text');
  assert.equal(m.content[0].text, 'what is this');
  assert.equal(m.content[1].type, 'image_url');
  assert.equal(m.content[1].image_url.url, 'data:image/png;base64,iVBORw0KGgo');
});

test('convertMessages: assistant with tool_use → tool_calls field', () => {
  const r = convertMessages([
    {
      role: 'assistant',
      content: [
        { type: 'text', text: 'Let me search...' },
        {
          type: 'tool_use',
          id: 'call_xyz',
          name: 'grep',
          input: { pattern: 'foo' },
        },
      ],
    },
  ]);
  assert.equal(r.length, 1);
  const m = r[0] as any;
  assert.equal(m.role, 'assistant');
  assert.equal(m.content, 'Let me search...');
  assert.equal(m.tool_calls.length, 1);
  assert.equal(m.tool_calls[0].id, 'call_xyz');
  assert.equal(m.tool_calls[0].type, 'function');
  assert.equal(m.tool_calls[0].function.name, 'grep');
  assert.equal(m.tool_calls[0].function.arguments, '{"pattern":"foo"}');
});

test('convertMessages: assistant with only tool_use (no text) → content null', () => {
  const r = convertMessages([
    {
      role: 'assistant',
      content: [
        { type: 'tool_use', id: 'c1', name: 'grep', input: { pattern: 'x' } },
      ],
    },
  ]);
  const m = r[0] as any;
  assert.equal(m.content, null);
  assert.equal(m.tool_calls[0].id, 'c1');
});

test('convertMessages: tool_result → separate tool role message', () => {
  const r = convertMessages([
    {
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 'call_xyz', content: 'foo found here' },
      ],
    },
  ]);
  assert.equal(r.length, 1);
  const m = r[0] as any;
  assert.equal(m.role, 'tool');
  assert.equal(m.tool_call_id, 'call_xyz');
  assert.equal(m.content, 'foo found here');
});

test('convertMessages: mixed tool_result + new user text → split into tool + user', () => {
  const r = convertMessages([
    {
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 'call_1', content: 'result A' },
        { type: 'text', text: 'thanks, now do this' },
      ],
    },
  ]);
  assert.equal(r.length, 2);
  assert.equal(r[0].role, 'tool');
  assert.equal(r[1].role, 'user');
  assert.equal((r[1] as any).content, 'thanks, now do this');
});

test('convertMessages: multiple tool_results → multiple tool messages', () => {
  const r = convertMessages([
    {
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 'c1', content: 'r1' },
        { type: 'tool_result', tool_use_id: 'c2', content: 'r2' },
      ],
    },
  ]);
  assert.equal(r.length, 2);
  assert.equal((r[0] as any).tool_call_id, 'c1');
  assert.equal((r[1] as any).tool_call_id, 'c2');
});

test('convertToolDef: ToolDef → OpenAI function format', () => {
  const td = convertToolDef({
    name: 'grep',
    description: 'Search files',
    input_schema: {
      type: 'object',
      properties: { pattern: { type: 'string' } },
      required: ['pattern'],
    },
  });
  assert.equal(td.type, 'function');
  assert.equal(td.function.name, 'grep');
  assert.equal(td.function.description, 'Search files');
  assert.ok(td.function.parameters);
});

test('convertMessages: assistant plain string still works', () => {
  const r = convertMessages([{ role: 'assistant', content: 'hello' }]);
  assert.equal(r[0].role, 'assistant');
  assert.equal((r[0] as any).content, 'hello');
});
