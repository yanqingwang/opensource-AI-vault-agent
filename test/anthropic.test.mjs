/**
 * End-to-end test of the Anthropic Messages client against a mock SSE server,
 * plus unit checks of the canonical → Anthropic message conversion.
 * Runs in Node (anthropic.ts has no Obsidian dependency).
 */
import assert from 'node:assert';
import http from 'node:http';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// 1. Bundle anthropic.ts (and its agent.ts dependency) to a temp ESM module.
const dir = mkdtempSync(join(tmpdir(), 'va-anthropic-'));
const out = join(dir, 'anthropic.mjs');
await build({
	entryPoints: [new URL('../anthropic.ts', import.meta.url).pathname],
	outfile: out,
	bundle: true,
	format: 'esm',
	platform: 'node'
});
const { runAnthropicLoop, toAnthropicMessages, buildAnthropicBody } = await import(pathToFileURL(out).href);

// 2. Mock Anthropic Messages server: turn 1 streams a tool_use block, turn 2 text.
const anthSse = events => events.map(e => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');

const TOOL_TURN = [
	{ type: 'message_start', message: { id: 'msg_1', role: 'assistant', content: [] } },
	{ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_1', name: 'create_note', input: {} } },
	{ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"path":"Notes/' } },
	{ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: 'Abc.md","content":"# Hello' } },
	{ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: ' world"}' } },
	{ type: 'content_block_stop', index: 0 },
	{ type: 'message_delta', delta: { stop_reason: 'tool_use' } },
	{ type: 'message_stop' }
];

const TEXT_TURN = [
	{ type: 'message_start', message: { id: 'msg_2', role: 'assistant', content: [] } },
	{ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
	{ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '笔记' } },
	{ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '创建完成 ✅' } },
	{ type: 'content_block_stop', index: 0 },
	{ type: 'message_delta', delta: { stop_reason: 'end_turn' } },
	{ type: 'message_stop' }
];

const seenBodies = [];
const seenRequests = [];
const server = http.createServer((req, res) => {
	let body = '';
	req.on('data', d => body += d);
	req.on('end', () => {
		seenRequests.push({ url: req.url, headers: req.headers });
		seenBodies.push(JSON.parse(body));
		res.writeHead(200, { 'Content-Type': 'text/event-stream' });
		res.end(anthSse(seenBodies.length === 1 ? TOOL_TURN : TEXT_TURN));
	});
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

// 3. Fake executor + write confirmation.
const executed = [];
const executor = {
	async execute(name, argsJson) {
		executed.push({ name, args: JSON.parse(argsJson) });
		return { ok: true, content: `created ${JSON.parse(argsJson).path}` };
	}
};
const confirmations = [];
const confirmWrite = async (summary) => { confirmations.push(summary); return true; };

const messages = [
	{ role: 'system', content: 'sys' },
	{ role: 'user', content: '请创建笔记 Notes/Abc.md' }
];
let streamed = '';
const { text, hitCap } = await runAnthropicLoop({
	baseUrl: `http://127.0.0.1:${port}`,
	apiKey: 'sk-test',
	model: 'doubao-seed-code-preview-latest',
	messages,
	tools: [
		{ name: 'create_note', description: 'create', parameters: { type: 'object', properties: {} }, x_write: true },
		{ name: 'noop', description: 'noop', parameters: { type: 'object', properties: {} } }
	],
	executor,
	confirmWrite,
	fetchImpl: fetch,
	maxIterations: 5,
	onText: d => streamed += d
});

// 4. Assertions.
assert.equal(executed.length, 1, 'executor ran once');
assert.deepEqual(executed[0].args, { path: 'Notes/Abc.md', content: '# Hello world' }, 'streamed input_json_delta reassembled');
assert.equal(text, '笔记创建完成 ✅', 'final text is the assistant answer');
assert.equal(streamed, '笔记创建完成 ✅', 'text deltas were streamed to the caller');
assert.equal(hitCap, false);
assert.equal(confirmations.length, 1, 'write tool asked for confirmation');

// Request shape: Anthropic endpoint, auth headers, tools in input_schema form.
assert.equal(seenRequests[0].url, '/v1/messages', 'posts to /v1/messages');
assert.equal(seenRequests[0].headers['x-api-key'], 'sk-test', 'sends x-api-key');
assert.equal(seenRequests[0].headers['anthropic-version'], '2023-06-01', 'sends anthropic-version');
const first = seenBodies[0];
assert.equal(first.system, 'sys', 'system is lifted to the top level');
assert.ok(!first.messages.some(m => m.role === 'system'), 'no system message left in the list');
assert.equal(first.tools[0].name, 'create_note');
assert.ok(first.tools[0].input_schema && !first.tools[0].function, 'tools use Anthropic input_schema, not OpenAI function shape');
assert.ok(!('x_write' in first.tools[0]), 'local write flag is not sent');

// Second request must carry the tool result back as a user/tool_result block.
const second = seenBodies[1];
const assistantMsg = second.messages.find(m => m.role === 'assistant' && Array.isArray(m.content));
assert.ok(assistantMsg, 'assistant message is present');
assert.equal(assistantMsg.content[0].type, 'tool_use');
assert.equal(assistantMsg.content[0].id, 'toolu_1');
const resultMsg = second.messages.find(m => m.role === 'user' && Array.isArray(m.content) && m.content[0]?.type === 'tool_result');
assert.ok(resultMsg, 'tool result fed back in a user message');
assert.equal(resultMsg.content[0].tool_use_id, 'toolu_1');
assert.equal(resultMsg.content[0].content, 'created Notes/Abc.md');

// 5. Pure conversion: consecutive tool results merge into one user message.
const converted = toAnthropicMessages([
	{ role: 'system', content: 'a' },
	{ role: 'user', content: 'q' },
	{ role: 'assistant', content: null, tool_calls: [
		{ id: 't1', type: 'function', function: { name: 'f1', arguments: '{"x":1}' } },
		{ id: 't2', type: 'function', function: { name: 'f2', arguments: 'not-json' } }
	] },
	{ role: 'tool', tool_call_id: 't1', content: 'r1' },
	{ role: 'tool', tool_call_id: 't2', content: 'USER_DENIED' }
]);
assert.equal(converted.system, 'a');
const lastMsg = converted.messages[converted.messages.length - 1];
assert.equal(lastMsg.role, 'user');
assert.equal(lastMsg.content.length, 2, 'both tool results share one user message');
assert.equal(lastMsg.content[0].tool_use_id, 't1');
assert.equal(lastMsg.content[1].is_error, true, 'denied result is flagged as an error');
const toolUseBlocks = converted.messages.find(m => m.role === 'assistant').content;
assert.deepEqual(toolUseBlocks[0].input, { x: 1 }, 'tool arguments are parsed into input');
assert.deepEqual(toolUseBlocks[1].input, {}, 'unparsable arguments degrade to an empty object');

// 6. Body builder omits empty system and stream flag is honoured.
const body = buildAnthropicBody({ baseUrl: 'x', apiKey: 'k', model: 'm' }, [{ role: 'user', content: 'hi' }], [], true);
assert.ok(!('system' in body), 'no system key when there is none');
assert.ok(!('tools' in body), 'no tools key when there are none');
assert.equal(body.stream, true);
assert.equal(body.max_tokens, 8192);

server.close();
console.log('anthropic.test.mjs OK');
