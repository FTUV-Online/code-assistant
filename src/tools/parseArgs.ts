import type { ToolDef } from '../providers/base';

/**
 * Some providers (notably OpenAI-style function calling and streamed tool
 * deltas) hand back tool arguments as a JSON-encoded string instead of an
 * object — or, worse, double-encode it. Others send numbers/booleans as
 * strings. This layer normalizes raw tool input into a plain object that
 * matches the tool's declared schema as closely as possible, without throwing.
 *
 * It is intentionally permissive: if it cannot improve on the input, it returns
 * the original value so the tool's own validation still runs.
 */

/** Parse a value that may be a JSON string (possibly double-encoded) into an object. */
export function safeParseToolArgs(raw: unknown): Record<string, unknown> {
  let value = raw;
  // Unwrap up to two layers of JSON-string encoding.
  for (let i = 0; i < 2; i++) {
    if (typeof value !== 'string') break;
    const trimmed = value.trim();
    if (trimmed === '') return {};
    try {
      value = JSON.parse(trimmed);
    } catch {
      // Not JSON — give up, the tool will report a useful error itself.
      return {};
    }
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

type JsonSchema = {
  type?: string;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
};

/** Coerce a scalar string into the schema-declared primitive when unambiguous. */
function coerceScalar(value: unknown, type: string | undefined): unknown {
  if (typeof value !== 'string') return value;
  if (type === 'number' || type === 'integer') {
    const n = Number(value);
    return value.trim() !== '' && Number.isFinite(n) ? n : value;
  }
  if (type === 'boolean') {
    if (value === 'true') return true;
    if (value === 'false') return false;
  }
  if ((type === 'object' || type === 'array') && value.trim() !== '') {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
}

/**
 * Walk the schema's top-level properties and coerce string-encoded scalars
 * (and stringified objects/arrays) to their declared types. Unknown keys and
 * already-correct values pass through untouched.
 */
export function coerceArgsToSchema(
  args: Record<string, unknown>,
  def: ToolDef,
): Record<string, unknown> {
  const schema = def.input_schema as JsonSchema | undefined;
  const props = schema?.properties;
  if (!props) return args;
  const out: Record<string, unknown> = { ...args };
  for (const [key, propSchema] of Object.entries(props)) {
    if (!(key in out)) continue;
    out[key] = coerceScalar(out[key], propSchema?.type);
  }
  return out;
}

/** Full normalization: parse raw input then coerce to the tool's schema. */
export function normalizeToolArgs(raw: unknown, def: ToolDef): Record<string, unknown> {
  const parsed =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : safeParseToolArgs(raw);
  return coerceArgsToSchema(parsed, def);
}
