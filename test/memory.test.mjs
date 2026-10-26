/**
 * Unit test for the conversation-memory note format (memory.ts): path naming,
 * frontmatter quoting and the transcript rendering.
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
const { MEMORY_FOLDER, memoryPath, memoryTitle, renderMemoryNote } = await import(pathToFileURL(out).href);

const ev = (partial) => ({
	id: 'x', ts: 0, iso: '', session: 's1', seq: 0, turn: 1, role: 'assistant', type: 'assistant',
	...partial
});

// --- 1. folder and path -----------------------------------------------------
{
	assert.equal(MEMORY_FOLDER, 'CN AI Agent');
	const ms = new Date(2026, 9, 27, 14, 5).getTime(); // local time on purpose
	assert.equal(memoryPath('abcd1234-ef', ms), 'CN AI Agent/2026-10-27 1405 abcd1234.md',
		'one note per session, named by day, time and the session id prefix');
	// Two sessions starting the same minute must not collide.
	assert.notEqual(memoryPath('aaaa1111', ms), memoryPath('bbbb2222', ms));
}

// --- 2. title ---------------------------------------------------------------
{
	assert.equal(memoryTitle([ev({ type: 'user', content: '  如何  高效学习  ' })]), '如何 高效学习',
		'whitespace is collapsed');
	const long = memoryTitle([ev({ type: 'user', content: '一'.repeat(80) })]);
	assert.equal(long.length, 41, 'long titles are cut to 40 chars plus an ellipsis');
	assert.ok(long.endsWith('…'));
	assert.equal(memoryTitle([ev({ type: 'user', content: '   ' })]), '（无标题对话）');
	assert.equal(memoryTitle([]), '（无标题对话）');
}

// --- 3. frontmatter quoting ------------------------------------------------
{
	const note = renderMemoryNote('s1', [
		ev({ seq: 1, type: 'user', role: 'user', content: 'hi', agent: 'Magpie 网关', provider: 'magpie', model: 'auto/x', ts: 1000 })
	]);
	assert.match(note, /^---\ntitle: hi\n/, 'a plain title stays unquoted');
	assert.match(note, /^agent: Magpie 网关$/m, 'CJK and spaces are safe unquoted');
	assert.match(note, /^created: 1970-01-01T00:00:01.000Z$/m);

	const tricky = renderMemoryNote('s2', [
		ev({ seq: 1, type: 'user', role: 'user', content: 'a: b', agent: 'x: y', ts: 1 })
	]);
	assert.match(tricky, /^title: "a: b"$/m, 'a colon forces quoting');
	assert.match(tricky, /^agent: "x: y"$/m);

	const reserved = renderMemoryNote('s3', [ev({ seq: 1, type: 'user', role: 'user', content: 'true', ts: 1 })]);
	assert.match(reserved, /^title: "true"$/m, 'a YAML keyword is quoted');
}

// --- 4. transcript body -----------------------------------------------------
{
	const events = [
		ev({ seq: 1, type: 'user', role: 'user', content: '问题', ts: 1000, iso: '2026-10-27T06:05:00.000Z' }),
		ev({ seq: 2, type: 'tool_call', role: 'assistant', tool: 'read_note', args: '{"path":"a.md"}' }),
		ev({ seq: 3, type: 'tool_result', role: 'tool', content: 'note body' }),
		ev({ seq: 4, type: 'assistant', role: 'assistant', content: '回答', reasoning: '想一想\n再答', iso: '2026-10-27T06:06:00.000Z' }),
		ev({ seq: 5, type: 'assistant', role: 'assistant', content: '   ' })
	];
	const note = renderMemoryNote('sess-1', events);

	assert.match(note, /^# 问题$/m, 'the title is repeated as an H1');
	assert.match(note, /^## 🧑 我 · 06:05$/m, 'user turns carry their local-clock time');
	assert.match(note, /^## 🤖 智能体 · 06:06$/m);
	assert.ok(note.includes('\n问题\n'), 'user text is kept verbatim');
	assert.ok(note.includes('\n回答\n'), 'assistant text is kept verbatim');
	assert.ok(!note.includes('read_note'), 'tool plumbing is not written into the note');
	assert.ok(!note.includes('note body'));
	assert.match(note, /> \[!note\]- 思考过程\n> 想一想\n> 再答/, 'reasoning is a collapsed callout');
	assert.match(note, /^turns: 1$/m, 'turns counts user messages');
	assert.ok(!note.includes('undefined'), 'no missing field leaks into the note');
	assert.ok(note.endsWith('\n') && !note.endsWith('\n\n'), 'exactly one trailing newline');
}

console.log('memory.test.mjs: all assertions passed');
