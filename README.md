# AI Vault Agent CN

[English](#english) | [中文](#中文)

---

## English

A China-first Obsidian agent plugin that talks directly to OpenAI-compatible and Anthropic Messages LLM APIs and can autonomously **search, read, create and edit** your notes. No CLI to install, no overseas account, no environment variables to configure. Configure **multiple agents** (each with its own provider, key and prompt) and switch between them from the header.

**Current version: v0.3.1**

### Why

The closest equivalent overseas ([Claudian](https://github.com/yishentu/claudian)) requires the Claude Code CLI and an overseas subscription, which is both hard to set up and hard to pay for from mainland China. Vault Agent turns the same agent experience into **paste one API key and go**:

| What you want | Pick this preset |
|---|---|
| Your local Magpie gateway (one entry for every subscription, key and routing group) | `Magpie 本地网关 (本机)`, or **New from Magpie template** |
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

### Features

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
- **Magpie gateway (one-click template)**: one button creates an agent wired to the Magpie gateway, and the model list is read live from its `/v1/models` instead of being typed by hand.
- **Copyable messages**: every user message and answer carries a copy button (shown on hover); clicking it copies that message as plain text/Markdown and flips the icon to a check.
- **Conversations are memory**: every turn updates the single note `CN AI Agent/记忆.md` and schedules it on a forgetting curve, so a conversation is searchable, linkable and actually comes back for review.

### Multiple agents and Volcengine Ark Coding Plan

Settings → AI Vault Agent CN → the **Agents** section manages your agents:

- **New blank agent**: start from defaults, pick a provider and paste a key.
- **New from Volcengine Coding Plan template**: pre-fills the Anthropic protocol, base URL `https://ark.cn-beijing.volces.com/api/coding` and model `doubao-seed-code-preview-latest` — just paste the plan's API key.
- Click an agent row to make it **active**; rename inline, duplicate or delete (at least one agent is kept).
- Two badges: **active** (the one this turn uses) and **default** (the one a fresh conversation starts on). The star at the end of a row sets the default; switching agents does not change which one is default.

> **Volcengine Ark Coding Plan**: buy a Coding Plan (Lite/Pro) in the Ark console first, then create a **plan-specific** API key (it is not interchangeable with a general Ark key); the model ID is whatever the console lists. The plan exposes two entries and both have presets:
>
> | Preset | Protocol | Base URL |
> |---|---|---|
> | `火山方舟 Coding Plan (Anthropic 协议)` | Anthropic Messages | `https://ark.cn-beijing.volces.com/api/coding` (POST `/v1/messages`) |
> | `火山方舟 Coding Plan (OpenAI 兼容)` | OpenAI-compatible | `https://ark.cn-beijing.volces.com/api/coding/v3` (POST `/chat/completions`) |
>
> The Anthropic entry is the Claude Code path documented by Volcengine, and the template button uses it; if it is not available on your plan, switch to the OpenAI-compatible entry. Coding Plan has **no provider-native web search** — configure Tavily (below) if you need search.

Switching agents **keeps the conversation**; the next message goes to the new agent, and the history panel tags each session with the agent that produced it.

### Magpie gateway (one-click template)

[Magpie](https://usemagpie.ai) is a local AI gateway (default `127.0.0.1:3425`) that turns the subscriptions, vendor API keys and routing groups you configured inside it into one catalog of `provider/model` ids, and speaks OpenAI Chat and Anthropic Messages itself. To this plugin it is **a single provider**, not one configuration per vendor.

Settings → AI Vault Agent CN → Agents → **New from Magpie template**:

1. An agent is created with base URL `http://127.0.0.1:3425/v1` and API key `magpie-ai-vault-agent`.
2. The plugin then reads `GET /v1/models` from the gateway and picks a model: `auto/…` (Magpie's own routing) first, then a `group/…` routing group, then the first enabled model.
3. Those models are listed under **Model ID** — click one to switch; press **Reload** after changing anything in Magpie.

Boundaries worth knowing:

- **Nothing is sent while the gateway is down** (`net::ERR_CONNECTION_REFUSED`). When Magpie is off, switch to another agent.
- **The key is not a secret.** The local gateway accepts any key; `magpie-ai-vault-agent` only makes Magpie's usage page and routing rules attribute this client to `ai-vault-agent`. Switching to a real vendor clears it, so it can never be mistaken for a credential.
- **The port can move.** If you change `port` in Magpie's `settings.json`, change the base URL to match; Magpie's "share on the local network" address works too.
- Model ids are Magpie's `provider/model` (or a routing group name) exactly as `/v1/models` returns them; this plugin ships no fixed list.

### Conversation memory (CN AI Agent/记忆.md)

With **Save conversations as vault memory** on (the default), every turn updates **one** memory note:

```
CN AI Agent/记忆.md
```

Not one file per conversation — that only piles up files nobody reopens. Every memory lives in this one note, each with its own review schedule, so the note itself says what to review today.

- **Scheduled on a forgetting curve**: a new memory is due the next day, then every 1 / 2 / 4 / 7 / 15 / 30 / 60 / 120 / 240 days. "Remembered" climbs a rung; "Forgot" drops back to day one.
- **Two ways in**: the "Review due memory" command walks the due entries; the note's `## 今日待复习` section lists them. On start-up the plugin mentions how many are due.
- **What the note holds**: frontmatter (updated/entries/due/tags), the due list, then every memory with its session, turn count, next review date, review count, a memory-strength percentage and the question/answer pairs.
- **The prose is safe to edit by hand**; the trailing `<!-- memory:data -->` comment is the schedule, and editing it loses review progress.
- Turning the switch off stops all writes.

### Installation

**Community plugins**: Settings → Community plugins → Browse → search for **AI Vault Agent CN** → Install, then Enable.

**Manual**: copy `main.js`, `manifest.json` and `styles.css` into `<vault>/.obsidian/plugins/vault-agent/`, restart Obsidian and enable the plugin.

**Requirements**: Obsidian 1.7.2 or newer; works on desktop and mobile (the local proxy is desktop-only).

### Usage

1. Settings → AI Vault Agent CN → in **Agents**, create or pick an agent → pick a provider → paste your API key → pick a model.
2. Click the ribbon icon (or run "打开智能体 / open agent" from the command palette) to open the chat sidebar.
3. For example: "find my recent notes about X and turn them into a MOC", "rewrite the end of the current note as a summary paragraph".
4. Click the **History** icon in the header to search past conversations; click a row to load it back and keep chatting.

### Local proxy

Settings → AI Vault Agent CN → **Local proxy (optional)**: enter `host:port` (e.g. `http://127.0.0.1:9000`, or `user:pass@host:port` when the proxy needs authentication) and AI requests go through it — handy for inspecting traffic with a local proxy or for relaying on a restricted network. Leave it empty to connect directly. Desktop only; SOCKS is not supported.

### Web search

A model's training data has a cut-off, and your notes may not cover recent events. Settings → AI Vault Agent CN → **Web search** has four modes:

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

### Conversation history

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

### Safety

- The API key is stored only in local Obsidian config (`data.json`) and is never uploaded.
- The agent has no tools to delete or move files, or to run commands; write actions need confirmation by default.
- Long notes and tool results are truncated to keep token cost down.

### Development

```bash
npm install
npm run build   # tsc check + esbuild -> main.js
npm test        # node end-to-end tests (mock SSE server + agent loop + history recorder)
```

### License

MIT

### Issues & Feedback

- GitHub Issues: <https://github.com/yanqingwang/opensource-AI-vault-agent/issues>
- Email: wangyantsing@qq.com

Please include your Obsidian version, the plugin version, a description or screenshot of the problem, and what you expected to happen.

---

## 中文

中文优先的 Obsidian vault 智能体插件（插件市场名 **AI Vault Agent CN**）——直连国产大模型 API（OpenAI 兼容协议 + Anthropic Messages 协议），智能体可自主**搜索、读取、创建、修改**你的笔记。无需安装任何 CLI，无需海外账号，无需配置环境变量。可配置**多个 Agent**（各自的服务商、Key、提示词），在标题栏一键切换。

**当前版本：v0.3.1**

### 为什么做这个

海外的同类形态（[Claudian](https://github.com/yishentu/claudian)）依赖 Claude Code CLI 与海外订阅，国内用户配置门槛高且支付困难。Vault Agent 把同一形态的智能体体验变成**填一个 API Key 就能用**：

| 你想用 | 选这个预设 |
|---|---|
| 本机 Magpie 网关（一个入口用上所有订阅/Key/路由组） | `Magpie 本地网关 (本机)`，或用 **🪄 用 Magpie 模板一键新建** |
| DeepSeek 深度求索 | `DeepSeek` |
| 智谱 GLM / Z.ai | `智谱 GLM` / `Z.ai` |
| Kimi（月之暗面） | `Kimi` |
| 通义 Qwen（Qoder 同源模型） | `通义 Qwen (DashScope)` |
| 豆包/Seed（Trae 同源模型） | `火山方舟 Ark`（填接入点 ID） |
| 豆包编程模型（Claude Code 同源套餐） | `火山方舟 Coding Plan`（Anthropic / OpenAI 兼容两个入口） |
| 腾讯混元（WorkBuddy 同源模型） | `腾讯混元 Hunyuan` |
| Hermes（Nous Research） | `Hermes` 或 `OpenRouter` |
| 其他任意 OpenAI 兼容服务 | `自定义 OpenAI 兼容端点` |
| 其他任意 Anthropic 兼容服务 | `自定义 Anthropic 兼容端点` |

> Trae / Qoder / WorkBuddy 本体不对外提供个人 API 通道，本插件支持的是它们背后的模型服务商官方 API（火山方舟、DashScope、腾讯混元），申请即用、人民币计费。

### 功能

- **智能体工具调用**：`search_notes` / `read_note` / `list_notes` / `get_active_note` / `create_note` / `edit_note`（精确替换）/ `append_note` / `read_properties`，单轮可多步连续操作。
- **流式输出**：SSE 流式渲染，支持 reasoning（DeepSeek-R1 / Kimi thinking 等）；直连失败自动降级为非流式（Obsidian requestUrl）。
- **本地代理（可选）**：AI 请求可经本机 HTTP 代理转发（`http://` 绝对 URI 直转、`https://` CONNECT 隧道），仅桌面端。
- **联网搜索（可选）**：用服务商内置联网（GLM / Kimi / Qwen / OpenRouter），或用插件自带的 `web_search` 工具（Tavily）——DeepSeek 这类没有内置联网的服务商也能搜。
- **写操作确认**：默认每次创建/修改前询问；可在设置中开启自动执行。
- **上下文感知**：自动告知当前打开的笔记路径，方便直接整理正在编辑的内容。
- **中文优先**：内置中文系统提示与界面，可切换英文；自定义系统提示词。
- **会话保留与检索**：最近对话自动保存，重启后继续；侧栏「历史记录」按钮可搜索过往会话并载回继续对话，完整记录另存为 `history.jsonl`（见下）。
- **多 Agent 与快速切换**：每个 Agent 保存自己的服务商、Base URL、API Key、模型、生成参数、系统提示词与联网配置；标题栏的切换按钮（或命令「切换智能体」）可即时换用另一个 Agent，对话上下文保持不变。
- **Anthropic Messages 协议**：除 OpenAI 兼容协议外，支持 Anthropic Messages（`POST /v1/messages`），可直接接入火山方舟 Coding Plan 等 Anthropic 兼容端点。
- **Magpie 本地网关（一键模板）**：设置里点一下就用 Magpie 网关建好 Agent，模型列表从网关 `/v1/models` 实时读取，不用手抄模型名。
- **消息可复制**：每条用户消息与回答右上角都有复制按钮（悬停出现），点击即复制该条消息的纯文本/Markdown，图标短暂变成 ✓。
- **对话即记忆**：每轮对话结束自动更新库内 `CN AI Agent/记忆.md` 这一篇笔记，并按遗忘曲线安排复习——对话因此可搜索、可双链、会被主动想起。

### 多 Agent 与火山方舟 Coding Plan

设置 → AI Vault Agent CN → **智能体 (Agents)** 区域可管理多个 Agent：

- **＋ 新建空白 Agent**：从默认值开始，自行选择服务商并填 Key。
- **⚡ 用火山 Coding Plan 模板新建**：预填 Anthropic 协议、Base URL `https://ark.cn-beijing.volces.com/api/coding` 与模型 `doubao-seed-code-preview-latest`，只需粘贴套餐专属 API Key。
- 点击某个 Agent 行即切换为**当前** Agent；可内联重命名，也可复制/删除（至少保留一个）。
- 行内有两枚标记：**当前**（这一轮用的）和 **默认**（新对话从哪个 Agent 开始）。
  点行尾星标把某个 Agent 设为默认；切换 Agent 不会改变「默认」。

> **火山方舟 Coding Plan**：先在火山方舟控制台购买 Coding Plan（Lite/Pro 订阅），再创建**套餐专属** API Key（与通用方舟 Key 不互通），模型 ID 以控制台为准。同一套餐有两个入口，插件都提供预设：
>
> | 预设 | 协议 | Base URL |
> |---|---|---|
> | `火山方舟 Coding Plan (Anthropic 协议)` | Anthropic Messages | `https://ark.cn-beijing.volces.com/api/coding`（POST `/v1/messages`） |
> | `火山方舟 Coding Plan (OpenAI 兼容)` | OpenAI 兼容 | `https://ark.cn-beijing.volces.com/api/coding/v3`（POST `/chat/completions`） |
>
> Anthropic 入口是 Claude Code 同款、官方文档记载的接入方式，模板按钮默认用它；若在你的套餐下不可用，改用 OpenAI 兼容入口即可。Coding Plan **不提供「服务商内置联网」**，需要联网时请配置 Tavily（见下）。

切换 Agent 时**对话上下文保留**，下一条消息即由新 Agent 应答；侧栏历史记录里每个会话会标注产生它的 Agent。

### Magpie 本地网关（一键模板）

[Magpie](https://usemagpie.ai) 是本机的一个 AI 网关（默认 `127.0.0.1:3425`），把你在里面配好的订阅、各家 API Key 和路由组统一成一套 `provider/model` 模型列表，并同时听懂 OpenAI Chat、Anthropic Messages 等协议。对本插件来说，它等于**一个服务商**，而不是每家用一套配置。

设置 → AI Vault Agent CN → 智能体 (Agents) → **🪄 用 Magpie 模板一键新建**：

1. 建好一个 Agent，Base URL 填 `http://127.0.0.1:3425/v1`，API Key 填 `magpie-ai-vault-agent`。
2. 插件随即向网关 `GET /v1/models` 拉取你已启用的模型，自动选中一个（优先 `auto/…` 自动路由，其次 `group/…` 路由组，再次列表第一个）。
3. 「模型 ID」下方会列出这些模型，点一下即可切换；换过 Magpie 里的配置后点「重新读取」。

几个要知道的边界：

- **网关没启动就发不出请求**（`net::ERR_CONNECTION_REFUSED`）。Magpie 关掉时，切回别的 Agent 即可。
- **Key 不是密钥**。本机网关接受任意 Key，`magpie-ai-vault-agent` 只是让 Magpie 的用量统计和路由规则把你这个客户端记成 `ai-vault-agent`。切到别的服务商时插件会自动清掉它，避免被当成真 Key 误用。
- **端口可改**。Magpie 的 `settings.json` 里改了 `port`，把 Base URL 一起改掉即可；也支持 Magpie 的「共享到局域网」地址。
- 模型名就是 Magpie 的 `provider/model`（或路由组名），以 `/v1/models` 返回为准，本插件不内置任何固定列表。

### 对话记忆（CN AI Agent/记忆.md）

开启后（默认开启，设置 → AI Vault Agent CN → **把对话保存为库内记忆**），**每轮对话结束**都会更新**同一个**记忆文件：

```
CN AI Agent/记忆.md
```

不是一篇会话一个文件——那样只会堆出一堆没人再打开的文件。全部记忆都在这一篇里，每条自带复习排期，笔记本身就会告诉你今天该复习什么。

- **按遗忘曲线复习**：新记忆第二天到期，之后按 1 / 2 / 4 / 7 / 15 / 30 / 60 / 120 / 240 天递增。
  「记得」升一级，「忘了」回到第一天。
- **两种复习入口**：命令面板「复习今日记忆」逐条问；打开笔记看 `## 今日待复习` 一节。
  插件启动时若有到期记忆会提示一次。
- **笔记内容**：frontmatter（updated/entries/due/tags）+ 今日待复习清单 + 全部记忆（每条含会话、轮数、
  下次复习日期、复习次数、记忆强度百分比，以及每一轮的问答对）。
- **可安全手工编辑正文**；末尾 `<!-- memory:data -->` 注释是排期数据，改了会丢复习进度。
- 关掉开关即完全停止写入。

### 安装

**社区插件市场**：设置 → 第三方插件 → 浏览 → 搜索 **AI Vault Agent CN** → 安装并启用。

**手动安装**：把 `main.js`、`manifest.json`、`styles.css` 放进 `<vault>/.obsidian/plugins/vault-agent/`，重开 Obsidian 后在第三方插件里启用。

**系统要求**：Obsidian 1.7.2 及以上；桌面端与移动端均可（本地代理仅桌面端）。

### 使用

1. 设置 → AI Vault Agent CN → 在「智能体 (Agents)」里新建或选择一个 Agent → 选择服务商 → 粘贴 API Key → 选择模型。
2. 点击左侧 ribbon 图标（或命令面板「打开智能体 / open agent」）打开侧栏对话。
3. 例如：「找出最近关于 X 的笔记整理成一篇 MOC」「把当前笔记的结尾改成总结段落」。
4. 点击标题栏的**切换智能体**图标换用另一个 Agent（对话不变）；点击**历史记录**图标搜索过往会话，点任意一条即载回对话并继续。

### 本地代理

设置 → AI Vault Agent CN → **本地代理（可选）** 填 `host:port`（如 `http://127.0.0.1:9000`；需认证时写 `user:pass@host:port`），
AI 请求即经该代理转发，便于抓包排查或在受限网络下中转；留空直连。仅桌面端生效，不支持 SOCKS。

### 联网搜索

模型训练数据有截止日期，库内笔记也未必覆盖最新信息。设置 → AI Vault Agent CN → **联网搜索** 有四档：

| 模式 | 行为 |
|---|---|
| 关闭 | 默认。只用模型自身知识与库内笔记 |
| 自动 | 服务商有内置联网就用内置，否则回退到插件工具（需 Tavily Key） |
| 仅服务商内置 | GLM / Z.ai / Kimi / Qwen / OpenRouter |
| 仅插件工具 | 用 Tavily，**任何服务商**都能联网（含 DeepSeek） |

- **服务商内置**不需要额外 Key，检索在服务商侧完成。DeepSeek 官方 API 不支持联网；火山方舟的联网插件开启后会**禁用函数调用**（会废掉全部库内工具），因此未接入。**火山方舟 Coding Plan 同样没有内置联网**，需要联网请用「仅插件工具」并配置 Tavily。
- **插件工具**需要 Tavily Key：到 [app.tavily.com](https://app.tavily.com) 注册（免费额度 1000 次/月），填进「Tavily API Key」。检索结果会并入上下文，因此既计入 token，也按次计费。
- 可调「每次搜索返回条数」与「搜索深度」（basic 1 credit / advanced 2 credits）。
- 若服务商拒绝了联网参数，本轮会自动去掉该参数重试一次，不会因此整轮失败。

### 会话历史

聊天过程中，插件把每条事件（用户消息、助手回答、思考、工具调用与结果）追加写入
`.obsidian/plugins/vault-agent/history.jsonl`。`data.json` 里只留最近 40 条用于恢复界面，
这份 JSONL 才是带时间戳、带会话 id、带工具调用的完整记录。

侧栏标题栏的**历史记录**按钮可以直接列出并搜索这些会话，点击即载回对话——不需要命令行。

用 `tools/history_db.py`（仅标准库）导入 SQLite，则可从命令行随时检索：

```bash
python tools/history_db.py import                  # 增量导入，可重复执行
python tools/history_db.py search 同步任务          # 全文检索（FTS5 trigram，支持中文）
python tools/history_db.py search --tool read_note  # 按工具过滤
python tools/history_db.py sessions                # 列出会话
python tools/history_db.py show <session 前缀>      # 打印某个会话的完整对话
python tools/history_db.py stats
```

数据库默认落在 JSONL 同目录（`history.db`）；导入按事件 id 去重，重复运行只写入新增事件。
路径可用 `--vault <vault 根目录>` 或 `--jsonl/--db` 指定。

### 安全

- API Key 只存本机 Obsidian 配置（`data.json`），不上传。
- 智能体没有删除、移动文件与执行命令的工具；写操作默认需确认。
- 长笔记读取与工具结果均自动截断，控制 token 成本。

### 开发

```bash
npm install
npm run build   # tsc 检查 + esbuild 产出 main.js
npm test        # node 端到端单测（mock SSE 服务 + 工具循环 + 历史记录器）
```

### 许可证

MIT

### 问题与反馈

- GitHub Issues：<https://github.com/yanqingwang/opensource-AI-vault-agent/issues>
- 邮箱：wangyantsing@qq.com

反馈时请尽量附上：Obsidian 版本、插件版本、问题描述或截图、预期结果。
