/**
 * Model-specific edit instructions for the edit_file / multi_edit tools.
 * Different model families benefit from different output format guidance.
 */

/**
 * Lazy edit instruction appended to model-specific instructions.
 */
const LAZY_EDIT_INSTRUCTION =
  '\n\nFor large edits, you can use "lazy" editing: include `// ... existing code ...` ' +
  'comments (or `# ...`, `<!-- ... -->`) for unchanged sections. ' +
  'The system auto-fills the original code for those placeholders. ' +
  'Always keep at least 1 line of context above and below each placeholder block.';

/**
 * Default instructions — concise and model-agnostic.
 */
const DEFAULT_EDIT_INSTRUCTIONS =
  'When editing, use find/replace: include at least 2-3 lines of surrounding context ' +
  'in each "find" string to make it unique. Copy exact text from the file, preserving ' +
  'whitespace and indentation. Prefer multi_edit for changes spanning multiple files.' +
  LAZY_EDIT_INSTRUCTION;

/**
 * Claude family — excellent at structured output, follows XML-like patterns well.
 * Prefers explicit, unambiguous instructions.
 */
const CLAUDE_EDIT_INSTRUCTIONS =
  'When editing code:\n' +
  '- Use find/replace pairs. Each "find" must be an exact match from the file.\n' +
  '- Include 2-4 lines of surrounding context in "find" to guarantee uniqueness.\n' +
  '- Preserve exact whitespace and indentation. Copy-paste from the file.\n' +
  '- For symbol renames or repeated tokens, use "replaceAll": true.\n' +
  '- Prefer multi_edit over multiple edit_file calls when changes span several files.\n' +
  '- Always DOUBLE-CHECK that each "find" text exists verbatim in the file before submitting.' +
  LAZY_EDIT_INSTRUCTION;

/**
 * GPT / o-series — good at following structured JSON schemas.
 * Tends to trim whitespace; needs emphasis on exact matching.
 */
const GPT_EDIT_INSTRUCTIONS =
  'When editing code:\n' +
  '- Provide find/replace pairs with exact text from the file.\n' +
  '- CRITICAL: do NOT trim or normalize whitespace in "find" — it must match exactly.\n' +
  '- Include 2-3 lines of surrounding context for uniqueness.\n' +
  '- Use "replaceAll": true for repeated occurrences (renames, version bumps).\n' +
  '- Prefer multi_edit for changes spanning multiple files.\n' +
  '- Verify each "find" string exists in the file before submitting.' +
  LAZY_EDIT_INSTRUCTION;

/**
 * Gemini family — benefits from explicit examples and repetition of key constraints.
 */
const GEMINI_EDIT_INSTRUCTIONS =
  'When editing code, use find/replace edits:\n' +
  '- Copy the "find" text EXACTLY from the file — every space and newline matters.\n' +
  '- Include enough context (2-3 lines) to make each "find" unique in the file.\n' +
  '- "replace" contains the new code that replaces the matched text.\n' +
  '- Use "replaceAll": true for renaming symbols or updating repeated strings.\n' +
  '- For multi-file refactors, prefer multi_edit to apply all changes atomically.\n' +
  'Remember: the matcher is case-sensitive and whitespace-sensitive. Copy exactly.' +
  LAZY_EDIT_INSTRUCTION;

/**
 * Ollama / local models — need the most explicit and repetitive guidance.
 * These models often produce markdown fences or explanatory text around edits.
 */
const OLLAMA_EDIT_INSTRUCTIONS =
  'RULES for editing files:\n' +
  '1. Output ONLY valid tool calls — no explanation, no markdown, no commentary.\n' +
  '2. Each "find" string must be copy-pasted verbatim from the file.\n' +
  '3. Include 2-3 lines of surrounding context for uniqueness.\n' +
  '4. Preserve ALL whitespace and indentation exactly as in the file.\n' +
  '5. Use "replaceAll": true for repeated tokens (e.g. version bumps, renames).\n' +
  '6. Never wrap tool calls in markdown code blocks or XML tags.\n' +
  '7. For changes across multiple files, use multi_edit in one turn.' +
  LAZY_EDIT_INSTRUCTION;

/**
 * Return model-specific edit instructions based on the model name.
 */
export function getEditInstructions(model: string): string {
  const lower = model.toLowerCase();

  if (lower.includes('claude') || lower.includes('anthropic')) {
    return CLAUDE_EDIT_INSTRUCTIONS;
  }
  if (
    lower.includes('gpt') ||
    lower.includes('o1') ||
    lower.includes('o3') ||
    lower.includes('o4') ||
    lower.includes('chatgpt')
  ) {
    return GPT_EDIT_INSTRUCTIONS;
  }
  if (lower.includes('gemini')) {
    return GEMINI_EDIT_INSTRUCTIONS;
  }
  if (
    lower.includes('llama') ||
    lower.includes('codellama') ||
    lower.includes('mistral') ||
    lower.includes('deepseek') ||
    lower.includes('qwen') ||
    lower.includes('phi') ||
    lower.includes('gemma') ||
    lower.includes('ollama')
  ) {
    return OLLAMA_EDIT_INSTRUCTIONS;
  }

  return DEFAULT_EDIT_INSTRUCTIONS;
}
