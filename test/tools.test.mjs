/**
 * Unit test for vault folder creation in tools.ts (VaultToolExecutor.ensureFolder).
 *
 * Regression: the recursion used to pass `dir + '/x'`, which recomputed the same
 * `dir` at every level, so creating a note in a new subfolder recursed until the
 * stack overflowed. Obsidian's API is faked here; the executor only needs
 * `getAbstractFileByPath` and `createFolder` for this path.
 */
import assert from 'node:assert';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'va-tools-'));
const stub = join(dir, 'obsidian-stub.mjs');
writeFileSync(stub, `
export class TFile {}
export class TFolder {}
export function normalizePath(p) { return String(p).replace(/\\\\/g, '/').replace(/\\/{2,}/g, '/').replace(/^\\/+|\\/+$/g, ''); }
export function setIcon() {}
export function requestUrl() { throw new Error('not used'); }
export const MarkdownRenderer = { render: async () => {} };
`);

const out = join(dir, 'tools.mjs');
await build({
	entryPoints: [new URL('../tools.ts', import.meta.url).pathname],
	outfile: out,
	bundle: true,
	format: 'esm',
	platform: 'node',
	alias: { obsidian: stub }
});
const { VaultToolExecutor } = await import(pathToFileURL(out).href);

/** Minimal in-memory vault: folders are paths that exist. */
function fakeVault() {
	const folders = new Set(['']);
	const files = new Map();
	return {
		folders,
		files,
		getAbstractFileByPath: (p) => (folders.has(p) ? { path: p, children: [] } : files.get(p) ?? null),
		createFolder: async (p) => {
			if (!folders.has(p)) folders.add(p);
			return { path: p };
		},
		create: async (p, content) => {
			files.set(p, content);
			return { path: p, content };
		},
		getFileByPath: (p) => (files.has(p) ? { path: p, content: files.get(p) } : null),
		modify: async (f, content) => { files.set(f.path, content); },
		read: async (f) => files.get(f.path) ?? '',
		cachedRead: async (f) => files.get(f.path) ?? ''
	};
}

const app = { vault: fakeVault(), workspace: { getActiveFile: () => null } };
const executor = new VaultToolExecutor(app, () => null);

// --- 1. a new nested folder is created, not recursed to death ---------------
{
	const result = await executor.execute('create_note', JSON.stringify({
		path: 'CN AI Agent/sub/deep.md',
		content: '# hi\n'
	}));
	assert.equal(result.ok, true, `create_note failed: ${result.content}`);
	assert.match(result.content, /created CN AI Agent\/sub\/deep\.md/);
	assert.ok(app.vault.folders.has('CN AI Agent'), 'top folder created');
	assert.ok(app.vault.folders.has('CN AI Agent/sub'), 'nested folder created');
	assert.equal(app.vault.files.get('CN AI Agent/sub/deep.md'), '# hi\n');
}

// --- 2. an existing folder is left alone -----------------------------------
{
	const before = new Set(app.vault.folders);
	const result = await executor.execute('create_note', JSON.stringify({
		path: 'CN AI Agent/second.md',
		content: 'x'
	}));
	assert.equal(result.ok, true, `create_note failed: ${result.content}`);
	assert.deepEqual([...app.vault.folders].sort(), [...before].sort(), 'no extra folders were made');
	assert.equal(app.vault.files.get('CN AI Agent/second.md'), 'x');
}

// --- 3. a note at the vault root needs no folder ---------------------------
{
	const result = await executor.execute('create_note', JSON.stringify({ path: 'root.md', content: 'r' }));
	assert.equal(result.ok, true, `create_note failed: ${result.content}`);
	assert.equal(app.vault.files.get('root.md'), 'r');
}

console.log('tools.test.mjs: all assertions passed');
