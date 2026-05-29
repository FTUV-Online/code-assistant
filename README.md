# dev-code

> Open-source code completion extension for VS Code — multi-provider, no vendor lock-in.

**dev-code** is an inline code suggestion (ghost text) extension similar to GitHub Copilot, but:
- 100% open source
- You pick the provider: **Anthropic Claude**, **OpenAI**, **Google Gemini**, **Ollama**, or any endpoint compatible with the OpenAI / Anthropic API
- No middleman backend — the extension talks directly to the provider
- API keys are stored securely in VS Code SecretStorage

## Status

🚧 **Pre-alpha** — Phase 1 skeleton is in place (Anthropic adapter), not yet tested against the live API. See [ROADMAP.md](./ROADMAP.md) for progress.

## Planned features

- [x] Multi-provider architecture via protocol adapters
- [x] Inline completion (ghost text) — accept with `Tab` *(scaffold, runtime test pending)*
- [x] Streaming responses *(Anthropic SSE)*
- [ ] Multi-file context
- [ ] Chat panel with `/explain`, `/fix`, `/test` commands
- [ ] Workspace indexing (RAG)

## Supported providers

| Protocol | Coverage |
|---|---|
| **Anthropic-compatible** | Claude (first-party), AWS Bedrock proxy, Vertex AI proxy, LiteLLM, custom proxy |
| **OpenAI-compatible** | OpenAI, Azure OpenAI, OpenRouter, Groq, Together AI, DeepSeek, Fireworks, Mistral, LM Studio, vLLM, LocalAI, Ollama (`/v1`), xAI Grok, custom proxy |
| **Gemini native** | Google AI Studio |
| **Ollama native** | `/api/generate` endpoint (better FIM support for code completion) |

## Development

```bash
npm install
npm run compile        # build into out/
npm run watch          # dev mode, auto rebuild
```

In VS Code, open the folder and press **F5** to launch the **Extension Development Host** — a new VS Code window opens with the extension loaded.

Inside the Extension Host window:
1. Open the Command Palette (`Ctrl+Shift+P`) → run **dev-code: Setup Provider**
2. Pick a preset (first-party Anthropic or a custom endpoint)
3. Enter provider name, base URL, model, and API key
4. Open any code file → start typing → ghost text will appear

## Documentation

- [ROADMAP.md](./ROADMAP.md) — Development roadmap by phase
- [DESIGN.md](./DESIGN.md) — Architecture and design decisions

## License

[MIT](./LICENSE)
