import * as vscode from 'vscode';
import { getAllowShell, getAllowWriteTools } from '../config/settings';
import type { McpManager } from '../mcp/manager';
import type { ToolDef } from '../providers/base';
import type { SkillManager } from '../skills/manager';
import * as log from '../util/logger';
import { delegateResearchTool } from './delegate';
import { editFileTool } from './editFile';
import { findFilesTool } from './findFiles';
import { getOpenTabsTool } from './getOpenTabs';
import { getSelectionTool } from './getSelection';
import { gitLogTool } from './gitLog';
import { grepTool } from './grep';
import { listDirTool } from './listDir';
import { loadSkillTool } from './loadSkill';
import { readFileTool } from './readFile';
import { runCommandTool } from './runCommand';
import type { Tool, ToolExecutionContext, ToolResult } from './types';
import { writeFileTool } from './writeFile';

const TOOLS: Record<string, Tool> = {
  read_file: readFileTool,
  grep: grepTool,
  list_dir: listDirTool,
  find_files: findFilesTool,
  git_log: gitLogTool,
  get_open_tabs: getOpenTabsTool,
  get_selection: getSelectionTool,
  delegate_research: delegateResearchTool,
  write_file: writeFileTool,
  edit_file: editFileTool,
  load_skill: loadSkillTool,
  run_command: runCommandTool,
};

// Tools available to a sub-agent (no delegation, no destructive ops).
const SUBAGENT_TOOL_NAMES: Set<string> = new Set([
  'read_file',
  'grep',
  'list_dir',
  'find_files',
  'git_log',
  'get_open_tabs',
  'get_selection',
  'load_skill',
]);

let mcpManagerRef: McpManager | null = null;
let skillManagerRef: SkillManager | null = null;

export function setMcpManager(mgr: McpManager | null): void {
  mcpManagerRef = mgr;
}

export function setSkillManager(mgr: SkillManager | null): void {
  skillManagerRef = mgr;
}

export function getSkillManager(): SkillManager | null {
  return skillManagerRef;
}

/** Tools exposed to the main agent — destructive tools gated by their respective user settings, plus MCP tools. */
export function getAllToolDefs(): ToolDef[] {
  const allowWrite = getAllowWriteTools();
  const allowShell = getAllowShell();
  const builtin = Object.values(TOOLS)
    .filter((t) => {
      if (t.gateFlag === 'allowWriteTools') return allowWrite;
      if (t.gateFlag === 'allowShell') return allowShell;
      return true;
    })
    .map((t) => t.def);
  const mcp = mcpManagerRef?.getAllToolDefs() ?? [];
  return [...builtin, ...mcp];
}

export function getSubAgentToolDefs(): ToolDef[] {
  const builtin = Object.values(TOOLS)
    .filter((t) => SUBAGENT_TOOL_NAMES.has(t.def.name))
    .map((t) => t.def);
  // Sub-agent also gets MCP tools (research can leverage external data sources).
  const mcp = mcpManagerRef?.getAllToolDefs() ?? [];
  return [...builtin, ...mcp];
}

export function getToolDef(name: string): ToolDef | null {
  return TOOLS[name]?.def ?? null;
}

export async function executeTool(
  name: string,
  input: unknown,
  ctx: ToolExecutionContext,
): Promise<ToolResult> {
  // Route MCP tools first
  if (mcpManagerRef && mcpManagerRef.isMcpTool(name)) {
    const t0 = Date.now();
    try {
      const res = await mcpManagerRef.executeTool(name, input);
      log.info('tool exec (mcp)', {
        name,
        ms: Date.now() - t0,
        ok: !res.isError,
        bytes: res.content.length,
      });
      return res;
    } catch (err) {
      log.error('mcp tool exec threw', err);
      return {
        content: `Error: ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
      };
    }
  }
  const tool = TOOLS[name];
  if (!tool) {
    return { content: `Error: unknown tool "${name}".`, isError: true };
  }
  const t0 = Date.now();
  try {
    const result = await tool.execute(input, ctx);
    log.info('tool exec', {
      name,
      ms: Date.now() - t0,
      ok: !result.isError,
      bytes: result.content.length,
    });
    return result;
  } catch (err) {
    log.error(`tool "${name}" threw`, err);
    return {
      content: `Error: ${err instanceof Error ? err.message : String(err)}`,
      isError: true,
    };
  }
}

export function getWorkspaceRoot(): string | null {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) return null;
  return folders[0].uri.fsPath;
}
