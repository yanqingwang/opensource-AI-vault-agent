/**
 * Unit test for the starter-agent migration in main.ts (migrateStarterAgent).
 *
 * Regression: the first version of this migration reset *any* profile named
 * "默认 Agent" to the DeepSeek defaults. A real vault can hold exactly that name
 * on a configured agent (a Magpie gateway with a key), so the migration would
 * have wiped working credentials. Only a pristine placeholder may be rewritten.
 */
import assert from 'node:assert';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'va-starter-'));
const stub = join(dir, 'obsidian-stub.mjs');
writeFileSync(stub, `
export class Plugin {}
export class PluginSettingTab {}
export class Modal {}
export class Menu {}
export class Notice {}
export class TFile {}
export class TFolder {}
export class WorkspaceLeaf {}
export class ItemView {}
export const MarkdownRenderer = { render: async () => {} };
export function normalizePath(p) { return p; }
export function requestUrl() { throw new Error('not used'); }
export function requireApiVersion() { return true; }
export function setIcon() {}
export const Setting = class {};
`);

const out = join(dir, 'main.mjs');
await build({
	entryPoints: [new URL('../main.ts', import.meta.url).pathname],
	outfile: out,
	bundle: true,
	format: 'esm',
	platform: 'node',
	alias: { obsidian: stub }
});
const { migrateStarterAgent, makeProfile } = await import(pathToFileURL(out).href);

/** A pristine placeholder: default provider, default base URL, no key. */
const pristine = () => ({ ...makeProfile('默认 Agent'), id: 'agent-a' });

// --- 1. a pristine placeholder is reset and renamed ------------------------
{
	const p = pristine();
	const changed = migrateStarterAgent([p]);
	assert.equal(changed, true, 'a pristine placeholder is migrated');
	assert.equal(p.name, 'deepseek');
	assert.equal(p.id, 'agent-a', 'the id is kept so history.jsonl references stay valid');
	assert.equal(p.providerId, 'deepseek');
	assert.equal(p.baseUrl, 'https://api.deepseek.com/v1');
	assert.equal(p.model, 'deepseek-v4.1-flash');
	assert.equal(p.apiKey, '');
}

// --- 2. a configured "默认 Agent" is left completely alone ------------------
{
	// The real-vault shape: a Magpie gateway the user set up, under that name.
	const configured = {
		...makeProfile('默认 Agent'),
		id: 'agent-b',
		providerId: 'custom',
		baseUrl: 'http://127.0.0.1:3425/v1',
		apiKey: 'magpie',
		model: 'auto/deepseek-v4.1-flash'
	};
	const snapshot = { ...configured };
	const changed = migrateStarterAgent([configured]);
	assert.equal(changed, false, 'a configured agent is not migrated');
	assert.deepEqual(configured, snapshot, 'nothing about it is rewritten');
	assert.equal(configured.apiKey, 'magpie', 'the key survives');
	assert.equal(configured.baseUrl, 'http://127.0.0.1:3425/v1');
}

// --- 3. a key alone is enough to make it the user's -----------------------
{
	const withKey = { ...pristine(), apiKey: 'sk-real' };
	assert.equal(migrateStarterAgent([withKey]), false, 'a key means the user configured it');
	assert.equal(withKey.name, '默认 Agent');
	assert.equal(withKey.apiKey, 'sk-real');
}

// --- 4. a different model or base URL also protects it --------------------
{
	const otherModel = { ...pristine(), model: 'deepseek-reasoner' };
	assert.equal(migrateStarterAgent([otherModel]), false, 'a chosen model is a configuration');

	const otherBase = { ...pristine(), baseUrl: 'https://api.deepseek.com/beta' };
	assert.equal(migrateStarterAgent([otherBase]), false, 'a chosen base URL is a configuration');
}

// --- 5. unrelated names are never touched --------------------------------
{
	const named = { ...makeProfile('我的助手'), providerId: 'custom', apiKey: 'magpie' };
	assert.equal(migrateStarterAgent([named]), false);
	assert.equal(named.name, '我的助手');
}

// --- 6. the English placeholder is handled the same way ------------------
{
	const english = pristine();
	english.name = 'Default agent';
	assert.equal(migrateStarterAgent([english]), true);
	assert.equal(english.name, 'deepseek');
}

console.log('starter.test.mjs: all assertions passed');
