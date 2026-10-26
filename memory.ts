/**
 * Conversation memory: one Markdown note per chat session, written into the
 * vault so the conversation is a normal, searchable, linkable note rather than
 * something only the plugin can read.
 *
 * Pure functions only — the caller supplies the file text and path, so the
 * format can be unit-tested without Obsidian.
 */

import type { HistoryEvent } from './history';

/** Vault folder that holds the notes. Created on demand. */
export const MEMORY_FOLDER = 'CN AI Agent';

/**
 * One note per session, named after the day it started plus the session id, so
 * two conversations on the same day never collide and the id in the filename
 * matches the id in `history.jsonl`.
 */
export function memoryPath(sessionId: string, firstMs: number): string {
	const date = new Date(firstMs);
	const pad = (n: number) => String(n).padStart(2, '0');
	const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
	const stamp = `${pad(date.getHours())}${pad(date.getMinutes())}`;
	return `${MEMORY_FOLDER}/${day} ${stamp} ${sessionId.slice(0, 8)}.md`;
}

/** YAML scalar: quote only when the value would otherwise break the frontmatter. */
function yamlValue(value: string): string {
	const flat = value.replace(/\r?\n/g, ' ').trim();
	if (!flat) return '""';
	return /^[\w\u4e00-\u9fff][\w\u4e00-\u9fff .·\-/()（）]*$/.test(flat) && !/^(true|false|null|yes|no|on|off)$/i.test(flat)
		? flat
		: JSON.stringify(flat);
}

/** The first user message, trimmed to something usable as a title. */
export function memoryTitle(events: HistoryEvent[]): string {
	const first = events.find(e => e.type === 'user' && e.content?.trim());
	const text = (first?.content ?? '').replace(/\s+/g, ' ').trim();
	if (!text) return '（无标题对话）';
	return text.length > 40 ? text.slice(0, 40) + '…' : text;
}

/**
 * Render a session as a Markdown note.
 *
 * Only user and assistant messages become prose: tool calls and results are
 * chat-internal plumbing and would drown the transcript. The reasoning text is
 * kept in a collapsed callout, because it is often what explains *why* an answer
 * went one way, but it is not the answer.
 */
export function renderMemoryNote(sessionId: string, events: HistoryEvent[]): string {
	const ordered = [...events].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
	const first = ordered[0];
	const last = ordered[ordered.length - 1];
	const turns = ordered.filter(e => e.type === 'user').length;
	const iso = (ms?: number) => (ms ? new Date(ms).toISOString() : '');

	const lines: string[] = [
		'---',
		`title: ${yamlValue(memoryTitle(ordered))}`,
		`session: ${sessionId}`,
		`agent: ${yamlValue(first?.agent ?? '')}`,
		`provider: ${yamlValue(first?.provider ?? '')}`,
		`model: ${yamlValue(first?.model ?? '')}`,
		`created: ${iso(first?.ts)}`,
		`updated: ${iso(last?.ts)}`,
		`turns: ${turns}`,
		'tags:',
		'  - ai-chat',
		'---',
		'',
		`# ${memoryTitle(ordered)}`,
		'',
		`> 会话 \`${sessionId}\` · ${turns} 轮 · ${first?.agent ?? 'agent'} · ${first?.model ?? ''}`,
		''
	];

	for (const event of ordered) {
		if (event.type !== 'user' && event.type !== 'assistant') continue;
		const text = (event.content ?? '').trim();
		if (!text) continue;
		const who = event.type === 'user' ? '🧑 我' : '🤖 智能体';
		const time = event.iso ? event.iso.slice(11, 16) : '';
		lines.push(`## ${who}${time ? ` · ${time}` : ''}`, '');
		lines.push(text, '');
		const reasoning = (event.reasoning ?? '').trim();
		if (reasoning) {
			lines.push('> [!note]- 思考过程', ...reasoning.split('\n').map(l => `> ${l}`), '');
		}
	}

	return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}
