/**
 * Unit test for the single-note memory format (memory.ts): the review ladder,
 * retention maths, merging a session into the entry list, and the round-trip
 * through the `memory:data` block.
 */
import assert from 'node:assert';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'va-memory-'));
const out = join(dir, 'memory.mjs');
await build({
	entryPoints: [new URL('../memory.ts', import.meta.url).pathname],
	outfile: out,
	bundle: true,
	format: 'esm',
	platform: 'node'
});
const {
	MEMORY_FOLDER, MEMORY_FILE, REVIEW_LADDER_DAYS, DAY_MS,
	intervalDays, retention, dueEntries, markReviewed, markForgotten,
	sessionPoints, memoryTitle, mergeSession, formatDay, daysUntil,
	encodeMemoryData, parseMemoryFile, renderMemoryFile
} = await import(pathToFileURL(out).href);

const NOW = new Date(2026, 9, 27, 9, 0).getTime(); // local 2026-10-27 09:00
const ev = (partial) => ({
	id: 'x', ts: NOW, iso: new Date(NOW).toISOString(), session: 's1', seq: 0, turn: 1,
	role: 'user', type: 'user', ...partial
});

// --- 1. one file, not one per session --------------------------------------
{
	assert.equal(MEMORY_FOLDER, 'CN AI Agent');
	assert.equal(MEMORY_FILE, 'CN AI Agent/记忆.md', 'a single memory note');
	assert.ok(!MEMORY_FILE.includes('${'), 'the path is fixed, not per session');
}

// --- 2. the review ladder --------------------------------------------------
{
	assert.deepEqual(REVIEW_LADDER_DAYS.slice(0, 4), [1, 2, 4, 7]);
	assert.equal(intervalDays(0), 1, 'a fresh memory comes back tomorrow');
	assert.equal(intervalDays(1), 2);
	assert.equal(intervalDays(3), 7);
	assert.equal(intervalDays(99), REVIEW_LADDER_DAYS.at(-1), 'the ladder is capped, not extrapolated');
	assert.equal(intervalDays(-5), 1, 'a negative count is clamped to the first rung');
	assert.equal(intervalDays(1.8), 2, 'fractional counts floor');
}

// --- 3. retention ----------------------------------------------------------
{
	const entry = { session: 's', reviews: 0, created: NOW, updated: NOW, lastReviewed: 0, nextReview: NOW + DAY_MS };
	const fresh = retention(entry, NOW);
	assert.ok(fresh > 0.99, `a just-created memory is ~100% (got ${fresh})`);
	const onDue = retention(entry, NOW + DAY_MS);
	assert.ok(Math.abs(onDue - 0.9) < 0.02, `90% retention on the due date (got ${onDue})`);
	// Stability is interval/DECAY ≈ 9.5 days for the first rung, so a fortnight
	// later only a fifth of it is left.
	assert.ok(retention(entry, NOW + 14 * DAY_MS) < 0.25, 'and it decays after that');

	const reviewed = markReviewed(entry, NOW);
	assert.equal(reviewed.reviews, 1);
	assert.equal(reviewed.nextReview, NOW + 2 * DAY_MS, 'a review moves to the next rung');
	assert.ok(retention(reviewed, NOW) > 0.99, 'reviewing resets the decay');

	const forgotten = markForgotten({ ...entry, reviews: 4, lastReviewed: NOW - 5 * DAY_MS }, NOW);
	assert.equal(forgotten.reviews, 0, 'a failure sends it back to the start');
	assert.equal(forgotten.nextReview, NOW + DAY_MS);
}

// --- 4. due selection ------------------------------------------------------
{
	const entries = [
		{ session: 'a', nextReview: NOW - 3 * DAY_MS },
		{ session: 'b', nextReview: NOW + 2 * DAY_MS },
		{ session: 'c', nextReview: NOW - 1 }
	];
	assert.deepEqual(dueEntries(entries, NOW).map(e => e.session), ['a', 'c'], 'due only, most overdue first');
	assert.deepEqual(dueEntries(entries, NOW - 5 * DAY_MS), [], 'nothing due before its date');
}

// --- 5. session extraction -------------------------------------------------
{
	const events = [
		ev({ seq: 1, content: '  第一个问题  ' }),
		ev({ seq: 2, type: 'assistant', role: 'assistant', content: '回答' }),
		ev({ seq: 3, content: '第二个问题' })
	];
	assert.deepEqual(sessionPoints(events), [
		{ q: '第一个问题', a: '回答' },
		{ q: '第二个问题', a: '' }
	], 'each question is paired with the answer that followed it');
	assert.equal(memoryTitle(events), '第一个问题');
	assert.equal(memoryTitle([ev({ content: '一'.repeat(60) })]).length, 41, 'titles are clipped to 40 chars plus an ellipsis');
	assert.deepEqual(sessionPoints([ev({ content: '   ' })]), [], 'a blank question is not a memory');
}

// --- 6. merging a session into the list ------------------------------------
{
	const first = [
		ev({ seq: 1, content: '问题一', ts: NOW - 2 * DAY_MS }),
		ev({ seq: 2, type: 'assistant', role: 'assistant', content: '答', ts: NOW - 2 * DAY_MS })
	];
	const one = mergeSession([], first, NOW - 2 * DAY_MS);
	assert.equal(one.length, 1);
	assert.equal(one[0].session, 's1');
	assert.equal(one[0].turns, 1);
	assert.equal(one[0].reviews, 0);
	assert.equal(one[0].nextReview, NOW - 2 * DAY_MS + DAY_MS, 'a new memory is due the next day');

	// A later turn updates the same entry instead of adding another.
	const more = [...first, ev({ seq: 3, content: '问题二' })];
	const two = mergeSession(one, more, NOW);
	assert.equal(two.length, 1, 'one entry per session, not one per turn');
	assert.equal(two[0].turns, 2);
	assert.equal(two[0].points.length, 2);
	assert.equal(two[0].created, one[0].created, 'the creation time is preserved');
	assert.equal(two[0].nextReview, one[0].nextReview, 'new turns do not push the review date out');
	assert.equal(one[0].turns, 1, 'the input array is not mutated');

	// A reviewed entry keeps its progress when the session continues.
	const reviewed = mergeSession([markReviewed(one[0], NOW)], more, NOW + 1000);
	assert.equal(reviewed[0].reviews, 1, 'review count survives new turns');
	assert.equal(reviewed[0].nextReview, NOW + 2 * DAY_MS, 'and so does the schedule');

	// An answered turn fills the answer into the existing pair instead of adding one.
	const answered = mergeSession(one, [
		...first,
		ev({ seq: 3, type: 'assistant', role: 'assistant', content: '答二' })
	], NOW);
	assert.equal(answered[0].points.length, 1, 'a question is not duplicated by its answer');
	assert.equal(answered[0].points[0].a, '答', 'the first answer is kept');
	assert.equal(answered[0].turns, 1, 'turns still counts questions');

	// A second session is a second entry.
	const other = mergeSession(two, [ev({ session: 's2', content: '另一个问题' })], NOW);
	assert.equal(other.length, 2);
	assert.deepEqual(other.map(e => e.session), ['s1', 's2'], 'append order is stable');
}

// --- 7. the data block round-trips -----------------------------------------
{
	const entries = mergeSession([], [ev({ seq: 1, content: '问题' })], NOW);
	const text = encodeMemoryData(entries);
	assert.match(text, /^<!-- memory:data\n\[/, 'the block is an HTML comment, invisible in preview');
	const parsed = parseMemoryFile(renderMemoryFile(entries, NOW));
	assert.deepEqual(parsed, entries, 'a rendered note parses back to the same entries');

	assert.deepEqual(parseMemoryFile(''), [], 'a note without the block has no entries');
	assert.deepEqual(parseMemoryFile('<!-- memory:data\nnot json\n-->'), [], 'a corrupt block is ignored, not fatal');
	assert.deepEqual(parseMemoryFile('<!-- memory:data\n{"a":1}\n-->'), [], 'a non-array is ignored');
	const partial = parseMemoryFile('<!-- memory:data\n[{"session":"s9","points":"nope"}]\n-->');
	assert.equal(partial.length, 1);
	assert.deepEqual(partial[0].points, [], 'a malformed field is dropped, the entry survives');
	const pairs = parseMemoryFile('<!-- memory:data\n[{"session":"s8","points":[{"q":"问","a":"答"},{"q":""},{"a":"orphan"},"junk"]}]\n-->');
	assert.deepEqual(pairs[0].points, [{ q: '问', a: '答' }], 'only well-formed pairs survive');
	assert.equal(partial[0].id, 's9', 'a missing id falls back to the session');
}

// --- 8. rendering ----------------------------------------------------------
{
	const entries = mergeSession([], [ev({ seq: 1, content: '如何高效学习' })], NOW - 5 * DAY_MS);
	const note = renderMemoryFile(entries, NOW);

	assert.match(note, /^---\ntitle: 记忆\n/, 'frontmatter names the note');
	assert.match(note, /^entries: 1$/m);
	assert.match(note, /^due: 1$/m, 'the overdue entry is counted');
	assert.match(note, /^## 今日待复习（1）$/m);
	assert.match(note, /- \[\[#如何高效学习\]\] · 已过期 4 天 · 复习 0 次/, 'the due list links to the entry heading');
	assert.match(note, /^### 如何高效学习$/m);
	assert.match(note, /下次复习 已过期 4 天（\d{4}-\d{2}-\d{2}）/, 'the entry states when it is next due');
	assert.match(note, /记忆强度 \d+%/, 'and how strong the memory is');
	assert.match(note, /    - \*\*问\*\*：如何高效学习/, 'the questions are listed under the entry');
	assert.match(note, /<!-- memory:data/, 'the schedule block is present');
	assert.ok(!note.includes('undefined'), 'no missing field leaks into the note');
	assert.ok(note.endsWith('\n') && !note.endsWith('\n\n'), 'exactly one trailing newline');

	const empty = renderMemoryFile([], NOW);
	assert.match(empty, /今天没有到期的记忆/);
	assert.match(empty, /还没有记忆/);
	assert.match(empty, /^due: 0$/m);

	const future = renderMemoryFile([{ ...entries[0], nextReview: NOW + 3 * DAY_MS }], NOW);
	assert.match(future, /今天没有到期的记忆/, 'an entry due later is not listed today');
	assert.match(future, /下次复习 3 天后/);
}

// --- 9. date helpers -------------------------------------------------------
{
	assert.equal(formatDay(new Date(2026, 0, 5).getTime()), '2026-01-05', 'zero-padded local date');
	assert.equal(daysUntil(NOW + 2 * DAY_MS, NOW), 2);
	assert.equal(daysUntil(NOW - 2 * DAY_MS, NOW), -2, 'negative when overdue');
}

console.log('memory.test.mjs: all assertions passed');
