import { App, Menu, Modal, Notice, Plugin, PluginSettingTab, Setting, normalizePath, requestUrl, requireApiVersion, setIcon, WorkspaceLeaf, type SettingDefinitionItem } from 'obsidian';
import { AgentView, VIEW_TYPE_AGENT } from './view';
import { HistoryRecorder, newSessionId, type HistoryMeta, type SessionCursor } from './history';
import { nativeSearchFor, withTimeout, type SearchDepth, type SearchMode } from './search';
import { t, Lang } from './i18n';

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
}

/** Curated OpenAI-compatible providers. "同源" rows are the model vendors behind popular Chinese AI tools. */
export const PROVIDERS: ProviderPreset[] = [
	{ id: 'deepseek', label: 'DeepSeek 深度求索', baseUrl: 'https://api.deepseek.com/v1', models: ['deepseek-chat', 'deepseek-reasoner'] },
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
}

type ChatMessage = import('./agent').ChatMessage;

/** Fields a profile starts with; `id`/`name` are assigned per profile. */
const PROFILE_DEFAULTS: Omit<AgentProfile, 'id' | 'name'> = {
	protocol: 'openai',
	providerId: 'deepseek',
	baseUrl: 'https://api.deepseek.com/v1',
	apiKey: '',
	proxyUrl: '',
	model: 'deepseek-chat',
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
	profile.protocol = preset.protocol ?? 'openai';
	profile.baseUrl = preset.baseUrl;
	if (preset.models.length) profile.model = preset.models[0];
}

function defaultSettings(): VASettings {
	const profile = makeProfile('默认 Agent');
	return { lang: 'zh', profiles: [profile], activeProfileId: profile.id, history: [], sessionId: '' };
}

export default class VaultAgentPlugin extends Plugin {
	settings: VASettings = defaultSettings();
	private recorder: HistoryRecorder | null = null;
	private settingTab: VASettingTab | null = null;
	/** Set once settings have been read successfully; guards against clobbering data.json. */
	private loaded = false;

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
		this.settingTab = new VASettingTab(this.app, this);
		this.addSettingTab(this.settingTab);
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
				this.settings = {
					lang: data.lang ?? 'zh',
					profiles,
					activeProfileId: active,
					history: Array.isArray(data.history) ? data.history : [],
					sessionId: data.sessionId ?? ''
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
					sessionId: data.sessionId ?? ''
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
		private onConfirm: () => void
	) {
		super(app);
	}

	onOpen(): void {
		for (const line of this.lines) this.contentEl.createEl('p', { text: line });
		const buttons = this.contentEl.createDiv({ cls: 'va-confirm-buttons' });
		buttons.createEl('button', { text: this.labels.cancel })
			.addEventListener('click', () => this.close());
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
		const tpl = buttons.createEl('button', { text: '⚡ ' + this.st('codingPlanTemplate') });
		tpl.addEventListener('click', () => { this.plugin.createProfile(this.st('codingAgentName'), 'ark-coding'); this.refreshTab(); });
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
				name: this.st('modelPreset'),
				searchable: false,
				visible: () => !!(PROVIDERS.find(p => p.id === this.profile.providerId)?.models.length),
				render: (setting) => {
					const preset = PROVIDERS.find(p => p.id === this.profile.providerId);
					for (const m of preset?.models ?? []) {
						const btn = setting.controlEl.createEl('button', { text: m });
						if (m === this.profile.model) btn.addClass('va-chip-active');
						btn.addEventListener('click', () => {
							this.profile.model = m;
							void this.plugin.saveSettings();
							setting.controlEl.querySelectorAll('button').forEach(b => b.removeClass('va-chip-active'));
							btn.addClass('va-chip-active');
						});
					}
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
		if (key === 'lang') return this.plugin.settings.lang;
		return (this.profile as unknown as Record<string, unknown>)[key];
	}

	override async setControlValue(key: string, value: unknown): Promise<void> {
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
		if (key === 'providerId' && typeof value === 'string') {
			// Switching provider rewrites the protocol, base URL and default model;
			// re-render so those rows show the new values (deferred so we do not
			// tear down the dropdown mid-change-event).
			applyProviderPreset(s, value);
			await this.plugin.saveSettings();
			window.setTimeout(() => this.refreshTab(), 0);
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
					s.providerId = v;
					await this.plugin.saveSettings();
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

	/** Provider hint + model preset chips; re-rendered in place when the provider changes. */
	private renderProviderExtras(containerEl: HTMLElement): void {
		const s = this.profile;
		const preset = PROVIDERS.find(p => p.id === s.providerId);

		if (preset?.hint) {
			const hint = new Setting(containerEl).setClass('va-hint');
			hint.nameEl.setText('ℹ️ ' + preset.hint);
		}

		if (!preset?.models.length) return;
		const presets = new Setting(containerEl).setName(this.st('modelPreset')).setClass('va-model-chips');
		for (const m of preset.models) {
			presets.addButton(b => {
				b.setButtonText(m);
				if (s.model === m) b.buttonEl.addClass('va-chip-active');
				b.onClick(async () => {
					s.model = m;
					await this.plugin.saveSettings();
					presets.controlEl.querySelectorAll('button').forEach(el => el.removeClass('va-chip-active'));
					b.buttonEl.addClass('va-chip-active');
				});
			});
		}
	}
}
