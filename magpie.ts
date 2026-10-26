/**
 * Magpie local gateway helpers (framework-free so they can be unit-tested).
 *
 * Magpie runs an LLM gateway on this machine (default `127.0.0.1:3425`) and
 * serves every model the user has there under one id each, so an agent needs a
 * single provider entry instead of one per vendor. Its docs ask clients to read
 * `GET /v1/models` rather than shipping a fixed model list, because the user
 * adds and removes providers inside Magpie.
 */

/** App id Magpie counts calls under: the gateway key is `magpie-<app id>`. */
export const MAGPIE_APP_ID = 'ai-vault-agent';
export const MAGPIE_KEY = 'magpie-' + MAGPIE_APP_ID;
export const MAGPIE_BASE_URL = 'http://127.0.0.1:3425/v1';

export interface MagpieModel {
	id: string;
	displayName?: string;
	ownedBy?: string;
	contextWindow?: number;
}

/**
 * `/v1/models` for any way the user may have typed the gateway address:
 * with or without the `/v1` suffix, with or without a trailing slash.
 */
export function magpieModelsUrl(baseUrl: string): string {
	const base = (baseUrl || MAGPIE_BASE_URL).trim().replace(/\/+$/, '');
	if (!base) return MAGPIE_BASE_URL + '/models';
	return /\/v\d+$/.test(base) ? base + '/models' : base + '/v1/models';
}

function asRecord(v: unknown): Record<string, unknown> | null {
	return v !== null && typeof v === 'object' ? (v as Record<string, unknown>) : null;
}

/**
 * Read the catalog out of a `/v1/models` body. Unknown fields are ignored, and
 * an entry without a string `id` is dropped: it cannot be sent as a model.
 */
export function parseMagpieModels(body: unknown): MagpieModel[] {
	const root = asRecord(body);
	const data = root && Array.isArray(root.data) ? root.data : Array.isArray(body) ? body : [];
	const out: MagpieModel[] = [];
	for (const raw of data) {
		const m = asRecord(raw);
		if (!m || typeof m.id !== 'string' || !m.id) continue;
		out.push({
			id: m.id,
			displayName: typeof m.display_name === 'string' ? m.display_name : undefined,
			ownedBy: typeof m.owned_by === 'string' ? m.owned_by : undefined,
			contextWindow: typeof m.context_window === 'number' ? m.context_window : undefined
		});
	}
	return out;
}

/**
 * Which model a freshly enabled Magpie agent should start on.
 *
 * Keep the model already set when the gateway still lists it; otherwise prefer
 * Magpie's own auto-routing id (`auto/…`), then a routing group (`group/…`),
 * then whatever the user has enabled first. `auto/…` wins over a group because
 * it is Magpie's default pick for an agent that has no opinion, while a group
 * carries routing rules the user tuned for a different tool.
 */
export function pickDefaultMagpieModel(models: MagpieModel[], current?: string): string {
	const ids = models.map(m => m.id);
	if (current && ids.includes(current)) return current;
	return (
		ids.find(id => id.startsWith('auto/')) ??
		ids.find(id => id.startsWith('group/')) ??
		ids[0] ??
		''
	);
}
