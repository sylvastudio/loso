# Loso — Faceless Short-Video Studio

A single-tenant web app for making short videos two ways:

- **AI short** — turn a **written script + your branding + your own API keys** into a
  polished, captioned, voiced vertical short. Paste a script; Loso voices it (ElevenLabs
  `eleven_v3`), syncs captions word-for-word (Groq Whisper word timestamps), builds an AI
  shot list (Anthropic), sources visuals (Pexels), and renders with **Remotion 4**.
- **Compositor** — a **manual, no-AI canvas editor**. Drag in video, images, audio, and text,
  position them on any-size canvas, animate them in, and export a real MP4. No API keys needed.

You pick the mode when creating a project.

## Stack

- **Next.js 15** (App Router, TypeScript) — UI + API in one process
- **Remotion 4** — in-editor Player preview, live card thumbnails, and server-side
  H.264 MP4 render (`@remotion/renderer` + `@remotion/bundler`, headless Chromium)
- **SQLite** (`better-sqlite3`) — projects, brand, keys, content-hashed assets at `./data/`
  (rendered MP4s land in `./data/renders/`)
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

## Compositor mode (manual, no AI)

A layer-based canvas editor for assembling a video by hand. No API keys required.

### Create one

Projects → **New** → choose **Compositor** → **Create**. The project opens in the canvas
editor instead of the script editor. (AI-short projects still open the old script editor —
the mode is stored per project.)

### The editor at a glance

- **Left rail** — canvas setup (output size/fps/duration/background), an **Add** tray
  (Video / Image / Audio / Text), and the **layer list** (select, reorder = z-order, delete).
- **Center stage** — a live Remotion Player of your composition, scaled to fit. Drag the
  selected layer to move it; drag the corner handles to resize. Drop files here to upload.
- **Right inspector** — every property of the selected layer.
- **Header** — Undo / Redo and the **Export video** button.

### Build a composition

1. **Set the canvas first** (left rail → *Output*): pick a preset (9:16, 16:9, 1:1, 4:5) or
   type a custom `Width × Height`, set `FPS` and length in `Secs`, and a background color.
   Do this first — new layers size themselves to the canvas.
2. **Add layers.** Drag a video / image / audio / logo straight onto the stage (or use the
   **Add** buttons); click **Text** to add a copy block. Uploads are content-hashed and stored
   under `./data/assets`.
3. **Position & size.** Drag on the stage, or set exact `X/Y/W/H` in the inspector. Use
   **Align to canvas** (left/center/right · top/middle/bottom) to snap a layer to the frame.
4. **Style** (per layer): corner **Radius**, **Border** width + color, opacity, rotation, and
   `Cover`/`Contain` fit for media. Text has font, size, weight, color, **italic**, and align.
5. **Animate in** (per layer): choose **Fade**, **Rise**, **Scale**, or **Hero** (starts big &
   centered, springs to its position — great for a logo), with a **Delay** and **Duration** in
   frames. Stagger the delays to choreograph an intro.
6. **Timing** (per layer): `Start` frame and `Length` on the timeline.
7. **Export.** Hit **Export video** — Loso bundles the composition and renders a real H.264 MP4
   (with audio) via headless Chromium. The result is saved to `./data/renders/<projectId>.mp4`
   and offered as a **Download MP4** link.

### Good to know

- **Layer types:** `video` (trim + volume), `image`, `text` (multi-line — press Enter for a
  line break), and `audio` (a music/sound track, mixed into the export).
- **Fonts** are loaded from Google Fonts automatically for any family used by a text layer, so
  the export matches the preview. Pick from the font dropdown (Inter, Playfair Display,
  Montserrat, DM Serif Display, …).
- **Undo / redo:** `⌘Z` / `⇧⌘Z` (Ctrl on Windows/Linux) or the header buttons. A drag or slider
  sweep collapses into a single undo step. History is per editing session (resets on reload).
- **Live thumbnails:** the Projects page shows a real frame of each compositor project (past its
  intro animation) as the card poster.
- **First export is slow** (~1 min): it downloads a headless Chromium once. Later renders are
  much faster. Long/large videos take proportionally longer.
- **Editing in the app vs. externally:** the editor autosaves. If you edit a project's data
  outside the app while its tab is open, reload the page first so the editor doesn't overwrite
  your changes on its next autosave.

## Status

- [x] **M1** — App shell, Settings (keys + brand profile), persistence
- [x] **M2** — Script → normalized TTS → word-synced karaoke captions in the Remotion Player
- [x] **Compositor** — manual, no-AI canvas editor: layers (video/image/text/audio),
  drag/resize, align, radius/border, spring **animate-in**, undo/redo, live card thumbnails,
  and server-side MP4 export
- [ ] **M3** — AI shot list, pace-aware timeline, auto-sourced visuals
- [ ] **M4** — Branding overlays + detached render job → MP4 download
- [ ] **M5** — Editor polish: image library, refine prompts, pronunciation dictionary
