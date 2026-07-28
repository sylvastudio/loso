# Loso — Faceless Short-Video Studio

A single-tenant web app that turns a **written script + your branding + your own API keys**
into a polished, captioned, voiced **9:16 vertical short video (MP4)**.

Paste a script; Loso voices it (ElevenLabs `eleven_v3`), syncs captions word-for-word
(Groq Whisper word timestamps), builds an AI shot list (Anthropic), sources visuals (Pexels),
and renders a branded video with **Remotion 4**.

## Stack

- **Next.js 15** (App Router, TypeScript) — UI + API in one process
- **Remotion 4** — in-editor Player preview + server-side H.264 MP4 render
- **SQLite** (`better-sqlite3`) — projects, brand, keys, assets at `./data/`
- **Tailwind v4** — editorial dark UI (Fraunces / Schibsted Grotesk / IBM Plex Mono)

## Getting started

```bash
pnpm install
pnpm dev
```

Open http://localhost:3000, then in **Settings**:

1. **API Keys** — add your own ElevenLabs, Groq, Anthropic, and Pexels keys
   (SerpApi optional). Keys are stored server-side in the local SQLite DB and
   never reach the browser. Missing keys degrade features gracefully.
2. **Brand** — name, logo, colors, fonts, tone words, presenter avatars,
   intro/outro, music bed.

Create a project, paste a script, pick a voice, hit **Generate voiceover** —
the script is speech-normalized (numbers/money/% expanded to words), synthesized,
transcribed with word-level timestamps, and previewed with karaoke captions in
the Remotion Player.

## Status

- [x] **M1** — App shell, Settings (keys + brand profile), persistence
- [x] **M2** — Script → normalized TTS → word-synced karaoke captions in the Remotion Player
- [ ] **M3** — AI shot list, pace-aware timeline, auto-sourced visuals
- [ ] **M4** — Branding overlays + detached render job → MP4 download
- [ ] **M5** — Editor polish: image library, refine prompts, pronunciation dictionary
