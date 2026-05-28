# dev-code — Roadmap

> File theo dõi tiến độ phát triển. Đánh dấu `[x]` khi hoàn thành.

**Last updated:** 2026-05-25 — Tier 1 hoàn thành (v0.3.0)

---

## 🎯 Suggested next features (prioritized)

### Tier 1 — High impact, low/medium effort (build first) ✅

- [x] **Inline edit / Apply** — `Ctrl+K Ctrl+I` invoke inline edit, AI rewrite selection in place (undo via Ctrl+Z).
- [x] **Slash commands trong chat**: `/clear`, `/new`, `/help` (autocomplete popup khi gõ `/`).
- [x] **Edit + regenerate user message** — hover message → ✎ Edit → save & regenerate.
- [x] **@-mention files** trong chat textarea — autocomplete workspace files → attach.
- [x] **Token usage + cost estimate per chat session** — chip ở header hiện real input/output + USD cost ước tính theo model.
- [x] **AI-generated PR description** — Git tab → ✨ PR description từ diff branch vs base.
- [x] **AI-generated branch name** — Git tab → ✨ Branch name từ diff + optional intent.
- [x] **Quick fix with AI** — CodeActionProvider tích hợp light bulb cho selection + diagnostics.
- [x] **Code lens above functions** — `✨ Explain` / `✨ Review` lens trên function/class/method.
- [x] **Inline diff preview** cho `write_file` / `edit_file` trước approve — hiện diff trong modal thay vì chỉ text "+X chars".
- [x] **Regenerate last assistant message** — ↻ Regenerate button cuối assistant turn.
- [x] **Stop generation hotkey** — Esc trong chat panel hủy stream.
- [x] **Pin tab** — 📍/📌 toggle giữ chat tab.
- [x] **Conversation export** — MD / JSON via header buttons.

### Tier 2 — Medium impact, more effort

- [ ] **Gemini native provider** (`/v1beta/models/X:streamGenerateContent`) — thêm provider chính chủ Google.
- [ ] **Ollama native FIM provider** — endpoint `/api/generate` với fim prompt format cho code completion chất lượng cao hơn chat mode.
- [ ] **MCP HTTP/SSE transport** — kết nối remote MCP server (không chỉ stdio local).
- [ ] **MCP Resources + Prompts** — không chỉ tools, expose resources (file URIs) + prompt templates.
- [ ] **Multi-line / multi-block inline completion** — completion vượt 1 hàm, predict whole block.
- [ ] **Multi-file context** cho inline completion — gửi thêm open tabs + import resolution.
- [x] **Workspace indexing tùy chọn** — chỉ index symbols/file tree (không embeddings), enable LLM gọi `find_symbol` / `goto_definition` / `find_references` qua VS Code LSP API.
- [x] **Auto-memory** — `~/.dev-code/memory/` persistent store (user/feedback/project/reference types), 3 tools (`read_memory` / `write_memory` / `list_memory`), index injected vào system prompt mỗi turn để AI tự nhớ qua sessions.
- [ ] **Telemetry opt-in** (accept rate, latency, error categories) — host endpoint riêng hoặc PostHog.
- [ ] **Conversation history search** — search box trong welcome state filter recent chats.
- [ ] **Skills marketplace / bundled starter skills** — `code-review`, `commit-style`, `test-writer`, `bug-investigator`...
- [ ] **Global skills location** `~/.dev-code/skills` (workspace + global, workspace wins).
- [ ] **Skill per-enable toggle** trong Config (giờ all-on khi load).
- [ ] **Push / pull / fetch buttons** trong Git tab.
- [ ] **Branch switcher** + AI commit on switch.
- [ ] **Multi-line tool result viewer** — virtual scroll cho output dài.
- [ ] **Cycle suggestions** Alt+] / Alt+[ — multiple ghost text candidates.
- [ ] **Partial accept** Ctrl+Right — accept theo từ.

### Tier 3 — Nice-to-have / polish

- [ ] **Auto-fetch model list** từ `/v1/models` khi config provider (OpenAI compat).
- [ ] **Azure OpenAI specific helper** — auto-set api-version header, deployment URL helper.
- [ ] **Voice input** trong chat — Web Speech API hoặc whisper local.
- [ ] **Conversation forking** — fork từ message giữa chừng → branch chat session.
- [ ] **Mermaid diagram render** trong assistant message (graph TD, sequenceDiagram, ...).
- [ ] **Inline blame** — hover line → AI summary của commit cuối touch line đó.
- [ ] **Drag-reorder tabs**.
- [ ] **Split chat view** — 2 chat side-by-side.
- [ ] **Sound / notification** khi assistant done (cho task lâu).
- [ ] **i18n** — strings UI multi-language (en, vi, ...).
- [ ] **Conversation summarization** — khi history quá dài, summarize old turns.
- [ ] **Compare providers** trong chat — chạy cùng prompt qua 2 providers, hiện side-by-side.

### Tier 4 — Production / publishing

- [ ] **Marketplace publish** (VS Code) — publisher account, icon PNG, README polish, screenshots, demo GIF.
- [ ] **Open VSX publish** — cho VSCodium / Cursor users.
- [ ] **Documentation site** — Docusaurus / VitePress.
- [ ] **GitHub repo public** + CI (build, test, lint, package vsix on tag).
- [ ] **Logo / branding** — design icon set.
- [ ] **Changelog** — keep-a-changelog format, auto từ commits.
- [ ] **Telemetry destination** — quyết định self-host server hay PostHog/Plausible.
- [ ] **Versioning policy** — semver, auto-bump.
- [ ] **Marketing**: demo video, blog post, Reddit/HN/Twitter.
- [ ] **Privacy policy + data handling docs**.

### Tier 5 — Stretch / experimental

- [ ] **Image generation tool** — DALL-E / Stable Diffusion → embed kết quả trong chat.
- [ ] **Code visualization** — AI sinh mermaid graph từ codebase.
- [ ] **Diff streaming** — show write_file/edit_file changes appearing token-by-token.
- [ ] **Multi-conversation merge** — combine 2 chats thành 1.
- [ ] **Auto-test generation** — pick a function → AI gen test → run → iterate đến pass.
- [ ] **Agent mode** — autonomous task runner (plan → execute → verify loop).
- [ ] **Local model auto-discovery** — quét Ollama đang chạy, list models, auto-config.
- [ ] **Custom keybindings UI** — visual editor cho keybindings.

---

## Vision

Một extension VS Code mã nguồn mở, cho phép developer dùng bất kỳ LLM nào (cloud hoặc local) cho inline code completion, không bị khóa với một nhà cung cấp.

---

## Phase 0 — Project setup ✅

- [x] Định hướng sản phẩm
- [x] Thống nhất kiến trúc (no-backend, multi-protocol adapter)
- [x] Tạo file tracking (README, ROADMAP, DESIGN)
- [x] Quyết định license — **MIT**
- [x] Scaffold project (TypeScript extension, không dùng `yo code` — viết tay)
- [x] `.gitignore`
- [ ] Init git repo (user tạo GitHub sau)
- [ ] Setup CI cơ bản (build + lint)

---

## Phase 1 — MVP với Anthropic (1-2 tuần) ⬅️ *đang ở đây*

**Mục tiêu:** gõ code → gọi Claude API → hiện ghost text → `Tab` để accept.

### Core
- [x] Scaffold extension skeleton (`extension.ts`, `package.json` contributes)
- [x] Interface `LLMProvider` + type `CompletionRequest`
- [x] **Anthropic adapter** (`src/providers/anthropic.ts`)
  - [x] Gọi endpoint `/v1/messages` với streaming SSE
  - [x] Hỗ trợ custom `baseURL` (cho proxy / Bedrock / Vertex compat)
  - [x] Hỗ trợ custom headers
  - [x] Mặc định model: `claude-haiku-4-5` (tốc độ cao, rẻ)
  - [x] Prompt caching để giảm latency

### Inline completion
- [x] Implement `vscode.InlineCompletionItemProvider`
- [x] Debounce 300-500ms (configurable qua `devCode.debounceMs`)
- [x] Cancellation khi user gõ tiếp (`AbortController`)
- [x] Context builder: ±50/20 dòng quanh cursor, language hint
- [x] Prompt template cho Claude (system + user với marker `<CURSOR/>`)
- [x] Parse output (xử lý markdown code fence, trailing text)

### Config & UX
- [x] Settings schema trong `package.json` (`devCode.providers`, `devCode.activeProvider`)
- [x] SecretStorage cho API key (key = `devCode.apiKey.<providerId>`)
- [x] Command `dev-code: Setup Provider` (wizard)
- [x] Command `dev-code: Switch Active Provider`
- [x] Status bar item hiện provider đang dùng
- [x] Command `dev-code: Toggle Enable/Disable`
- [x] Command `dev-code: Remove API Key`
- [x] **Webview config panel** (Activity Bar icon → side panel)
  - [x] List providers, activate/edit/delete inline
  - [x] Add/edit form với preset, advanced options
  - [x] API key set/missing indicator
  - [x] Test Connection button
  - [x] Toggle enable từ panel
- [x] Test connection (via webview panel)

### Quality
- [x] `npm install` + verify `tsc` compile sạch
- [x] Unit test cho `outputParser` (12 cases)
- [x] Unit test cho `sse` parser (13 cases, có Anthropic stream simulation)
- [x] Unit test cho `AnthropicProvider` adapter (9 cases, mock `fetch`)
- [ ] Unit test cho `contextBuilder` *(cần mock vscode API)*
- [ ] Smoke test bằng VS Code Extension Host (F5) — cần API key
- [ ] Mock provider (`providers/mock.ts`) để dev không cần API key
- [ ] Error handling: 401/403/429/network → toast rõ ràng (hiện đã có generic, cần phân loại)

---

## Phase 2 — OpenAI-compatible adapter ✅

Cover được phần lớn thị trường (OpenAI, Groq, OpenRouter, LM Studio, vLLM, Ollama qua `/v1`, Azure, DeepSeek, Together...).

- [x] `providers/openai.ts` — gọi `/v1/chat/completions` streaming
- [x] Smart endpoint resolve (`baseURL/v1/chat/completions` hoặc `baseURL/chat/completions` nếu baseURL kết thúc bằng `/v1`)
- [x] Auth header `Authorization: Bearer <key>` (skip nếu user đã cung cấp `Authorization` hoặc `api-key`)
- [x] Convert ChatMessage[] sang OpenAI format:
  - System messages giữ trong `messages` array
  - `tool_use` blocks → `tool_calls` field trên assistant
  - `tool_result` blocks → separate `role: 'tool'` messages
  - `image` blocks → `image_url` parts với `data:` URL
- [x] Convert ToolDef → OpenAI `{type:'function', function:{name, description, parameters}}`
- [x] Parse SSE: `data: ` lines, `[DONE]` sentinel, no event types
- [x] Tool call accumulation: build up `arguments` JSON across `delta.tool_calls[]` events
- [x] Stop sequences (filter whitespace-only như Anthropic)
- [x] Preset shortcuts trong setup wizard + Config UI dropdown:
  - OpenAI (official)
  - Groq
  - OpenRouter
  - LM Studio (local)
  - Ollama (OpenAI-compat `/v1`)
- [x] 10 unit tests cho `convertMessages` + `convertToolDef`
- [ ] Auto fetch model list từ `/v1/models` (future)
- [ ] Azure-specific helper (user can use custom headers + baseURL now)

---

## Phase 3 — Gemini + Ollama native (1 tuần)

- [ ] `providers/gemini.ts` — Google AI Studio API
- [ ] `providers/ollama.ts` — endpoint `/api/generate` với FIM support
- [ ] Cờ `supportsFIM` trong config, tự chọn prompt format
- [ ] Fetch model list từ Ollama `/api/tags`

---

## Phase 4 — UX polish (2 tuần)

- [ ] Multi-line / multi-block suggestion
- [ ] Multi-file context (file đang mở, imports liên quan)
- [ ] Cycle giữa nhiều suggestion (`Alt+]` / `Alt+[`)
- [ ] Partial accept (accept theo từ — `Ctrl+Right`)
- [ ] Language-specific prompt tuning
- [ ] Telemetry opt-in (accept rate, latency p50/p95) — gửi đến đâu? *(quyết định sau)*
- [ ] Blacklist file pattern (`.env`, `secrets/*`, ...)

---

## Phase 5 — Chat panel (3 tuần)

- [ ] Webview chat panel (như Cursor / Continue)
- [ ] Slash commands: `/explain`, `/fix`, `/test`, `/docs`
- [ ] Inline edit (highlight code → ra lệnh sửa)
- [ ] @-mentions để add file vào context
- [ ] Conversation history persist

---

## Git integration (added ngoài kế hoạch phase ban đầu)

- [x] Refactor `LLMProvider` — thêm method `chat()` cho non-completion tasks
- [x] `RepoManager` — wrap `vscode.git` extension API (typed)
- [x] `commitMessageGenerator` — gen commit message từ staged diff bằng `provider.chat()`
- [x] `GitViewProvider` + `media/gitView.html` — Git panel (2nd view trong sidebar)
- [x] Multi-repo selector
- [x] List staged / unstaged / merge changes với status code (M/A/D/U/R)
- [x] Stage / unstage per file
- [x] Stage all / Unstage all
- [x] Click file path → open file
- [x] Commit message textarea + button **AI Generate** + button Commit
- [x] Live refresh khi git state thay đổi
- [x] Diff viewer khi click file (`git.openChange`)
- [x] Discard changes / Delete untracked file (right-click context menu)
- [x] Multi-repo nested scan + loading state
- [x] File filter (lọc cả staged + changes cùng lúc)
- [x] Commit panel di chuyển lên trên cùng để dễ truy cập với many-files
- [x] Per-file pending state (spinner thay icon +/-) khi git op đang chạy
- [ ] Commit options: amend, signoff
- [ ] Push / pull / fetch buttons

---

## Generic chat + history (added)

- [x] `SessionKind` mở rộng thêm `'chat'` (no source diff/code, generic conversational)
- [x] System prompt `CHAT_SYSTEM_PROMPT` cho mode chat tự do — tools sẵn có như Explain/Review
- [x] `startChat()` khởi tạo session rỗng, title "New Chat"
- [x] Auto-derive title từ first user message (truncate 50 chars + `…`)
- [x] Default chat tab tự tạo khi mở Activity Bar lần đầu (ensureDefaultChat flag — 1 lần / VS Code session)
- [x] **`+ New Chat`** button cuối thanh tabs để mở thêm
- [x] Welcome state khi chat empty: title + sub + recent history list
- [x] History list persistent qua `workspaceState`:
  - [x] Auto-save snapshot khi assistant trả lời xong (mỗi turn)
  - [x] Save khi user close tab (nếu có content)
  - [x] Strip images khỏi history (thay bằng `[image stripped from history]`)
  - [x] Limit 50 entries, prune oldest
- [x] **Resume**: click history item →
  - Nếu active tab là empty chat → load vào current
  - Nếu khác → tạo tab mới, load
- [x] **Delete history**: nút × trên mỗi item (hover mới hiện)
- [x] History item shows kind icon (💡/🔍/✎/💬) + title + relative time

---

## Image input (added)

- [x] `ImageBlock` type trong `ChatContentBlock` (base64, media_type: jpg/png/gif/webp)
- [x] Composer button 🖼 mở `vscode.window.showOpenDialog` filter image (multi-select)
- [x] Paste image từ clipboard vào textarea (FileReader → dataUrl)
- [x] Drag & drop image vào composer box (highlight border khi drag-over)
- [x] Pending bar phía trên textarea hiện thumbnails + nút × remove
- [x] Max 5 MB per image, warn nếu vượt
- [x] User message render inline thumbnails (max 200×200), click → modal full-size, Esc/click outside → close
- [x] Context bar hiện chip `🖼 N images` + token estimate (~1500/image)
- [x] Send button auto-enable khi có image dù textarea rỗng

---

## UI consolidation (added)

- [x] Gộp chat panel (Explain/Review/Rewrite) vào dev-code Tool sidebar dưới dạng **dynamic tabs**, đóng được, multi-session
- [x] Tab Config tách thành section General (output language, include full file, features)
- [x] Per-feature provider + enable/disable (`completion`, `explain`, `review`, `rewrite`, `commitMessage`)
- [x] Provider có thêm `displayName` (friendly name)
- [x] Chat composer box mới (textarea + bottom bar: attach button, provider dropdown, send/stop)
- [x] Attach file qua VS Code QuickPick (search toàn workspace)
- [x] Token usage tách thành **input / output** chips
- [x] Editor context menu **dev-code Tool** với Explain / Review / Rewrite selection
- [x] Status bar + header dùng displayName, ellipsis cho long titles

---

## MCP (Model Context Protocol) — Phase 1 ✅

- [x] Runtime dep `@modelcontextprotocol/sdk` (Anthropic official)
- [x] Esbuild bundling setup (`esbuild.js`) — single file `out/extension.js`, tsc giờ chỉ type-check
- [x] `src/mcp/client.ts` — wrapper 1 server: connect (stdio transport), listTools, callTool, disconnect, status tracking
- [x] `src/mcp/manager.ts` — multi-server lifecycle:
  - `configure(servers)` reload config, disconnect removed
  - `connectAll()` background concurrent connect
  - `reconnect()` force close + reconnect
  - `getAllToolDefs()` aggregate tools across servers, name prefixed `mcp__<server>__<tool>`
  - `executeTool()` route to correct server (lazy-connect if idle)
  - `onChange` listener for UI updates
- [x] Tool registry integration: main agent + sub-agent đều thấy MCP tools, write tools gating vẫn áp dụng cho built-in
- [x] Settings `devCode.mcp.servers` (record `{name → {command, args?, env?}}`)
- [x] Activate hook: configure + connect all in background; reconfigure when settings change
- [x] UI: MCP Servers section trong Config tab
  - Mỗi server hiện status dot (green/yellow/red/gray), name, tool count hoặc error
  - Hover name → tooltip list các tool
  - Nút ↻ reconnect all
- [x] Deactivate cleanup: close all subprocess transports
- [ ] HTTP/SSE/WebSocket transports (only stdio now)
- [ ] Resources + Prompts (only Tools now)
- [ ] Per-server enable toggle (currently all servers expose all tools)

### MCP usage example

In `settings.json`:
```json
{
  "devCode.mcp.servers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/project"]
    },
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_..." }
    }
  }
}
```

Server tools tự xuất hiện trong AI's tool list. AI gọi `mcp__filesystem__read_file`, `mcp__github__create_issue`...

---

## Shell tool — `run_command` ✅

- [x] `src/tools/runCommand.ts` — spawn shell command, capture stdout/stderr/exit code
- [x] Cross-platform: PowerShell on Windows, default shell `sh` on Linux/Mac (via `shell: true`)
- [x] Path-safe working directory (resolveSafePath enforces workspace boundary)
- [x] Timeout: default 30s, max 5min, configurable per-call + globally (`devCode.toolUse.shellTimeoutMs`)
- [x] Output truncation at 50k chars each (stdout, stderr)
- [x] Abort signal propagation (cancel kills child)
- [x] **Two approval modes** (Option C as user picked):
  - Default: confirm dialog mỗi call (giống write_file)
  - Auto-approve: nếu command match `devCode.toolUse.shellAutoApprove` allowlist → skip dialog
- [x] **Metachar protection**: nếu command có `&`, `|`, `;`, `>`, `<`, `` ` ``, `$(`, `${`, newline → **NEVER auto-approve**, force confirm dialog regardless of allowlist
- [x] Confirmation dialog hiện preview command (truncated), cwd, timeout, warning nếu có metachars
- [x] Setting gating:
  - `devCode.toolUse.allowShell` (default false) — tool không xuất hiện trong tool list cho LLM khi tắt
  - `devCode.toolUse.shellAutoApprove` (string[], default []) — allowlist prefix
  - `devCode.toolUse.shellTimeoutMs` (default 30000)
- [x] Tool `gateFlag` field — clean separation giữa write tools và shell tool (mỗi loại có flag riêng)
- [x] 17 unit tests cho `hasShellMetachars` + `isAutoApproved` (allowlist matching, prefix boundary, metachar block, edge cases)
- [x] Sub-agent **không có** `run_command` (research-only, no destructive)

### Shell tool usage

Trong `settings.json`:
```json
{
  "devCode.toolUse.allowShell": true,
  "devCode.toolUse.shellAutoApprove": ["npm", "git status", "git diff", "dotnet test", "ls", "cat"]
}
```

User hỏi: "Run the tests"
→ AI gọi `run_command({ command: "npm test" })`
→ Matches `npm` allowlist → auto-approve → run → return output

User hỏi: "Clean up old logs"
→ AI gọi `run_command({ command: "rm -rf logs/*.log" })`
→ KHÔNG match allowlist (rm không có) → dialog hiện
→ User approve → run

User hỏi: "Test and commit"
→ AI gọi `run_command({ command: "npm test && git commit -am 'done'" })`
→ Có `&&` (metachar) → **bypass allowlist**, force dialog dù `npm` và `git` có trong allowlist
→ User review, approve nếu OK

---

## Skills — Phase 1 ✅

- [x] `src/skills/types.ts` — `Skill`, `SkillSummary`
- [x] `src/skills/parser.ts` — pure parser: `parseSkill()` + `parseSimpleYaml()` (no vscode dep, testable)
- [x] `src/skills/loader.ts` — load `.md` từ `.dev-code/skills/` + `.claude/skills/` (Claude Code compat)
- [x] Support cả flat `*.md` và folder-style `*/SKILL.md`
- [x] `src/skills/manager.ts` — registry với `FileSystemWatcher` auto-reload
- [x] **Skill loading model**: descriptions injected vào system prompt; AI gọi `load_skill(name)` tool để load full body khi cần
- [x] `load_skill` tool — gửi full body khi LLM yêu cầu
- [x] Sub-agent cũng có `load_skill`
- [x] UI Config tab: section **Skills** liệt kê (name + description), click → open file trong editor, nút ↻ reload
- [x] 12 unit tests cho parser (YAML basics, frontmatter, CRLF, edge cases)
- [ ] Per-skill enable/disable (currently all loaded skills are advertised)
- [ ] Skill discovery: shipped/recommended skills

### Skills usage example

Create `.dev-code/skills/code-review.md`:
```markdown
---
name: code-review
description: Use when reviewing a PR. Follows the team's security/perf/style checklist.
---

# Code Review Checklist

When reviewing code:
1. **Security**: SQL injection, secrets in logs, XSS
2. **Performance**: N+1 queries, unbounded loops
3. **Errors**: All async paths have error handling
4. **Style**: Names match conventions

After review, summarize as:
- Blockers
- Suggestions
- Nits
```

Hỏi assistant "review this PR" → AI thấy `code-review` skill trong system prompt → gọi `load_skill('code-review')` → follow checklist.

---

## Tool use (chat panel có thể gọi tools)

- [x] **Phase 1 — Provider foundation**: extend `LLMProvider` với `chatWithTools()`, `ChatStreamEvent` (text / tool_use), Anthropic adapter parse `content_block_delta` cho `tool_use` + `input_json_delta`
- [x] **Phase 2 — Core tools** (`src/tools/`):
  - [x] `read_file` (line range, binary detect, path safety)
  - [x] `grep` (regex, glob filter, top-N)
  - [x] `list_dir` (workspace-scoped, skip build dirs)
  - [x] `find_files` (glob)
- [x] **Phase 3 — ChatSession tool loop**:
  - [x] Auto-enable cho `explain` / `review` (không cho `rewrite`/`completion`/`commitMessage`)
  - [x] Max iterations (configurable, default 10)
  - [x] Abort signal propagation
  - [x] Build history với content blocks (mixed text + tool_use + tool_result)
- [x] **Phase 4 — UI**: tool cards expandable trong chat (input + result), status icon (running/ok/err)
- [x] Settings `devCode.toolUse.enabled`, `devCode.toolUse.maxIterations`, `devCode.toolUse.blacklist`
- [x] **Phase 5 — Safety**:
  - [x] Default blacklist (`.env`, `*.pem`, `*.key`, `**/secrets/**`, ssh keys, aws/kube creds)
  - [x] Configurable qua `devCode.toolUse.blacklist`
  - [x] Applied trong `read_file` (reject), `grep` (skip + report count), `find_files` (filter)
  - [x] Path traversal blocked (`resolveSafePath`)
  - [x] **Confirm dialog cho write tools** (`write_file`, `edit_file`):
    - [x] `confirmDestructive(name, summary, detail)` via `vscode.window.showWarningMessage` modal
    - [x] Buttons: **Approve** / **Approve all this session** / Cancel = deny
    - [x] Session-level approval cache (module-level Set, cleared on reload)
    - [x] Setting `devCode.toolUse.allowWriteTools` (default **false**) gates write tools from main agent's tool list
    - [x] Sub-agent never sees write tools (no destructive ops in research mode)
    - [x] Destructive tools tagged `destructive: true` on `Tool` type
- [x] **Phase 7 — Subagent tool** (`delegate_research`):
  - [x] Spawn sub-LLM với system prompt nghiên cứu
  - [x] Sub-agent có read_file, grep, list_dir, find_files (no `delegate_research` → no recursion)
  - [x] Max iters cho subagent = `floor(parent maxIter / 2)`
  - [x] Trả về 1 summary text về cho parent
  - [x] Same provider, isolated message history
- [x] **Phase 8 — Tests** (31 cases mới):
  - [x] `isBinary` (ascii, null byte, large)
  - [x] `isSkipDir` (build dirs, ordinary)
  - [x] `truncate` (short, long, custom suffix)
  - [x] `resolveSafePath` (relative, root, traversal, absolute in/out)
  - [x] `globToRegex` (literal, `*` single segment, `**` multi)
  - [x] `matchesGlob` (basename, full path, backslash normalize)
  - [x] `matchesAnyGlob` (multi-pattern, empty)
  - [x] `applyEdits` (10 cases: unique find, multi-edit order, not found, ambiguous, empty/missing fields, whitespace preserve, deletion via empty replace, sequential dependencies)
- [x] **Phase 6 — More tools**:
  - [x] `git_log` (optional `file` filter, default 20, max 100; uses `gitCli.gitRun`; respects blacklist + path safety)
  - [x] `get_open_tabs` (lists all open file tabs across tab groups, marks active with `*`)
  - [x] `get_selection` (current editor selection with file + language + line range)
  - [x] All 3 also available to sub-agent
  - [x] Subagent system prompt updated to advertise new tools

---

## Phase 6 — Production polish (ongoing)

- [ ] Marketplace publish (VS Code)
- [ ] Open VSX publish (cho VSCodium / Cursor)
- [ ] Documentation site
- [ ] ~~Workspace indexing + RAG (embedding repo)~~ → thay bằng **tool-use** (đã làm)
- [ ] Custom model fine-tune guide

---

## Open questions / cần quyết định

1. ~~**License** — MIT hay Apache 2.0?~~ → **MIT** ✅
2. **Telemetry destination** — self-host server hay không có telemetry?
3. **Logo / branding** — TBD
4. **Repo GitHub** — public từ đầu hay private cho đến Phase 1 xong?
5. **Versioning** — semver từ `0.1.0` cho MVP? *(đã set 0.1.0 trong package.json)*
6. **Publisher ID** trên VS Code Marketplace — hiện để placeholder `"dev-code"`, cần thay khi publish
