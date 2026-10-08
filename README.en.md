# Vault Agent

[中文](README.md) · [GitHub](https://github.com/yanqingwang/opensource-AI-vault-agent) · [MIT License](LICENSE)

A China-first Obsidian agent plugin that talks directly to OpenAI-compatible and Anthropic Messages LLM APIs and can autonomously **search, read, create and edit** your notes. No CLI to install, no overseas account, no environment variables to configure. Configure **multiple agents** (each with its own provider, key and prompt) and switch between them from the header.

**Current version: v0.2.0**

## Why

The closest equivalent overseas ([Claudian](https://github.com/yishentu/claudian)) requires the Claude Code CLI and an overseas subscription, which is both hard to set up and hard to pay for from mainland China. Vault Agent turns the same agent experience into **paste one API key and go**:

| What you want | Pick this preset |
|---|---|
| DeepSeek | `DeepSeek` |
| Zhipu GLM / Z.ai | `智谱 GLM` / `Z.ai` |
| Kimi (Moonshot) | `Kimi` |
| Qwen (DashScope — the models behind Qoder) | `通义 Qwen (DashScope)` |
| Doubao/Seed (Volcengine Ark — the models behind Trae) | `火山方舟 Ark` (enter your endpoint ID) |
| Doubao-Seed-Code (the Claude Code–compatible Coding Plan) | `火山方舟 Coding Plan` (both Anthropic and OpenAI-compatible entries) |
| Tencent Hunyuan (the models behind WorkBuddy) | `腾讯混元 Hunyuan` |
| Hermes (Nous Research) | `Hermes` or `OpenRouter` |
| Any other OpenAI-compatible service | `自定义 OpenAI 兼容端点` (custom) |
| Any other Anthropic-compatible service | `自定义 Anthropic 兼容端点` (custom) |

> Preset names above are the labels shown in the plugin UI (Chinese). Trae / Qoder / WorkBuddy do not expose personal API channels; this plugin talks to the official APIs of the model vendors behind them (Volcengine Ark, DashScope, Tencent Hunyuan), which you can sign up for and pay for in RMB.

## Features

- **Agent tool calls**: `search_notes` / `read_note` / `list_notes` / `get_active_note` / `create_note` / `edit_note` (exact replace) / `append_note` / `read_properties`, with multiple steps per turn.
- **Streaming**: SSE rendering with reasoning support (DeepSeek-R1 / Kimi thinking and friends); falls back to non-streaming (Obsidian `requestUrl`) when the direct connection fails.
- **Local proxy (optional)**: route AI requests through a local HTTP proxy (absolute-URI forwarding for `http`, CONNECT tunnelling for `https`). Desktop only.
- **Web search (optional)**: use the provider's own search (GLM / Kimi / Qwen / OpenRouter), or the bundled `web_search` tool backed by Tavily — so providers without native search, DeepSeek included, can search too.
- **Write confirmation**: creating or editing asks first by default; can be auto-approved in settings.
- **Context aware**: the agent is told which note is open, so it can work on what you are editing.
- **China-first**: a Chinese system prompt and UI are built in, switchable to English; you can also supply your own system prompt.
- **History, kept and searchable**: recent messages are saved and restored after a restart; the sidebar **History** button searches past conversations and loads one back into the chat, and the full transcript is kept in `history.jsonl` (see below).
- **Multiple agents, instant switching**: each agent keeps its own provider, base URL, API key, model, generation settings, system prompt and search config; the header switcher (or the "Switch agent" command) swaps agents on the fly, keeping the conversation.
- **Anthropic Messages protocol**: alongside the OpenAI-compatible protocol, Anthropic Messages (`POST /v1/messages`) is supported, so Anthropic-compatible endpoints such as Volcengine Ark's Coding Plan work directly.

## Multiple agents and Volcengine Ark Coding Plan

Settings → Vault Agent → the **Agents** section manages your agents:

- **New blank agent**: start from defaults, pick a provider and paste a key.
- **New from Volcengine Coding Plan template**: pre-fills the Anthropic protocol, base URL `https://ark.cn-beijing.volces.com/api/coding` and model `doubao-seed-code-preview-latest` — just paste the plan's API key.
- Click an agent row to make it active; rename inline, duplicate or delete (at least one agent is kept).

> **Volcengine Ark Coding Plan**: buy a Coding Plan (Lite/Pro) in the Ark console first, then create a **plan-specific** API key (it is not interchangeable with a general Ark key); the model ID is whatever the console lists. The plan exposes two entries and both have presets:
>
> | Preset | Protocol | Base URL |
> |---|---|---|
> | `火山方舟 Coding Plan (Anthropic 协议)` | Anthropic Messages | `https://ark.cn-beijing.volces.com/api/coding` (POST `/v1/messages`) |
> | `火山方舟 Coding Plan (OpenAI 兼容)` | OpenAI-compatible | `https://ark.cn-beijing.volces.com/api/coding/v3` (POST `/chat/completions`) |
>
> The Anthropic entry is the Claude Code path documented by Volcengine, and the template button uses it; if it is not available on your plan, switch to the OpenAI-compatible entry. Coding Plan has **no provider-native web search** — configure Tavily (below) if you need search.

Switching agents **keeps the conversation**; the next message goes to the new agent, and the history panel tags each session with the agent that produced it.

## Usage

1. Settings → Vault Agent → in **Agents**, create or pick an agent → pick a provider → paste your API key → pick a model.
2. Click the ribbon icon (or run "Open Vault Agent" from the command palette) to open the chat sidebar.
3. For example: "find my recent notes about X and turn them into a MOC", "rewrite the end of the current note as a summary paragraph".
4. Click the **History** icon in the header to search past conversations; click a row to load it back and keep chatting.

## Local proxy

Settings → Vault Agent → **Local proxy (optional)**: enter `host:port` (e.g. `http://127.0.0.1:9000`, or `user:pass@host:port` when the proxy needs authentication) and AI requests go through it — handy for inspecting traffic with a local proxy or for relaying on a restricted network. Leave it empty to connect directly. Desktop only; SOCKS is not supported.

## Web search

A model's training data has a cut-off, and your notes may not cover recent events. Settings → Vault Agent → **Web search** has four modes:

| Mode | Behaviour |
|---|---|
| Off | Default. The model uses its own knowledge plus your notes |
| Auto | Provider-native search when the provider has it, otherwise the plugin tool (needs a Tavily key) |
| Provider-native only | GLM / Z.ai / Kimi / Qwen / OpenRouter |
| Plugin tool only | Tavily, so **any** provider can search — DeepSeek included |

- **Provider-native** search needs no extra key; the vendor does the retrieval. DeepSeek's API has no web search, and Volcengine Ark's search plugin **disables function calling** while it is on (which would break every vault tool), so Ark is not wired up. **Volcengine Ark Coding Plan has no native search either** — use "Plugin tool only" with a Tavily key if you need it.
- **The plugin tool** needs a Tavily key: sign up at [app.tavily.com](https://app.tavily.com) (free tier: 1,000 searches/month) and paste it into "Tavily API key". Search results are merged into the context, so they cost both tokens and a per-search fee.
- "Results per search" and "Search depth" (basic = 1 credit, advanced = 2) are configurable.
- If a provider rejects the search parameters, the turn is retried once without them instead of failing.

## Conversation history

While you chat, every event (user message, assistant reply, reasoning, tool call and tool result) is appended to
`.obsidian/plugins/vault-agent/history.jsonl`. `data.json` keeps only the last 40 messages, which is what restores the chat view;
the JSONL is the complete record, with timestamps, session ids and tool calls.

The **History** button in the sidebar header lists and searches those conversations directly, and clicking a row loads it back into the chat — no command line needed.

Importing the JSONL into SQLite with `tools/history_db.py` (standard library only) gives you the same thing from a terminal:

```bash
python tools/history_db.py import                  # incremental; safe to re-run
python tools/history_db.py search 同步任务          # full-text search (FTS5 trigram, so Chinese works)
python tools/history_db.py search --tool read_note  # filter by tool
python tools/history_db.py sessions                # list conversations
python tools/history_db.py show <session prefix>    # print one conversation in full
python tools/history_db.py stats
```

The database lands next to the JSONL (`history.db`) by default. Import deduplicates on event id, so re-running only adds what is new; the paths can be overridden with `--vault <vault root>` or `--jsonl/--db`.

## Safety

- The API key is stored only in local Obsidian config (`data.json`) and is never uploaded.
- The agent has no tools to delete or move files, or to run commands; write actions need confirmation by default.
- Long notes and tool results are truncated to keep token cost down.

## Development

```bash
npm install
npm run build   # tsc check + esbuild -> main.js
npm test        # node end-to-end tests (mock SSE server + agent loop + history recorder)
```

## License

MIT
