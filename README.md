# dev-code

> Open-source code completion extension cho VS Code — hỗ trợ nhiều LLM provider, không khóa nhà cung cấp.

**dev-code** là extension gợi ý code inline (ghost text) tương tự GitHub Copilot, nhưng:
- 100% open source
- Người dùng tự chọn provider: **Anthropic Claude**, **OpenAI**, **Google Gemini**, **Ollama**, hoặc bất kỳ endpoint nào tương thích OpenAI / Anthropic API
- Không cần backend trung gian — extension gọi thẳng tới provider
- API key lưu an toàn trong VS Code SecretStorage

## Trạng thái

🚧 **Pre-alpha** — Phase 1 skeleton đã code xong (Anthropic adapter), chưa test với API thật. Xem [ROADMAP.md](./ROADMAP.md) để biết tiến độ.

## Tính năng dự kiến

- [x] Thiết kế kiến trúc đa provider qua protocol adapter
- [x] Inline completion (ghost text) — accept bằng `Tab` *(scaffold, cần test runtime)*
- [x] Streaming response *(Anthropic SSE)*
- [ ] Multi-file context
- [ ] Chat panel với commands `/explain`, `/fix`, `/test`
- [ ] Workspace indexing (RAG)

## Provider được hỗ trợ

| Protocol | Bao phủ |
|---|---|
| **Anthropic-compatible** | Claude (chính chủ), AWS Bedrock proxy, Vertex AI proxy, LiteLLM, custom proxy |
| **OpenAI-compatible** | OpenAI, Azure OpenAI, OpenRouter, Groq, Together AI, DeepSeek, Fireworks, Mistral, LM Studio, vLLM, LocalAI, Ollama (`/v1`), xAI Grok, custom proxy |
| **Gemini native** | Google AI Studio |
| **Ollama native** | Endpoint `/api/generate` (hỗ trợ FIM tốt hơn cho code completion) |

## Phát triển

```bash
npm install
npm run compile        # build vào out/
npm run watch          # dev mode, auto rebuild
```

Trong VS Code, mở folder rồi nhấn **F5** để chạy **Extension Development Host** — một cửa sổ VS Code mới sẽ mở với extension đã được nạp.

Trong cửa sổ Extension Host:
1. Mở Command Palette (`Ctrl+Shift+P`) → chạy **dev-code: Setup Provider**
2. Chọn preset (Anthropic chính chủ hoặc custom endpoint)
3. Nhập tên provider, base URL, model, API key
4. Mở 1 file code bất kỳ → bắt đầu gõ → ghost text sẽ hiện ra

## Tài liệu

- [ROADMAP.md](./ROADMAP.md) — Lộ trình phát triển theo phase
- [DESIGN.md](./DESIGN.md) — Kiến trúc và quyết định thiết kế

## License

[MIT](./LICENSE)
