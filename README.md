# Loso — Faceless Short-Video Studio

A local, single-user web app for making short videos. It has a built-in **studio agent that runs on
your own AI model**: OpenAI, xAI Grok, Anthropic Claude, Google Gemini, Groq, OpenRouter, or a local model
via Ollama / LM Studio. You can also drive Loso from Claude Code, Cursor or Codex over **MCP**.

Two kinds of project:

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

(`npm install && npm run dev` works too. If an install gets interrupted and the app throws
*"Could not locate the bindings file"* or *"Cannot find native binding"*, delete `node_modules`
and install again, because a half-downloaded native binary is the usual cause.)

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
- **Keyboard:** arrows nudge the selected layer 1px (`⇧` = 10px), `⌫` deletes, `⌘D` duplicates,
  `[` / `]` send back / bring forward, `Esc` deselects. The empty inspector lists them too.
- **Names:** uploaded layers are named after their file; double-click a layer to rename it.
  Click the project title in the header to rename the project.
- **Saving:** the header shows *Saving… / Saved / Save failed — retry*. Export always saves your
  latest edit first, and a *Download previous export* link means the MP4 predates your edits.
- **Live thumbnails:** the Projects page shows a real frame of each compositor project (past its
  intro animation) as the card poster.
- **First export is slow** (~1 min): it downloads a headless Chromium once. Later renders are
  much faster. Long/large videos take proportionally longer.
- **Editing in the app vs. externally:** the editor autosaves. If you edit a project's data
  outside the app while its tab is open, reload the page first so the editor doesn't overwrite
  your changes on its next autosave.

## Studio agent: bring your own model

Every Compositor project has an **Agent** tab (next to **Layer** in the right rail). You chat with it
like a video editor. It works on the live canvas, so you watch the layers appear as it builds.

**1. Connect a model:** go to Settings → **AI model**, pick a provider, paste a key (local servers need
none), choose a model with **Load models**, then press **Test model**. The test checks whether the model
can **call tools** (required) and **see images** (strongly recommended: it lets the agent read contact
sheets, study your reference screenshots and check its own layouts).

| Provider | Notes |
| --- | --- |
| OpenAI · xAI (Grok) · Groq · OpenRouter · custom | One OpenAI-compatible adapter; change the base URL for any compatible server |
| Anthropic (Claude) | Native Messages API adapter |
| Google Gemini | Native generateContent adapter |
| Ollama · LM Studio | Local, no key. Use a model that supports tool calling; a vision model (e.g. a Qwen-VL / LLaVA variant) unlocks the visual tools |

**Transcription** (word timings drive every cut): OpenAI (`whisper-1`) or Groq keys transcribe with
word timings. Otherwise Loso uses **local Whisper** (`pip install mlx-whisper` on Apple Silicon, or
`openai-whisper`) or a saved Groq key. The same layer powers AI Short captions.

**2. Talk to it.** For example:

> Make a 30-second short from the clips in ~/Downloads/Excerpt: the sermon plus audience reactions.
> Here's the look I want [attach screenshot]. Ask me what you need first.

It works the way the Sunday Galore video was made:

1. **Survey:** it scans the folder in place (footage is never copied), reads a contact sheet per clip,
   and transcribes the speech.
2. **Ask:** questions it can't decide itself (card text, sound, style, captions) appear as a small form.
3. **Storyboard:** it proposes the edit beat by beat (what's heard, what's seen, the caption), with real
   frames from your footage. You approve it or ask for changes. Nothing is cut before you approve.
4. **Cut:** after one more **Go ahead**, it cuts between sentences (cut points snap to word boundaries),
   crops every shot to the video box, cleans up and levels the voice, and adds short dissolves.
5. **Build:** it lays out the design (or applies a template), adds captions, then **renders a frame and
   looks at it** to catch wrapping text, overlaps and bad crops before handing back.
6. **Render:** it exports the MP4 when you ask (with one more confirmation).

- **Undo:** everything the agent changed in a turn is one undo step (**Undo turn** in the chat header, or ⌘Z).
- **Locking:** while it works, the canvas is locked so your edits and its edits can't collide.
  **Stop** ends the turn.
- **History:** the chat is saved per project. Clearing it keeps the canvas.

## Templates

A template is a saved design whose **slots** change for each video (a title, a date, the main
video) while everything else stays fixed. The **Poster card** built for Sunday Galore ships as
the built-in example.

- **Make one:** build a canvas, mark layers as slots with the **Slot** field in the Layer tab, then
  choose **+ Save this canvas as a template** (Templates, in the left rail). Or ask the agent:
  "save this as a template; the title, date and video change each week."
- **Use one:** click it under Templates. Replacing a canvas that has layers takes a second click.
  The agent fills slots with `apply_template`, and single-line text slots shrink automatically so a
  longer title never wraps.

## MCP: use Loso from your own agent

Everything the in-app agent can do is also exposed as tools over HTTP (`GET /api/tools`,
`POST /api/tools/call`) and through a zero-dependency MCP server:

```bash
claude mcp add loso -- node /absolute/path/to/loso/mcp/loso-mcp.mjs   # Claude Code
```

See [`mcp/README.md`](mcp/README.md) for Cursor, Codex and other clients. Keep `pnpm dev` running.
An editor tab that's open picks up changes made over MCP within a few seconds. Over MCP, your agent
asks you its own questions, so the interactive tools (`ask_user`, `propose_storyboard`) aren't
listed. Cutting and rendering run without Loso's confirmation step, so have your agent ask first.

**Tools:**
- `list_projects`, `create_project`
- `get_composition`, `set_output`, `add_layers`, `update_layers`, `remove_layers`, `add_captions`,
  `snapshot`
- `list_templates`, `apply_template`, `save_template`, `delete_template`
- `footage_scan`, `footage_contact_sheet`, `footage_frame`, `footage_transcribe`, `footage_words`,
  `footage_cut`
- `import_file`, `render_video`

## Recipe: sermon excerpt → 30s poster short

This is a real workflow run end-to-end with Loso + [Claude Code](https://claude.com/claude-code):
a folder of raw phone clips from a church service became a 30-second vertical short. The speaker's
own words carry the story, audience reactions are cut in over them, and the whole thing sits
inside a white "poster card" (small corner labels, a date line, a huge **SUNDAY**, a video
window, a badge row) with the same footage blurred behind it. Everything lands in a normal
Compositor project, so every word, caption and position stays editable in Loso.

> **Now built in:** the studio agent does this whole workflow inside the app on your own model (see
> above). The scripts below are the standalone, no-AI version: handy for batch jobs, or when you'd
> rather write the plan yourself.

The scripts live in [`recipes/sermon-short/`](recipes/sermon-short):

| File | What it does |
| --- | --- |
| `survey.sh` | Contact sheet per clip (a frame every 2 s) + local Whisper transcript with word timings → `transcripts.txt` |
| `words.py` | Prints word-by-word timings for a stretch of a clip, to find clean cut points |
| `plan.example.json` | The edit plan that produced the real video: audio pieces, shots, card text, captions |
| `build.py` | `cut` → `edit.mp4` + blurred `bg.mp4` via ffmpeg · `push` → uploads and writes the poster layers into a Loso project · `--render` → exports the MP4 |

### What you need

- Loso running (`pnpm dev`, see *Getting started*) and a **Compositor** project for the video
  (Projects → New → Compositor). Its id is the last part of the URL: `/project/<id>`.
- `ffmpeg` / `ffprobe` (`brew install ffmpeg`) and Python 3.
- Local Whisper: `pip install mlx-whisper` on Apple Silicon, or `pip install openai-whisper`.
  No API keys are needed for this recipe.
- Your footage in one folder, e.g. `~/Downloads/Excerpt/` (`.MOV`/`.mp4`; phone rotation is
  handled). Optional: a screenshot of the look you want.

```
~/Downloads/Excerpt/        ← raw clips (IMG_0731.MOV …)
~/sermon-work/              ← anything; survey + build output goes here
  sheets/IMG_0731.jpg       ← contact sheets
  transcripts.txt           ← every sentence with in/out times
  tx/IMG_0731.json          ← word timings
  edit.mp4  bg.mp4          ← the cut, and its blurred background copy
data/renders/<id>.mp4       ← the final export (inside the Loso folder)
```

### The prompts

**1. Ask for the video (Claude Code, in the Loso folder).** This is the prompt that started it.
Attach or reference the look you want and the footage folder:

> I created a new project called *Sunday Galore*. `~/Desktop/reference.png` is an example of what
> I want. Help me create the template design with *Sunday* etc. in it, with the videos in the
> background. `~/Downloads/Excerpt` has videos from the service. Find the parts that make a
> short excerpt: show the sermon, the people receiving the message and their reactions. It
> should be 30 seconds. Cut at the right places, join them and make it smooth. Ask me any
> questions you need to make your decisions.

Claude should come back with a few questions before cutting. These were the ones that mattered:

- **Card text:** the corner labels, the date line and the big word
  (here `PROJECT 1 MILLION` / `RHAPSODY OF REALITIES` / `27 — SEPTEMBER` / `SUNDAY`)
- **Sound:** the speaker's own voice (+ an optional soft music bed), room sound only, or music only
- **Style:** match the reference exactly, or pick up the venue's colours
- **Captions:** on or off

**2. Survey the footage.** Claude runs this itself, or you can run it:

```bash
recipes/sermon-short/survey.sh ~/Downloads/Excerpt ~/sermon-work
```

Then have Claude *look* at every `sheets/*.jpg` and read `transcripts.txt`. A good follow-up
prompt:

> Map each clip: what's on screen when (stage wide, speaker close, audience, notes being
> written…). From the transcripts, find the strongest 30 seconds of *spoken* story: a setup,
> a turn, a line to end on. Cut only at sentence boundaries (use `words.py` for exact times).
> Put a synced shot of the speaker on the key line, and cover everything else with reaction
> shots. Write it as `plan.json` in the format of `recipes/sermon-short/plan.example.json`.

**3. Build it.**

```bash
python3 recipes/sermon-short/build.py all plan.json ~/sermon-work --project <id> --render
```

Then open the project in Loso to tweak it, and hit **Export video** again.

### Writing the plan (`plan.json`)

- **`audio`**: the pieces of sermon you'll hear, in order (`clip`, `from`, `to` in seconds of that
  clip). Short 80 ms crossfades join them. The voice is high-passed, lightly denoised, compressed
  and normalized to −14 LUFS. Aim for a total a little over `duration`.
- **`shots`**: what you'll see, in order. `start` is where the shot begins in its clip and `dur`
  is its length on the timeline. The durations should add up to `duration` (they're joined with
  0.2 s dissolves). `focus` sets the vertical centre of the square-ish crop (0 = top, 1 = bottom):
  aim it at faces. To lip-sync a shot, use the same clip as the audio playing at that moment and
  make `start` equal to that audio's clip time.
- **`card`**: `left`, `right`, `date`, `title`, `badges` (plus optional `font`, `paper`, `ink`).
  The title is sized so it fits on one line.
- **`captions`**: `from` / `to` in *timeline* seconds with the text. Keep each to one line
  (about 40 characters). To convert a word time to timeline time, add up the earlier audio pieces.

### Tips from the real run

- **Transcripts of room audio are rough.** Whisper on a phone mic in a hall gets the gist, but
  names and short words drift. Listen once and fix captions in Loso's inspector.
- **Check each shot's first frame.** Phone footage often starts on a whip-pan. Nudge `start` past
  it (the real plan moved one shot from 22.5 s to 24.6 s).
- **Story beats reactions.** The best cut used the speaker's words as the spine (question →
  answer → call to action) and let reactions *illustrate* them, instead of montaging pretty shots.
- The poster layout is fixed at 1080×1920. Everything else (text, timing, colours, the music
  bed as an extra audio layer) is editable afterwards in the Compositor.

## Status

- [x] **M1** — App shell, Settings (keys + brand profile), persistence
- [x] **M2** — Script → normalized TTS → word-synced karaoke captions in the Remotion Player
- [x] **Compositor** — manual, no-AI canvas editor: layers (video/image/text/audio),
  drag/resize, align, radius/border, spring **animate-in**, undo/redo, live card thumbnails,
  and server-side MP4 export
- [x] **UX pass**: autosave and flush-before-export, undoable deletes, clear error states, keyboard
  editing, accessible dialogs, contrast fixes, honest "coming soon" labels
- [x] **Recipe**: sermon excerpt → 30s poster short (`recipes/sermon-short`)
- [x] **Studio agent (bring your own model)**: OpenAI-compatible / Anthropic / Gemini adapters,
  in-app chat with live canvas edits, questions + storyboard + confirm steps, snapshots, footage
  tools, word-snapped cuts, per-turn undo
- [x] **Templates** with slots (Poster card built in), auto-fit text slots
- [x] **MCP server** + HTTP tool API
- [ ] **M3** — AI shot list, pace-aware timeline, auto-sourced visuals
- [ ] **M4** — Branding overlays + detached render job → MP4 download
- [ ] **M5** — Editor polish: image library, refine prompts, pronunciation dictionary
