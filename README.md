# Loso — say what you want, Loso makes the video

**Try it: [loso.sylvastudio.com](https://loso.sylvastudio.com)**

Loso is a talk-to-edit video studio. You give it your clips and tell it the video you want, by
typing or by voice. Its AI builds the video on a live canvas: it watches and transcribes the
footage, cuts between sentences, lays out words on screen and exports an MP4. Everything it does
stays editable by hand, and every change is a version you can go back to.

It's built to be usable by kids aged 6 to 10, and by anyone who has never edited a video.

## Using Loso

### Before you start

- **A computer with Chrome or Edge** works best, because Loso opens a folder of your clips. On a
  phone, use **Pick videos and photos** instead.
- **An AI key.** Loso runs on your own key: Claude (recommended), OpenAI, Grok (xAI), Groq,
  Gemini or OpenRouter. Get a Claude key at [console.anthropic.com](https://console.anthropic.com).
  About $5 of credit goes a long way. A typical edit costs a few cents to a dollar, and Loso shows
  what you've spent (Settings → AI → Usage). You can set a monthly limit.
- **Start with a short video** (under a minute). Long, high-resolution videos need a lot of
  memory; Loso warns you before a heavy job and offers a quick test version first.

### How it works

1. **Open your folder** (or pick videos on a phone) and **paste your AI key** when Loso asks.
2. **Tell Loso what you want**: "make a 30-second video of the best moments, with words on
   screen". Type it, or press the mic and say it.
3. **Watch it build.** Loso decides most things itself. When it truly needs you, it shows a small
   card with choices, a "You decide" option and a box to type your own answer.
4. **Fix things by pointing.** Press **Point at it**, circle a spot on the video and say what to
   change.
5. **Make the video** and download it. On a phone, **Save or share** puts it in your photos.

A short guided tour shows new users around the first time; replay it any time from the **?**
button.

### Your stuff stays yours

- Your clips never leave your computer. Projects are saved as `.loso` files in your own folder
  (or in the browser's private storage on a phone).
- Your AI key stays in your browser and is only ever sent to the AI provider you chose. It's kept
  in memory unless you tick **Remember on this computer**.
- Speech-to-text (captions and voice) and making the video both run inside your browser.
- There are no accounts and no Loso servers holding your data.

### Something not working?

Go to **Settings → Tell us**, choose **Something isn't working** and press **Send**. Leave
**Send Loso's notes too** ticked: Loso keeps a small diary of errors and slow steps in your
browser (AI keys and pictures are removed), and it helps us fix the problem. You can also
**Copy notes** or **Save as a file** and send them another way.

## What's in the app

- **Stage**: a live preview of the video. Drop videos, pictures and sounds anywhere.
- **Loso chat**: a floating dock (open, peek or folded away; ⌘J) that shows what Loso is doing
  as it works. The model chip shows which AI is working and suggests the best one for the job.
- **Voice**: the mic in the chat box. Whisper writes down what you said, in the browser, and puts
  it in the box for you to check before sending.
- **Point at it** (⌘⇧X): circle something on the frame; the picture goes to Loso with your message.
- **Words on screen**: captions from the transcript, with a look editor and `.srt` in/out.
- **Story**: the timeline of pieces.
- **Versions**: every change, yours or Loso's, is a version. Going back never throws anything away.
- **Make the video**: exports the MP4, then shows it ready to play and download.
- **Settings** (⌘ ,): your AI key and model, usage and a monthly limit, memory, light/dark
  theme, and **Tell us** (feedback).
- **Phones**: a stage-first layout with Loso / Pieces / Story tabs.

Keyboard: ⌘Z / ⇧⌘Z undo and redo, arrows nudge the selected piece (⇧ = 10px), ⌫ deletes, ⌘D
duplicates, `[` / `]` change the order, Esc deselects.

## For developers

### Two ways to run it

**The website (the product).** A static site, with no server code. Everything happens in the tab:

- **Projects** use the File System Access API (`.loso` files in the user's folder), or OPFS on
  phones (`src/lib/local/*`). Footage is read in place; clips dropped in are copied to
  `loso-media/`, and exports land in `exports/`.
- **The agent** (`src/lib/local/agent/*`) calls the provider straight from the browser on the
  user's key (`src/lib/ai/*`: Anthropic, OpenAI-compatible, Gemini). Claude replies are streamed.
- **Transcription** uses Whisper via transformers.js, with ONNX Runtime served from `/ort/`.
  **Export** renders the MP4 with `@remotion/web-renderer`, with the frame cache capped by the
  computer's memory (`src/lib/local/memory.ts`).
- Versions, chats, transcripts and usage live in IndexedDB (`loso-local`). The problem-notes diary
  lives in `localStorage` (`src/lib/log.ts`).

**The dev server (the owner's local setup).** `pnpm dev` runs the same app plus a local API:

- Projects in SQLite at `./data/studio.db` (`/project/<id>`), uploads in `./data/assets`, renders
  in `./data/renders` (server-side Remotion + headless Chromium).
- The **server agent** runs on any model you configure, and the same tools are exposed over
  **MCP** (`mcp/`).
- It binds to `127.0.0.1` only, and `src/middleware.ts` rejects other hosts and cross-site
  requests.

### Getting started

```bash
pnpm install
pnpm dev            # http://localhost:3000
```

(`npm install && npm run dev` works too. If an install gets interrupted and the app throws
*"Could not locate the bindings file"*, delete `node_modules` and install again.)

Open `http://localhost:3000`, not `http://127.0.0.1:3000`. Browser storage (projects, key,
versions) is kept per origin, so the two addresses don't share it.

### Build and deploy

```bash
LOSO_STATIC=1 npm run build      # → out/
```

`scripts/build-static.mjs` stages a copy without the API routes and middleware, exports it to
`out/`, and writes a strict Content-Security-Policy into `out/_headers`. The policy's
`connect-src` lists only the AI providers, Hugging Face (for the speech model) and fonts. The
build also strips local file paths from the output.

The site is on **Netlify** (`netlify.toml`). Every push to the deploy branch builds and publishes
to loso.sylvastudio.com. `netlify.toml` also sets the security headers (the microphone is
allowed for Loso's own pages only) and serves Next's `.txt` page data as `text/x-component`.
Feedback is collected with **Netlify Forms**: the form is declared in `public/__forms.html`, and
submissions appear under Forms in the Netlify dashboard.

### Stack

- **Next.js 15** (App Router, TypeScript), **React 19**, **Tailwind v4**
- **Remotion 4**: Player preview, in-browser export (`@remotion/web-renderer`), server export
- **mediabunny** for decoding, **transformers.js** Whisper for speech
- **SQLite** (`better-sqlite3`) for the dev server only
- Editorial UI: Fraunces / Schibsted Grotesk / IBM Plex Mono, one lime accent, light and dark
  themes from tokens in `src/app/globals.css`. The Onion Skin mark is in `src/components/logo.tsx`.

### The agent

The agent decides by default. It asks only about things the user alone knows, through an
options card (`ask_user`), at most once per request. It looks at its own work by rendering a
frame (`snapshot`) to catch wrapping text, overlaps and bad crops. Everything it changes in a turn
is one undo step, and the canvas is locked while it works (**Stop** ends the turn).

On the dev server, connect a model in Settings → **AI**: pick a provider, paste a key (local
servers need none), choose a model and press **Test model**. The model must be able to call
tools, and should be able to see images.

| Provider | Notes |
| --- | --- |
| Anthropic (Claude) | Native Messages API adapter, streamed. The recommended choice. |
| OpenAI · xAI (Grok) · Groq · OpenRouter · custom | One OpenAI-compatible adapter; change the base URL for any compatible server |
| Google Gemini | Native generateContent adapter |
| Ollama · LM Studio (dev server) | Local, no key. Use a model with tool calling; a vision model unlocks the visual tools |

## Starting points (templates)

A starting point is a saved design whose **slots** change for each video (a title, a date, the main
video) while everything else stays fixed. The **Poster card** built for Sunday Galore ships as the
built-in example.

- **Make one:** build a video, then choose **+ Save this video as a starting point**, or ask Loso:
  "save this as a template; the title, date and video change each week."
- **Use one:** click it under Starting points. Single-line text slots shrink automatically so a
  longer title never wraps.

## MCP: use Loso from your own agent (dev server)

Everything the in-app agent can do is also exposed as tools over HTTP (`GET /api/tools`,
`POST /api/tools/call`) and through a zero-dependency MCP server:

```bash
claude mcp add loso -- node /absolute/path/to/loso/mcp/loso-mcp.mjs   # Claude Code
```

See [`mcp/README.md`](mcp/README.md) for Cursor, Codex and other clients. Keep `pnpm dev` running;
an open editor tab picks up changes made over MCP within a few seconds. Over MCP, your agent asks
its own questions, and cutting and rendering run without Loso's confirmation step, so have your
agent ask first.

**Tools:** `list_projects`, `create_project`, `get_composition`, `set_output`, `add_layers`,
`update_layers`, `remove_layers`, `add_captions`, `snapshot`, `list_templates`, `apply_template`,
`save_template`, `delete_template`, `footage_scan`, `footage_contact_sheet`, `footage_frame`,
`footage_transcribe`, `footage_words`, `footage_cut`, `import_file`, `render_video`

## Recipe: sermon excerpt → 30s poster short

This is a real workflow run end-to-end with Loso + [Claude Code](https://claude.com/claude-code):
a folder of raw phone clips from a church service became a 30-second vertical short. The speaker's
own words carry the story, audience reactions are cut in over them, and the whole thing sits
inside a white "poster card" (small corner labels, a date line, a huge **SUNDAY**, a video
window, a badge row) with the same footage blurred behind it. Everything lands in a normal
Loso project, so every word, caption and position stays editable in Loso.

> **Now built in:** Loso does this whole workflow inside the app on your own model (see
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

Live at [loso.sylvastudio.com](https://loso.sylvastudio.com), early and being tested with a few
people.

- [x] Agent-first editor: stage, floating Loso chat, Point at it, Words on screen, Story, Versions
- [x] Browser-local engine: `.loso` projects in your folder (OPFS on phones), in-tab
      transcription and export
- [x] Bring your own key: Claude, OpenAI, Grok, Groq, Gemini, OpenRouter; usage and monthly limit
- [x] Voice input, phone layout, light and dark themes, guided tour for new users
- [x] Feedback and problem notes (Netlify Forms), memory meter and heavy-job warnings
- [x] Templates with slots (Poster card built in), auto-fit text slots
- [x] Server agent on any model, MCP + HTTP tool API, recipe: sermon excerpt → 30s poster short

**Known limits**

- Opening a folder needs Chrome or Edge on a computer. Phone support is new.
- Rendering runs in the browser: long or 4K videos are slow and need a lot of memory, and the
  browser keeps some decoded video in memory until the tab is closed.
- Some phone video formats (e.g. certain HEVC `.MOV` files) can't be decoded by every browser;
  Loso names them and suggests converting them to MP4 (H.264).
