# AbleVSEP

[![CI](https://github.com/madisonrickert/ablevsep/actions/workflows/ci.yml/badge.svg)](https://github.com/madisonrickert/ablevsep/actions/workflows/ci.yml)
[![Latest release](https://img.shields.io/github/v/release/madisonrickert/ablevsep?label=release)](https://github.com/madisonrickert/ablevsep/releases/latest)
[![License: MIT](https://img.shields.io/github/license/madisonrickert/ablevsep)](LICENSE)
[![Ableton Live Suite 12.4.5b5+](https://img.shields.io/badge/Ableton%20Live%20Suite-12.4.5b5%2B-black)](https://www.ableton.com/en/live/extensions)
[![Stars](https://img.shields.io/github/stars/madisonrickert/ablevsep?style=flat)](https://github.com/madisonrickert/ablevsep/stargazers)

Right-click an audio clip in Ableton Live → **Separate Stems with MVSEP** → pick any
[MVSEP](https://mvsep.com) model → the stems come back as new, group-styled tracks.
It mirrors Live's built-in Stem Separation workflow, but exposes MVSEP's model
catalog (100+ models) instead of one fixed algorithm.

![AbleVSEP: separate any audio clip into stems with any of MVSEP's 100+ models, right inside Ableton Live](docs/social-preview.png)

## Features

- Separate an **Arrangement audio clip** into stems.
- **Smart model picker:** search 100+ MVSEP models by name or category, sorted by
  popularity, with community ★ ratings and each model's variant options.
- **Premium-aware:** live credit-cost estimates, gating for premium-only models and output
  formats, an in-app premium-usage toggle, and pre-upload checks against your plan's limits.
- Stems land as new adjacent tracks named `<clip> - <stem>`, each in its own track color
  for easy visual separation, with the original muted (press ⌘G to fold them into a group).
- Cancellable progress; your API token and last-used model are remembered.

## How it works

When you run a separation, AbleVSEP captures the clip's audio, sends it to MVSEP for
separation, and brings the stems back into your set. For an **Arrangement** clip it renders
exactly what plays (pre-FX, trimmed, and warped). The audio is uploaded with the model you
chose, and AbleVSEP polls the job until it finishes, showing progress you can cancel at any
point. When the stems are ready, it downloads them and places each on its own new track
beside the original.

All MVSEP-facing logic lives in pure, unit-tested modules; the Ableton SDK is touched only at
a thin orchestration edge.

![A clip being separated into stems, which arrive as new color-coded tracks in the arrangement (2× speed)](docs/demo.gif)

## Requirements

To install and use AbleVSEP you need only **Ableton Live Suite 12.4.5b5+ with Extensions**
(Extensions are a Suite-only feature, currently in the Live 12 beta; tested on 12.4.5b6) and
an **MVSEP API token** ([get one](https://mvsep.com/full_api)). The `.ablx` is self-contained
and runs inside Live's Extension Host, so you do **not** need Node.js or the SDK installed to
use it. Separations run on your MVSEP account, and premium models spend your MVSEP credits.

## Install

Download the latest **`.ablx`** from the
[**Releases** page](https://github.com/madisonrickert/ablevsep/releases/latest) (or build
one, see [Build from source](#build-from-source)), then:

1. In Ableton Live, open **Preferences → Extensions** (with Developer Mode **off**, so Live
   manages the extension).
2. Drag the `.ablx` onto that page.

## Usage

1. Right-click an **audio clip in the Arrangement** → **Separate Stems with MVSEP**.
2. Search/select a model, set its options + output format, paste your MVSEP API token
   (optionally "remember as default"), click **Separate**.
3. Stems arrive as new tracks named `<clip> - <stem>`, each in its own track color, with
   the original muted.
4. **To group them:** select the new tracks and press **⌘G** (Live's extension API can't
   create a group track programmatically).

> **Session clips aren't supported yet.** The Live Extensions API can render **Arrangement**
> audio but not a Session clip's audio, so to separate a Session clip, drag it into the
> Arrangement first.

![The model picker: search 100+ MVSEP models, pick variant options and output format, and paste your API token](docs/screenshot-picker.png)

## Your MVSEP token & privacy

AbleVSEP talks only to MVSEP. Your API token is stored locally in the extension's
private storage folder (managed by Live's Extension Host) and is sent only to MVSEP's
API over HTTPS to run separations. AbleVSEP has no analytics or telemetry and makes no
other network calls. To replace a saved token, click **Replace** in the picker; to revoke
it entirely, regenerate it on [MVSEP](https://mvsep.com/full_api).

## Build from source

Building from source needs **Node.js ≥ 24** and the **Ableton Extensions SDK (beta)**, which
is distributed by Ableton, not published to npm, and **not** bundled here. Obtain the SDK, then:

1. Download and unpack the Extensions SDK (e.g. `extensions-sdk-1.0.0-beta.0`).
2. Tell the project where it is and install:
   ```bash
   cp .env.example .env
   # set ABLETON_SDK_PATH to your unpacked SDK, e.g. /path/to/extensions-sdk-1.0.0-beta.0
   pnpm run setup
   ```
   `pnpm run setup` copies the SDK tarballs into `./vendor/` (git-ignored) and installs all
   dependencies. Set the path once and you never edit `package.json`.

## Develop

The fastest loop uses Live's Developer Mode and an externally-launched Extension Host:

1. In your `.env`, set **`EXTENSION_HOST_PATH`** to your Live app, pointed at the Beta for
   live iteration, e.g. `/Applications/Ableton Live 12 Beta.app`.
2. In Live: **Preferences → Extensions → enable Developer Mode** (Live releases its managed
   host so the externally-launched one can connect).
3. Build and launch the host (leave it running):
   ```bash
   pnpm start
   ```
   `pnpm start` builds in dev mode and runs `extensions-cli run`, pointing storage/temp at
   `./.dev/` (git-ignored) so your token and catalog cache persist between runs.
4. Right-click an audio clip → **Separate Stems with MVSEP**.

## Build & package

```bash
pnpm run build               # production bundle → dist/extension.js
pnpm run package             # build + package the installable → release/<name>-<version>.ablx
pnpm run package -- --reveal # same, then reveal the .ablx in Finder (macOS)
```

`pnpm run package` writes the installable to `release/` (git-ignored), clearing any older
`.ablx` first so there's only ever the current one. Install it by dropping the `.ablx` onto
Live's **Extensions** preferences (with Developer Mode **off**).

## Test

```bash
pnpm test           # unit tests (Vitest) for the SDK-independent modules
pnpm run typecheck  # type-check the extension
```


## Other extensions by the developer

- [AbleTab](https://github.com/madisonrickert/abletab): View any Ableton Live MIDI clip as tablature for guitar, bass, or other
- [Sheet Music](https://github.com/madisonrickert/ableton-sheet-music-extension): View an Ableton Live MIDI clip as sheet music

---

> **Disclaimer.** AbleVSEP is an independent, unofficial client of [MVSEP](https://mvsep.com)'s
> public API, not an Ableton or MVSEP product. "Ableton" and "MVSEP" are trademarks of their
> respective owners. You bring your own MVSEP account and API token, and separations consume your
> MVSEP credits.

> **Disclosure.** MVSEP's creator provided complimentary premium credits to support AbleVSEP's
> development, with no conditions attached. The project is built and maintained independently.
