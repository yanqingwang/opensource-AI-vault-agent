/**
 * Conversation memory: ONE Markdown note in the vault, rescheduled on the
 * Ebbinghaus forgetting curve.
 *
 * Earlier versions wrote one note per session, which turns the vault into a pile
 * of files nobody re-reads. This module keeps a single `CN AI Agent/记忆.md`
 * holding every memory entry, and each entry carries its own review schedule so
 * the note itself says what is due today.
 *
 * The schedule is stored as JSON in an HTML comment at the end of the note: the
 * body is generated prose, so the comment is the only part that must survive a
 * round-trip. Editing the prose by hand is safe; editing the comment is not.
 *
 * Pure functions only — the caller reads and writes the file, so the format and
 * the scheduling maths are unit-testable without Obsidian.
 */

import type { HistoryEvent } from './history';

/** Vault folder that holds the note. Created on demand. */
export const MEMORY_FOLDER = 'CN AI Agent';
export const MEMORY_FILE = `${MEMORY_FOLDER}/记忆.md`;

/**
 * The review ladder, in days. Index = how many times the entry has been
 * reviewed, so a fresh memory comes back tomorrow, then in two days, and an
 * often-recalled one only every few months.
 */
export const REVIEW_LADDER_DAYS = [1, 2, 4, 7, 15, 30, 60, 120, 240];

export const DAY_MS = 86_400_000;

/** -ln(0.9): the decay constant that puts retention at 90% on the due date. */
const DECAY = -Math.log(0.9);

/** One exchange worth remembering: what was asked, and what came back. */
export interface MemoryPoint {
	q: string;
	a: string;
}

export interface MemoryEntry {
	/** Stable id: the session it came from. */
	id: string;
	session: string;
	title: string;
	/** The exchanges in that session, one per turn. */
	points: MemoryPoint[];
	turns: number;
	agent: string;
	model: string;
	created: number;
	/** Last content change (a new turn). */
	updated: number;
	/** How many times the entry has been reviewed. */
	reviews: number;
	/** Last review, or 0 when never reviewed. */
	lastReviewed: number;
	/** When it is due again (ms). */
	nextReview: number;
}

/** Days until the next review, given how often the entry has been recalled. */
export function intervalDays(reviews: number): number {
	const ladder = REVIEW_LADDER_DAYS;
	const index = Math.min(Math.max(Math.floor(reviews), 0), ladder.length - 1);
	return ladder[index];
}

/**
 * Retention right now, 0–1. `R = e^(-t/S)` with `S` chosen so that `R = 0.9` on
 * the scheduled date: the number the note shows as 记忆强度.
 */
export function retention(entry: MemoryEntry, now: number): number {
	const since = Math.max(0, now - (entry.lastReviewed || entry.updated || entry.created));
	const stability = (intervalDays(entry.reviews) * DAY_MS) / DECAY;
	return Math.exp(-since / stability);
}

/** Entries whose scheduled date has arrived, most overdue first. */
export function dueEntries(entries: MemoryEntry[], now: number): MemoryEntry[] {
	return entries
		.filter(e => (e.nextReview || 0) <= now)
		.sort((a, b) => (a.nextReview || 0) - (b.nextReview || 0));
}

/** Recall succeeded: climb one rung of the ladder. */
export function markReviewed(entry: MemoryEntry, now: number): MemoryEntry {
	const reviews = Math.max(0, entry.reviews) + 1;
	return {
		...entry,
		reviews,
		lastReviewed: now,
		nextReview: now + intervalDays(reviews) * DAY_MS
	};
}

/** Recall failed: back to the first rung, due again tomorrow. */
export function markForgotten(entry: MemoryEntry, now: number): MemoryEntry {
	return {
		...entry,
		reviews: 0,
		lastReviewed: now,
		nextReview: now + intervalDays(0) * DAY_MS
	};
}

/** Collapse whitespace and cut to `max` characters on a word-ish boundary. */
function clip(text: string, max: number): string {
	const flat = text.replace(/\s+/g, ' ').trim();
	if (flat.length <= max) return flat;
	return flat.slice(0, max).trimEnd() + '…';
}

/**
 * The exchanges a session contains, in order: each question paired with the
 * answer that followed it. A question with no answer yet keeps an empty `a`, so
 * the next turn fills it in rather than adding a duplicate.
 */
export function sessionPoints(events: HistoryEvent[], limit = 12): MemoryPoint[] {
	const ordered = [...events].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
	const points: MemoryPoint[] = [];
	for (const event of ordered) {
		if (event.type === 'user') {
			const q = clip(event.content ?? '', 200);
			if (q) points.push({ q, a: '' });
			if (points.length >= limit) break;
		} else if (event.type === 'assistant') {
			const last = points[points.length - 1];
			if (last && !last.a) last.a = clip(event.content ?? '', 400);
		}
	}
	return points;
}

/** A title from the first question, or a placeholder. */
export function memoryTitle(events: HistoryEvent[]): string {
	const first = [...events].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0)).find(e => e.type === 'user' && e.content?.trim());
	return clip(first?.content ?? '', 40) || '（无标题对话）';
}

/**
 * Fold one session's events into the entry list: an existing entry for that
 * session is refreshed in place, a new one starts on the first rung (due
 * tomorrow). Returns a new array; the input is not mutated.
 */
export function mergeSession(entries: MemoryEntry[], events: HistoryEvent[], now: number): MemoryEntry[] {
	if (!events.length) return entries;
	const session = events[0].session;
	const points = sessionPoints(events);
	if (!points.length) return entries;
	const ordered = [...events].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
	const created = ordered[0].ts || now;
	const first = ordered[0];
	const existing = entries.find(e => e.session === session);

	const refreshed: MemoryEntry = {
		id: session,
		session,
		title: memoryTitle(events),
		points,
		turns: points.length,
		agent: first.agent ?? '',
		model: first.model ?? '',
		created: existing?.created ?? created,
		updated: now,
		reviews: existing?.reviews ?? 0,
		lastReviewed: existing?.lastReviewed ?? 0,
		// A conversation that keeps going is not "recalled": only an explicit
		// review moves the date, so new turns must not push it into the future.
		nextReview: existing?.nextReview ?? now + intervalDays(0) * DAY_MS
	};

	return existing
		? entries.map(e => (e.session === session ? refreshed : e))
		: [...entries, refreshed];
}

const pad = (n: number) => String(n).padStart(2, '0');

/** `YYYY-MM-DD` in local time. */
export function formatDay(ms: number): string {
	const d = new Date(ms);
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** `YYYY-MM-DD HH:mm` in local time. */
export function formatStamp(ms: number): string {
	const d = new Date(ms);
	return `${formatDay(ms)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Whole days from `now` to `ms`; negative when overdue. */
export function daysUntil(ms: number, now: number): number {
	return Math.round((ms - now) / DAY_MS);
}

/** A heading-safe title: no newlines, no leading hashes. */
function heading(title: string): string {
	return title.replace(/\r?\n/g, ' ').replace(/^#+\s*/, '').trim() || '（无标题对话）';
}

/** The machine-readable block the schedule round-trips through. */
export function encodeMemoryData(entries: MemoryEntry[]): string {
	return ['<!-- memory:data', JSON.stringify(entries), '-->'].join('\n');
}

/**
 * Read the entries back out of a note. Anything unreadable (a hand-edited or
 * truncated block) yields no entries rather than throwing, so a damaged note
 * cannot stop the plugin from writing a fresh one.
 */
export function parseMemoryFile(text: string): MemoryEntry[] {
	const match = /<!--\s*memory:data\s*\n([\s\S]*?)\n\s*-->/.exec(text);
	if (!match) return [];
	try {
		const parsed: unknown = JSON.parse(match[1]);
		if (!Array.isArray(parsed)) return [];
		const out: MemoryEntry[] = [];
		for (const raw of parsed) {
			if (raw === null || typeof raw !== 'object') continue;
			const e = raw as Partial<MemoryEntry> & { points?: unknown };
			if (typeof e.session !== 'string' || !e.session) continue;
			out.push({
				id: typeof e.id === 'string' ? e.id : e.session,
				session: e.session,
				title: typeof e.title === 'string' ? e.title : '（无标题对话）',
				points: Array.isArray(e.points)
					? e.points.flatMap((p): MemoryPoint[] => {
						if (p === null || typeof p !== 'object') return [];
						const pair = p as Partial<MemoryPoint>;
						if (typeof pair.q !== 'string' || !pair.q) return [];
						return [{ q: pair.q, a: typeof pair.a === 'string' ? pair.a : '' }];
					})
					: [],
				turns: typeof e.turns === 'number' ? e.turns : 0,
				agent: typeof e.agent === 'string' ? e.agent : '',
				model: typeof e.model === 'string' ? e.model : '',
				created: typeof e.created === 'number' ? e.created : 0,
				updated: typeof e.updated === 'number' ? e.updated : 0,
				reviews: typeof e.reviews === 'number' ? e.reviews : 0,
				lastReviewed: typeof e.lastReviewed === 'number' ? e.lastReviewed : 0,
				nextReview: typeof e.nextReview === 'number' ? e.nextReview : 0
			});
		}
		return out;
	} catch {
		return [];
	}
}

/**
 * Render the whole note: frontmatter, what is due today, then every memory in
 * review order. The body is regenerated on every write, so it is never stale.
 */
export function renderMemoryFile(entries: MemoryEntry[], now: number): string {
	const due = dueEntries(entries, now);
	const ordered = [...entries].sort((a, b) => (a.nextReview || 0) - (b.nextReview || 0));
	const lines: string[] = [
		'---',
		'title: 记忆',
		`updated: ${new Date(now).toISOString()}`,
		`entries: ${entries.length}`,
		`due: ${due.length}`,
		'tags:',
		'  - ai-memory',
		'---',
		'',
		'# 记忆',
		'',
		'> 由 AI Vault Agent CN 自动维护。每轮对话更新一次，并按遗忘曲线安排复习：',
		'> 间隔依次为 ' + REVIEW_LADDER_DAYS.join(' / ') + ' 天。正文可以随意修改，',
		'> 末尾 `memory:data` 注释是排期数据，改动会丢失复习进度。',
		''
	];

	lines.push(`## 今日待复习${due.length ? `（${due.length}）` : ''}`, '');
	if (!due.length) {
		lines.push('今天没有到期的记忆。', '');
	} else {
		for (const entry of due) {
			const overdue = -daysUntil(entry.nextReview, now);
			const when = overdue > 0 ? `已过期 ${overdue} 天` : '今天到期';
			lines.push(`- [[#${heading(entry.title)}]] · ${when} · 复习 ${entry.reviews} 次`);
		}
		lines.push('');
	}

	lines.push('## 全部记忆', '');
	if (!ordered.length) {
		lines.push('还没有记忆。发起一次对话后，这里会自动出现第一条。', '');
	}
	for (const entry of ordered) {
		const strength = Math.round(retention(entry, now) * 100);
		const next = daysUntil(entry.nextReview, now);
		const nextText = next > 0 ? `${next} 天后` : next === 0 ? '今天' : `已过期 ${-next} 天`;
		lines.push(`### ${heading(entry.title)}`, '');
		lines.push(
			`- 会话 \`${entry.session}\` · ${entry.turns} 轮` + (entry.agent ? ` · ${entry.agent}` : '') + (entry.model ? ` · ${entry.model}` : '')
		);
		lines.push(
			`- 创建 ${formatStamp(entry.created)} · 下次复习 ${nextText}（${formatDay(entry.nextReview)}）· 复习 ${entry.reviews} 次 · 记忆强度 ${strength}%`
		);
		if (entry.points.length) {
			lines.push('- 要点：');
			for (const point of entry.points) {
				lines.push(`    - **问**：${point.q}`);
				if (point.a) lines.push(`      **答**：${point.a}`);
			}
		}
		lines.push('');
	}

	lines.push(encodeMemoryData(entries), '');
	return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}
