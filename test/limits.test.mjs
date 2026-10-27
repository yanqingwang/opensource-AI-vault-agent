/**
 * Unit test for limits.ts: the documented per-model output ceilings used by the
 * "auto" max-tokens mode, including gateway-prefixed ids.
 */
import assert from 'node:assert';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'va-limits-'));
const out = join(dir, 'limits.mjs');
await build({
	entryPoints: [new URL('../limits.ts', import.meta.url).pathname],
	outfile: out,
	bundle: true,
	format: 'esm',
	platform: 'node'
});
const { DEFAULT_MAX_OUTPUT, maxOutputForModel } = await import(pathToFileURL(out).href);

const cases = [
	['deepseek-v4.1-flash', 384000],
	['deepseek-v4-pro', 384000],
	['deepseek-flash', 384000],
	['workbuddy/deepseek-v4.1-flash', 384000],
	['deepseek-chat', 8192],
	['glm-4.6', 128000],
	['glm-4.5-air', 96000],
	['kimi-k2-turbo-preview', 32768],
	['kimi-k2-preview', 32768],
	['moonshot-v1-32k', 8192],
	['qwen3-coder-plus', 65536],
	['qwen-plus', 32768],
	['qwen-max', 32768],
	['doubao-seed-1-6-250615', 32768],
	['doubao-seed-code-preview-latest', 32768],
	['hunyuan-turbos-latest', 16384],
	['Hermes-4-405B', 32768],
	['some-custom-model', DEFAULT_MAX_OUTPUT],
	['', DEFAULT_MAX_OUTPUT]
];
for (const [model, expected] of cases) {
	assert.equal(maxOutputForModel(model), expected, `limit for ${model || '(empty)'}`);
}

assert.equal(DEFAULT_MAX_OUTPUT, 8192);
console.log('limits.test.mjs: all assertions passed');
