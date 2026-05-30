# Cách tính Token Input/Output cho mỗi Request

## Nguồn gốc token

Có 2 nguồn cung cấp số token, ưu tiên theo thứ tự:

### 1. Lấy từ response của provider (chính xác nhất)

`open-sse/utils/usageTracking.js` → `extractUsage()` đọc usage từ nhiều format:

| Format | Input field | Output field |
|---|---|---|
| OpenAI | `usage.prompt_tokens` | `usage.completion_tokens` |
| Claude | `usage.input_tokens` (event `message_delta`) | `usage.output_tokens` |
| OpenAI Responses API | `response.usage.input_tokens` | `response.usage.output_tokens` |
| Gemini / Antigravity | `usageMetadata.promptTokenCount` | `usageMetadata.candidatesTokenCount` |
| Ollama (NDJSON) | `prompt_eval_count` | `eval_count` |
| DeepSeek | dùng `prompt_cache_hit_tokens` cho cached | giống OpenAI |

Tất cả được normalize về shape OpenAI: `prompt_tokens`, `completion_tokens`, kèm theo `cached_tokens`, `reasoning_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens` nếu có.

### 2. Estimate khi provider không trả usage (fallback)

Hàm `estimateUsage()` trong `open-sse/utils/usageTracking.js`:

- **Input**: `Math.ceil(JSON.stringify(body).length / 4)` — lấy độ dài toàn bộ request body (messages + tools + system…) chia 4 ký tự ≈ 1 token.
- **Output**: `Math.floor(contentLength / 4)` — `contentLength` là tổng độ dài text mà router thu được khi stream về client.
- Đánh dấu `estimated: true` khi trả về client.

### Buffer tokens

Khi forward usage về client (streaming), router thêm **buffer 2000 tokens** vào input (`addBufferToUsage`) để tránh CLI tool tính sai context limit. Buffer này chỉ thêm vào response cho client, **không lưu DB**.

## Khi nào tính

Trong `open-sse/utils/stream.js`:

- **Streaming**: parser theo dõi từng SSE chunk, `extractUsage()` trên mỗi chunk; chunk cuối (`finishReason`) mà chưa có usage thì gọi `estimateUsage()`.
- **Non-streaming**: `extractUsageFromResponse()` đọc trực tiếp từ JSON response (`open-sse/handlers/chatCore/requestDetail.js`).

Mỗi request kết thúc đều gọi `logUsage()` → in console + lưu DB qua `saveRequestUsage()`.

## Lưu vào DB và tổng hợp

`src/lib/db/repos/usageRepo.js` → `saveRequestUsage(entry)`:

1. Insert vào bảng `usageHistory` với các cột:
   - `promptTokens`, `completionTokens` (top-level, dùng cho query nhanh)
   - `tokens` (JSON đầy đủ gồm cả `cache_read_input_tokens`, `cache_creation_input_tokens`, `reasoning_tokens`...)
2. Upsert `usageDaily` (aggregate theo ngày): cộng dồn vào `byProvider`, `byModel`, `byAccount`, `byApiKey`, `byEndpoint`.
3. Tăng counter `totalRequestsLifetime` trong `_meta`.

Tất cả gói trong 1 transaction `better-sqlite3`.

## Tính cost

Hàm `calculateCost(provider, model, tokens)` áp giá từ `pricingRepo`:

```
nonCachedInput = max(0, prompt_tokens - cached_tokens)
cost = nonCachedInput * pricing.input / 1e6
     + cached_tokens * (pricing.cached || pricing.input) / 1e6
     + completion_tokens * pricing.output / 1e6
     + reasoning_tokens * (pricing.reasoning || pricing.output) / 1e6
     + cache_creation_input_tokens * (pricing.cache_creation || pricing.input) / 1e6
```

- `cached_tokens` được trừ khỏi input thường rồi áp giá rẻ hơn (cache_read).
- `cache_creation_input_tokens` áp giá riêng (Claude prompt caching).

## Hiển thị

- **Stats endpoint** (`/api/usage/stats`): `totalPromptTokens` và `totalCompletionTokens` cộng dồn từ `usageDaily` (period 7d/30d/60d) hoặc trực tiếp từ `usageHistory` (period today/24h).
- **Recent requests** và `last10Minutes`: query thẳng `usageHistory` theo timestamp window.
- **Log dòng**: `time | model | provider | account | sent | received | status` lấy từ `usageHistory` qua `getRecentLogs()`.

## Tóm tắt

- **Input** = `prompt_tokens` (normalize từ format gốc của provider, hoặc estimate `body.length / 4`)
- **Output** = `completion_tokens` (từ provider hoặc estimate `content.length / 4`)
- Cached / reasoning tách riêng để tính cost chính xác hơn
- Buffer 2000 chỉ thêm vào response cho client, không lưu DB
