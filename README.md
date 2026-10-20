# Vault Agent

[English](README.en.md) · [GitHub](https://github.com/yanqingwang/opensource-AI-vault-agent) · [MIT License](LICENSE)

**Vault Agent** is an Obsidian plugin that turns your vault into an agentic workspace. It talks directly to LLM APIs that are usable from mainland China — DeepSeek, Zhipu GLM, Kimi (Moonshot), Qwen (DashScope), Volcengine Ark / Ark Coding Plan (Doubao-Seed-Code) and Tencent Hunyuan — as well as any OpenAI- or Anthropic-compatible endpoint. You can configure several agents (each with its own provider, API key and prompt) and switch between them from the view header. The agent can search, read, create and edit your notes on its own. No CLI, no overseas account and no environment variables required.

> Chinese-first: the UI and the notes below are written in Chinese by default, but an English UI and a full English README are included. Switch the language in Settings → Vault Agent → Language. See [README.en.md](README.en.md) for the complete English documentation.

---

中文优先的 Obsidian vault 智能体插件——直连国产大模型 API（OpenAI 兼容协议 + Anthropic Messages 协议），智能体可自主**搜索、读取、创建、修改**你的笔记。无需安装任何 CLI，无需海外账号，无需配置环境变量。可配置**多个 Agent**（各自的服务商、Key、提示词），在标题栏一键切换。

**当前版本：v0.2.1**

## 为什么做这个

海外的同类形态（[Claudian](https://github.com/yishentu/claudian)）依赖 Claude Code CLI 与海外订阅，国内用户配置门槛高且支付困难。Vault Agent 把同一形态的智能体体验变成**填一个 API Key 就能用**：

| 你想用 | 选这个预设 |
|---|---|
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

## 功能

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

## 多 Agent 与火山方舟 Coding Plan

设置 → Vault Agent → **智能体 (Agents)** 区域可管理多个 Agent：

- **＋ 新建空白 Agent**：从默认值开始，自行选择服务商并填 Key。
- **⚡ 用火山 Coding Plan 模板新建**：预填 Anthropic 协议、Base URL `https://ark.cn-beijing.volces.com/api/coding` 与模型 `doubao-seed-code-preview-latest`，只需粘贴套餐专属 API Key。
- 点击某个 Agent 行即切换为当前 Agent；可内联重命名，也可复制/删除（至少保留一个）。

> **火山方舟 Coding Plan**：先在火山方舟控制台购买 Coding Plan（Lite/Pro 订阅），再创建**套餐专属** API Key（与通用方舟 Key 不互通），模型 ID 以控制台为准。同一套餐有两个入口，插件都提供预设：
>
> | 预设 | 协议 | Base URL |
> |---|---|---|
> | `火山方舟 Coding Plan (Anthropic 协议)` | Anthropic Messages | `https://ark.cn-beijing.volces.com/api/coding`（POST `/v1/messages`） |
> | `火山方舟 Coding Plan (OpenAI 兼容)` | OpenAI 兼容 | `https://ark.cn-beijing.volces.com/api/coding/v3`（POST `/chat/completions`） |
>
> Anthropic 入口是 Claude Code 同款、官方文档记载的接入方式，模板按钮默认用它；若在你的套餐下不可用，改用 OpenAI 兼容入口即可。Coding Plan **不提供「服务商内置联网」**，需要联网时请配置 Tavily（见下）。

切换 Agent 时**对话上下文保留**，下一条消息即由新 Agent 应答；侧栏历史记录里每个会话会标注产生它的 Agent。

## 使用

1. 设置 → Vault Agent → 在「智能体 (Agents)」里新建或选择一个 Agent → 选择服务商 → 粘贴 API Key → 选择模型。
2. 点击左侧 ribbon 图标（或命令面板 "Open Vault Agent"）打开侧栏对话。
3. 例如：「找出最近关于 X 的笔记整理成一篇 MOC」「把当前笔记的结尾改成总结段落」。
4. 点击标题栏的**切换智能体**图标换用另一个 Agent（对话不变）；点击**历史记录**图标搜索过往会话，点任意一条即载回对话并继续。

## 本地代理

设置 → Vault Agent → **本地代理（可选）** 填 `host:port`（如 `http://127.0.0.1:9000`；需认证时写 `user:pass@host:port`），
AI 请求即经该代理转发，便于抓包排查或在受限网络下中转；留空直连。仅桌面端生效，不支持 SOCKS。

## 联网搜索

模型训练数据有截止日期，库内笔记也未必覆盖最新信息。设置 → Vault Agent → **联网搜索** 有四档：

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

## 会话历史

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

## 安全

- API Key 只存本机 Obsidian 配置（`data.json`），不上传。
- 智能体没有删除、移动文件与执行命令的工具；写操作默认需确认。
- 长笔记读取与工具结果均自动截断，控制 token 成本。

## 开发

```bash
npm install
npm run build   # tsc 检查 + esbuild 产出 main.js
npm test        # node 端到端单测（mock SSE 服务 + 工具循环 + 历史记录器）
```

## 许可证

MIT
