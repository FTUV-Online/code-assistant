# dev-code — Design Document

> Tài liệu thiết kế kỹ thuật. Cập nhật song song với code.

**Last updated:** 2026-05-20

---

## 1. Goals & non-goals

### Goals
- Inline code completion (ghost text) với độ trễ < 500ms
- Hỗ trợ nhiều LLM provider qua protocol adapter
- User tự cấu hình: chọn protocol, base URL, model, API key
- Không có backend trung gian — extension gọi thẳng provider
- API key lưu an toàn (VS Code SecretStorage)
- 100% open source

### Non-goals (giai đoạn đầu)
- Không build LLM riêng
- Không host server cho user
- Không hỗ trợ JetBrains / Neovim (chỉ VS Code + fork tương thích)
- Không tự fine-tune model

---

## 2. Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                  VS Code Extension Host (Node.js)             │
│                                                                │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  InlineCompletionItemProvider                           │  │
│  │   ├─ Debouncer (300-500ms)                              │  │
│  │   ├─ Cancellation (AbortController)                     │  │
│  │   └─ Context builder (cursor ±N lines + language hint)  │  │
│  └─────────────────────┬──────────────────────────────────┘  │
│                        │                                       │
│                        ▼                                       │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  Provider Manager                                       │  │
│  │   ├─ resolveActiveProvider()                            │  │
│  │   └─ instantiate adapter from ProviderConfig            │  │
│  └─────────────────────┬──────────────────────────────────┘  │
│                        │                                       │
│        ┌───────────────┼───────────────┬───────────────┐     │
│        ▼               ▼               ▼               ▼     │
│  ┌──────────┐  ┌──────────────┐  ┌─────────┐  ┌────────────┐ │
│  │Anthropic │  │OpenAI-compat │  │ Gemini  │  │Ollama (FIM)│ │
│  │ adapter  │  │   adapter    │  │ adapter │  │  adapter   │ │
│  └────┬─────┘  └──────┬───────┘  └────┬────┘  └─────┬──────┘ │
└───────┼───────────────┼────────────────┼─────────────┼────────┘
        ▼               ▼                ▼             ▼
   api.anthropic   api.openai.com   ai.google     localhost:11434
   (or proxy)      Groq/OR/LMStudio  ...           (or remote)
```

---

## 3. Provider abstraction

### 3.1 Interface

```typescript
// src/providers/base.ts

export type CompletionRequest = {
  prefix: string;          // code trước cursor
  suffix: string;          // code sau cursor (cho FIM)
  language: string;        // 'typescript', 'python', ...
  filePath?: string;       // relative path để LLM có context
  maxTokens?: number;
  stopSequences?: string[];
  temperature?: number;
};

export interface LLMProvider {
  readonly id: string;
  readonly protocol: ProviderProtocol;

  /** Streaming completion. Yield từng chunk text. */
  complete(req: CompletionRequest, signal: AbortSignal): AsyncIterable<string>;

  /** Optional: fetch danh sách model có sẵn từ endpoint */
  listModels?(): Promise<string[]>;
}

export type ProviderProtocol = 'anthropic' | 'openai' | 'gemini' | 'ollama';
```

### 3.2 Config schema

```typescript
type ProviderConfig = {
  id: string;                          // user-defined, vd "my-claude"
  protocol: ProviderProtocol;
  baseURL: string;                     // bắt buộc — cho phép custom endpoint
  model: string;
  headers?: Record<string, string>;    // custom headers (Azure api-version, X-Team-ID...)
  // apiKey KHÔNG ở đây — lưu trong SecretStorage
  // Tham số tùy biến
  maxTokens?: number;
  temperature?: number;
  supportsFIM?: boolean;
  promptCaching?: boolean;             // Anthropic only
};

// settings.json
{
  "devCode.providers": ProviderConfig[],
  "devCode.activeProvider": string,    // id
  "devCode.enabled": boolean,
  "devCode.debounceMs": number,
  "devCode.contextLines": { "before": number, "after": number }
}
```

### 3.3 SecretStorage layout

```
key: devCode.apiKey.<providerId>
val: <api-key-string>
```

Một provider có thể không cần key (local Ollama, LM Studio).

---

## 4. Anthropic adapter (Phase 1 chi tiết)

### 4.1 Endpoint

```
POST {baseURL}/v1/messages
Headers:
  x-api-key: <key>            # nếu là Anthropic chính chủ
  anthropic-version: 2023-06-01
  content-type: application/json
  ...customHeaders            # vd: Authorization Bearer cho proxy
```

Hỗ trợ proxy: nếu user dùng gateway (LiteLLM, AWS Bedrock proxy), header auth có thể khác → dùng `headers` trong config để override.

### 4.2 Prompt format (Phase 1 — chat completion)

Vì `/v1/messages` là chat, không phải FIM native, ta dùng marker:

```
System:
"You are a code completion assistant. Complete the code at <CURSOR/>.
 Return ONLY the code that should replace <CURSOR/>, no explanation,
 no markdown fences. Match the file's language: {language}."

User:
```{language}
// File: {filePath}
{prefix}<CURSOR/>{suffix}
```
```

### 4.3 Streaming

Parse SSE event `content_block_delta` → yield `delta.text`.

Dừng khi:
- Stream kết thúc
- Cancellation signal
- Gặp stop sequence (vd `\n\n` cho single-line mode)

### 4.4 Prompt caching

Set `cache_control: { type: 'ephemeral' }` trên system prompt + file context (prefix). 5-minute TTL. Giảm latency 30-50% và cost 90% với tokens được cache.

---

## 5. Inline completion flow

```
User gõ ký tự
   │
   ▼
onDidChangeTextDocument
   │
   ▼
Debounce(300ms)
   │
   ▼
Cancel inflight request (nếu có)
   │
   ▼
Build CompletionRequest từ document state
   │
   ▼
provider.complete(req, signal)
   │
   ├─ stream chunks ───► accumulate → set InlineCompletionItem
   │
   ▼
User press Tab → accept
User press Esc → reject
User gõ tiếp → cancel + restart
```

---

## 6. Security

| Vấn đề | Cách xử lý |
|---|---|
| API key bị lộ | Lưu SecretStorage, **không** vào `settings.json` |
| Mạng không tin cậy | Cảnh báo khi `baseURL` không phải `https://` (trừ `localhost`/`127.0.0.1`) |
| Code nhạy cảm gửi LLM | Blacklist file pattern: `.env`, `*.pem`, `secrets/**` (Phase 4) |
| MITM | Verify TLS cert mặc định; cho phép `customCAs` nâng cao (Phase 6) |
| Prompt injection từ code | Mức rủi ro thấp (output là code, không exec); document để user biết |

---

## 7. File / module layout

```
dev-code/
├── src/
│   ├── extension.ts              # activate / deactivate
│   ├── providers/
│   │   ├── base.ts               # LLMProvider interface, types
│   │   ├── anthropic.ts          # Phase 1
│   │   ├── openai.ts             # Phase 2
│   │   ├── gemini.ts             # Phase 3
│   │   ├── ollama.ts             # Phase 3
│   │   └── manager.ts            # resolve active provider
│   ├── completion/
│   │   ├── inlineProvider.ts     # InlineCompletionItemProvider impl
│   │   ├── contextBuilder.ts     # build prefix/suffix from document
│   │   ├── debouncer.ts
│   │   └── outputParser.ts       # strip markdown fence, trim trailing
│   ├── config/
│   │   ├── settings.ts           # đọc / validate ProviderConfig
│   │   └── secrets.ts            # SecretStorage helpers
│   ├── ui/
│   │   ├── setupWizard.ts        # multi-step QuickPick
│   │   ├── statusBar.ts
│   │   └── notifications.ts
│   └── util/
│       ├── http.ts               # fetch wrapper với timeout + abort
│       └── sse.ts                # SSE parser
├── test/
│   └── ...
├── package.json
├── tsconfig.json
├── README.md
├── ROADMAP.md
├── DESIGN.md
├── LICENSE                       # TBD
└── .gitignore
```

---

## 8. Decisions log

| Date | Decision | Reason |
|---|---|---|
| 2026-05-20 | Tên: `dev-code` | User chốt |
| 2026-05-20 | Không backend, gọi thẳng provider từ extension | User yêu cầu — đơn giản, không lộ key, không host |
| 2026-05-20 | Gộp provider theo protocol (4 adapter cho N nhà cung cấp) | Bao phủ proxy / self-host (OpenRouter, LiteLLM, LM Studio…) |
| 2026-05-20 | Phase 1: Anthropic adapter (đổi từ Ollama/OpenAI) | User chỉ định |
| 2026-05-20 | License: **MIT** | User chốt — gọn, phù hợp open source phổ thông |
| 2026-05-20 | Code 100% tiếng Anh (comment, string, UI string, JSON description) | User yêu cầu — docs vẫn tiếng Việt |
| 2026-05-20 | Không dùng runtime dependency (chỉ devDeps) | Dùng global `fetch`, `ReadableStream`, `TextDecoder` của Node 18+; SSE parser viết tay |
| 2026-05-20 | `debouncer.ts`, `util/http.ts`, `ui/notifications.ts` không tạo riêng | Inline trong `inlineProvider.ts` cho gọn; dùng `vscode.window.showXxxMessage` trực tiếp |

---

## 9. Open questions

- Có cần workspace-level config riêng (`.vscode/dev-code.json`) để check vào git, hay chỉ user settings?
- Telemetry: tự host server hay tích hợp dịch vụ sẵn (PostHog, Plausible)?
- Quy ước version model name (vd `claude-haiku-4-5` vs `claude-haiku-4-5-20251001` — full ID hay alias)?
