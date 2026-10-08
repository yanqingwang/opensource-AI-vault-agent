/**
 * Anthropic Messages client (POST /v1/messages) with SSE streaming and the same
 * agentic tool-call loop as `agent.ts`.
 *
 * Needed because some China-accessible providers — notably Volcengine Ark's
 * Coding Plan (Doubao-Seed-Code) — speak the Anthropic protocol rather than
 * OpenAI Chat Completions. The public surface mirrors `runAgentLoop` so the view
 * can dispatch on protocol without caring which client is underneath.
 *
 * No Obsidian import: pure conversion + an injected fetch, unit-testable in Node.
 */

import { consumeSse, truncate, type AgentLoopResult, type ChatMessage, type StreamHandlers, type ToolCall, type ToolDef, type ToolExecutor } from './agent';
import type { FetchLike } from './proxyFetch';

export const ANTHROPIC_VERSION = '2023-06-01';

export interface AnthropicConfig {
	/** Base URL without the trailing `/v1/messages`, e.g. `https://ark.cn-beijing.volces.com/api/coding`. */
	baseUrl: string;
	apiKey: string;
	model: string;
	temperature?: number;
	maxTokens?: number;
}

export interface AnthropicLoopOptions extends AnthropicConfig {
	messages: ChatMessage[];
	tools: ToolDef[];
	executor: ToolExecutor;
	maxIterations?: number;
	confirmWrite?: (summary: string) => Promise<boolean>;
	onText?: (delta: string) => void;
	onReasoning?: (delta: string) => void;
	onToolStart?: (call: ToolCall) => void;
	onToolDone?: (call: ToolCall, result: { ok: boolean; content: string }) => void;
	signal?: AbortSignal;
	fetchImpl?: FetchLike;
	fallbackPost?: StreamHandlers['fallbackPost'];
}

export interface AnthropicTurn {
	content: string | null;
	reasoning: string | null;
	toolCalls: ToolCall[];
}

/** One in-flight content block, keyed by its stream index. */
export interface BlockState {
	type: 'text' | 'thinking' | 'tool_use';
	id: string;
	name: string;
	argsJson: string;
}

export interface StreamState {
	turn: AnthropicTurn;
	blocks: Record<number, BlockState>;
	error: string | null;
}

/** Anthropic wants tool_results inside a user message, so blocks are merged per role. */
interface AnthropicMessage {
	role: 'user' | 'assistant';
	content: unknown;
}

/**
 * Convert the canonical OpenAI-shaped transcript into Anthropic's shape: system
 * is lifted out of the message list, assistant tool calls become `tool_use`
 * blocks, and consecutive tool results merge into one user message.
 */
export function toAnthropicMessages(messages: ChatMessage[]): { system: string; messages: AnthropicMessage[] } {
	const systemParts: string[] = [];
	const out: AnthropicMessage[] = [];

	for (const m of messages) {
		if (m.role === 'system') {
			if (m.content) systemParts.push(m.content);
			continue;
		}
		if (m.role === 'user') {
			out.push({ role: 'user', content: m.content ?? '' });
			continue;
		}
		if (m.role === 'assistant') {
			const blocks: unknown[] = [];
			if (m.content) blocks.push({ type: 'text', text: m.content });
			for (const tc of m.tool_calls ?? []) {
				blocks.push({ type: 'tool_use', id: tc.id, name: tc.function.name, input: parseArgs(tc.function.arguments) });
			}
			out.push({ role: 'assistant', content: blocks.length ? blocks : (m.content ?? '') });
			continue;
		}
		// tool result
		const denied = m.content === 'USER_DENIED';
		const block: Record<string, unknown> = {
			type: 'tool_result',
			tool_use_id: m.tool_call_id ?? '',
			content: m.content || '(no output)'
		};
		if (denied) block.is_error = true;
		const last = out[out.length - 1];
		if (last && last.role === 'user' && Array.isArray(last.content)) {
			(last.content as unknown[]).push(block);
		} else {
			out.push({ role: 'user', content: [block] });
		}
	}
	return { system: systemParts.join('\n\n'), messages: out };
}

/** Build the request body for one /v1/messages round-trip. */
export function buildAnthropicBody(cfg: AnthropicConfig, messages: ChatMessage[], tools: ToolDef[], stream: boolean): Record<string, unknown> {
	const { system, messages: msgs } = toAnthropicMessages(messages);
	const body: Record<string, unknown> = {
		model: cfg.model,
		max_tokens: cfg.maxTokens ?? 8192,
		temperature: cfg.temperature ?? 0.7,
		messages: msgs,
		stream
	};
	if (system) body.system = system;
	if (tools.length) {
		body.tools = tools.map(t => ({ name: t.name, description: t.description, input_schema: t.parameters }));
	}
	return body;
}

/** One round-trip against /v1/messages. Streams if possible, falls back to non-streaming. */
export async function anthropicCompletion(cfg: AnthropicConfig, messages: ChatMessage[], tools: ToolDef[], h: StreamHandlers): Promise<AnthropicTurn> {
	const url = cfg.baseUrl.replace(/\/+$/, '') + '/v1/messages';
	const headers: Record<string, string> = {
		'Content-Type': 'application/json',
		'x-api-key': cfg.apiKey,
		'anthropic-version': ANTHROPIC_VERSION
	};
	const state: StreamState = { turn: { content: null, reasoning: null, toolCalls: [] }, blocks: {}, error: null };

	const sendStream = async (): Promise<void> => {
		if (!h.fetchImpl) throw new Error('no streaming fetch implementation provided');
		const res = await h.fetchImpl(url, {
			method: 'POST',
			headers,
			body: JSON.stringify(buildAnthropicBody(cfg, messages, tools, true)),
			signal: h.signal
		});
		if (!res.ok) {
			const errText = await res.text().catch(() => '');
			throw new Error(`HTTP ${res.status}: ${truncate(errText, 500)}`);
		}
		if (!res.body) throw new Error('empty response body');
		await consumeSse(res.body, (data) => applyAnthropicChunk(data, state, h));
		if (state.error) throw new Error(state.error);
	};

	try {
		await sendStream();
	} catch (e: unknown) {
		// Network/CORS/unsupported-stream failures: retry once without streaming.
		if (h.fallbackPost && !(h.signal?.aborted)) {
			// Discard anything the failed stream produced so the fallback cannot
			// duplicate text the user already saw.
			state.turn = { content: null, reasoning: null, toolCalls: [] };
			state.blocks = {};
			state.error = null;
			const out = await h.fallbackPost(url, headers, JSON.stringify(buildAnthropicBody(cfg, messages, tools, false)));
			if (out.status >= 400) throw new Error(`HTTP ${out.status}: ${truncate(out.body, 500)}`);
			applyNonStreamingMessage(out.body || '{}', state, h);
		} else {
			throw e;
		}
	}
	finalizeToolCalls(state);
	return state.turn;
}

/** Handle one SSE `data:` payload from the Messages stream. */
export function applyAnthropicChunk(payload: string, state: StreamState, h: StreamHandlers): void {
	if (!payload) return;
	let parsed: unknown;
	try {
		parsed = JSON.parse(payload);
	} catch {
		return;
	}
	const data = asRecord(parsed);
	if (!data) return;
	const index = typeof data.index === 'number' ? data.index : 0;

	switch (asString(data.type)) {
		case 'content_block_start': {
			const block = asRecord(data.content_block) ?? {};
			const type = asString(block.type);
			state.blocks[index] = {
				type: type === 'tool_use' ? 'tool_use' : type === 'thinking' ? 'thinking' : 'text',
				id: asString(block.id),
				name: asString(block.name),
				argsJson: ''
			};
			break;
		}
		case 'content_block_delta': {
			const delta = asRecord(data.delta);
			if (!delta) break;
			const kind = asString(delta.type);
			if (kind === 'text_delta') {
				const text = asString(delta.text);
				if (text) {
					state.turn.content = (state.turn.content ?? '') + text;
					h.onText?.(text);
				}
			} else if (kind === 'thinking_delta') {
				const thinking = asString(delta.thinking);
				if (thinking) {
					state.turn.reasoning = (state.turn.reasoning ?? '') + thinking;
					h.onReasoning?.(thinking);
				}
			} else if (kind === 'input_json_delta') {
				const block = state.blocks[index];
				if (block) block.argsJson += asString(delta.partial_json);
			}
			break;
		}
		case 'message_delta': {
			// `delta.stop_reason` (end_turn | tool_use | max_tokens) needs no handling:
			// the loop decides from the accumulated tool calls.
			break;
		}
		case 'error': {
			const err = asRecord(data.error);
			state.error = (err ? asString(err.message) : '') || 'stream error';
			break;
		}
		default:
			break;
	}
}

/** Handle a non-streaming Messages response body. */
export function applyNonStreamingMessage(body: string, state: StreamState, h: StreamHandlers): void {
	let parsed: unknown;
	try {
		parsed = JSON.parse(body);
	} catch {
		throw new Error('non-JSON response from provider');
	}
	const data = asRecord(parsed);
	if (!data) throw new Error('unparsable response from provider');
	const err = asRecord(data.error);
	if (err) throw new Error(asString(err.message) || 'provider error');

	const content = Array.isArray(data.content) ? data.content : [];
	content.forEach((raw, i) => {
		const block = asRecord(raw);
		if (!block) return;
		const type = asString(block.type);
		if (type === 'text') {
			const text = asString(block.text);
			state.turn.content = (state.turn.content ?? '') + text;
			h.onText?.(text);
		} else if (type === 'thinking') {
			const thinking = asString(block.thinking);
			state.turn.reasoning = (state.turn.reasoning ?? '') + thinking;
			h.onReasoning?.(thinking);
		} else if (type === 'tool_use') {
			state.blocks[i] = {
				type: 'tool_use',
				id: asString(block.id),
				name: asString(block.name),
				argsJson: JSON.stringify(block.input ?? {})
			};
		}
	});
}

/** Turn accumulated tool_use blocks into canonical tool calls, in stream order. */
function finalizeToolCalls(state: StreamState): void {
	state.turn.toolCalls = Object.keys(state.blocks)
		.map(Number)
		.sort((a, b) => a - b)
		.map(i => state.blocks[i])
		.filter(b => b.type === 'tool_use')
		.map(b => ({
			id: b.id,
			type: 'function' as const,
			function: { name: b.name, arguments: b.argsJson || '{}' }
		}));
}

/**
 * Agentic loop over the Messages protocol: chat → (tool_use → execute → tool_result)
 * → repeat → final text. Mirrors `runAgentLoop` so callers can swap on protocol.
 */
export async function runAnthropicLoop(opts: AnthropicLoopOptions): Promise<AgentLoopResult> {
	const maxIter = opts.maxIterations ?? 12;
	let hitCap = false;
	let reasoning = '';

	for (let i = 0; i < maxIter; i++) {
		const turn = await anthropicCompletion(opts, opts.messages, opts.tools, {
			onText: opts.onText,
			onReasoning: opts.onReasoning,
			signal: opts.signal,
			fetchImpl: opts.fetchImpl,
			fallbackPost: opts.fallbackPost
		});
		if (turn.reasoning) reasoning += (reasoning ? '\n' : '') + turn.reasoning;

		const calls = turn.toolCalls.filter(Boolean);
		if (!calls.length) {
			return { text: turn.content ?? '', reasoning, hitCap: false };
		}
		opts.messages.push({ role: 'assistant', content: turn.content ?? null, tool_calls: calls });

		for (const call of calls) {
			opts.onToolStart?.(call);
			let result = { ok: false, content: 'blocked before execution' };
			try {
				const args: unknown = JSON.parse(call.function.arguments || '{}');
				const def = opts.tools.find(t => t.name === call.function.name);
				if (def?.x_write && opts.confirmWrite && !(await opts.confirmWrite(`${call.function.name}: ${truncate(JSON.stringify(args), 200)}`))) {
					result = { ok: false, content: 'USER_DENIED' };
				} else {
					result = await opts.executor.execute(call.function.name, call.function.arguments);
				}
			} catch (e: unknown) {
				result = { ok: false, content: 'tool error: ' + (e instanceof Error ? e.message : String(e)) };
			}
			opts.onToolDone?.(call, result);
			opts.messages.push({
				role: 'tool',
				tool_call_id: call.id,
				content: truncate(result.content, 20000)
			});
		}
		hitCap = true; // stays true only if we exhaust the loop below
	}
	return { text: '', reasoning: '', hitCap };
}

function parseArgs(json: string): unknown {
	try {
		return JSON.parse(json || '{}');
	} catch {
		return {};
	}
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string {
	return typeof value === 'string' ? value : '';
}
