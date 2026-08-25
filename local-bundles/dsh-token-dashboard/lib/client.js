window.__ModuleLoader__.load({
	id: "dsh-token-dashboard",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const react = require("react");
		const { jsx, jsxs } = require("react/jsx-runtime");
		const { useState, useEffect, useMemo, useRef } = react;

		// ────────────────────────────────────────────────────────────
		// Constants & helpers
		// ────────────────────────────────────────────────────────────

		const BUCKET_KEYS = ["input", "cacheRead", "cacheWrite", "output"];
		const BUCKET_LABELS = { input: "Input (miss)", cacheRead: "Input (hit)", cacheWrite: "Cache write", output: "Output" };
		const BUCKET_COLORS = { input: "#3b9de0", cacheRead: "#7cc4f8", cacheWrite: "#8b5cf6", output: "#1d6fd1" };

		function fmt(n) { return typeof n === "number" && Number.isFinite(n) ? n.toLocaleString("en-US") : "—"; }
		function pct(n) { return typeof n === "number" && Number.isFinite(n) ? n + "%" : "—"; }
		function shortNum(n) {
			if (n >= 1e9) return (n / 1e9).toFixed(1) + "B";
			if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
			if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
			return String(n);
		}
		function timeUntil(iso) {
			if (!iso) return "";
			const ms = new Date(iso).getTime() - Date.now();
			if (ms <= 0) return "now";
			const h = Math.floor(ms / 3600000);
			const m = Math.floor((ms % 3600000) / 60000);
			return h > 0 ? h + "h " + m + "m" : m + "m";
		}
		function csvEscape(v) { return '"' + String(v).replace(/"/g, '""') + '"'; }

		// ────────────────────────────────────────────────────────────
		// Data fetching (shared by all components)
		// ────────────────────────────────────────────────────────────

		let _cache = null;
		let _cacheTs = 0;
		const CACHE_TTL = 30000; // 30s client-side dedup

		async function fetchOverview() {
			if (_cache && Date.now() - _cacheTs < CACHE_TTL) return _cache;
			try {
				const r = await fetch("/token-dashboard/overview", { headers: { accept: "application/json" } });
				if (!r.ok) return null;
				const b = await r.json();
				if (b?.ok !== true) return null;
				_cache = b.value;
				_cacheTs = Date.now();
				return _cache;
			} catch { return null; }
		}

		// ────────────────────────────────────────────────────────────
		// Shared hook
		// ────────────────────────────────────────────────────────────

		function useOverview() {
			const [data, setData] = useState(null);
			const [failed, setFailed] = useState(false);
			useEffect(() => {
				let alive = true;
				fetchOverview().then((v) => { if (alive) { if (v === null) setFailed(true); else setData(v); } });
				return () => { alive = false; };
			}, []);
			return { data, failed };
		}

		// ────────────────────────────────────────────────────────────
		// SVG chart primitives
		// ────────────────────────────────────────────────────────────

		const PAD = { top: 10, right: 16, bottom: 30, left: 58 };

		function niceMax(v) {
			if (v <= 0) return 100;
			const mag = Math.pow(10, Math.floor(Math.log10(v)));
			const norm = v / mag;
			return (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
		}

		function niceTicks(max, count) {
			if (max <= 0) return [0];
			const step = max / count;
			const mag = Math.pow(10, Math.floor(Math.log10(step)));
			const norm = step / mag;
			const ns = (norm <= 1.5 ? 1 : norm <= 3 ? 2 : norm <= 7 ? 5 : 10) * mag;
			const t = [];
			for (let v = 0; v <= max * 1.01; v += ns) t.push(Math.round(v));
			return t;
		}

		function xLabelsFor(labels) {
			const n = labels.length;
			const skip = n > 20 ? Math.ceil(n / 10) : n > 10 ? Math.ceil(n / 8) : 1;
			const out = [];
			for (let i = 0; i < n; i += skip) out.push({ i, text: labels[i].slice(5) });
			return out;
		}

		function GridAndAxes({ w, h, yMax, ticks }) {
			const ph = h - PAD.top - PAD.bottom;
			const yScale = (v) => ph - (v / yMax) * ph;
			return jsx("g", { children: [
				...ticks.map((t) => jsx("g", { key: t, children: [
					jsx("line", { x1: PAD.left, y1: PAD.top + yScale(t), x2: w - PAD.right, y2: PAD.top + yScale(t), stroke: "rgba(255,255,255,0.06)", "stroke-width": 1 }),
					jsx("text", { x: PAD.left - 8, y: PAD.top + yScale(t) + 3.5, "text-anchor": "end", fill: "#777", fontSize: 10, children: shortNum(t) })
				] }))
			] });
		}

		function StackedBarChart({ labels, series, colors, width, height }) {
			const w = width || 760, h = height || 280;
			const pw = w - PAD.left - PAD.right, ph = h - PAD.top - PAD.bottom;
			const n = labels.length;
			const barW = Math.max(3, Math.min(22, pw / Math.max(n, 1) - 2));
			let yMax = 0;
			for (let i = 0; i < n; i++) { let s = 0; for (const sr of series) s += sr.values[i] || 0; if (s > yMax) yMax = s; }
			yMax = niceMax(yMax);
			const ticks = niceTicks(yMax, 4);
			const yScale = (v) => ph - (v / yMax) * ph;
			const xStep = pw / Math.max(n, 1);
			const xL = xLabelsFor(labels);
			return jsx("svg", { viewBox: "0 0 " + w + " " + h, style: { width: "100%", height: "auto" }, children: [
				jsx(GridAndAxes, { w, h, yMax, ticks }),
				...xL.map(({ i, text }) => jsx("text", { key: i, x: PAD.left + i * xStep + barW / 2 + 1, y: h - 6, "text-anchor": "middle", fill: "#777", fontSize: 10, children: text })),
				...labels.map((_, i) => {
					let cumY = 0;
					const rects = [];
					for (const s of series) {
						const v = s.values[i] || 0;
						const barH = (v / yMax) * ph;
						const y = PAD.top + yScale(cumY + v);
						cumY += v;
						if (barH > 0) rects.push(jsx("rect", { x: PAD.left + i * xStep + 1, y, width: barW, height: barH, fill: colors[s.key] || "#666", rx: barW > 5 ? 2 : 0 }));
					}
					return jsx("g", { key: i, children: rects });
				})
			] });
		}

		function LineChart({ labels, series, width, height, fillArea }) {
			const w = width || 760, h = height || 280;
			const pw = w - PAD.left - PAD.right, ph = h - PAD.top - PAD.bottom;
			let yMax = 0;
			for (const s of series) for (const v of s.values) if (v > yMax) yMax = v;
			yMax = niceMax(yMax);
			const ticks = niceTicks(yMax, 4);
			const yScale = (v) => ph - (v / yMax) * ph;
			const n = labels.length;
			const xStep = n > 1 ? pw / (n - 1) : pw;
			const xScale = (i) => PAD.left + (n > 1 ? i * xStep : pw / 2);
			const xL = xLabelsFor(labels);
			const paths = series.map((s) => {
				const pts = s.values.map((v, i) => xScale(i).toFixed(1) + "," + (PAD.top + yScale(v)).toFixed(1));
				const line = pts.map((p, i) => (i === 0 ? "M" : "L") + p).join(" ");
				const area = fillArea ? line + " L" + xScale(n - 1).toFixed(1) + "," + (PAD.top + ph) + " L" + xScale(0).toFixed(1) + "," + (PAD.top + ph) + " Z" : null;
				return { line, area, color: s.color, label: s.label };
			});
			return jsx("svg", { viewBox: "0 0 " + w + " " + h, style: { width: "100%", height: "auto" }, children: [
				jsx(GridAndAxes, { w, h, yMax, ticks }),
				...xL.map(({ i, text }) => jsx("text", { key: i, x: xScale(i), y: h - 6, "text-anchor": "middle", fill: "#777", fontSize: 10, children: text })),
				...paths.map((p) => jsx("g", { key: p.label, children: [
					p.area && jsx("path", { d: p.area, fill: p.color, opacity: 0.12 }),
					jsx("path", { d: p.line, fill: "none", stroke: p.color, "stroke-width": 2, "stroke-linejoin": "round" })
				] })),
				series.length > 1 && jsx("g", { children: series.map((s, i) => jsx("g", { key: s.label, children: [
					jsx("rect", { x: PAD.left + i * 110, y: 2, width: 10, height: 10, fill: s.color, rx: 2 }),
					jsx("text", { x: PAD.left + i * 110 + 14, y: 11, fill: "#999", fontSize: 10, children: s.label })
				] })) })
			] });
		}

		// ────────────────────────────────────────────────────────────
		// Shared UI primitives
		// ────────────────────────────────────────────────────────────

		const CARD = { flex: "1 1 140px", minWidth: 120, padding: "12px 16px", borderRadius: 12, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" };
		const CARD_LBL = { fontSize: 11, color: "#888", marginBottom: 4, letterSpacing: "0.02em" };
		const CARD_VAL = { fontSize: 22, fontWeight: 700, fontVariantNumeric: "tabular-nums", lineHeight: "28px" };
		const SEC = { display: "flex", flexDirection: "column", gap: 6 };

		function KpiCard({ label, value, accent }) {
			return jsx("div", { style: CARD, children: [
				jsx("div", { key: "l", style: { ...CARD_LBL, ...(accent ? { color: accent } : {}) }, children: label }),
				jsx("div", { key: "v", style: { ...CARD_VAL, ...(accent ? { color: accent } : {}) }, children: value })
			] });
		}

		const FBTN = { background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6, padding: "4px 10px", fontSize: 11, color: "#bbb", cursor: "pointer", transition: "background 0.15s" };
		const FBTN_ON = { ...FBTN, background: "rgba(59,157,224,0.2)", borderColor: "#3b9de0", color: "#fff" };
		const FLBL = { fontSize: 11, color: "#777", marginRight: 2 };
		const FINPUT = { background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6, padding: "3px 8px", fontSize: 12, color: "#ddd", width: 115 };

		// ────────────────────────────────────────────────────────────
		// Filter bar
		// ────────────────────────────────────────────────────────────

		function defaultFilters(models) {
			return { from: "", to: "", models: [...models], buckets: [...BUCKET_KEYS], chartType: "stacked" };
		}

		function FilterBar({ filters, onChange, allModels }) {
			const { from, to, models, buckets, chartType } = filters;
			const set = (p) => onChange({ ...filters, ...p });
			return jsx("div", { style: { display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", padding: "10px 0", borderBottom: "1px solid rgba(255,255,255,0.06)" }, children: [
				jsxs("div", { style: { display: "flex", alignItems: "center", gap: 4 }, children: [
					jsx("span", { style: FLBL, children: "From" }),
					jsx("input", { type: "date", value: from, style: FINPUT, onChange: (e) => set({ from: e.target.value }) })
				] }),
				jsxs("div", { style: { display: "flex", alignItems: "center", gap: 4 }, children: [
					jsx("span", { style: FLBL, children: "To" }),
					jsx("input", { type: "date", value: to, style: FINPUT, onChange: (e) => set({ to: e.target.value }) })
				] }),
				jsx("span", { style: { ...FLBL, marginLeft: 6 }, children: "Models" }),
				...allModels.map((m) => jsx("label", { key: m, style: { display: "flex", alignItems: "center", fontSize: 11, color: "#bbb", cursor: "pointer", gap: 3 }, children: [
					jsx("input", { type: "checkbox", checked: models.includes(m), style: { accentColor: "#3b9de0" }, onChange: (e) => set({ models: e.target.checked ? [...models, m] : models.filter((x) => x !== m) }) }),
					m
				] })),
				jsx("span", { style: { ...FLBL, marginLeft: 6 }, children: "View" }),
				...BUCKET_KEYS.map((k) => jsx("label", { key: k, style: { display: "flex", alignItems: "center", fontSize: 11, color: "#bbb", cursor: "pointer", gap: 3 }, children: [
					jsx("input", { type: "checkbox", checked: buckets.includes(k), style: { accentColor: BUCKET_COLORS[k] }, onChange: (e) => set({ buckets: e.target.checked ? [...buckets, k] : buckets.filter((x) => x !== k) }) }),
					jsx("span", { style: { color: BUCKET_COLORS[k] }, children: BUCKET_LABELS[k] })
				] })),
				jsx("span", { style: { ...FLBL, marginLeft: 6 }, children: "Chart" }),
				...["stacked", "lines", "area"].map((t) => jsx("button", { key: t, style: chartType === t ? FBTN_ON : FBTN, onClick: () => set({ chartType: t }), children: t })),
				jsx("button", { style: { ...FBTN, marginLeft: 4 }, onClick: () => onChange(defaultFilters(allModels)) }, null)
			] });
		}

		// ────────────────────────────────────────────────────────────
		// Export
		// ────────────────────────────────────────────────────────────

		function download(content, name, mime) {
			const a = document.createElement("a");
			a.href = URL.createObjectURL(new Blob([content], { type: mime }));
			a.download = name; a.click(); URL.revokeObjectURL(a.href);
		}

		function exportCSV(sessions) {
			const h = ["Session ID", "Title", "Created", "Steps", "Input", "Cache Read", "Cache Write", "Output"];
			const rows = sessions.map((s) => [s.id, s.title || "", s.createdAt ? new Date(s.createdAt).toISOString().slice(0, 10) : "", s.steps, s.buckets.input, s.buckets.cacheRead, s.buckets.cacheWrite, s.buckets.output]);
			download([h.join(","), ...rows.map((r) => r.map(csvEscape).join(","))].join("\n"), "token-usage-sessions.csv", "text/csv");
		}

		function exportJSON(overview) {
			download(JSON.stringify(overview, null, 2), "token-usage-overview.json", "application/json");
		}

		// ────────────────────────────────────────────────────────────
		// OpenCode ring gauge (reusable)
		// ────────────────────────────────────────────────────────────

		const RING_S = 72, RING_ST = 6;

		function RingGauge({ percent, label, resetsAt, size }) {
			const s = size || RING_S;
			const r = (s - RING_ST * 2) / 2;
			const circ = 2 * Math.PI * r;
			const offset = circ * (1 - Math.min(percent || 0, 100) / 100);
			const color = percent > 80 ? "#ef4444" : percent > 50 ? "#eab308" : "#22c55e";
			const remaining = timeUntil(resetsAt);
			return jsxs("div", { style: { display: "flex", flexDirection: "column", alignItems: "center", gap: 6, minWidth: 90 }, children: [
				jsx("svg", { width: s, height: s, viewBox: "0 0 " + s + " " + s, children: [
					jsx("circle", { cx: s / 2, cy: s / 2, r, fill: "none", stroke: "rgba(255,255,255,0.06)", "stroke-width": RING_ST }),
					jsx("circle", { cx: s / 2, cy: s / 2, r, fill: "none", stroke: color, "stroke-width": RING_ST, "stroke-dasharray": circ, "stroke-dashoffset": offset, "stroke-linecap": "round", transform: "rotate(-90 " + s / 2 + " " + s / 2 + ")", style: { transition: "stroke-dashoffset 0.6s ease" } }),
					jsx("text", { x: s / 2, y: s / 2 + 1, "text-anchor": "middle", "dominant-baseline": "central", fill: "#eee", fontSize: s > 60 ? 16 : 12, fontWeight: 700, children: pct(percent) })
				] }),
				jsx("div", { style: { textAlign: "center" }, children: [
					jsx("div", { style: { fontSize: 11, color: "#aaa", fontWeight: 500 }, children: label }),
					remaining && jsx("div", { style: { fontSize: 9, color: "#666", marginTop: 2 }, children: "resets " + remaining })
				] })
			] });
		}

		/** Compact progress bar for the composer dock. */
		function MiniBar({ percent, label, color }) {
			const p = Math.min(percent || 0, 100);
			const c = color || (p > 80 ? "#ef4444" : p > 50 ? "#eab308" : "#22c55e");
			return jsxs("div", { style: { display: "flex", alignItems: "center", gap: 6, fontSize: 11 }, children: [
				jsx("span", { style: { color: "#999", minWidth: 50, textAlign: "right" }, children: label }),
				jsx("div", { style: { flex: 1, height: 4, background: "rgba(255,255,255,0.08)", borderRadius: 2, overflow: "hidden", minWidth: 40 }, children: jsx("div", { style: { width: p + "%", height: "100%", background: c, borderRadius: 2, transition: "width 0.4s ease" } }) }),
				jsx("span", { style: { color: "#ccc", fontVariantNumeric: "tabular-nums", minWidth: 28 }, children: pct(p) })
			] });
		}

		// ────────────────────────────────────────────────────────────
		// 1. TOKEN USAGE — Settings section
		// ────────────────────────────────────────────────────────────

		function TokenUsageSection() {
			const { data: overview, failed } = useOverview();
			if (failed) return jsx("div", { style: { padding: 16, color: "#888" }, children: "Token dashboard: overview route unreachable." });
			if (!overview) return jsx("div", { style: { padding: 16, color: "#888" }, children: "Loading token usage…" });
			return jsx(DashboardView, { overview });
		}

		function DashboardView({ overview }) {
			const allModels = useMemo(() => overview.models.map((m) => m.model), [overview]);
			const [filters, setFilters] = useState(() => defaultFilters(allModels));
			const [exportOpen, setExportOpen] = useState(false);
			const exportRef = useRef(null);

			useEffect(() => {
				if (!exportOpen) return;
				const h = (e) => { if (exportRef.current && !exportRef.current.contains(e.target)) setExportOpen(false); };
				document.addEventListener("mousedown", h);
				return () => document.removeEventListener("mousedown", h);
			}, [exportOpen]);

			const filteredDays = useMemo(() => {
				let d = overview.days;
				if (filters.from) d = d.filter((x) => x.day >= filters.from);
				if (filters.to) d = d.filter((x) => x.day <= filters.to);
				if (filters.models.length < allModels.length) {
					const sel = new Set(filters.models);
					d = d.map((x) => {
						const f = { day: x.day, steps: 0, byModel: {} };
						for (const k of BUCKET_KEYS) f[k] = 0;
						for (const [model, mb] of Object.entries(x.byModel ?? {})) {
							if (!sel.has(model)) continue;
							f.byModel[model] = mb; f.steps += mb.steps || 1;
							for (const k of BUCKET_KEYS) f[k] += mb[k] || 0;
						}
						return f;
					});
				}
				return d;
			}, [overview, filters, allModels]);

			const filteredSessions = useMemo(() => {
				if (filters.models.length >= allModels.length) return overview.sessions;
				const sel = new Set(filters.models);
				return overview.sessions.filter((s) => Object.keys(s.byModel ?? {}).some((m) => sel.has(m)));
			}, [overview, filters, allModels]);

			const labels = filteredDays.map((d) => d.day);
			const series = BUCKET_KEYS.filter((k) => filters.buckets.includes(k)).map((k) => ({ key: k, values: filteredDays.map((d) => d[k] || 0) }));
			const cacheHitData = filteredDays.map((d) => { const t = (d.input||0)+(d.cacheRead||0)+(d.cacheWrite||0)+(d.output||0); return t > 0 ? Math.round(((d.cacheRead||0)/t)*100) : 0; });
			const stepsData = filteredDays.map((d) => d.steps || 0);

			const ft = useMemo(() => {
				const t = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, steps: 0 };
				for (const d of filteredDays) { for (const k of BUCKET_KEYS) t[k] += d[k] || 0; t.steps += d.steps || 0; }
				const billed = t.input + t.cacheRead + t.cacheWrite + t.output;
				t.cacheHitPercent = billed > 0 ? Math.round((t.cacheRead / billed) * 100) : null;
				return t;
			}, [filteredDays]);

			const ct = filters.chartType;
			const isLine = ct === "lines" || ct === "area";

			return jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 20, padding: "4px 0" }, children: [
				// KPI cards
				jsxs("div", { style: { display: "flex", gap: 10, flexWrap: "wrap" }, children: [
					jsx(KpiCard, { key: "in", label: "Input (cache miss)", value: fmt(ft.input) }),
					jsx(KpiCard, { key: "hit", label: "Input (cache hit)", value: fmt(ft.cacheRead), accent: BUCKET_COLORS.cacheRead }),
					jsx(KpiCard, { key: "wr", label: "Cache write", value: fmt(ft.cacheWrite) }),
					jsx(KpiCard, { key: "out", label: "Output", value: fmt(ft.output), accent: BUCKET_COLORS.output }),
					jsx(KpiCard, { key: "pct", label: "Cache hit", value: pct(ft.cacheHitPercent) }),
					jsx(KpiCard, { key: "st", label: "Steps", value: fmt(ft.steps) }),
					jsx(KpiCard, { key: "ns", label: "Sessions", value: fmt(filteredSessions.length) }),
				] }),

				jsx(FilterBar, { filters, onChange: setFilters, allModels }),

				// Main chart
				labels.length > 0 && jsx("div", { style: SEC, children: [
					jsx("div", { style: { ...CARD_LBL, marginBottom: 4 }, children: "Token usage · " + ct + " · " + labels.length + " days" }),
					isLine
						? jsx(LineChart, { labels, series: series.map((s) => ({ values: s.values, color: BUCKET_COLORS[s.key], label: BUCKET_LABELS[s.key] })), fillArea: ct === "area" })
						: jsx(StackedBarChart, { labels, series, colors: BUCKET_COLORS })
				] }),

				// Cache hit % trend
				labels.length > 1 && jsx("div", { style: SEC, children: [
					jsx("div", { style: CARD_LBL, children: "Cache hit % trend" }),
					jsx(LineChart, { labels, series: [{ values: cacheHitData, color: "#22c55e", label: "Cache hit %" }], fillArea: true })
				] }),

				// Steps per day
				labels.length > 1 && jsx("div", { style: SEC, children: [
					jsx("div", { style: CARD_LBL, children: "Steps per day" }),
					jsx(LineChart, { labels, series: [{ values: stepsData, color: "#f59e0b", label: "Steps" }], fillArea: true })
				] }),

				// Per-model daily
				allModels.length > 1 && labels.length > 1 && jsx("div", { style: SEC, children: [
					jsx("div", { style: CARD_LBL, children: "Per-model daily tokens" }),
					jsx(LineChart, { labels, series: allModels.filter((m) => filters.models.includes(m)).map((m, i) => ({
						values: filteredDays.map((d) => { const mb = d.byModel?.[m]; return mb ? (mb.input||0)+(mb.cacheRead||0)+(mb.cacheWrite||0)+(mb.output||0) : 0; }),
						color: ["#3b9de0","#22c55e","#ef4444","#f59e0b","#8b5cf6","#ec4899"][i % 6], label: m,
					})) })
				] }),

				// Model summary
				overview.models.length > 0 && jsx("div", { style: SEC, children: [
					jsx("div", { style: CARD_LBL, children: "By model (all time)" }),
					...overview.models.map((model) => jsx("div", { key: model.model, style: { display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 13, fontVariantNumeric: "tabular-nums", borderBottom: "1px solid rgba(255,255,255,0.04)" }, children: [
						jsx("span", { key: "m", style: { color: "#ddd" }, children: model.model + (model.provider ? " · " + model.provider : "") }),
						jsx("span", { key: "v", style: { color: "#aaa" }, children: fmt(model.input + model.cacheRead + model.cacheWrite + model.output) })
					] }))
				] }),

				// Sessions + export
				filteredSessions.length > 0 && jsx("div", { style: SEC, children: [
					jsxs("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }, children: [
						jsx("span", { style: CARD_LBL, children: "Sessions (" + filteredSessions.length + " of " + overview.sessionCount + ")" }),
						jsx("div", { ref: exportRef, style: { position: "relative" }, children: [
							jsx("button", { style: FBTN, onClick: () => setExportOpen(!exportOpen), children: "Export ▾" }),
							exportOpen && jsx("div", { style: { position: "absolute", right: 0, top: "100%", background: "#222", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, padding: 6, zIndex: 10, minWidth: 170, boxShadow: "0 8px 24px rgba(0,0,0,0.4)" }, children: [
								jsx("button", { style: { ...FBTN, width: "100%", textAlign: "left", marginBottom: 4 }, onClick: () => { exportCSV(filteredSessions); setExportOpen(false); }, children: "📄 Sessions as CSV" }),
								jsx("button", { style: { ...FBTN, width: "100%", textAlign: "left" }, onClick: () => { exportJSON(overview); setExportOpen(false); }, children: "📋 Full data as JSON" })
							] })
						] })
					] }),
					...filteredSessions.map((session) => jsx("div", {
						key: session.id,
						title: session.id + "\n" + (session.cwd || "") + "\ninput " + fmt(session.buckets.input) + " · hit " + fmt(session.buckets.cacheRead) + " · write " + fmt(session.buckets.cacheWrite) + " · output " + fmt(session.buckets.output),
						style: { display: "flex", justifyContent: "space-between", gap: 12, padding: "5px 0", fontSize: 13, fontVariantNumeric: "tabular-nums", borderBottom: "1px solid rgba(255,255,255,0.04)" },
						children: [
							jsx("span", { key: "l", style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#ddd", flex: 1 }, children: session.title || session.id.replace(/^session-/, "").slice(0, 8) }),
							jsx("span", { key: "v", style: { flexShrink: 0, color: "#aaa" }, children: fmt(session.buckets.input + session.buckets.cacheRead + session.buckets.cacheWrite + session.buckets.output) })
						]
					}))
				] })
			] });
		}

		// ────────────────────────────────────────────────────────────
		// 2. OPENCODE QUOTAS — Settings section
		// ────────────────────────────────────────────────────────────

		function OpenCodeQuotasSection(props) {
			const hook = useOverview();
			const overview = props.overview || hook.data;
			const failed = !overview && hook.failed;
			if (failed) return jsx("div", { style: { padding: 16, color: "#888" }, children: "Route unreachable." });
			if (!overview) return jsx("div", { style: { padding: 16, color: "#888" }, children: "Loading…" });
			const u = overview.opencodeUsage;
			if (!u) return jsx("div", { style: { padding: 16, color: "#888" }, children: "No OpenCode Go API key found in credentials." });
			return jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 24, padding: "8px 0" }, children: [
				// Ring gauges
				jsxs("div", { style: { display: "flex", gap: 24, flexWrap: "wrap", justifyContent: "center" }, children: [
					jsx(RingGauge, { percent: u.rolling?.percent, label: "5-hour rolling", resetsAt: u.rolling?.resetsAt }),
					jsx(RingGauge, { percent: u.weekly?.percent, label: "Weekly · all models", resetsAt: u.weekly?.resetsAt }),
					jsx(RingGauge, { percent: u.monthly?.percent, label: "Monthly · all models", resetsAt: u.monthly?.resetsAt }),
				] }),

				// Detail bars
				jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 12, padding: "16px", borderRadius: 12, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }, children: [
					jsx("div", { style: { ...CARD_LBL, fontSize: 12, marginBottom: 4 }, children: "Usage breakdown" }),
					jsx(MiniBar, { percent: u.rolling?.percent, label: "5-hour" }),
					jsx(MiniBar, { percent: u.weekly?.percent, label: "Weekly" }),
					jsx(MiniBar, { percent: u.monthly?.percent, label: "Monthly" }),
				] }),

				// Raw data
				jsxs("div", { style: { padding: "12px 16px", borderRadius: 12, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }, children: [
					jsx("div", { style: { ...CARD_LBL, fontSize: 12, marginBottom: 8 }, children: "Raw data" }),
					jsx("pre", { style: { fontSize: 11, color: "#999", margin: 0, whiteSpace: "pre-wrap", fontFamily: "monospace" }, children: JSON.stringify(u, null, 2) })
				] })
			] });
		}

		// ────────────────────────────────────────────────────────────
		// 3. STATS LINE — compact quota alongside turns/steps/LLM time
		// ────────────────────────────────────────────────────────────

		function StatsLineQuota() {
			const [usage, setUsage] = useState(null);
			useEffect(() => {
				let alive = true;
				fetchOverview().then((v) => { if (alive && v?.opencodeUsage) setUsage(v.opencodeUsage); });
				return () => { alive = false; };
			}, []);
			if (!usage) return null;
			return jsxs("span", { style: { display: "inline-flex", alignItems: "center", gap: 8, fontSize: 11, color: "#888" }, children: [
				jsx(MiniBar, { percent: usage.rolling?.percent, label: "5h" }),
				jsx(MiniBar, { percent: usage.weekly?.percent, label: "wk" }),
				jsx(MiniBar, { percent: usage.monthly?.percent, label: "mo" }),
			] });
		}

		// ────────────────────────────────────────────────────────────
		// Plugin registration
		// ────────────────────────────────────────────────────────────

		const inject = ["slots"];
		function apply(ctx) {
			// Settings: Token Usage
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section", id: "token-usage", order: 60, label: "Token Usage"
			}, TokenUsageSection));

			// Settings: OpenCode Quotas
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section", id: "opencode-quotas", order: 65, label: "OpenCode Quotas"
			}, OpenCodeQuotasSection));

			// Stats line: compact quota alongside turns/steps/LLM time
			ctx.slots.inject("conversation.composer.dock", () => ctx.slots.register({
				name: "conversation.composer.dock", id: "token-dashboard-stats", order: 1, label: "OC Quotas"
			}, StatsLineQuota));
		}

		exports.apply = apply;
		exports.inject = inject;
		exports.TokenUsageSection = TokenUsageSection;
		exports.DashboardView = DashboardView;
		exports.OpenCodeQuotasSection = OpenCodeQuotasSection;
		exports.StatsLineQuota = StatsLineQuota;
		return module.exports;
	}
});
