import { App, Menu, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, normalizePath, requestUrl, requireApiVersion, setIcon, WorkspaceLeaf, type SettingDefinitionItem } from 'obsidian';
import { AgentView, VIEW_TYPE_AGENT } from './view';
import { HistoryRecorder, newSessionId, parseHistory, type HistoryMeta, type SessionCursor } from './history';
import { nativeSearchFor, withTimeout, type SearchDepth, type SearchMode } from './search';
import { t, tf, Lang } from './i18n';
import {
	MEMORY_FILE, MEMORY_FOLDER, dueEntries, markForgotten, markReviewed,
	mergeSession, parseMemoryFile, renderMemoryFile, type MemoryEntry
} from './memory';
import { MAGPIE_BASE_URL, MAGPIE_KEY, magpieModelsUrl, parseMagpieModels, pickDefaultMagpieModel, type MagpieModel } from './magpie';

/** Wire protocol a provider speaks. Coding Plan (and Anthropic itself) use 'anthropic'. */
export type Protocol = 'openai' | 'anthropic';

export interface ProviderPreset {
	id: string;
	label: string;
	baseUrl: string;
	models: string[];
	/** Defaults to 'openai' when omitted. */
	protocol?: Protocol;
	hint?: string;
	/**
	 * Key a fresh profile gets for this provider. Only Magpie has one: its local
	 * gateway accepts any key and uses it to attribute usage to the app.
	 */
	defaultApiKey?: string;
	/** Models come from the provider itself (Magpie's `/v1/models`), not from a fixed list. */
	catalog?: boolean;
}

/** Curated OpenAI-compatible providers. "同源" rows are the model vendors behind popular Chinese AI tools. */
export const PROVIDERS: ProviderPreset[] = [
	{
		id: 'magpie',
		label: 'Magpie 本地网关 (本机)',
		baseUrl: MAGPIE_BASE_URL,
		models: [],
		defaultApiKey: MAGPIE_KEY,
		catalog: true,
		hint: 'Magpie 在本机 127.0.0.1:3425 跑一个网关，把你在里面配置的订阅、API Key 和路由组都变成模型。下面的模型列表直接从网关 /v1/models 读取，点「重新读取」刷新；Magpie 没启动时请求会连不上。'
	},
	{ id: 'deepseek', label: 'DeepSeek 深度求索', baseUrl: 'https://api.deepseek.com/v1', models: ['deepseek-v4.1-flash', 'deepseek-v4-pro'], hint: 'V4.1 Flash 的官方调用名为 deepseek-flash（同一模型）；以 api.deepseek.com 实际返回为准' },
	{ id: 'glm', label: '智谱 GLM (bigmodel.cn)', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', models: ['glm-4.6', 'glm-4.5-air'], hint: '模型 ID 以 bigmodel.cn 控制台为准' },
	{ id: 'zai', label: 'Z.ai (GLM 海外版)', baseUrl: 'https://api.z.ai/api/paas/v4', models: ['glm-4.6', 'glm-4.5-air'] },
	{ id: 'kimi', label: 'Kimi (Moonshot 月之暗面)', baseUrl: 'https://api.moonshot.cn/v1', models: ['kimi-k2-turbo-preview', 'kimi-k2-preview', 'moonshot-v1-32k'], hint: 'K 系列模型 ID 以 platform.moonshot.cn 为准' },
	{ id: 'qwen', label: '通义 Qwen (DashScope · Qoder 同源)', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', models: ['qwen3-coder-plus', 'qwen-plus', 'qwen-max'] },
	{ id: 'ark', label: '火山方舟 Ark (豆包 · Trae 同源)', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', models: ['doubao-seed-1-6-250615'], hint: '方舟需填推理接入点 ID（ep-xxx）或模型 ID，以火山控制台为准' },
	{
		id: 'ark-coding',
		label: '火山方舟 Coding Plan (Anthropic 协议)',
		baseUrl: 'https://ark.cn-beijing.volces.com/api/coding',
		models: ['doubao-seed-code-preview-latest', 'doubao-seed-code-preview-251028'],
		protocol: 'anthropic',
		hint: '需先在火山方舟控制台购买 Coding Plan，并使用套餐专属 API Key（与通用方舟 Key 不互通）。这是 Claude Code 同款的 Anthropic Messages 入口（POST /api/coding/v1/messages）。模型 ID 以控制台为准。'
	},
	{
		id: 'ark-coding-openai',
		label: '火山方舟 Coding Plan (OpenAI 兼容)',
		baseUrl: 'https://ark.cn-beijing.volces.com/api/coding/v3',
		models: ['doubao-seed-code-preview-latest', 'doubao-seed-2.1-pro'],
		hint: '同一 Coding Plan 的 OpenAI 兼容入口（POST /api/coding/v3/chat/completions）。若 Anthropic 入口在你的套餐下不可用，改用这个。模型 ID 以控制台为准。'
	},
	{ id: 'hunyuan', label: '腾讯混元 Hunyuan (WorkBuddy 同源)', baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1', models: ['hunyuan-turbos-latest', 'hunyuan-t1-latest'] },
	{ id: 'hermes', label: 'Hermes (Nous Research)', baseUrl: 'https://inference-api.nousresearch.com/v1', models: ['Hermes-4-405B', 'Hermes-4-70B'], hint: '也可用 OpenRouter 转发（选 OpenRouter 并填 nousresearch/hermes-4-405b）' },
	{ id: 'openrouter', label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', models: ['nousresearch/hermes-4-405b', 'deepseek/deepseek-chat-v3.1'] },
	{ id: 'anthropic-custom', label: '自定义 Anthropic 兼容端点', baseUrl: '', models: [], protocol: 'anthropic', hint: '填写 Anthropic Messages 协议（POST /v1/messages）的 Base URL 与模型 ID。' },
	{ id: 'custom', label: '自定义 OpenAI 兼容端点', baseUrl: '', models: [], hint: '填写任意 OpenAI 兼容 Base URL 与模型 ID' }
];

/** One named agent: its own provider, credentials, prompts and generation settings. */
export interface AgentProfile {
	id: string;
	name: string;
	protocol: Protocol;
	providerId: string;
	baseUrl: string;
	apiKey: string;
	proxyUrl: string;
	model: string;
	temperature: number;
	maxTokens: number;
	maxIterations: number;
	autoContext: boolean;
	autoApprove: boolean;
	systemPrompt: string;
	searchMode: SearchMode;
	/** Tavily key; only used when web search falls back to the plugin tool. */
	searchApiKey: string;
	searchMaxResults: number;
	searchDepth: SearchDepth;
}

export interface VASettings {
	lang: Lang;
	profiles: AgentProfile[];
	activeProfileId: string;
	/** Conversation is shared by all agents (switching keeps the context). */
	history: ChatMessage[];
	/** Id of the conversation currently being appended to history.jsonl. */
	sessionId: string;
	/** Write every conversation into the vault as a note under `CN AI Agent/`. */
	memoryNotes: boolean;
}

type ChatMessage = import('./agent').ChatMessage;

/** Fields a profile starts with; `id`/`name` are assigned per profile. */
const PROFILE_DEFAULTS: Omit<AgentProfile, 'id' | 'name'> = {
	protocol: 'openai',
	providerId: 'deepseek',
	baseUrl: 'https://api.deepseek.com/v1',
	apiKey: '',
	proxyUrl: '',
	model: 'deepseek-v4.1-flash',
	temperature: 0.7,
	maxTokens: 8192,
	maxIterations: 12,
	autoContext: true,
	autoApprove: false,
	systemPrompt: '',
	searchMode: 'off',
	searchApiKey: '',
	searchMaxResults: 5,
	searchDepth: 'basic'
};

function newProfileId(): string {
	return 'agent-' + newSessionId();
}

export function makeProfile(name: string, presetId?: string): AgentProfile {
	const preset = presetId ? PROVIDERS.find(p => p.id === presetId) : undefined;
	const profile: AgentProfile = { id: newProfileId(), name, ...PROFILE_DEFAULTS };
	if (preset) applyProviderPreset(profile, preset.id);
	return profile;
}

/**
 * Point a profile at a curated provider: protocol, base URL and (when the
 * preset lists any) the first model.
 */
export function applyProviderPreset(profile: AgentProfile, providerId: string): void {
	const preset = PROVIDERS.find(p => p.id === providerId);
	if (!preset) return;
	// `providerId` is what the settings dropdown shows, what native web search is
	// resolved from and what history.jsonl records — an agent created from a
	// template used to keep the default provider id, so every preset looked like
	// DeepSeek there.
	profile.providerId = preset.id;
	profile.protocol = preset.protocol ?? 'openai';
	profile.baseUrl = preset.baseUrl;
	// A catalog provider (Magpie) has no fixed model list. Keep an id that looks
	// like one of its own (`provider/model`, or a `group/…` routing group) so
	// switching away and back does not lose the user's pick, and drop a vendor id
	// such as `deepseek-chat` that the gateway does not serve.
	if (preset.catalog) {
		if (!profile.model.includes('/')) profile.model = '';
	} else if (preset.models.length) profile.model = preset.models[0];
	// A gateway key is not a credential for a real vendor: leaving
	// `magpie-ai-vault-agent` in place after switching to DeepSeek would look like
	// a filled-in key and then fail with an authentication error.
	if (preset.defaultApiKey) profile.apiKey = preset.defaultApiKey;
	else if (profile.apiKey === MAGPIE_KEY) profile.apiKey = '';
}

/**
 * Repair profiles saved by versions that applied a preset without storing its
 * id: the protocol, base URL and model came from the preset while `providerId`
 * stayed at the default, so the settings dropdown claimed DeepSeek for an
 * Anthropic Coding Plan agent and provider-native web search was resolved
 * against the wrong vendor.
 *
 * Only profiles whose claimed provider has its own fixed base URL, but point
 * somewhere else, are touched — and only when the address they use is a curated
 * preset's address. A hand-written custom endpoint never matches, so user
 * configuration is not rewritten.
 */
export function reconcileProviderIds(profiles: AgentProfile[]): boolean {
	const norm = (url: string) => (url || '').trim().replace(/\/+$/, '');
	let changed = false;
	for (const profile of profiles) {
		const claimed = PROVIDERS.find(p => p.id === profile.providerId);
		if (!claimed?.baseUrl || norm(claimed.baseUrl) === norm(profile.baseUrl)) continue;
		const match = PROVIDERS.find(p => p.baseUrl && norm(p.baseUrl) === norm(profile.baseUrl));
		if (!match) continue;
		profile.providerId = match.id;
		changed = true;
	}
	return changed;
}

function defaultSettings(): VASettings {
	const profile = makeProfile('默认 Agent');
	return { lang: 'zh', profiles: [profile], activeProfileId: profile.id, history: [], sessionId: '', memoryNotes: true };
}

export default class VaultAgentPlugin extends Plugin {
	settings: VASettings = defaultSettings();
	private recorder: HistoryRecorder | null = null;
	private settingTab: VASettingTab | null = null;
	/** Set once settings have been read successfully; guards against clobbering data.json. */
	private loaded = false;
	/** The memory-note failure notice is shown once per session, not per turn. */
	private memoryWarned = false;

	/** The agent profile currently in use. */
	get profile(): AgentProfile {
		const s = this.settings;
		return s.profiles.find(p => p.id === s.activeProfileId) ?? s.profiles[0];
	}

	get lang(): Lang {
		return this.settings.lang;
	}

	async onload(): Promise<void> {
		await this.loadSettings();
		this.registerView(VIEW_TYPE_AGENT, (leaf: WorkspaceLeaf) => new AgentView(leaf, this));
		this.addRibbonIcon('bot-message-square', t(this.settings.lang, 'viewName'), () => void this.revealAgent());
		this.addCommand({ id: 'open-agent', name: '打开智能体 / open agent', callback: () => void this.revealAgent() });
		this.addCommand({ id: 'switch-agent', name: '切换智能体 / switch agent', callback: () => this.openAgentSwitcher() });
		this.addCommand({ id: 'open-memory', name: '打开记忆文件 / open memory note', callback: () => void this.openMemoryNote() });
		this.addCommand({ id: 'review-memory', name: '复习今日记忆 / review due memory', callback: () => void this.openMemoryReview() });
		this.settingTab = new VASettingTab(this.app, this);
		this.addSettingTab(this.settingTab);
		this.app.workspace.onLayoutReady(() => this.notifyDueMemory());
	}

	onunload(): void {
		// Obsidian detaches registered views automatically.
	}

	/** Open (or reveal) the agent view; safe to call repeatedly. */
	async revealAgent(): Promise<void> {
		const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_AGENT);
		if (existing.length) {
			await this.app.workspace.revealLeaf(existing[0]);
			return;
		}
		const leaf = this.app.workspace.getRightLeaf(false) ?? this.app.workspace.getLeaf(true);
		await leaf.setViewState({ type: VIEW_TYPE_AGENT, active: true });
		await this.app.workspace.revealLeaf(leaf);
	}

	openSettings(): void {
		const setting = (this.app as unknown as { setting: { open(): void; openTabById(id: string): void } }).setting;
		setting.open();
		setting.openTabById(this.manifest.id);
	}

	/** Open `CN AI Agent/记忆.md`, creating it when it does not exist yet. */
	async openMemoryNote(): Promise<void> {
		if (!this.app.vault.getAbstractFileByPath(MEMORY_FILE)) {
			await this.writeMemoryFile(await this.readMemoryEntries(), Date.now()).catch(e => this.warnMemoryFailure(e));
		}
		const file = this.app.vault.getAbstractFileByPath(MEMORY_FILE);
		if (file instanceof TFile) await this.app.workspace.getLeaf(false).openFile(file);
	}

	/**
	 * Ask whether the due memories were recalled, then reschedule them: recalled
	 * climbs the ladder, forgotten drops back to the first rung.
	 */
	async openMemoryReview(): Promise<void> {
		const due = dueEntries(await this.readMemoryEntries(), Date.now());
		if (!due.length) {
			new Notice(t(this.settings.lang, 'memoryNothingDue'));
			return;
		}
		const lang = this.settings.lang;
		new ConfirmModal(
			this.app,
			[tf(lang, 'memoryReviewTitle', { n: due.length }), ...due.map(e => '· ' + e.title)],
			{ cancel: t(lang, 'memoryForgotten'), confirm: t(lang, 'memoryRecalled') },
			() => void this.finishMemoryReview(true),
			() => void this.finishMemoryReview(false)
		).open();
	}

	private async finishMemoryReview(recalled: boolean): Promise<void> {
		const { reviewed, remaining } = await this.reviewDueMemory(recalled).catch(e => {
			this.warnMemoryFailure(e);
			return { reviewed: 0, remaining: 0 };
		});
		if (reviewed) new Notice(tf(this.settings.lang, 'memoryReviewed', { n: reviewed, left: remaining }));
	}

	/** On start-up, say once how many memories are due today. */
	private notifyDueMemory(): void {
		if (!this.settings.memoryNotes) return;
		void this.readMemoryEntries().then(entries => {
			const due = dueEntries(entries, Date.now());
			if (due.length) new Notice(tf(this.settings.lang, 'memoryDueToday', { n: due.length }), 8000);
		}).catch(() => undefined);
	}

	currentModelLabel(): string {
		const p = this.profile;
		return p.model || p.baseUrl || 'not configured';
	}

	// ---------------------------------------------------------------- agents

	/** Create a profile (optionally from a provider preset) and make it active. */
	createProfile(name?: string, presetId?: string): AgentProfile {
		const profile = makeProfile(name ?? t(this.settings.lang, 'newAgentName'), presetId);
		this.settings.profiles.push(profile);
		this.settings.activeProfileId = profile.id;
		void this.saveSettings();
		return profile;
	}

	/**
	 * Ask the Magpie gateway which models the user has enabled. Read through
	 * `requestUrl` so a gateway on another machine (Settings → Share on local
	 * network) and a browser without CORS both work.
	 */
	async fetchMagpieModels(baseUrl: string): Promise<MagpieModel[]> {
		const res = await withTimeout(
			requestUrl({
				url: magpieModelsUrl(baseUrl),
				method: 'GET',
				headers: { Authorization: 'Bearer ' + MAGPIE_KEY },
				throw: false
			}),
			10000,
			'magpie models'
		);
		if (res.status >= 400) throw new Error(`HTTP ${res.status}`);
		return parseMagpieModels(JSON.parse(res.text));
	}

	/**
	 * One-click Magpie agent: fills the gateway base URL and key, then adopts a
	 * model from the live catalog. When the gateway is down the agent is still
	 * created (the user may start Magpie later) and the caller reports why the
	 * model list is empty.
	 */
	async createMagpieProfile(): Promise<{ profile: AgentProfile; models: MagpieModel[] | null }> {
		const profile = this.createProfile(t(this.settings.lang, 'magpieAgentName'), 'magpie');
		const models = await this.adoptCatalogModel(profile);
		return { profile, models };
	}

	/**
	 * Point a catalog-driven profile at a model the gateway actually lists, and
	 * return the catalog (`null` when the gateway could not be read). Without this
	 * a profile switched to Magpie would keep the previous vendor's model id, which
	 * the gateway does not serve.
	 */
	async adoptCatalogModel(profile: AgentProfile): Promise<MagpieModel[] | null> {
		try {
			const models = await this.fetchMagpieModels(profile.baseUrl);
			const model = pickDefaultMagpieModel(models, profile.model);
			if (model) profile.model = model;
			await this.saveSettings();
			return models;
		} catch {
			return null;
		}
	}

	/** Copy a profile (keys and all) under a new id, so it can be tweaked separately. */
	duplicateProfile(id: string): AgentProfile | null {
		const src = this.settings.profiles.find(p => p.id === id);
		if (!src) return null;
		const copy: AgentProfile = { ...src, id: newProfileId(), name: src.name + ' copy' };
		this.settings.profiles.push(copy);
		this.settings.activeProfileId = copy.id;
		void this.saveSettings();
		return copy;
	}

	/** Remove a profile; the last one cannot be deleted. */
	deleteProfile(id: string): boolean {
		const s = this.settings;
		if (s.profiles.length <= 1) return false;
		const idx = s.profiles.findIndex(p => p.id === id);
		if (idx < 0) return false;
		s.profiles.splice(idx, 1);
		if (s.activeProfileId === id) s.activeProfileId = s.profiles[0].id;
		void this.saveSettings();
		return true;
	}

	/**
	 * Switch the active agent. The conversation is shared, so history, session id
	 * and the recorder are left untouched: the next turn simply goes to the new
	 * provider. Only the view header (and an open settings tab) needs refreshing.
	 */
	switchProfile(id: string): boolean {
		const s = this.settings;
		if (s.activeProfileId === id || !s.profiles.some(p => p.id === id)) return false;
		s.activeProfileId = id;
		void this.saveSettings();
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_AGENT)) {
			if (leaf.view instanceof AgentView) leaf.view.onProfileSwitched();
		}
		this.notifySettingsChanged();
		return true;
	}

	/** Menu of configured agents, anchored to the click or to the view's switcher button. */
	openAgentSwitcher(evt?: MouseEvent): void {
		const s = this.settings;
		const menu = new Menu();
		for (const p of s.profiles) {
			menu.addItem(item => item
				.setTitle(p.name + (p.model ? ' · ' + p.model : ''))
				.setChecked(p.id === s.activeProfileId)
				.onClick(() => this.switchProfile(p.id)));
		}
		menu.addSeparator();
		menu.addItem(item => item
			.setTitle(t(s.lang, 'openSettings'))
			.setIcon('settings')
			.onClick(() => this.openSettings()));

		if (evt) {
			menu.showAtMouseEvent(evt);
			return;
		}
		const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_AGENT)[0];
		const anchor = leaf?.view instanceof AgentView ? leaf.view.getSwitcherAnchor() : null;
		const rect = anchor?.getBoundingClientRect();
		menu.showAtPosition({ x: rect ? rect.left : 40, y: rect ? rect.bottom + 4 : 80 });
	}

	private notifySettingsChanged(): void {
		this.settingTab?.refresh();
	}

	/** Non-streaming fallback used when direct fetch streaming fails (e.g. CORS). */
	/**
	 * Non-streaming POST through Obsidian's `requestUrl` (bypasses CORS, works on
	 * mobile). It ignores AbortSignal and has no timeout, so cap it here: a stalled
	 * endpoint must surface as an error the chat can report, not as a hung turn.
	 */
	async fallbackPost(url: string, headers: Record<string, string>, body: string, timeoutMs = 120000): Promise<{ status: number; body: string }> {
		const res = await withTimeout(
			requestUrl({ url, method: 'POST', headers, body, throw: false }),
			timeoutMs,
			'request'
		);
		return { status: res.status, body: res.text };
	}

	// -------------------------------------------------------------- settings

	async loadSettings(): Promise<void> {
		this.settings = defaultSettings();
		let migrated = false;
		try {
			const data = (await this.loadData()) as (Partial<VASettings> & Partial<AgentProfile>) | null;
			if (data && Array.isArray(data.profiles) && data.profiles.length) {
				// Already in the multi-agent shape; fill in anything a future version adds.
				const profiles = data.profiles.map(p => ({ ...PROFILE_DEFAULTS, ...p })) as AgentProfile[];
				const active = profiles.some(p => p.id === data.activeProfileId) ? (data.activeProfileId as string) : profiles[0].id;
				if (reconcileProviderIds(profiles)) migrated = true;
				this.settings = {
					lang: data.lang ?? 'zh',
					profiles,
					activeProfileId: active,
					history: Array.isArray(data.history) ? data.history : [],
					sessionId: data.sessionId ?? '',
					memoryNotes: data.memoryNotes ?? true
				};
			} else if (data) {
				// Legacy single-provider layout: everything lived at the top level. Fold it
				// into one profile so existing users keep their key, model and transcript.
				const lang: Lang = data.lang ?? 'zh';
				const profile: AgentProfile = {
					id: newProfileId(),
					name: t(lang, 'defaultAgentName'),
					protocol: PROVIDERS.find(p => p.id === data.providerId)?.protocol ?? 'openai',
					providerId: data.providerId ?? PROFILE_DEFAULTS.providerId,
					baseUrl: data.baseUrl ?? PROFILE_DEFAULTS.baseUrl,
					apiKey: data.apiKey ?? '',
					proxyUrl: data.proxyUrl ?? '',
					model: data.model ?? PROFILE_DEFAULTS.model,
					temperature: data.temperature ?? PROFILE_DEFAULTS.temperature,
					maxTokens: data.maxTokens ?? PROFILE_DEFAULTS.maxTokens,
					maxIterations: data.maxIterations ?? PROFILE_DEFAULTS.maxIterations,
					autoContext: data.autoContext ?? PROFILE_DEFAULTS.autoContext,
					autoApprove: data.autoApprove ?? PROFILE_DEFAULTS.autoApprove,
					systemPrompt: data.systemPrompt ?? '',
					searchMode: data.searchMode ?? PROFILE_DEFAULTS.searchMode,
					searchApiKey: data.searchApiKey ?? '',
					searchMaxResults: data.searchMaxResults ?? PROFILE_DEFAULTS.searchMaxResults,
					searchDepth: data.searchDepth ?? PROFILE_DEFAULTS.searchDepth
				};
				this.settings = {
					lang,
					profiles: [profile],
					activeProfileId: profile.id,
					history: Array.isArray(data.history) ? data.history : [],
					sessionId: data.sessionId ?? '',
					memoryNotes: data.memoryNotes ?? true
				};
				migrated = true;
			}
			this.loaded = true;
		} catch (e: unknown) {
			// Never let a malformed data.json stop the plugin from loading — but do not
			// persist either, so a bad read cannot overwrite the user's real settings.
			console.error('[vault-agent] failed to load settings; keeping defaults without saving', e);
			return;
		}
		if (migrated) await this.saveSettings();
	}

	async saveSettings(): Promise<void> {
		if (!this.loaded) return;
		await this.saveData(this.settings);
	}

	// --------------------------------------------------------------- history

	loadHistory(): ChatMessage[] {
		const h = this.settings.history;
		return Array.isArray(h) ? h.slice(-40) : [];
	}

	async saveHistory(messages: ChatMessage[]): Promise<void> {
		this.settings.history = messages.filter(m => m.role !== 'system').slice(-40);
		await this.saveData(this.settings);
	}

	/** `history.jsonl` sits next to `data.json`, inside the plugin folder. */
	private historyPath(): string {
		const dir = this.manifest.dir ?? `.obsidian/plugins/${this.manifest.id}`;
		return normalizePath(`${dir}/history.jsonl`);
	}

	/**
	 * Durable transcript used by `tools/history_db.py`. Unlike `saveHistory`
	 * (last 40 messages, overwritten each turn) this is append-only and keeps
	 * timestamps, session ids and tool calls.
	 */
	get history(): HistoryRecorder {
		if (!this.recorder) {
			this.recorder = this.newRecorder(this.settings.sessionId || this.startSession());
		}
		return this.recorder;
	}

	/** Rotate the session id so a new chat is a separate session in the database. */
	startSession(): string {
		const id = newSessionId();
		this.settings.sessionId = id;
		this.recorder = null;
		void this.saveSettings();
		return id;
	}

	/**
	 * Continue an existing session picked in the history panel: new events append
	 * to it, with seq/turn picking up where its transcript left off.
	 */
	resumeSession(sessionId: string, cursor: SessionCursor): void {
		this.settings.sessionId = sessionId;
		this.recorder = this.newRecorder(sessionId, cursor);
		void this.saveSettings();
	}

	/**
	 * Fold the current session into the single memory note.
	 *
	 * Called at the end of every turn: the note must be current even if Obsidian
	 * is quit abruptly, and rewriting one file is cheap and idempotent. Existing
	 * entries are preserved — including their review schedule — so this only ever
	 * adds or refreshes the entry for the active session.
	 */
	async saveMemoryNote(): Promise<void> {
		if (!this.settings.memoryNotes) return;
		const session = this.settings.sessionId;
		if (!session) return;
		try {
			const events = parseHistory(await this.readHistoryText()).filter(e => e.session === session);
			if (!events.some(e => e.type === 'user' || e.type === 'assistant')) return;
			const now = Date.now();
			const entries = mergeSession(await this.readMemoryEntries(), events, now);
			await this.writeMemoryFile(entries, now);
		} catch (e: unknown) {
			this.warnMemoryFailure(e);
		}
	}

	/** Every memory entry currently stored in the note. */
	async readMemoryEntries(): Promise<MemoryEntry[]> {
		const file = this.app.vault.getAbstractFileByPath(MEMORY_FILE);
		if (!(file instanceof TFile)) return [];
		return parseMemoryFile(await this.app.vault.cachedRead(file));
	}

	/**
	 * Review the memory that is due now. Returns how many entries were handled,
	 * so the caller can tell the user what happened.
	 */
	async reviewDueMemory(recalled: boolean): Promise<{ reviewed: number; remaining: number }> {
		const now = Date.now();
		const entries = await this.readMemoryEntries();
		const due = dueEntries(entries, now);
		if (!due.length) return { reviewed: 0, remaining: 0 };
		const ids = new Set(due.map(e => e.session));
		const next = entries.map(e => {
			if (!ids.has(e.session)) return e;
			return recalled ? markReviewed(e, now) : markForgotten(e, now);
		});
		await this.writeMemoryFile(next, now);
		return { reviewed: due.length, remaining: dueEntries(next, now).length };
	}

	/** Rewrite the note from `entries`; creates the folder and file when missing. */
	private async writeMemoryFile(entries: MemoryEntry[], now: number): Promise<void> {
		await this.ensureFolder(MEMORY_FOLDER);
		const text = renderMemoryFile(entries, now);
		const existing = this.app.vault.getAbstractFileByPath(MEMORY_FILE);
		if (existing instanceof TFile) await this.app.vault.modify(existing, text);
		else await this.app.vault.create(MEMORY_FILE, text);
	}

	/** A memory note is a convenience: report the first failure, never fail a turn. */
	private warnMemoryFailure(e: unknown): void {
		if (this.memoryWarned) return;
		this.memoryWarned = true;
		console.error('[vault-agent] could not write the memory note', e);
		new Notice(t(this.settings.lang, 'memoryFailed'));
	}

	/** Create `CN AI Agent/` (and any parent) once; a no-op when it exists. */
	private async ensureFolder(path: string): Promise<void> {
		const existing = this.app.vault.getAbstractFileByPath(path);
		if (existing) return;
		await this.app.vault.createFolder(path).catch(() => undefined);
	}

	/** Raw `history.jsonl` text; empty string when nothing has been recorded yet. */
	async readHistoryText(): Promise<string> {
		try {
			return await this.app.vault.adapter.read(this.historyPath());
		} catch {
			return '';
		}
	}

	private newRecorder(session: string, cursor: SessionCursor = { seq: 0, turn: 0 }): HistoryRecorder {
		return new HistoryRecorder(this.app.vault.adapter, this.historyPath(), session, () => this.historyMeta(), cursor);
	}

	private historyMeta(): HistoryMeta {
		const p = this.profile;
		return {
			vault: this.app.vault.getName(),
			provider: p.providerId,
			model: p.model,
			agent: p.name
		};
	}
}

/** Native Obsidian confirmation dialog — window.confirm() is rejected by the plugin review bot. */
class ConfirmModal extends Modal {
	constructor(
		app: App,
		private lines: string[],
		private labels: { cancel: string; confirm: string },
		private onConfirm: () => void,
		private onCancel?: () => void
	) {
		super(app);
	}

	onOpen(): void {
		for (const line of this.lines) this.contentEl.createEl('p', { text: line });
		const buttons = this.contentEl.createDiv({ cls: 'va-confirm-buttons' });
		buttons.createEl('button', { text: this.labels.cancel })
			.addEventListener('click', () => {
				this.close();
				this.onCancel?.();
			});
		buttons.createEl('button', { cls: 'mod-cta', text: this.labels.confirm })
			.addEventListener('click', () => {
				this.close();
				this.onConfirm();
			});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

class VASettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: VaultAgentPlugin) {
		super(app, plugin);
	}

	private st(key: Parameters<typeof t>[1]): string { return t(this.plugin.settings.lang, key); }

	private get profile(): AgentProfile { return this.plugin.profile; }

	/** Re-render: declarative tabs (1.13+) refresh via update(), older ones via display(). */
	private refreshTab(): void {
		if (requireApiVersion('1.13.0')) {
			this.update();
			return;
		}
		// PluginSettingTab.display() carries a @deprecated tag, yet Obsidian's own
		// JSDoc describes it as the fallback for plugins that must keep working on
		// versions older than 1.13.0. Call it through a signature without the tag.
		(this as unknown as { display(): void }).display();
	}

	/** Called by the plugin when the active agent changes (e.g. from the view header). */
	refresh(): void {
		if (this.containerEl.isConnected) this.refreshTab();
	}

	// ---------------------------------------------------- agent manager UI

	/** Roster of agents: rename inline, switch by clicking, duplicate or delete. */
	private renderAgentManager(el: HTMLElement): void {
		const s = this.plugin.settings;
		el.empty();

		for (const p of s.profiles) {
			const active = p.id === s.activeProfileId;
			const row = el.createDiv({ cls: 'va-agent-row' + (active ? ' va-agent-row-active' : '') });

			const nameInput = row.createEl('input', { cls: 'va-agent-name', attr: { type: 'text', 'aria-label': this.st('agentName') } });
			nameInput.value = p.name;
			nameInput.addEventListener('click', e => e.stopPropagation());
			nameInput.addEventListener('change', () => {
				p.name = nameInput.value.trim() || this.st('newAgentName');
				nameInput.value = p.name;
				void this.plugin.saveSettings().then(() => this.refreshTab());
			});

			row.createSpan({ cls: 'va-agent-tag', text: p.protocol === 'anthropic' ? 'Anthropic' : 'OpenAI' });
			if (active) row.createSpan({ cls: 'va-agent-badge', text: this.st('agentActiveBadge') });

			const actions = row.createDiv({ cls: 'va-agent-actions' });
			const dup = actions.createEl('button', { cls: 'va-icon-btn', attr: { 'aria-label': this.st('duplicateAgent'), title: this.st('duplicateAgent') } });
			setIcon(dup, 'copy');
			dup.addEventListener('click', e => { e.stopPropagation(); this.plugin.duplicateProfile(p.id); this.refreshTab(); });
			const del = actions.createEl('button', { cls: 'va-icon-btn', attr: { 'aria-label': this.st('deleteAgent'), title: this.st('deleteAgent') } });
			setIcon(del, 'trash-2');
			del.addEventListener('click', e => { e.stopPropagation(); this.deleteAgent(p.id); });

			if (!active) {
				row.addEventListener('click', () => { this.plugin.switchProfile(p.id); this.refreshTab(); });
			}
		}

		const buttons = el.createDiv({ cls: 'va-agent-buttons' });
		const add = buttons.createEl('button', { cls: 'mod-cta', text: '＋ ' + this.st('newAgent') });
		add.addEventListener('click', () => { this.plugin.createProfile(); this.refreshTab(); });
		const magpie = buttons.createEl('button', { text: '🪄 ' + this.st('magpieTemplate') });
		magpie.addEventListener('click', () => {
			magpie.disabled = true;
			void this.plugin.createMagpieProfile().then(({ profile, models }) => {
				if (models === null) new Notice(this.magpieUnreachable(profile.baseUrl));
				else if (!models.length) new Notice(this.st('magpieModelsEmpty'));
				else new Notice(tf(this.plugin.lang, 'magpieModelPicked', { model: profile.model }));
				this.refreshTab();
			});
		});
		const tpl = buttons.createEl('button', { text: '⚡ ' + this.st('codingPlanTemplate') });
		tpl.addEventListener('click', () => { this.plugin.createProfile(this.st('codingAgentName'), 'ark-coding'); this.refreshTab(); });
	}

	private magpieUnreachable(baseUrl: string): string {
		return tf(this.plugin.lang, 'magpieUnreachable', { url: magpieModelsUrl(baseUrl) });
	}

	private deleteAgent(id: string): void {
		if (this.plugin.settings.profiles.length <= 1) {
			new Notice(this.st('deleteLastAgent'));
			return;
		}
		const p = this.plugin.settings.profiles.find(x => x.id === id);
		if (!p) return;
		new ConfirmModal(
			this.app,
			[this.st('confirmDeleteAgent'), p.name],
			{ cancel: this.st('cancel'), confirm: this.st('delete') },
			() => {
				this.plugin.deleteProfile(id);
				this.refreshTab();
			}
		).open();
	}

	/**
	 * Declarative settings (Obsidian 1.13+): makes settings searchable.
	 * display() below still renders for older Obsidian versions.
	 */
	getSettingDefinitions(): SettingDefinitionItem[] {
		const s = this.profile;
		const providerHint = PROVIDERS.find(p => p.id === s.providerId)?.hint;
		return [
			{
				name: this.st('language'),
				desc: this.st('languageDesc'),
				control: { type: 'dropdown', key: 'lang', options: { zh: '中文', en: 'English' } }
			},
			{
				name: this.st('agentsHeading'),
				desc: this.st('agentsHeadingDesc'),
				searchable: false,
				render: (setting) => {
					setting.settingEl.addClass('va-agents-setting');
					const el = setting.controlEl.createDiv({ cls: 'va-agents' });
					this.renderAgentManager(el);
					return () => setting.controlEl.empty();
				}
			},
			{
				name: '⚙️ ' + this.st('editingAgent') + ' · ' + this.profile.name,
				searchable: false,
				render: (setting) => {
					setting.settingEl.addClass('va-hint');
					return () => setting.settingEl.removeClass('va-hint');
				}
			},
			{
				name: this.st('provider'),
				desc: this.st('providerDesc') + (providerHint ? '\nℹ️ ' + providerHint : ''),
				control: { type: 'dropdown', key: 'providerId', options: Object.fromEntries(PROVIDERS.map(p => [p.id, p.label])) }
			},
			{
				name: this.st('baseUrl'),
				control: { type: 'text', key: 'baseUrl', placeholder: 'https://api.example.com/v1' }
			},
			{
				name: this.st('apiKey'),
				desc: this.st('apiKeyDesc'),
				control: { type: 'text', key: 'apiKey', placeholder: 'sk-…' }
			},
			{
				name: this.st('proxy'),
				desc: this.st('proxyDesc'),
				control: { type: 'text', key: 'proxyUrl', placeholder: 'http://127.0.0.1:9000' }
			},
			{
				name: this.st('model'),
				desc: this.st('modelDesc'),
				control: { type: 'text', key: 'model' }
			},
			{
				// The Magpie row is a live catalog, not a fixed list of presets.
				name: this.preset?.catalog ? this.st('magpieModels') : this.st('modelPreset'),
				searchable: false,
				visible: () => this.hasModelChips(),
				render: (setting) => {
					setting.settingEl.addClass('va-model-chips');
					const el = setting.controlEl.createDiv({ cls: 'va-model-chip-row' });
					this.renderModelChips(el);
					return () => setting.controlEl.empty();
				}
			},
			{
				name: this.st('temperature'),
				control: { type: 'slider', key: 'temperature', min: 0, max: 2, step: 0.1 }
			},
			{
				name: this.st('maxTokens'),
				control: {
					type: 'number',
					key: 'maxTokens',
					step: 1,
					validate: (v) => (typeof v === 'number' && v > 0 ? undefined : 'must be a positive number')
				}
			},
			{
				name: this.st('maxIterations'),
				control: {
					type: 'number',
					key: 'maxIterations',
					step: 1,
					validate: (v) => (typeof v === 'number' && v > 0 ? undefined : 'must be a positive number')
				}
			},
			{
				name: this.st('autoContext'),
				desc: this.st('autoContextDesc'),
				control: { type: 'toggle', key: 'autoContext' }
			},
			{
				name: this.st('autoApprove'),
				desc: this.st('autoApproveDesc'),
				control: { type: 'toggle', key: 'autoApprove' }
			},
			{
				name: this.st('memoryNotes'),
				desc: this.st('memoryNotesDesc'),
				control: { type: 'toggle', key: 'memoryNotes' }
			},
			{
				name: this.st('systemPrompt'),
				desc: this.st('systemPromptDesc'),
				control: { type: 'textarea', key: 'systemPrompt', rows: 4 }
			},
			...this.searchSettingDefinitions()
		];
	}

	/** Web-search settings; shared by the declarative and the legacy settings UI. */
	private searchSettingDefinitions(): SettingDefinitionItem[] {
		const usesTool = () => ['auto', 'tool'].includes(this.profile.searchMode);
		const nativeUnsupported = () => {
			const s = this.profile;
			return s.searchMode === 'native' && !nativeSearchFor(s.providerId, s.searchMaxResults);
		};
		return [
			{
				name: this.st('searchMode'),
				desc: this.st('searchModeDesc'),
				control: {
					type: 'dropdown',
					key: 'searchMode',
					options: {
						off: this.st('searchModeOff'),
						auto: this.st('searchModeAuto'),
						native: this.st('searchModeNative'),
						tool: this.st('searchModeTool')
					}
				}
			},
			{
				name: this.st('searchApiKey'),
				desc: this.st('searchApiKeyDesc'),
				visible: usesTool,
				control: { type: 'text', key: 'searchApiKey' }
			},
			{
				name: this.st('searchMaxResults'),
				visible: usesTool,
				control: {
					type: 'number',
					key: 'searchMaxResults',
					step: 1,
					validate: (v) => (typeof v === 'number' && v >= 1 && v <= 20 ? undefined : 'must be 1-20')
				}
			},
			{
				name: this.st('searchDepth'),
				visible: usesTool,
				control: {
					type: 'dropdown',
					key: 'searchDepth',
					options: { basic: this.st('searchDepthBasic'), advanced: this.st('searchDepthAdvanced') }
				}
			},
			{
				// Description-only row: no control, just the explanation.
				name: this.st('searchUnsupported'),
				searchable: false,
				visible: nativeUnsupported,
				render: (setting) => {
					setting.settingEl.addClass('va-hint');
					return () => setting.settingEl.removeClass('va-hint');
				}
			}
		];
	}

	override getControlValue(key: string): unknown {
		if (key === 'lang' || key === 'memoryNotes') return (this.plugin.settings as unknown as Record<string, unknown>)[key];
		return (this.profile as unknown as Record<string, unknown>)[key];
	}

	override async setControlValue(key: string, value: unknown): Promise<void> {
		if (key === 'memoryNotes') {
			this.plugin.settings.memoryNotes = value === true;
			await this.plugin.saveSettings();
			return;
		}
		if (key === 'lang') {
			this.plugin.settings.lang = value as Lang;
			await this.plugin.saveSettings();
			// Every label on the tab is localised; re-render to translate them.
			window.setTimeout(() => this.refreshTab(), 0);
			return;
		}
		const s = this.profile;
		(s as unknown as Record<string, unknown>)[key] = value;
		await this.plugin.saveSettings();
		if (key === 'baseUrl' && this.preset?.catalog) {
			// Typing a port must not fire a request per keystroke, and re-rendering
			// the tab would drop focus, so only the chip row is refreshed.
			window.clearTimeout(this.baseUrlTimer);
			this.baseUrlTimer = window.setTimeout(() => {
				const el = this.liveChipEl;
				if (el?.isConnected) this.renderModelChips(el);
			}, 700);
		}
		if (key === 'providerId' && typeof value === 'string') {
			// Switching provider rewrites the protocol, base URL and default model;
			// re-render so those rows show the new values (deferred so we do not
			// tear down the dropdown mid-change-event).
			applyProviderPreset(s, value);
			await this.plugin.saveSettings();
			if (this.preset?.catalog) void this.plugin.adoptCatalogModel(s).then(() => this.refreshTab());
			else window.setTimeout(() => this.refreshTab(), 0);
		}
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		const s = this.profile;

		new Setting(containerEl).setName(this.st('settingsHeading')).setHeading();

		new Setting(containerEl)
			.setName(this.st('language'))
			.setDesc(this.st('languageDesc'))
			.addDropdown(d => d
				.addOption('zh', '中文')
				.addOption('en', 'English')
				.setValue(this.plugin.settings.lang)
				.onChange(async v => {
					this.plugin.settings.lang = v as Lang;
					await this.plugin.saveSettings();
					this.refreshTab();
				}));

		const agentsSetting = new Setting(containerEl)
			.setName(this.st('agentsHeading'))
			.setDesc(this.st('agentsHeadingDesc'))
			.setClass('va-agents-setting');
		this.renderAgentManager(agentsSetting.controlEl.createDiv({ cls: 'va-agents' }));

		const agentHead = new Setting(containerEl).setClass('va-hint');
		agentHead.nameEl.setText('⚙️ ' + this.st('editingAgent') + ' · ' + s.name);

		const providerNames = PROVIDERS.map(p => [p.id, p.label] as [string, string]);
		new Setting(containerEl)
			.setName(this.st('provider'))
			.setDesc(this.st('providerDesc'))
			.addDropdown(d => {
				for (const [id, label] of providerNames) d.addOption(id, label);
				d.setValue(s.providerId).onChange(async v => {
					applyProviderPreset(s, v);
					await this.plugin.saveSettings();
					if (PROVIDERS.find(p => p.id === v)?.catalog) await this.plugin.adoptCatalogModel(s);
					this.refreshTab();
				});
			});

		new Setting(containerEl).setName(this.st('baseUrl')).addText(tx => tx
			.setValue(s.baseUrl)
			.onChange(async v => { s.baseUrl = v.trim(); await this.plugin.saveSettings(); }));

		new Setting(containerEl)
			.setName(this.st('apiKey'))
			.setDesc(this.st('apiKeyDesc'))
			.addText(tx => {
				tx.inputEl.type = 'password';
				tx.setValue(s.apiKey)
					.onChange(async v => { s.apiKey = v.trim(); await this.plugin.saveSettings(); });
			});

		new Setting(containerEl)
			.setName(this.st('proxy'))
			.setDesc(this.st('proxyDesc'))
			.addText(tx => tx.setValue(s.proxyUrl)
				.onChange(async v => { s.proxyUrl = v.trim(); await this.plugin.saveSettings(); }));

		new Setting(containerEl)
			.setName(this.st('model'))
			.setDesc(this.st('modelDesc'))
			.addText(tx => tx
				.setValue(s.model)
				.onChange(async v => { s.model = v.trim(); await this.plugin.saveSettings(); }));

		this.renderProviderExtras(containerEl);

		new Setting(containerEl).setName(this.st('temperature'))
			.addSlider(sl => sl.setLimits(0, 2, 0.1).setValue(s.temperature)
				.onChange(async v => { s.temperature = v; await this.plugin.saveSettings(); }));

		new Setting(containerEl).setName(this.st('maxTokens'))
			.addText(tx => tx.setValue(String(s.maxTokens)).onChange(async v => {
				const n = parseInt(v, 10);
				if (n > 0) { s.maxTokens = n; await this.plugin.saveSettings(); }
			}));

		new Setting(containerEl).setName(this.st('maxIterations'))
			.addText(tx => tx.setValue(String(s.maxIterations)).onChange(async v => {
				const n = parseInt(v, 10);
				if (n > 0) { s.maxIterations = n; await this.plugin.saveSettings(); }
			}));

		new Setting(containerEl)
			.setName(this.st('autoContext'))
			.setDesc(this.st('autoContextDesc'))
			.addToggle(tg => tg.setValue(s.autoContext).onChange(async v => { s.autoContext = v; await this.plugin.saveSettings(); }));

		new Setting(containerEl)
			.setName(this.st('autoApprove'))
			.setDesc(this.st('autoApproveDesc'))
			.addToggle(tg => tg.setValue(s.autoApprove).onChange(async v => { s.autoApprove = v; await this.plugin.saveSettings(); }));

		new Setting(containerEl)
			.setName(this.st('memoryNotes'))
			.setDesc(this.st('memoryNotesDesc'))
			.addToggle(tg => tg
				.setValue(this.plugin.settings.memoryNotes)
				.onChange(async v => { this.plugin.settings.memoryNotes = v; await this.plugin.saveSettings(); }));

		new Setting(containerEl)
			.setName(this.st('systemPrompt'))
			.setDesc(this.st('systemPromptDesc'))
			.addTextArea(ta => ta.setValue(s.systemPrompt).onChange(async v => { s.systemPrompt = v; await this.plugin.saveSettings(); }));

		const searchEl = containerEl.createDiv({ cls: 'va-search-settings' });
		this.renderSearchSettings(searchEl);
	}

	/**
	 * Web-search settings for the legacy (pre-1.13) settings UI. Re-rendered in
	 * place when the mode or provider changes, because several rows are conditional.
	 */
	private renderSearchSettings(el: HTMLElement): void {
		const s = this.profile;
		el.empty();

		const usesTool = () => ['auto', 'tool'].includes(s.searchMode);
		const rerender = () => this.renderSearchSettings(el);

		new Setting(el)
			.setName(this.st('searchMode'))
			.setDesc(this.st('searchModeDesc'))
			.addDropdown(d => d
				.addOption('off', this.st('searchModeOff'))
				.addOption('auto', this.st('searchModeAuto'))
				.addOption('native', this.st('searchModeNative'))
				.addOption('tool', this.st('searchModeTool'))
				.setValue(s.searchMode)
				.onChange(async v => {
					s.searchMode = v as SearchMode;
					await this.plugin.saveSettings();
					rerender();
				}));

		if (s.searchMode === 'native' && !nativeSearchFor(s.providerId, s.searchMaxResults)) {
			const hint = new Setting(el).setClass('va-hint');
			hint.nameEl.setText('⚠️ ' + this.st('searchUnsupported'));
		}

		if (!usesTool()) return;

		new Setting(el)
			.setName(this.st('searchApiKey'))
			.setDesc(this.st('searchApiKeyDesc'))
			.addText(tx => {
				tx.inputEl.type = 'password';
				tx.setValue(s.searchApiKey)
					.onChange(async v => { s.searchApiKey = v.trim(); await this.plugin.saveSettings(); });
			});

		new Setting(el)
			.setName(this.st('searchMaxResults'))
			.addText(tx => tx.setValue(String(s.searchMaxResults)).onChange(async v => {
				const n = parseInt(v, 10);
				if (n >= 1 && n <= 20) { s.searchMaxResults = n; await this.plugin.saveSettings(); }
			}));

		new Setting(el)
			.setName(this.st('searchDepth'))
			.addDropdown(d => d
				.addOption('basic', this.st('searchDepthBasic'))
				.addOption('advanced', this.st('searchDepthAdvanced'))
				.setValue(s.searchDepth)
				.onChange(async v => { s.searchDepth = v as SearchDepth; await this.plugin.saveSettings(); }));
	}

	/** Provider hint + model chips; re-rendered in place when the provider changes. */
	private renderProviderExtras(containerEl: HTMLElement): void {
		const preset = PROVIDERS.find(p => p.id === this.profile.providerId);

		if (preset?.hint) {
			const hint = new Setting(containerEl).setClass('va-hint');
			hint.nameEl.setText('ℹ️ ' + preset.hint);
		}

		if (!this.hasModelChips()) return;
		const title = this.preset?.catalog ? this.st('magpieModels') : this.st('modelPreset');
		const row = new Setting(containerEl).setName(title).setClass('va-model-chips');
		this.renderModelChips(row.controlEl.createDiv({ cls: 'va-model-chip-row' }));
	}

	// ------------------------------------------------------ model chips

	/**
	 * Magpie's catalog as last read, keyed by the base URL it came from: another
	 * agent (or an edited base URL) means another gateway, so a stale list must
	 * never be shown as if it belonged to the current one.
	 */
	private magpieCache: { url: string; models: MagpieModel[] } | null = null;
	private magpieLoading = false;
	/** Base URL whose read failed, so rendering does not retry on every paint. */
	private magpieFailedUrl = '';
	/**
	 * The chip row currently in the settings tab. A read started by one render can
	 * finish after Obsidian rebuilt the row (changing a setting re-renders the tab),
	 * so the result is painted into whichever row is live instead of the one that
	 * asked for it.
	 */
	private liveChipEl: HTMLElement | null = null;
	private baseUrlTimer = 0;

	private get preset(): ProviderPreset | undefined {
		return PROVIDERS.find(p => p.id === this.profile.providerId);
	}

	private hasModelChips(): boolean {
		const preset = this.preset;
		return !!preset && (!!preset.catalog || preset.models.length > 0);
	}

	/**
	 * Clickable model chips for the current agent. Curated providers use their
	 * fixed list; Magpie's list is read from the gateway, because the user adds
	 * and removes providers inside Magpie rather than in this plugin.
	 */
	private renderModelChips(el: HTMLElement): void {
		el.empty();
		const profile = this.profile;
		const preset = this.preset;

		if (!preset?.catalog) {
			for (const m of preset?.models ?? []) this.addModelChip(el, m, m);
			return;
		}

		const url = magpieModelsUrl(profile.baseUrl);
		const models = this.magpieCache?.url === url ? this.magpieCache.models : null;
		this.liveChipEl = el;

		const bar = el.createDiv({ cls: 'va-chip-bar' });
		const reload = bar.createEl('button', { text: this.st('magpieModelsRefresh') });
		reload.addEventListener('click', () => {
			this.magpieCache = null;
			this.magpieFailedUrl = '';
			void this.loadMagpieModels(el);
		});
		const status = bar.createSpan({ cls: 'va-chip-status' });
		if (this.magpieLoading) status.setText(this.st('magpieModelsLoading'));
		else if (this.magpieFailedUrl === url) status.setText(this.magpieUnreachable(profile.baseUrl));
		else if (models && !models.length) status.setText(this.st('magpieModelsEmpty'));
		else if (models) status.setText(tf(this.plugin.lang, 'magpieModelsLoaded', { n: models.length }));

		for (const m of models ?? []) {
			this.addModelChip(el, m.id, m.displayName ? `${m.displayName} · ${m.id}` : m.id);
		}

		// Nothing cached for this gateway yet, and no read in flight: go read it.
		if (!models && !this.magpieLoading && this.magpieFailedUrl !== url) void this.loadMagpieModels(el);
	}

	private addModelChip(el: HTMLElement, modelId: string, label: string): void {
		const btn = el.createEl('button', { text: label, attr: { title: modelId } });
		if (modelId === this.profile.model) btn.addClass('va-chip-active');
		btn.addEventListener('click', () => {
			this.profile.model = modelId;
			void this.plugin.saveSettings();
			el.querySelectorAll('button').forEach(b => b.removeClass('va-chip-active'));
			btn.addClass('va-chip-active');
		});
	}

	private async loadMagpieModels(el: HTMLElement): Promise<void> {
		const url = magpieModelsUrl(this.profile.baseUrl);
		this.magpieLoading = true;
		this.renderModelChips(el);
		try {
			const models = await this.plugin.fetchMagpieModels(this.profile.baseUrl);
			this.magpieCache = { url, models };
			this.magpieFailedUrl = '';
		} catch {
			this.magpieCache = null;
			this.magpieFailedUrl = url;
		} finally {
			this.magpieLoading = false;
		}
		const live = this.liveChipEl;
		if (live?.isConnected) this.renderModelChips(live);
	}
}
