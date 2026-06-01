import { getToolUseBlacklist, getToolUseMaxIterations } from '../../config/settings';
import type {
  ChatContentBlock,
  ChatMessage,
  LLMProvider,
  ToolResultBlock,
  ToolUseBlock,
} from '../../providers/base';
import { executeTool, getSubAgentToolDefs, getWorkspaceRoot } from '../../tools/registry';
import type { ToolExecutionContext } from '../../tools/types';
import * as log from '../../util/logger';
import { withAbort } from './helpers';
import { SUB_AGENT_SYSTEM_PROMPT } from './prompts';

export async function runSubAgent(
  provider: LLMProvider,
  task: string,
  signal: AbortSignal,
): Promise<string> {
  if (!provider.chatWithTools) {
    throw new Error('Active provider does not support tools.');
  }
  const tools = getSubAgentToolDefs();
  const messages: ChatMessage[] = [
    { role: 'system', content: SUB_AGENT_SYSTEM_PROMPT },
    { role: 'user', content: task },
  ];
  const SUB_MAX_ITERS = Math.max(3, Math.floor(getToolUseMaxIterations() / 2));
  let lastText = '';

  const subCtx: ToolExecutionContext = {
    workspaceRoot: getWorkspaceRoot() ?? process.cwd(),
    signal,
    blacklist: getToolUseBlacklist(),
    // Intentionally no runSubAgent here → block recursion.
  };

  log.info('subagent: start', { taskChars: task.length, maxIters: SUB_MAX_ITERS });

  for (let iter = 0; iter < SUB_MAX_ITERS; iter++) {
    if (signal.aborted) break;
    const turnText: string[] = [];
    const turnTools: ToolUseBlock[] = [];

    for await (const event of provider.chatWithTools(
      messages,
      tools,
      { maxTokens: 1500, temperature: 0.3 },
      signal,
    )) {
      if (signal.aborted) break;
      if (event.type === 'text') turnText.push(event.text);
      else if (event.type === 'tool_use') {
        turnTools.push({
          type: 'tool_use',
          id: event.id,
          name: event.name,
          input: event.input,
        });
      }
    }

    if (turnText.length > 0) lastText = turnText.join('');

    const blocks: ChatContentBlock[] = [];
    if (turnText.length > 0) blocks.push({ type: 'text', text: turnText.join('') });
    blocks.push(...turnTools);
    if (blocks.length > 0) messages.push({ role: 'assistant', content: blocks });

    if (turnTools.length === 0 || signal.aborted) break;

    const toolResults: ToolResultBlock[] = [];
    for (const tu of turnTools) {
      if (signal.aborted) break;
      const result = await withAbort(executeTool(tu.name, tu.input, subCtx), signal);
      toolResults.push({
        type: 'tool_result',
        tool_use_id: tu.id,
        content: result.content,
        is_error: result.isError,
      });
    }
    if (toolResults.length > 0) messages.push({ role: 'user', content: toolResults });
  }

  log.info('subagent: done', { answerChars: lastText.length });
  return lastText;
}
