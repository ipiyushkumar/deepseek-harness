# dsh-token-dashboard

Token usage dashboard for DeepSeek Harness: per-session and overall
cache-hit / cache-miss input, cache-write, and output token statistics from
the durable session logs. Read-only — no cost figures, nothing written into
session logs. The only file it creates is its own scan cache under
`~/.dsh/storages/token-dashboard/cache.json`.

## Surface

- **Settings → Token Usage** (browser half): KPI cards for the four disjoint
  buckets, cache-hit percent, session count, daily stacked bars (UTC, last 60
  days), per-model totals, and per-session totals with hover breakdowns.
- **`GET /token-dashboard/overview`** (host half): the aggregated JSON payload
  `{ totals, sessionCount, days[], models[], sessions[] }`.

## Accounting

Mirrors the official `@deepseek-ai/dsh-token-meter` `tokenUsage` projection
rules: a `assistant/chunk {chunk.type:'usage'}` sample counts even when the
request later fails; `assistant/message` usage for the same `(turn, step)`
replaces it; buckets are disjoint and `reasoningTokens` stays inside output;
model attribution follows the latest `request/header` and any
`assistant/message` `message.source`.

## Data access and coupling

Event payloads are the documented `SessionEventMap` and fold exactly the
official rules above. Session *enumeration* reads the persistence directory
layout directly (`~/.dsh/sessions/<project>/<id>/session.jsonl[.zstd]`) and
decodes multi-frame zstd with `node:zlib` — the official
`sessionQuery.listSessions()` cannot enumerate historical logs in this
deployment because the web profile mounts the sqlite backend as `:memory:`
with `openAt: never`. If an upstream change moves the storage layout, the
plugin degrades to an empty dashboard (never a crash) and only
`listSessionLogs`/`decodeMultiFrameZstd` need updating.

The overview route bypasses the `/api` browser-trust fence (plain
`webServer.register`); it serves token statistics and session titles/paths to
any authority that reaches the server. Fine for the default loopback bind —
review before serving beyond loopback.

## Install / remove

```sh
pnpm dsh plugin --profile web add /path/to/local-bundles/dsh-token-dashboard
systemctl --user restart dsh-web
pnpm dsh plugin --profile web remove dsh-token-dashboard
```

Client-side changes need a page refresh; host-side changes need the restart.
