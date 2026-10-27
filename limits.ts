/**
 * Per-model maximum output (completion) tokens, for the "auto" max-tokens mode.
 *
 * Providers rarely expose this in `/v1/models`; those that do (Magpie) are read
 * live by the caller and override this table. The values below are the vendors'
 * documented per-request output ceilings, matched by model family rather than an
 * exact id so dated snapshots and gateway prefixes (`auto/`, `workbuddy/…`) work:
 * only the last path segment is matched.
 */

/** Used when a model is not in the table (custom endpoints, new snapshots). */
export const DEFAULT_MAX_OUTPUT = 8192;

const RULES: Array<[RegExp, number]> = [
	// DeepSeek V4.x: max_tokens accepts 1..384K. `deepseek-flash` is the V4.1
	// Flash alias, so it shares the ceiling.
	[/^deepseek-(v4|flash)/, 384000],
	[/^deepseek-(chat|reasoner)/, 8192],
	// Zhipu GLM.
	[/^glm-4\.6/, 128000],
	[/^glm-4\.5-air/, 96000],
	// Moonshot.
	[/^kimi-k2/, 32768],
	[/^moonshot-v1-32k/, 8192],
	// DashScope.
	[/^qwen3-coder-plus/, 65536],
	[/^qwen-(plus|max)/, 32768],
	// Volcengine Doubao (1.6 / Seed Code / 2.x share the 32K answer ceiling).
	[/^doubao-seed/, 32768],
	// Tencent Hunyuan TurboS and T1.
	[/^hunyuan-/, 16384],
	// Nous Hermes 4.
	[/^hermes-4/, 32768]
];

/**
 * The output ceiling for a model id, or `DEFAULT_MAX_OUTPUT` when unknown.
 * Ids may carry a gateway prefix (`workbuddy/deepseek-v4.1-flash`).
 */
export function maxOutputForModel(model: string): number {
	const id = (model || '').trim().toLowerCase();
	if (!id) return DEFAULT_MAX_OUTPUT;
	const bare = id.slice(id.lastIndexOf('/') + 1);
	for (const [pattern, limit] of RULES) {
		if (pattern.test(bare)) return limit;
	}
	return DEFAULT_MAX_OUTPUT;
}
