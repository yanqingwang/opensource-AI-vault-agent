/**
 * Unit test for the clipboard helper (clipboard.ts): the async clipboard API is
 * the only path, so a rejection has to surface as `false` rather than as a
 * broken button or an unhandled rejection.
 */
import assert from 'node:assert';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'va-clipboard-'));
const stub = join(dir, 'obsidian-stub.mjs');
writeFileSync(stub, 'export function setIcon() {}\n');

const out = join(dir, 'clipboard.mjs');
await build({
	entryPoints: [new URL('../clipboard.ts', import.meta.url).pathname],
	outfile: out,
	bundle: true,
	format: 'esm',
	platform: 'node',
	alias: { obsidian: stub }
});
const { copyText } = await import(pathToFileURL(out).href);

const withClipboard = async (writeText) => {
	Object.defineProperty(globalThis, 'navigator', {
		configurable: true,
		value: { clipboard: { writeText } }
	});
};

// --- 1. a successful write reports true and passes the text through ---------
{
	const written = [];
	await withClipboard(async (text) => { written.push(text); });
	assert.equal(await copyText('hello'), true);
	assert.deepEqual(written, ['hello'], 'the exact text is written once');
}

// --- 2. a rejected write reports false instead of throwing ------------------
{
	await withClipboard(async () => { throw new Error('denied'); });
	assert.equal(await copyText('hello'), false, 'a denied clipboard is a false result');
}

// --- 3. an empty string is still a copy ------------------------------------
{
	const written = [];
	await withClipboard(async (text) => { written.push(text); });
	assert.equal(await copyText(''), true);
	assert.deepEqual(written, [''], 'empty text is written, not skipped');
}

console.log('clipboard.test.mjs: all assertions passed');

// --- 4. the button reflects the result and then resets ----------------------
{
	await withClipboard(async () => { throw new Error('denied'); });
	// Hold the reset callback instead of running it, so the failed state is
	// observable before the button reverts.
	const deferred = [];
	globalThis.window = { setTimeout: (fn) => { deferred.push(fn); return 0; } };

	const { addCopyButton } = await import(pathToFileURL(out).href);
	const classes = new Set(['va-copy-btn']);
	const attrs = {};
	const listeners = {};
	const button = {
		className: 'va-copy-btn',
		setAttribute: (k, v) => { attrs[k] = v; },
		getAttribute: (k) => attrs[k],
		addClass: (c) => classes.add(c),
		removeClass: (c) => classes.delete(c),
		addEventListener: (type, fn) => { listeners[type] = fn; }
	};
	// `createEl` receives the aria-label/title through its options in real code;
	// the stub applies them so the initial label is observable.
	const parent = {
		createEl: (_tag, opts) => {
			for (const [k, v] of Object.entries(opts?.attr ?? {})) attrs[k] = v;
			return button;
		}
	};

	addCopyButton(parent, () => 'text', { copy: 'copy', copied: 'copied', failed: 'failed' });
	assert.equal(attrs['aria-label'], 'copy', 'starts with the copy label');

	listeners.click({ preventDefault() {}, stopPropagation() {} });
	// Let the rejected clipboard promise settle.
	await new Promise(r => setImmediate(r));
	assert.equal(attrs['aria-label'], 'failed', 'a denied write labels the button as failed');
	assert.ok(classes.has('va-copy-fail'), 'the failure class is applied');

	for (const fn of deferred) fn();
	assert.equal(attrs['aria-label'], 'copy', 'the label returns to copy');
	assert.ok(!classes.has('va-copy-fail'), 'the failure class is cleared');
}

console.log('clipboard.test.mjs: button assertions passed');
