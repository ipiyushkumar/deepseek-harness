/**
 * dsh-token-dashboard — node half.
 *
 * Aggregates token usage (cache-hit / cache-miss input, cache-write, output)
 * across ALL persisted session logs and serves one read-only JSON overview
 * route for the browser half. Nothing is written into session logs; the only
 * file this plugin creates is its own scan cache under
 * `$DSH_HOME/storages/token-dashboard/cache.json`.
 *
 * Accounting mirrors the official `@deepseek-ai/dsh-token-meter` `tokenUsage`
 * projection rules (documented in its README):
 *  - `assistant/chunk {chunk.type:'usage'}` is an early sample that counts
 *    even when the request later fails;
 *  - `assistant/message` usage for the same `(turn, step)` REPLACES that
 *    sample instead of double-counting it;
 *  - the four buckets are disjoint; `reasoningTokens` is already inside
 *    `outputTokens` and is never added again;
 *  - model attribution: the latest `request/header` `config.{provider,model}`
 *    at the step's position; an `assistant/message` carrying
 *    `message.source.{provider,model}` wins for its own step.
 *
 * Session logs are multi-frame zstd (the persistence layer appends one frame
 * per flush batch), so decoding splits the file on the zstd frame magic and
 * decompresses frame-by-frame with `node:zlib`.
 */

import { createZstdDecompress, zstdDecompressSync } from 'node:zlib';
import { readdirSync, readFileSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

/** Stable Cordis plugin name. */
export const name = 'dsh-token-dashboard';

/** Services required before the plugin body runs. */
export const inject = ['webServer'];

/** Overview route path registered on the web server. */
export const OVERVIEW_PATH = '/token-dashboard/overview';

/** Zstd frame magic (little-endian 0xFD2FB528). */
const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);

// ────────────────────────────────────────────────────────────────
// Multi-frame zstd decoding
// ────────────────────────────────────────────────────────────────

/**
 * Decode one concatenated-frames zstd buffer.
 * @param buffer - raw file bytes.
 * @returns the decompressed UTF-8 text.
 */
export function decodeMultiFrameZstd(buffer) {
	if (buffer.length === 0) return '';
	const starts = [];
	for (let i = 0; i + 4 <= buffer.length; i++) {
		if (buffer[i] === 0x28 && buffer[i + 1] === 0xb5 && buffer[i + 2] === 0x2f && buffer[i + 3] === 0xfd) starts.push(i);
	}
	if (starts.length === 0) throw new Error('no zstd frame magic found');
	if (starts[0] !== 0) throw new Error('file does not start with a zstd frame');
	const parts = [];
	for (let s = 0; s < starts.length; s++) {
		let end = s + 1 < starts.length ? starts[s + 1] : buffer.length;
		for (;;) {
			try {
				parts.push(zstdDecompressSync(buffer.subarray(starts[s], end)));
				break;
			} catch (error) {
				if (end < buffer.length) {
					const next = starts.findIndex((value) => value > end);
					end = next === -1 ? buffer.length : starts[next];
					continue;
				}
				throw error;
			}
		}
	}
	return Buffer.concat(parts).toString('utf8');
}

// ────────────────────────────────────────────────────────────────
// Usage fold
// ────────────────────────────────────────────────────────────────

/** Four disjoint usage buckets, all zeros. */
function zeroBuckets() {
	return { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 };
}

/** Add the right-hand buckets into the left-hand buckets in place. */
function addBuckets(left, right) {
	left.input += right.input;
	left.cacheRead += right.cacheRead;
	left.cacheWrite += right.cacheWrite;
	left.output += right.output;
}

/** Coerce a possibly-missing token field to a non-negative finite number. */
function toNumber(value) {
	const n = typeof value === 'number' ? value : Number(value);
	return Number.isFinite(n) && n >= 0 ? n : 0;
}

/** Read the four disjoint buckets from one provider `usage` object. */
function bucketsOf(usage) {
	if (usage === null || typeof usage !== 'object') return null;
	return {
		input: toNumber(usage.inputTokens),
		cacheRead: toNumber(usage.cacheReadTokens),
		cacheWrite: toNumber(usage.cacheWriteTokens),
		output: toNumber(usage.outputTokens),
	};
}

/** UTC calendar day (YYYY-MM-DD) of one epoch-millisecond timestamp. */
function utcDay(time) {
	return new Date(time).toISOString().slice(0, 10);
}

/**
 * Fold one session log's event stream into per-session usage totals.
 * @returns the per-session aggregate, or null when the log carries no usage.
 */
export function foldSessionLog(text, seed) {
	const state = {
		id: seed.id, cwd: seed.cwd, title: undefined, createdAt: undefined,
		buckets: zeroBuckets(), steps: 0,
		byModel: new Map(), byDay: new Map(),
		dayModels: new Map(), // day -> Map<model, buckets>
		firstTs: undefined, lastTs: undefined,
		pending: new Map(),
		attribution: { provider: undefined, model: undefined },
	};
	for (const line of text.split('\n')) {
		if (line.length === 0) continue;
		let event;
		try { event = JSON.parse(line); } catch { continue; }
		if (event === null || typeof event !== 'object') continue;
		if (event.type === 'session') {
			if (typeof event.id === 'string') state.id = event.id;
			if (typeof event.cwd === 'string') state.cwd = event.cwd;
			if (typeof event.createdAt === 'number') state.createdAt = event.createdAt;
			continue;
		}
		const data = event.data;
		if (data === undefined || typeof data !== 'object') continue;
		if (event.type === 'session/title') {
			if (typeof data.title === 'string' && data.title.length > 0) state.title = data.title;
			continue;
		}
		if (event.type === 'request/header') {
			const config = data.header?.config;
			if (config !== null && typeof config === 'object') {
				if (typeof config.provider === 'string') state.attribution.provider = config.provider;
				if (typeof config.model === 'string' && config.model.length > 0) state.attribution.model = config.model;
			}
			continue;
		}
		if (event.type !== 'assistant/chunk' && event.type !== 'assistant/message') continue;
		if (typeof data.turn !== 'number' || typeof data.step !== 'number') continue;
		const stepKey = `${data.turn}:${data.step}`;
		if (event.type === 'assistant/chunk') {
			const chunk = data.chunk;
			if (chunk === null || typeof chunk !== 'object' || chunk.type !== 'usage') continue;
			const buckets = bucketsOf(chunk.usage);
			if (buckets === null) continue;
			state.pending.set(stepKey, { buckets, time: typeof event.time === 'number' ? event.time : undefined });
			continue;
		}
		const message = data.message;
		const source = message !== null && typeof message === 'object' ? message.source : undefined;
		if (source !== null && typeof source === 'object') {
			if (typeof source.provider === 'string') state.attribution.provider = source.provider;
			if (typeof source.model === 'string' && source.model.length > 0) state.attribution.model = source.model;
		}
		const replacement = bucketsOf(data.usage);
		const sample = state.pending.get(stepKey);
		if (replacement !== null) {
			state.pending.set(stepKey, { buckets: replacement, time: typeof event.time === 'number' ? event.time : undefined });
		}
		if (sample === undefined && replacement === null) continue;
		const committed = state.pending.get(stepKey);
		state.pending.delete(stepKey);
		commitSample(state, stepKey, committed);
	}
	for (const [stepKey, sample] of state.pending) commitSample(state, stepKey, sample);
	state.pending = undefined;
	if (state.steps === 0) return null;
	return {
		id: state.id, cwd: state.cwd, title: state.title, createdAt: state.createdAt,
		buckets: state.buckets, steps: state.steps,
		byModel: Object.fromEntries(state.byModel),
		byDay: Object.fromEntries(state.byDay),
		dayModels: Object.fromEntries([...state.dayModels].map(([day, m]) => [day, Object.fromEntries(m)])),
		firstTs: state.firstTs, lastTs: state.lastTs,
	};
}

/** Commit one (turn,step) sample into the totals, model, and day maps. */
function commitSample(state, stepKey, sample) {
	const buckets = sample.buckets;
	const time = sample.time ?? state.createdAt;
	state.steps += 1;
	addBuckets(state.buckets, buckets);
	const model = state.attribution.model ?? 'unknown';
	if (time !== undefined) {
		if (state.firstTs === undefined || time < state.firstTs) state.firstTs = time;
		if (state.lastTs === undefined || time > state.lastTs) state.lastTs = time;
		const day = utcDay(time);
		let dayBucket = state.byDay.get(day);
		if (dayBucket === undefined) state.byDay.set(day, dayBucket = { day, ...zeroBuckets(), steps: 0 });
		addBuckets(dayBucket, buckets);
		dayBucket.steps += 1;
		// Per-day-per-model breakdown
		let dayModelMap = state.dayModels.get(day);
		if (dayModelMap === undefined) state.dayModels.set(day, dayModelMap = new Map());
		let dayModelBucket = dayModelMap.get(model);
		if (dayModelBucket === undefined) dayModelMap.set(model, dayModelBucket = zeroBuckets());
		addBuckets(dayModelBucket, buckets);
	}
	let modelBucket = state.byModel.get(model);
	if (modelBucket === undefined) {
		state.byModel.set(model, modelBucket = { model, provider: state.attribution.provider, ...zeroBuckets(), steps: 0 });
	}
	addBuckets(modelBucket, buckets);
	modelBucket.steps += 1;
}

// ────────────────────────────────────────────────────────────────
// Session discovery + scan cache
// ────────────────────────────────────────────────────────────────

function dshHome() {
	const fromEnv = process.env.DSH_HOME;
	return fromEnv !== undefined && fromEnv.trim().length > 0 ? fromEnv : join(homedir(), '.dsh');
}

export function listSessionLogs(home) {
	const root = join(home, 'sessions');
	const out = [];
	let workspaces;
	try { workspaces = readdirSync(root, { withFileTypes: true }); } catch { return out; }
	for (const workspace of workspaces) {
		if (!workspace.isDirectory()) continue;
		const workspacePath = join(root, workspace.name);
		let sessions;
		try { sessions = readdirSync(workspacePath, { withFileTypes: true }); } catch { continue; }
		for (const session of sessions) {
			if (!session.isDirectory()) continue;
			for (const suffix of ['session.jsonl.zstd', 'session.jsonl']) {
				const file = join(workspacePath, session.name, suffix);
				let stats;
				try { stats = statSync(file); } catch { continue; }
				out.push({
					file, workspace: workspace.name,
					id: session.name.startsWith('session-') ? session.name : `session-${session.name}`,
					size: stats.size, mtimeMs: stats.mtimeMs,
				});
				break;
			}
		}
	}
	return out;
}

function signatureOf(entry) {
	return `${entry.size}:${Math.round(entry.mtimeMs)}`;
}

export function buildOverview(home, cacheFile) {
	let cache = { files: {}, sessions: {} };
	try { cache = JSON.parse(readFileSync(cacheFile, 'utf8')); } catch (error) {
		if (error.code !== 'ENOENT') cache = { files: {}, sessions: {} };
	}
	if (cache === null || typeof cache !== 'object' || typeof cache.files !== 'object') cache = { files: {}, sessions: {} };
	const entries = listSessionLogs(home);
	const nextFiles = {};
	const sessions = [];
	let changed = false;
	for (const entry of entries) {
		const signature = signatureOf(entry);
		const cached = cache.files[entry.file];
		let aggregate;
		if (cached !== undefined && cached.signature === signature && cache.sessions[cached.id] !== undefined) {
			aggregate = cache.sessions[cached.id];
		} else {
			let text;
			try {
				const raw = readFileSync(entry.file);
				text = entry.file.endsWith('.zstd') ? decodeMultiFrameZstd(raw) : raw.toString('utf8');
			} catch {
				continue;
			}
			aggregate = foldSessionLog(text, { id: entry.id, cwd: undefined });
			if (aggregate === null) aggregate = { id: entry.id, empty: true };
			changed = true;
		}
		nextFiles[entry.file] = { signature, id: aggregate.id };
		sessions.push(aggregate);
	}
	sessions.sort((left, right) => (right.lastTs ?? 0) - (left.lastTs ?? 0));
	const overview = aggregateOverview(sessions);
	if (changed || Object.keys(nextFiles).length !== Object.keys(cache.files).length) {
		try {
			mkdirSync(join(cacheFile, '..'), { recursive: true });
			writeFileSync(cacheFile, JSON.stringify({ files: nextFiles, sessions: Object.fromEntries(sessions.map((s) => [s.id, s])) }));
		} catch {
			// Cache write is best-effort.
		}
	}
	return overview;
}

/** Sum per-session aggregates into the overall payload. */
function aggregateOverview(sessions) {
	const totals = zeroBuckets();
	const days = new Map();
	const models = new Map();
	let steps = 0;
	let live = 0;
	for (const session of sessions) {
		if (session.empty === true) continue;
		live += 1;
		steps += session.steps;
		addBuckets(totals, session.buckets);
		for (const day of Object.values(session.byDay ?? {})) {
			let bucket = days.get(day.day);
			if (bucket === undefined) days.set(day.day, bucket = { day: day.day, ...zeroBuckets(), steps: 0, byModel: {} });
			addBuckets(bucket, day);
			bucket.steps += day.steps;
			// Merge per-day-per-model
			const dayModels = session.dayModels?.[day.day];
			if (dayModels !== undefined) {
				for (const [model, modelBuckets] of Object.entries(dayModels)) {
					if (bucket.byModel[model] === undefined) bucket.byModel[model] = zeroBuckets();
					addBuckets(bucket.byModel[model], modelBuckets);
				}
			}
		}
		for (const model of Object.values(session.byModel ?? {})) {
			let bucket = models.get(model.model);
			if (bucket === undefined) models.set(model.model, bucket = { model: model.model, provider: model.provider, ...zeroBuckets(), steps: 0 });
			addBuckets(bucket, model);
			bucket.steps += model.steps;
		}
	}
	const billedInput = totals.input + totals.cacheRead + totals.cacheWrite;
	const cacheHit = billedInput + totals.output > 0
		? Math.round((totals.cacheRead / (billedInput + totals.output)) * 100)
		: null;
	return {
		totals: { ...totals, steps, cacheHitPercent: cacheHit },
		sessionCount: live,
		days: [...days.values()].sort((a, b) => (a.day < b.day ? -1 : 1)),
		models: [...models.values()].sort((a, b) => modelTotal(b) - modelTotal(a)),
		sessions: sessions
			.filter((s) => s.empty !== true)
			.map((s) => ({
				id: s.id, title: s.title, cwd: s.cwd, createdAt: s.createdAt,
				firstTs: s.firstTs, lastTs: s.lastTs, steps: s.steps,
				buckets: s.buckets, byModel: s.byModel,
			})),
	};
}

function modelTotal(entry) {
	return entry.input + entry.cacheRead + entry.cacheWrite + entry.output;
}

// ────────────────────────────────────────────────────────────────
// OpenCode usage proxy (best-effort, 5-min cache)
// ────────────────────────────────────────────────────────────────

let opencodeCache = { data: null, ts: 0 };
const OPENCODE_TTL_MS = 5 * 60 * 1000;

async function fetchOpenCodeUsage(home) {
	if (Date.now() - opencodeCache.ts < OPENCODE_TTL_MS && opencodeCache.data !== null) {
		return opencodeCache.data;
	}
	let key;
	try {
		const text = readFileSync(join(home, '.credentials.yaml'), 'utf8');
		const match = text.match(/OPENCODE_GO_API_KEY:\s*(.+)/);
		if (match) key = match[1].trim();
	} catch {}
	if (!key) return null;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 5000);
	try {
		const response = await fetch('https://opencode.ai/zen/go/v1/usage', {
			headers: { Authorization: `Bearer ${key}` },
			signal: controller.signal,
		});
		clearTimeout(timer);
		if (!response.ok) return null;
		const body = await response.json();
		const usage = body?.usage ?? body;
		opencodeCache = { data: usage, ts: Date.now() };
		return usage;
	} catch {
		clearTimeout(timer);
		return null;
	}
}

// ────────────────────────────────────────────────────────────────
// Plugin body
// ────────────────────────────────────────────────────────────────

export function apply(ctx) {
	const home = dshHome();
	const cacheFile = join(home, 'storages', 'token-dashboard', 'cache.json');
	const handler = async (req, res) => {
		if (req.method !== 'GET' && req.method !== 'HEAD') {
			res.writeHead(405, { 'content-type': 'application/json' });
			res.end(JSON.stringify({ ok: false, error: { code: 'method-not-allowed', message: 'GET only' } }));
			return;
		}
		try {
			const overview = buildOverview(home, cacheFile);
			overview.opencodeUsage = await fetchOpenCodeUsage(home);
			res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
			res.end(JSON.stringify({ ok: true, value: overview }));
		} catch (error) {
			res.writeHead(500, { 'content-type': 'application/json' });
			res.end(JSON.stringify({ ok: false, error: { code: 'overview-failed', message: error instanceof Error ? error.message : String(error) } }));
		}
	};
	ctx.effect(
		() => ctx.webServer.register({ kind: 'exact', path: OVERVIEW_PATH, handler }),
		'token-dashboard: overview route',
	);
}
