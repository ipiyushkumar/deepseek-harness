window.__ModuleLoader__.load({
	id: "dsh-token-dashboard",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const react = require("react");
		const { jsx, jsxs } = require("react/jsx-runtime");
		const { useState, useEffect, useMemo } = react;

		// Type-only merges live in the source package; the built bundle only
		// needs the runtime pieces required above.

		// ────────────────────────────────────────────────────────────
		// Data
		// ────────────────────────────────────────────────────────────

		/** Fetch the host overview; null on any failure (section shows empty state). */
		async function fetchOverview() {
			try {
				const response = await fetch("/token-dashboard/overview", { headers: { accept: "application/json" } });
				if (!response.ok) return null;
				const body = await response.json();
				if (body === null || typeof body !== "object" || body.ok !== true) return null;
				return body.value;
			} catch {
				return null;
			}
		}

		function formatCount(value) {
			if (typeof value === "number") return value.toLocaleString("en-US");
			return typeof value === "string" ? value : "0";
		}

		/** Bucket colors: cache-hit (light) → cache-miss → cache-write → output (strong). */
		const BUCKET_COLORS = {
			cacheRead: "#7cc4f8",
			input: "#3b9de0",
			cacheWrite: "#8b5cf6",
			output: "#1d6fd1"
		};

		// ────────────────────────────────────────────────────────────
		// Components
		// ────────────────────────────────────────────────────────────

		const CARD = {
			flex: "1 1 0", minWidth: 120, padding: "10px 14px",
			borderRadius: 10, background: "var(--dsw-alias-surface-raised, rgba(255,255,255,0.04))"
		};
		const CARD_LABEL = { fontSize: 11, color: "var(--dsw-alias-label-secondary, #9a9a9a)", marginBottom: 4 };
		const CARD_VALUE = { fontSize: 20, fontWeight: 700, fontVariantNumeric: "tabular-nums", lineHeight: "26px" };

		function KpiCard({ label, value, accent }) {
			return jsx("div", { style: CARD, children: [
				jsx("div", { key: "l", style: { ...CARD_LABEL, ...(accent ? { color: accent } : {}) }, children: label }),
				jsx("div", { key: "v", style: CARD_VALUE, children: formatCount(value) })
			] });
		}

		/** One day's stacked token bar, heights relative to the busiest day. */
		function DayBar({ day, max }) {
			const segments = [
				{ key: "cacheRead", value: day.cacheRead },
				{ key: "input", value: day.input },
				{ key: "cacheWrite", value: day.cacheWrite },
				{ key: "output", value: day.output }
			].filter((segment) => segment.value > 0);
			const total = day.input + day.cacheRead + day.cacheWrite + day.output;
			const height = max > 0 ? Math.max(2, Math.round((total / max) * 120)) : 2;
			// NOTE: this bundle is hand-written against the automatic JSX
			// runtime, where children ride INSIDE props — a third jsx()
			// argument is the key, not children.
			return jsx("div", {
				key: day.day,
				title: `${day.day} · ${formatCount(total)} tokens (input ${formatCount(day.input)}, cache-hit ${formatCount(day.cacheRead)}, cache-write ${formatCount(day.cacheWrite)}, output ${formatCount(day.output)})`,
				style: { display: "flex", flexDirection: "column", justifyContent: "flex-end", alignItems: "center", width: 22, height: 124 },
				children: jsx("div", {
					style: { display: "flex", flexDirection: "column", width: "100%", height, borderRadius: 3, overflow: "hidden" },
					children: segments.map((segment) => jsx("div", {
						key: segment.key,
						style: { background: BUCKET_COLORS[segment.key], flex: String(segment.value) }
					}))
				})
			});
		}

		function TokenUsageSection() {
			const [overview, setOverview] = useState(null);
			const [failed, setFailed] = useState(false);
			useEffect(() => {
				let alive = true;
				fetchOverview().then((value) => {
					if (!alive) return;
					if (value === null) setFailed(true);
					else setOverview(value);
				});
				return () => { alive = false; };
			}, []);
			if (failed) {
				return jsx("div", { style: { padding: 16, color: "var(--dsw-alias-label-secondary, #9a9a9a)" }, children: "Token dashboard: overview route unreachable. Is the host plugin mounted?" });
			}
			if (overview === null) {
				return jsx("div", { style: { padding: 16, color: "var(--dsw-alias-label-secondary, #9a9a9a)" }, children: "Loading token usage…" });
			}
			return jsx(DashboardView, { overview });
		}

		/** Pure presentational view over one overview payload (no data fetching). */
		function DashboardView({ overview }) {
			const totals = overview.totals;
			const days = overview.days.slice(-60);
			const sessions = overview.sessions.slice(0, 50);
			const maxDay = useMemo(() => {
				let max = 0;
				for (const day of days) max = Math.max(max, day.input + day.cacheRead + day.cacheWrite + day.output);
				return max;
			}, [overview]);
			return jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 20, padding: "4px 2px" }, children: [
				jsx("div", { key: "cards", style: { display: "flex", gap: 10, flexWrap: "wrap" }, children: [
					jsx(KpiCard, { key: "in", label: "Input (cache miss)", value: totals.input }),
					jsx(KpiCard, { key: "hit", label: "Input (cache hit)", value: totals.cacheRead, accent: BUCKET_COLORS.cacheRead }),
					jsx(KpiCard, { key: "write", label: "Cache write", value: totals.cacheWrite }),
					jsx(KpiCard, { key: "out", label: "Output", value: totals.output, accent: BUCKET_COLORS.output }),
					jsx(KpiCard, { key: "hitpct", label: "Cache hit", value: totals.cacheHitPercent === null ? "—" : `${totals.cacheHitPercent}%` }),
					jsx(KpiCard, { key: "sessions", label: "Sessions", value: overview.sessionCount })
				] }),
				days.length > 0 && jsx("div", { key: "days", children: [
					jsx("div", { key: "t", style: { ...CARD_LABEL, marginBottom: 8 }, children: "Daily tokens (UTC, last 60 days) — hover for breakdown" }),
					jsx("div", { key: "row", style: { display: "flex", alignItems: "flex-end", gap: 2, overflowX: "auto", paddingBottom: 4 }, children: days.map((day) => jsx(DayBar, { key: day.day, day, max: maxDay })) })
				] }),
				overview.models.length > 0 && jsx("div", { key: "models", children: [
					jsx("div", { key: "t", style: { ...CARD_LABEL, marginBottom: 6 }, children: "By model" }),
					...overview.models.slice(0, 10).map((model) => jsx("div", {
						key: model.model,
						style: { display: "flex", justifyContent: "space-between", padding: "3px 0", fontSize: 13, fontVariantNumeric: "tabular-nums" },
						children: [
							jsx("span", { key: "m", style: { color: "var(--dsw-alias-label-primary, #ddd)" }, children: `${model.model}${model.provider ? ` · ${model.provider}` : ""}` }),
							jsx("span", { key: "v", children: formatCount(model.input + model.cacheRead + model.cacheWrite + model.output) })
						]
					}))
				] }),
				sessions.length > 0 && jsx("div", { key: "sessions", children: [
					jsx("div", { key: "t", style: { ...CARD_LABEL, marginBottom: 6 }, children: `Sessions by recency (top ${sessions.length} of ${overview.sessionCount})` }),
					...sessions.map((session) => jsx("div", {
						key: session.id,
						title: `${session.id}\n${session.cwd ?? ""}\ninput ${formatCount(session.buckets.input)} · cache-hit ${formatCount(session.buckets.cacheRead)} · cache-write ${formatCount(session.buckets.cacheWrite)} · output ${formatCount(session.buckets.output)}`,
						style: { display: "flex", justifyContent: "space-between", gap: 12, padding: "3px 0", fontSize: 13, fontVariantNumeric: "tabular-nums" },
						children: [
							jsx("span", { key: "l", style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--dsw-alias-label-primary, #ddd)" }, children: session.title ?? session.id.replace(/^session-/, "").slice(0, 8) }),
							jsx("span", { key: "v", style: { flexShrink: 0 }, children: formatCount(session.buckets.input + session.buckets.cacheRead + session.buckets.cacheWrite + session.buckets.output) })
						]
					}))
				] })
			] });
		}

		// ────────────────────────────────────────────────────────────
		// Plugin body
		// ────────────────────────────────────────────────────────────

		const inject = ["slots"];
		function apply(ctx) {
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "token-usage",
				order: 60,
				label: "Token Usage"
			}, TokenUsageSection));
		}

		exports.apply = apply;
		exports.inject = inject;
		exports.TokenUsageSection = TokenUsageSection;
		exports.DashboardView = DashboardView;
		return module.exports;
	}
});
