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
		// Formatting helpers
		// ────────────────────────────────────────────────────────────

		function fmt(n) {
			if (typeof n !== "number" || !Number.isFinite(n)) return "—";
			return n.toLocaleString("en-US");
		}

		function pct(n) {
			if (typeof n !== "number" || !Number.isFinite(n)) return "—";
			return n + "%";
		}

		const BUCKET_KEYS = ["input", "cacheRead", "cacheWrite", "output"];
		const BUCKET_LABELS = { input: "Input (miss)", cacheRead: "Input (hit)", cacheWrite: "Cache write", output: "Output" };
		const BUCKET_COLORS = { input: "#3b9de0", cacheRead: "#7cc4f8", cacheWrite: "#8b5cf6", output: "#1d6fd1" };

		// ────────────────────────────────────────────────────────────
		// Data fetching
		// ────────────────────────────────────────────────────────────

		async function fetchOverview() {
			try {
				const r = await fetch("/token-dashboard/overview", { headers: { accept: "application/json" } });
				if (!r.ok) return null;
				const b = await r.json();
				return b?.ok === true ? b.value : null;
			} catch { return null; }
		}

		// ────────────────────────────────────────────────────────────
		// SVG chart primitives
		// ────────────────────────────────────────────────────────────

		const PAD = { top: 8, right: 16, bottom: 28, left: 56 };

		function niceMax(v) {
			if (v <= 0) return 100;
			const mag = Math.pow(10, Math.floor(Math.log10(v)));
			const norm = v / mag;
			const nice = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
			return nice * mag;
		}

		function niceTicks(max, count) {
			if (max <= 0) return [0];
			const step = max / count;
			const mag = Math.pow(10, Math.floor(Math.log10(step)));
			const norm = step / mag;
			const niceStep = (norm <= 1.5 ? 1 : norm <= 3 ? 2 : norm <= 7 ? 5 : 10) * mag;
			const ticks = [];
			for (let v = 0; v <= max * 1.01; v += niceStep) ticks.push(Math.round(v));
			return ticks;
		}

		function shortNum(n) {
			if (n >= 1e9) return (n / 1e9).toFixed(1) + "B";
			if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
			if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
			return String(n);
		}

		function xLabelsFor(labels, pw) {
			const n = labels.length;
			if (n === 0) return [];
			const skip = n > 20 ? Math.ceil(n / 12) : n > 10 ? Math.ceil(n / 10) : 1;
			const out = [];
			for (let i = 0; i < n; i += skip) out.push({ i, text: labels[i].slice(5) });
			return out;
		}

		function gridAndAxes(w, h, yMax, ticks) {
			const ph = h - PAD.top - PAD.bottom;
			const yScale = (v) => ph - (v / yMax) * ph;
			return [
				...ticks.map((t) => jsx("g", { key: "g" + t, children: [
					jsx("line", { x1: PAD.left, y1: PAD.top + yScale(t), x2: w - PAD.right, y2: PAD.top + yScale(t), stroke: "rgba(255,255,255,0.07)", "stroke-width": 1 }),
					jsx("text", { x: PAD.left - 6, y: PAD.top + yScale(t) + 3.5, "text-anchor": "end", fill: "#888", fontSize: 10, children: shortNum(t) })
				] }))
			];
		}

		/** Stacked bar chart. */
		function StackedBarChart({ labels, series, colors, width, height }) {
			const w = width || 760;
			const h = height || 260;
			const pw = w - PAD.left - PAD.right;
			const ph = h - PAD.top - PAD.bottom;
			const n = labels.length;
			const barW = Math.max(2, Math.min(24, pw / Math.max(n, 1) - 2));
			let yMax = 0;
			for (let i = 0; i < n; i++) {
				let sum = 0;
				for (const s of series) sum += s.values[i] || 0;
				if (sum > yMax) yMax = sum;
			}
			yMax = niceMax(yMax);
			const ticks = niceTicks(yMax, 4);
			const yScale = (v) => ph - (v / yMax) * ph;
			const xStep = pw / Math.max(n, 1);
			const xL = xLabelsFor(labels, pw);
			return jsx("svg", { viewBox: `0 0 ${w} ${h}`, style: { width: "100%", height: "auto", maxHeight: h }, children: jsxs("g", { children: [
					...gridAndAxes(w, h, yMax, ticks),
					...xL.map(({ i, text }) => jsx("text", { key: i, x: PAD.left + i * xStep + barW / 2 + 1, y: h - 4, "text-anchor": "middle", fill: "#888", fontSize: 10, children: text })),
					...labels.map((_, i) => {
						let cumY = 0;
						const rects = [];
						for (const s of series) {
							const v = s.values[i] || 0;
							const barH = (v / yMax) * ph;
							const y = PAD.top + yScale(cumY + v);
							cumY += v;
							if (barH > 0) rects.push(jsx("rect", { x: PAD.left + i * xStep + 1, y, width: barW, height: barH, fill: colors[s.key] || "#666", rx: barW > 4 ? 2 : 0 }));
						}
						return jsx("g", { key: i, children: rects });
					})
				] }) });
		}

		/** Line/area chart for one or more series. */
		function LineChart({ labels, series, width, height, fillArea }) {
			const w = width || 760;
			const h = height || 260;
			const pw = w - PAD.left - PAD.right;
			const ph = h - PAD.top - PAD.bottom;
			let yMax = 0;
			for (const s of series) for (const v of s.values) if (v > yMax) yMax = v;
			yMax = niceMax(yMax);
			const ticks = niceTicks(yMax, 4);
			const yScale = (v) => ph - (v / yMax) * ph;
			const n = labels.length;
			const xStep = n > 1 ? pw / (n - 1) : pw;
			const xScale = (i) => PAD.left + (n > 1 ? i * xStep : pw / 2);
			const xL = xLabelsFor(labels, pw);
			const paths = series.map((s) => {
				const pts = s.values.map((v, i) => `${xScale(i).toFixed(1)},${(PAD.top + yScale(v)).toFixed(1)}`);
				const line = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p}`).join(" ");
				const area = fillArea ? `${line} L${xScale(n - 1).toFixed(1)},${PAD.top + ph} L${xScale(0).toFixed(1)},${PAD.top + ph} Z` : null;
				return { line, area, color: s.color, label: s.label };
			});
			const legend = series.length > 1 ? jsx("g", { children: series.map((s, i) => jsx("g", { key: s.label, children: [
				jsx("rect", { x: PAD.left + i * 110, y: 0, width: 10, height: 10, fill: s.color, rx: 2 }),
				jsx("text", { x: PAD.left + i * 110 + 14, y: 9, fill: "#aaa", fontSize: 10, children: s.label })
			] })) }) : null;
			return jsx("svg", { viewBox: `0 0 ${w} ${h}`, style: { width: "100%", height: "auto", maxHeight: h }, children: jsxs("g", { children: [
					...gridAndAxes(w, h, yMax, ticks),
					...xL.map(({ i, text }) => jsx("text", { key: i, x: xScale(i), y: h - 4, "text-anchor": "middle", fill: "#888", fontSize: 10, children: text })),
					...paths.map((p) => jsx("g", { key: p.label, children: [
						p.area && jsx("path", { d: p.area, fill: p.color, opacity: 0.15 }),
						jsx("path", { d: p.line, fill: "none", stroke: p.color, "stroke-width": 2, "stroke-linejoin": "round" })
					] })),
					legend
				] }) });
		}

		// ────────────────────────────────────────────────────────────
		// Filter bar
		// ────────────────────────────────────────────────────────────

		const FBAR = { display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", padding: "8px 0" };
		const FGROUP = { display: "flex", alignItems: "center", gap: 4 };
		const FLABEL = { fontSize: 11, color: "#999", marginRight: 2 };
		const FINPUT = { background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 6, padding: "3px 6px", fontSize: 12, color: "#ddd", width: 110 };
		const FBTN = { background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 6, padding: "3px 8px", fontSize: 11, color: "#ccc", cursor: "pointer" };
		const FBTN_ON = { ...FBTN, background: "rgba(59,157,224,0.25)", borderColor: "#3b9de0", color: "#fff" };
		const FCHECK = { accentColor: "#3b9de0", marginRight: 3 };

		function defaultFilters(models) {
			return { from: "", to: "", models: [...models], buckets: [...BUCKET_KEYS], chartType: "stacked" };
		}

		function FilterBar({ filters, onChange, allModels }) {
			const { from, to, models, buckets, chartType } = filters;
			const set = (patch) => onChange({ ...filters, ...patch });
			return jsx("div", { style: FBAR, children: [
				jsxs("div", { style: FGROUP, children: [
					jsx("span", { style: FLABEL, children: "From" }),
					jsx("input", { type: "date", value: from, style: FINPUT, onChange: (e) => set({ from: e.target.value }) })
				] }),
				jsxs("div", { style: FGROUP, children: [
					jsx("span", { style: FLABEL, children: "To" }),
					jsx("input", { type: "date", value: to, style: FINPUT, onChange: (e) => set({ to: e.target.value }) })
				] }),
				jsx("span", { style: { ...FLABEL, marginLeft: 8 }, children: "Models" }),
				...allModels.map((m) => jsx("label", { key: m, style: { display: "flex", alignItems: "center", fontSize: 11, color: "#ccc", cursor: "pointer" }, children: [
					jsx("input", { type: "checkbox", checked: models.includes(m), style: FCHECK, onChange: (e) => {
						set({ models: e.target.checked ? [...models, m] : models.filter((x) => x !== m) });
					} }),
					m
				] })),
				jsx("span", { style: { ...FLABEL, marginLeft: 8 }, children: "Buckets" }),
				...BUCKET_KEYS.map((k) => jsx("label", { key: k, style: { display: "flex", alignItems: "center", fontSize: 11, color: "#ccc", cursor: "pointer" }, children: [
					jsx("input", { type: "checkbox", checked: buckets.includes(k), style: { ...FCHECK, accentColor: BUCKET_COLORS[k] }, onChange: (e) => {
						set({ buckets: e.target.checked ? [...buckets, k] : buckets.filter((x) => x !== k) });
					} }),
					jsx("span", { style: { color: BUCKET_COLORS[k] }, children: BUCKET_LABELS[k] })
				] })),
				jsx("span", { style: { ...FLABEL, marginLeft: 8 }, children: "Chart" }),
				...["stacked", "lines", "area"].map((t) => jsx("button", { key: t, style: chartType === t ? FBTN_ON : FBTN, onClick: () => set({ chartType: t }), children: t })),
				jsx("button", { style: { ...FBTN, marginLeft: 4 }, onClick: () => onChange(defaultFilters(allModels)), children: "Reset" })
			] });
		}

		// ────────────────────────────────────────────────────────────
		// KPI card
		// ────────────────────────────────────────────────────────────

		const CARD = { flex: "1 1 140px", minWidth: 120, padding: "10px 14px", borderRadius: 10, background: "var(--dsw-alias-surface-raised, rgba(255,255,255,0.04))" };
		const CARD_LBL = { fontSize: 11, color: "var(--dsw-alias-label-secondary, #9a9a9a)", marginBottom: 4 };
		const CARD_VAL = { fontSize: 20, fontWeight: 700, fontVariantNumeric: "tabular-nums", lineHeight: "26px" };

		function KpiCard({ label, value, accent }) {
			return jsx("div", { style: CARD, children: [
				jsx("div", { key: "l", style: { ...CARD_LBL, ...(accent ? { color: accent } : {}) }, children: label }),
				jsx("div", { key: "v", style: CARD_VAL, children: value })
			] });
		}

		// ────────────────────────────────────────────────────────────
		// Export
		// ────────────────────────────────────────────────────────────

		function download(content, name, mime) {
			const a = document.createElement("a");
			a.href = URL.createObjectURL(new Blob([content], { type: mime }));
			a.download = name;
			a.click();
			URL.revokeObjectURL(a.href);
		}

		function csvEscape(v) { return '"' + String(v).replace(/"/g, '""') + '"'; }

		function exportCSV(sessions) {
			const h = ["Session ID", "Title", "Created", "Steps", "Input", "Cache Read", "Cache Write", "Output"];
			const rows = sessions.map((s) => [
				s.id, s.title || "", s.createdAt ? new Date(s.createdAt).toISOString().slice(0, 10) : "",
				s.steps, s.buckets.input, s.buckets.cacheRead, s.buckets.cacheWrite, s.buckets.output,
			]);
			download([h.join(","), ...rows.map((r) => r.map(csvEscape).join(","))].join("\n"), "token-usage-sessions.csv", "text/csv");
		}

		function exportJSON(overview) {
			download(JSON.stringify(overview, null, 2), "token-usage-overview.json", "application/json");
		}

		// ────────────────────────────────────────────────────────────
		// OpenCode usage rings
		// ────────────────────────────────────────────────────────────

		const RING_S = 60, RING_ST = 7;

		function UsageRing({ percent, label, resetsAt }) {
			const r = (RING_S - RING_ST) / 2;
			const circ = 2 * Math.PI * r;
			const offset = circ * (1 - (percent || 0) / 100);
			const color = percent > 80 ? "#ef4444" : percent > 50 ? "#eab308" : "#22c55e";
			const reset = resetsAt ? new Date(resetsAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";
			return jsxs("div", { style: { display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }, children: [
				jsx("svg", { width: RING_S, height: RING_S, viewBox: `0 0 ${RING_S} ${RING_S}`, children: [
					jsx("circle", { cx: RING_S / 2, cy: RING_S / 2, r, fill: "none", stroke: "rgba(255,255,255,0.08)", "stroke-width": RING_ST }),
					jsx("circle", { cx: RING_S / 2, cy: RING_S / 2, r, fill: "none", stroke: color, "stroke-width": RING_ST, "stroke-dasharray": circ, "stroke-dashoffset": offset, "stroke-linecap": "round", transform: `rotate(-90 ${RING_S / 2} ${RING_S / 2})` }),
					jsx("text", { x: RING_S / 2, y: RING_S / 2 + 4, "text-anchor": "middle", fill: "#ddd", fontSize: 13, fontWeight: 700, children: pct(percent) })
				] }),
				jsx("span", { style: { fontSize: 10, color: "#999" }, children: label }),
				reset && jsx("span", { style: { fontSize: 9, color: "#666" }, children: "resets " + reset })
			] });
		}

		function OpenCodePanel({ usage }) {
			if (!usage) return null;
			return jsxs("div", { style: { padding: "12px 0", borderTop: "1px solid rgba(255,255,255,0.06)" }, children: [
				jsx("div", { style: { ...CARD_LBL, marginBottom: 8, fontSize: 12 }, children: "OpenCode Go Quotas" }),
				jsxs("div", { style: { display: "flex", gap: 20, flexWrap: "wrap" }, children: [
					jsx(UsageRing, { percent: usage.rolling?.percent, label: "Rolling", resetsAt: usage.rolling?.resetsAt }),
					jsx(UsageRing, { percent: usage.weekly?.percent, label: "Weekly", resetsAt: usage.weekly?.resetsAt }),
					jsx(UsageRing, { percent: usage.monthly?.percent, label: "Monthly", resetsAt: usage.monthly?.resetsAt }),
				] })
			] });
		}

		// ────────────────────────────────────────────────────────────
		// Main dashboard view
		// ────────────────────────────────────────────────────────────

		const SEC = { display: "flex", flexDirection: "column", gap: 6 };

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

			// Filter days
			const filteredDays = useMemo(() => {
				let days = overview.days;
				if (filters.from) days = days.filter((d) => d.day >= filters.from);
				if (filters.to) days = days.filter((d) => d.day <= filters.to);
				if (filters.models.length < allModels.length) {
					const sel = new Set(filters.models);
					days = days.map((d) => {
						const f = { day: d.day, steps: 0, byModel: {} };
						for (const k of BUCKET_KEYS) f[k] = 0;
						for (const [model, mb] of Object.entries(d.byModel ?? {})) {
							if (!sel.has(model)) continue;
							f.byModel[model] = mb;
							f.steps += mb.steps || 1;
							for (const k of BUCKET_KEYS) f[k] += mb[k] || 0;
						}
						return f;
					});
				}
				return days;
			}, [overview, filters, allModels]);

			// Filter sessions
			const filteredSessions = useMemo(() => {
				if (filters.models.length >= allModels.length) return overview.sessions;
				const sel = new Set(filters.models);
				return overview.sessions.filter((s) => Object.keys(s.byModel ?? {}).some((m) => sel.has(m)));
			}, [overview, filters, allModels]);

			// Chart data
			const labels = filteredDays.map((d) => d.day);
			const series = BUCKET_KEYS.filter((k) => filters.buckets.includes(k)).map((k) => ({ key: k, values: filteredDays.map((d) => d[k] || 0) }));
			const cacheHitData = filteredDays.map((d) => {
				const t = (d.input || 0) + (d.cacheRead || 0) + (d.cacheWrite || 0) + (d.output || 0);
				return t > 0 ? Math.round(((d.cacheRead || 0) / t) * 100) : 0;
			});
			const stepsData = filteredDays.map((d) => d.steps || 0);

			// Filtered totals
			const ft = useMemo(() => {
				const t = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, steps: 0 };
				for (const d of filteredDays) { for (const k of BUCKET_KEYS) t[k] += d[k] || 0; t.steps += d.steps || 0; }
				const billed = t.input + t.cacheRead + t.cacheWrite + t.output;
				t.cacheHitPercent = billed > 0 ? Math.round((t.cacheRead / billed) * 100) : null;
				return t;
			}, [filteredDays]);

			const chartType = filters.chartType;
			const showLines = chartType === "lines" || chartType === "area";

			return jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 16, padding: "4px 2px" }, children: [
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

				// Filters
				jsx(FilterBar, { filters, onChange: setFilters, allModels }),

				// Main chart
				labels.length > 0 && jsx("div", { style: SEC, children: [
					jsx("div", { style: { ...CARD_LBL, marginBottom: 4 }, children: "Token usage · " + chartType + " · " + labels.length + " days" }),
					showLines
						? jsx(LineChart, { labels, series: series.map((s) => ({ values: s.values, color: BUCKET_COLORS[s.key], label: BUCKET_LABELS[s.key] })), fillArea: chartType === "area" })
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

				// Per-model daily chart
				allModels.length > 1 && labels.length > 1 && jsx("div", { style: SEC, children: [
					jsx("div", { style: CARD_LBL, children: "Per-model daily tokens" }),
					jsx(LineChart, {
						labels,
						series: allModels.filter((m) => filters.models.includes(m)).map((m, i) => ({
							values: filteredDays.map((d) => {
								const mb = d.byModel?.[m];
								return mb ? (mb.input || 0) + (mb.cacheRead || 0) + (mb.cacheWrite || 0) + (mb.output || 0) : 0;
							}),
							color: ["#3b9de0", "#22c55e", "#ef4444", "#f59e0b", "#8b5cf6", "#ec4899"][i % 6],
							label: m,
						}))
					})
				] }),

				// Model summary
				overview.models.length > 0 && jsx("div", { style: SEC, children: [
					jsx("div", { style: CARD_LBL, children: "By model (all time)" }),
					...overview.models.map((model) => jsx("div", {
						key: model.model,
						style: { display: "flex", justifyContent: "space-between", padding: "3px 0", fontSize: 13, fontVariantNumeric: "tabular-nums" },
						children: [
							jsx("span", { key: "m", style: { color: "var(--dsw-alias-label-primary, #ddd)" }, children: model.model + (model.provider ? " · " + model.provider : "") }),
							jsx("span", { key: "v", children: fmt(model.input + model.cacheRead + model.cacheWrite + model.output) })
						]
					}))
				] }),

				// Sessions table with export
				filteredSessions.length > 0 && jsx("div", { style: SEC, children: [
					jsxs("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center" }, children: [
						jsx("span", { style: CARD_LBL, children: "Sessions (" + filteredSessions.length + " of " + overview.sessionCount + ")" }),
						jsx("div", { ref: exportRef, style: { position: "relative" }, children: [
							jsx("button", { style: { ...FBTN, fontSize: 11 }, onClick: () => setExportOpen(!exportOpen), children: "Export ▾" }),
							exportOpen && jsx("div", { style: { position: "absolute", right: 0, top: "100%", background: "#2a2a2c", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 8, padding: 4, zIndex: 10, minWidth: 150 }, children: [
								jsx("button", { style: { ...FBTN, width: "100%", textAlign: "left", marginBottom: 2 }, onClick: () => { exportCSV(filteredSessions); setExportOpen(false); }, children: "Export sessions as CSV" }),
								jsx("button", { style: { ...FBTN, width: "100%", textAlign: "left" }, onClick: () => { exportJSON(overview); setExportOpen(false); }, children: "Export full data as JSON" }),
							] })
						] })
					] }),
					...filteredSessions.map((session) => jsx("div", {
						key: session.id,
						title: session.id + "\n" + (session.cwd || "") + "\ninput " + fmt(session.buckets.input) + " · hit " + fmt(session.buckets.cacheRead) + " · write " + fmt(session.buckets.cacheWrite) + " · output " + fmt(session.buckets.output),
						style: { display: "flex", justifyContent: "space-between", gap: 12, padding: "3px 0", fontSize: 13, fontVariantNumeric: "tabular-nums" },
						children: [
							jsx("span", { key: "l", style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--dsw-alias-label-primary, #ddd)", flex: 1 }, children: session.title || session.id.replace(/^session-/, "").slice(0, 8) }),
							jsx("span", { key: "v", style: { flexShrink: 0 }, children: fmt(session.buckets.input + session.buckets.cacheRead + session.buckets.cacheWrite + session.buckets.output) })
						]
					}))
				] }),

				// OpenCode usage
				jsx(OpenCodePanel, { usage: overview.opencodeUsage })
			] });
		}

		// ────────────────────────────────────────────────────────────
		// Plugin entry
		// ────────────────────────────────────────────────────────────

		function TokenUsageSection() {
			const [overview, setOverview] = useState(null);
			const [failed, setFailed] = useState(false);
			useEffect(() => {
				let alive = true;
				fetchOverview().then((v) => { if (alive) { if (v === null) setFailed(true); else setOverview(v); } });
				return () => { alive = false; };
			}, []);
			if (failed) return jsx("div", { style: { padding: 16, color: "var(--dsw-alias-label-secondary, #9a9a9a)" }, children: "Token dashboard: overview route unreachable." });
			if (overview === null) return jsx("div", { style: { padding: 16, color: "var(--dsw-alias-label-secondary, #9a9a9a)" }, children: "Loading token usage…" });
			return jsx(DashboardView, { overview });
		}

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
