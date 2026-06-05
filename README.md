# MVSEP Stem Separation for Ableton Live (Unofficial)

Right-click an audio clip in Ableton Live → **Separate with MVSEP** → pick any
[mvsep.com](https://mvsep.com) model → the stems come back as new, group-styled tracks.

> Unofficial. Not affiliated with, endorsed by, or supported by mvsep.com or Ableton AG.
> You need your own mvsep API token; separations consume your mvsep credits.

## Requirements

- Ableton Live with the Extensions runtime (Extension Host).
- Node ≥ 22.11.
- An mvsep API token — see <https://mvsep.com/full_api>.

## Setup

```sh
npm install
cp .env.example .env   # set EXTENSION_HOST_PATH to your Live Extension Host module
npm start              # builds (dev) and runs in the Extension Host
```

To build a distributable archive:

```sh
npm run package        # writes a .ablx
```

## Using it

1. Right-click an **audio clip** (Arrangement) or a **Session clip slot** → **Separate with MVSEP**.
2. Search/select a model, set its options + output format, paste your API token
   (optionally "remember as default"), click **Separate**.
3. Stems arrive as new tracks named `<clip> — <stem>`, tinted the original clip's color,
   with the original clip muted.
4. **To group them:** select the new tracks and press **⌘G** (Live's extension API can't
   create a group track programmatically).

## Behavior & limitations

- **Arrangement clips** render exactly what the clip plays (pre-FX, trimmed, warped) and
  place stems 1:1 at the original position. Faithful to Live's built-in stem separation.
- **Session clips** separate the clip's **source file** (no arrangement render is
  available). Unwarped clips get their region mirrored onto the stems; **warped Session
  clips are best-effort** — the placed region may not match what the clip played.
- Stems are placed **unwarped** (the Live API can't author warp markers), so they won't
  re-stretch if you change the project tempo later.
- Non-premium mvsep accounts allow **one job at a time**; v1 separates one clip per run.

## Development

```sh
npm test               # unit tests (Vitest) for the pure modules
npx tsc --noEmit       # typecheck
```
