# AbleVSEP

Unofficial Ableton Live extension: right-click an audio clip → "Separate Stems with
MVSEP" → pick a model → stems return as new color-coded tracks. Wraps the MVSEP HTTP API
and exposes its 100+ model catalog. Requires Ableton Live **Suite** 12.4.5b5+ (Extensions are
Suite-only). Full overview: `README.md` (read on demand).

## Commands

- `npm test` — unit tests (vitest); `npm run test:watch` to watch.
- `npm run typecheck` — `tsc --noEmit`.
- `npm run build:dev` / `npm run build` — esbuild → `dist/extension.js` (prod minifies); `ui/picker.html` is inlined as a text import.
- `npm start` — build:dev, then launch the supervised dev host (reconcile → `extensions-cli run` → Ctrl-C tears down). Needs Live installed.
- `npm run dev:clean` — reap a stale/orphaned dev host, then exit.
- `npm run package` — prod build → `.ablx`. `npm run setup` — vendor SDK tarballs (gitignored `vendor/`) + install.

## Architecture

Pure, unit-tested modules; the SDK is touched only at a thin orchestration edge
(`extension.ts`, `live.ts`). Each module has a colocated `*.test.ts`.

- `mvsep/client.ts` — MVSEP HTTP API (create/status/download/checkToken/setPremiumUsage). `BASE = https://mvsep.com/api`. Hand-builds the multipart body (see runtime note).
- `mvsep/catalog.ts` — fetch/parse/versioned-cache the model list (`Algorithm[]`).
- `picker.ts` + `picker-template.ts` + `ui/picker.html` — model picker. `picker-template.ts` is the pure render/parse + gating predicates; `picker.html` is the in-webview UI and **mirrors** that gating logic (keep both in sync; see its comments).
- `separate.ts` + `separate-core.ts` — one job: capture audio → upload → poll → download → place.
- `placement.ts` + `placement-args.ts` — create/name/color the stem tracks.
- `wav.ts` (WAV header → duration) · `config.ts` (persisted token/last-model/format) · `credits.ts` (credit-cost estimate + per-plan limits) · `error-dialog.ts` (error modal) · `dev/reconcile.ts` (dev-host reconciliation).

## Runtime gotchas (Live Extension Host)

- **Shared host:** the Extension Host process is shared across all installed extensions. NEVER blanket-kill `ExtensionHostNodeModule.node`. Restart the dev extension via `npm run dev:clean` then `npm start` (or SIGINT the dev supervisor's process group — it tears down its own host). `extensions-cli` does not hot-reload: rebuild + restart to pick up changes.
- **No Node parity** in the host/webview JS runtime: `URL`, `Blob`, `FormData` are absent (`new URL()` throws). That's why `client.ts` hand-builds multipart; don't reintroduce them.
- **WKWebView (picker dialog):** defers painting freshly-built DOM until a reflow (force one after building the list); won't paint a cursor on a natively-disabled button (wrap it, use `pointer-events`); external-link navigation closes the modal with an empty payload (parse as cancel).

## Domain notes

- **Premium gating** keys off `orientation === 2` ("premium users"), NOT `price_coefficient` (that's cost, ×N). The premium-gate 400 carries its reason only in `errors[]` (no `data`). Premium-only output formats: WAV 32-bit (4), FLAC 24-bit (5).
- **Model hiding is developer-controlled**, not user-facing (hide unplaceable outputs like MIDI/ASR; keep stems/upscale/denoise).

## MVSEP API reference

Do not vendor the spec into this repo (no redistribution license). Reference ad-hoc:

- Docs: https://mvsep.com/full_api
- OpenAPI spec: https://mvsep.com/misc/mvsep-openapi-spec.json

## Conventions

- **Public copy** (README, app text, releases): write "MVSEP" all-caps; no em dashes (en dashes in ranges OK).
- **TDD:** failing test first; MVSEP logic in pure modules, SDK calls at the edge.
- Never commit your MVSEP API token — dev config persists under the gitignored `.dev/` storage.
