# Loso — say what you want, Loso makes the video

Loso is a talk-to-edit video studio. You open a folder of clips, tell Loso the video you want, and
its agent builds it on a live canvas: it watches and transcribes the footage, asks what it can't
decide, cuts between sentences, lays out words on screen and exports an MP4. Everything it does
stays editable by hand, and every change is a version you can go back to. It's built to be usable by
kids aged 6 to 10.

## Two ways to run it

**The website (the product).** A static site (`LOSO_STATIC=1 npm run build` → `out/`, deployed
on Netlify by `netlify.toml`). Everything happens in the browser:

- **Projects are `.loso` files in your own folder** (File System Access API, Chrome or Edge on a
  computer). Footage is read in place; clips you drop in are copied to `loso-media/`, exports land
  in `exports/`.
- **The agent runs in the tab on your own Claude key** (`src/lib/local/agent/*`). The key stays in
  the browser.
- **Transcription** runs in the tab (Whisper via transformers.js + ONNX Runtime, served from
  `/ort/`), and **export** renders the MP4 in the tab with `@remotion/web-renderer`.
- Versions, chats and transcripts are kept in the browser's IndexedDB, per project.

**The dev server (the owner's local setup).** `pnpm dev` runs the same app plus a local API:

- Projects in SQLite at `./data/studio.db` (`/project/<id>`), uploads in `./data/assets`, renders
  in `./data/renders` (server-side Remotion + headless Chromium).
- The **server agent** runs on any model you configure (see below), and the same tools are
  exposed over **MCP** (`mcp/`).
- The dev home page lists these server projects and can move one into a folder.

## Stack

- **Next.js 15** (App Router, TypeScript), **React 19**, **Tailwind v4**
- **Remotion 4**: in-editor Player preview, in-browser export (`@remotion/web-renderer`) and
  server export (`@remotion/renderer` + `@remotion/bundler`)
- **SQLite** (`better-sqlite3`) for the dev server only
- Editorial UI: Fraunces / Schibsted Grotesk / IBM Plex Mono, one lime accent, light and dark
  themes from tokens in `src/app/globals.css`

## Getting started

```bash
pnpm install
pnpm dev            # http://localhost:3000
```

(`npm install && npm run dev` works too. If an install gets interrupted and the app throws
*"Could not locate the bindings file"*, delete `node_modules` and install again.)

Use `localhost`, not `127.0.0.1`: browser storage (projects, key, versions) is kept per origin.

Build the public site with `LOSO_STATIC=1 npm run build`; it writes `out/` plus a strict
Content-Security-Policy in `out/_headers`.

## The editor

- **Stage**: a live Remotion Player of the video. Drop videos, pictures and sounds anywhere.
- **Loso chat**: a dock on the right (open, peek or folded away; ⌘J). Starter prompts show when
  the video is empty.
- **Point at it** (⌘⇧X): circle something on the frame and say what to fix; the picture goes to
  Loso with your message.
- **Words on screen**: captions from the transcript, with a look editor and `.srt` in/out.
- **Story**: a drawer with the timeline of pieces.
- **Versions**: every change (yours or Loso's) is a version. Going back never throws anything away,
  and versions survive a reload (the last 100 per project).
- **Make the video**: exports the MP4. When it's done, Loso shows it ready to play and download.

Keyboard: ⌘Z / ⇧⌘Z undo and redo, arrows nudge the selected piece (⇧ = 10px), ⌫ deletes, ⌘D
duplicates, `[` / `]` change the order, Esc deselects.

## Studio agent

On the website the agent runs on Claude with your own key (Settings → AI). On the dev server it can
run on any model you connect. You chat with it like a video editor. It works on the live canvas, so
you watch the pieces appear as it builds.

**1. Connect a model (dev server):** go to Settings → **AI**, pick a provider, paste a key (local servers need
none), choose a model with **Load models**, then press **Test model**. The test checks whether the model
can **call tools** (required) and **see images** (strongly recommended: it lets the agent read contact
sheets, study your reference screenshots and check its own layouts).

| Provider | Notes |
| --- | --- |
| OpenAI · xAI (Grok) · Groq · OpenRouter · custom | One OpenAI-compatible adapter; change the base URL for any compatible server |
| Anthropic (Claude) | Native Messages API adapter |
| Google Gemini | Native generateContent adapter |
| Ollama · LM Studio | Local, no key. Use a model that supports tool calling; a vision model (e.g. a Qwen-VL / LLaVA variant) unlocks the visual tools |

**Transcription on the dev server** (word timings drive every cut): when your AI model is OpenAI
(`whisper-1`) or Groq, its speech-to-text is used. Otherwise Loso uses **local Whisper**
(`pip install mlx-whisper` on Apple Silicon, or `openai-whisper`). The website transcribes in the
browser instead.

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

## Starting points (templates)

A starting point is a saved design whose **slots** change for each video (a title, a date, the main
video) while everything else stays fixed. The **Poster card** built for Sunday Galore ships as the
built-in example.

- **Make one:** build a video, then choose **+ Save this video as a starting point** (Starting
  points, in the left rail). Or ask the agent: "save this as a template; the title, date and video
  change each week."
- **Use one:** click it under Starting points. The agent fills slots with `apply_template`, and
  single-line text slots shrink automatically so a longer title never wraps.

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
Loso project, so every word, caption and position stays editable in Loso.

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

- Loso's dev server running (`pnpm dev`, see *Getting started*) and a server project for the video
  (`curl -X POST localhost:3000/api/projects -H 'content-type: application/json' -d '{"title":"Sunday"}'`,
  or `create_project` over MCP). Its id is the last part of the URL: `/project/<id>`.
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

Then open the project in Loso to tweak it, and press **Make the video** again.

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
  bed as an extra audio layer) is editable afterwards in Loso.

## Status

- [x] Agent-first editor: stage, Loso chat dock, Point at it, Words on screen, Story drawer
- [x] Browser-local engine: `.loso` projects in your folder, in-tab transcription and export
- [x] In-browser agent on the user's Claude key; server agent on any model; MCP + HTTP tool API
- [x] Templates with slots (Poster card built in), auto-fit text slots
- [x] Versions that survive a reload, a "your video is ready" moment, light and dark themes
- [x] Recipe: sermon excerpt → 30s poster short (`recipes/sermon-short`)
