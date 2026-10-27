/**
 * Unit test for the Magpie gateway helpers (magpie.ts): URL shapes for the ways
 * a user types the gateway address, catalog parsing, and which model a fresh
 * agent adopts.
 */
import assert from 'node:assert';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'va-magpie-'));
const out = join(dir, 'magpie.mjs');
await build({
	entryPoints: [new URL('../magpie.ts', import.meta.url).pathname],
	outfile: out,
	bundle: true,
	format: 'esm',
	platform: 'node'
});
const { MAGPIE_BASE_URL, MAGPIE_KEY, magpieModelsUrl, modelOutputLimit, parseMagpieModels, pickDefaultMagpieModel } =
	await import(pathToFileURL(out).href);

// --- 1. gateway key and base URL --------------------------------------------
{
	assert.equal(MAGPIE_KEY, 'magpie-ai-vault-agent', 'the key names the app in Magpie usage');
	assert.equal(MAGPIE_BASE_URL, 'http://127.0.0.1:3425/v1');
}

// --- 2. /v1/models URL for every shape of base URL --------------------------
{
	const cases = [
		['http://127.0.0.1:3425/v1', 'http://127.0.0.1:3425/v1/models'],
		['http://127.0.0.1:3425/v1/', 'http://127.0.0.1:3425/v1/models'],
		['http://127.0.0.1:3425', 'http://127.0.0.1:3425/v1/models'],
		['http://192.168.1.20:3425/', 'http://192.168.1.20:3425/v1/models'],
		['  http://127.0.0.1:3425/v1  ', 'http://127.0.0.1:3425/v1/models'],
		['', 'http://127.0.0.1:3425/v1/models']
	];
	for (const [input, expected] of cases) assert.equal(magpieModelsUrl(input), expected, `URL for "${input}"`);
}

// --- 3. catalog parsing ------------------------------------------------------
{
	const body = {
		object: 'list',
		data: [
			{ id: 'group/smart-split', display_name: '难题给强模型', owned_by: 'workbuddy-ai', context_window: 1000000, max_output_tokens: 128000 },
			{ id: 'auto/deepseek-v4.1-flash', display_name: 'Deepseek-V4.1-Flash', owned_by: 'workbuddy' },
			{ id: 'trae-cn/glm-5.3-flash' },
			{ display_name: 'no id' },
			{ id: '' },
			{ id: 42 },
			'not-an-object'
		]
	};
	const models = parseMagpieModels(body);
	assert.deepEqual(models.map(m => m.id), ['group/smart-split', 'auto/deepseek-v4.1-flash', 'trae-cn/glm-5.3-flash'],
		'entries without a usable id are dropped');
	assert.equal(models[0].displayName, '难题给强模型');
	assert.equal(models[0].contextWindow, 1000000);
	assert.equal(models[0].maxOutputTokens, 128000);
	assert.equal(models[1].maxOutputTokens, undefined, 'a gateway without the field reports no cap');
	assert.equal(models[1].ownedBy, 'workbuddy');
	assert.equal(models[2].displayName, undefined);
}

// --- 4. tolerant input shapes ------------------------------------------------
{
	assert.deepEqual(parseMagpieModels([{ id: 'a' }]).map(m => m.id), ['a'], 'a bare array is accepted');
	assert.deepEqual(parseMagpieModels({ data: 'nope' }), [], 'a non-array data field yields no models');
	assert.deepEqual(parseMagpieModels(null), []);
	assert.deepEqual(parseMagpieModels('{"data":[]}'), [], 'a string body is not parsed here');
}

// --- 5. which model a fresh agent adopts ------------------------------------
{
	const cat = [{ id: 'trae-cn/glm-5.3-flash' }, { id: 'group/smart-split' }, { id: 'auto/deepseek-v4.1-flash' }];
	assert.equal(pickDefaultMagpieModel(cat), 'auto/deepseek-v4.1-flash', 'auto-routing wins over a group');
	assert.equal(pickDefaultMagpieModel(cat, 'group/smart-split'), 'group/smart-split',
		'a model the gateway still lists is kept');
	assert.equal(pickDefaultMagpieModel(cat, 'gone/model'), 'auto/deepseek-v4.1-flash',
		'a model the gateway no longer lists is replaced');
	assert.equal(pickDefaultMagpieModel([{ id: 'trae-cn/glm-5.3-flash' }]), 'trae-cn/glm-5.3-flash',
		'without auto/ the first enabled model is used');
	assert.equal(pickDefaultMagpieModel([]), '', 'an empty catalog leaves the model untouched');
}

// --- 6. output ceiling for catalogue models ---------------------------------
{
	const catalogue = [
		{ id: 'group/smart-split', maxOutputTokens: 128000 },
		{ id: 'raccoon/sn-deepseek', maxOutputTokens: 100000 },
		{ id: 'raccoon/sn-sensenova', maxOutputTokens: 64000 }
	];
	assert.equal(modelOutputLimit(catalogue, 'raccoon/sn-deepseek'), 100000,
		'a concrete model reports its own ceiling');
	assert.equal(modelOutputLimit(catalogue, 'group/smart-split'), 64000,
		'a routing group takes the smallest member ceiling');
	assert.equal(modelOutputLimit(catalogue, 'gone/model'), undefined);
	assert.equal(modelOutputLimit([{ id: 'group/x' }], 'group/x'), undefined,
		'a group without reported ceilings invents nothing');
}
console.log('magpie.test.mjs: all assertions passed');
