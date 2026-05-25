import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSimpleYaml, parseSkill } from '../src/skills/parser';

test('parseSimpleYaml: key:value pairs', () => {
  const r = parseSimpleYaml('name: foo\ndescription: bar baz');
  assert.deepEqual(r, { name: 'foo', description: 'bar baz' });
});

test('parseSimpleYaml: strips double quotes', () => {
  const r = parseSimpleYaml('name: "with spaces"');
  assert.equal(r.name, 'with spaces');
});

test('parseSimpleYaml: strips single quotes', () => {
  const r = parseSimpleYaml("name: 'value'");
  assert.equal(r.name, 'value');
});

test('parseSimpleYaml: strips brackets', () => {
  const r = parseSimpleYaml('keywords: [a, b, c]');
  assert.equal(r.keywords, 'a, b, c');
});

test('parseSimpleYaml: ignores comments and blanks', () => {
  const r = parseSimpleYaml('# comment\n\nname: foo\n# another\ndescription: bar');
  assert.deepEqual(r, { name: 'foo', description: 'bar' });
});

test('parseSkill: valid frontmatter + body', () => {
  const md = `---
name: code-review
description: Review code following our checklist.
---

# Body

Step 1...`;
  const s = parseSkill(md, '/path/to/skill.md');
  assert.ok(s);
  assert.equal(s?.name, 'code-review');
  assert.equal(s?.description, 'Review code following our checklist.');
  assert.match(s?.body ?? '', /Body/);
  assert.equal(s?.filePath, '/path/to/skill.md');
});

test('parseSkill: missing frontmatter → null', () => {
  const md = '# just a heading\n\nno frontmatter here';
  assert.equal(parseSkill(md, '/x.md'), null);
});

test('parseSkill: missing name field → null', () => {
  const md = `---
description: only description
---

body`;
  assert.equal(parseSkill(md, '/x.md'), null);
});

test('parseSkill: missing description field → null', () => {
  const md = `---
name: only-name
---

body`;
  assert.equal(parseSkill(md, '/x.md'), null);
});

test('parseSkill: CRLF line endings', () => {
  const md = '---\r\nname: foo\r\ndescription: bar\r\n---\r\nbody text\r\n';
  const s = parseSkill(md, '/x.md');
  assert.ok(s);
  assert.equal(s?.name, 'foo');
  assert.equal(s?.description, 'bar');
});

test('parseSkill: body trimmed', () => {
  const md = '---\nname: a\ndescription: b\n---\n\n\n  some body  \n\n';
  const s = parseSkill(md, '/x.md');
  assert.equal(s?.body, 'some body');
});

test('parseSimpleYaml: empty input → empty object', () => {
  assert.deepEqual(parseSimpleYaml(''), {});
});
