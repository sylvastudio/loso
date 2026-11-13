// In-browser transcription with word timings: Mediabunny decodes the clip's
// audio (any container Chrome's WebCodecs can read, incl. phone .MOV), it is
// resampled to 16 kHz mono, and Whisper runs on WebGPU (WASM fallback) via
// transformers.js. The model downloads once and is cached by the browser.

import { ALL_FORMATS, AudioBufferSink, BlobSource, Input } from "mediabunny";

export interface LocalWord {
  word: string;
  start: number;
  end: number;
}

export interface LocalTranscript {
  text: string;
  words: LocalWord[];
  device: "webgpu" | "wasm";
  audioSec: number;
  decodeMs: number;
  modelLoadMs: number;
  transcribeMs: number;
}

const MODEL = "onnx-community/whisper-base_timestamped";
// Pinned commit (main is mutable): the weights only change when we bump this.
const MODEL_REVISION = "608c49e61301901684bc36cac8f74b95ff6b5a8e";
const SAMPLE_RATE = 16000;
// ONNX Runtime's WASM runs from this site (copied from node_modules by
// scripts/copy-ort.mjs), never from a third-party CDN.
const ORT_PATHS = { mjs: "/ort/ort-wasm-simd-threaded.asyncify.mjs", wasm: "/ort/ort-wasm-simd-threaded.asyncify.wasm" };

export async function decodeAudio16k(file: Blob, maxSec: number, startSec = 0): Promise<Float32Array> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track) throw new Error("This clip has no audio track.");
    // Mix each decoded chunk down to mono as it arrives and let the decoded
    // (often 48 kHz stereo) buffer go: holding them all first doubled the
    // memory for long clips (10 min of stereo ≈ 230 MB on its own).
    const parts: Float32Array<ArrayBuffer>[] = [];
    let srcRate = 0;
    let total = 0;
    for await (const { buffer: b } of new AudioBufferSink(track).buffers(startSec, startSec + maxSec)) {
      srcRate ||= b.sampleRate;
      const m = new Float32Array(b.length);
      for (let c = 0; c < b.numberOfChannels; c++) {
        const ch = b.getChannelData(c);
        for (let i = 0; i < b.length; i++) m[i] += ch[i] / b.numberOfChannels;
      }
      parts.push(m);
      total += m.length;
    }
    if (parts.length === 0) throw new Error("No audio could be decoded from this clip.");

    const outLen = Math.ceil((total * SAMPLE_RATE) / srcRate);
    const ctx = new OfflineAudioContext(1, outLen, SAMPLE_RATE);
    const buf = ctx.createBuffer(1, total, srcRate);
    let off = 0;
    for (const m of parts) {
      buf.copyToChannel(m, 0, off);
      off += m.length;
    }
    parts.length = 0;
    const node = ctx.createBufferSource();
    node.buffer = buf;
    node.connect(ctx.destination);
    node.start();
    return (await ctx.startRendering()).getChannelData(0);
  } finally {
    input.dispose();
  }
}

type Asr = (
  audio: Float32Array,
  opts: object
) => Promise<{ text: string; chunks?: { text: string; timestamp: [number, number | null] }[] }>;

type LoadedAsr = { asr: Asr & { dispose?: () => Promise<void> }; device: "webgpu" | "wasm" };
let asrPromise: Promise<LoadedAsr> | null = null;

// The speech model takes a few hundred MB (plus graphics memory on WebGPU).
// Keep it while it's being used, and let it go after a few quiet minutes; the
// next use loads it again from the browser's cache (a few seconds, no download).
const ASR_IDLE_MS = 3 * 60 * 1000;
let asrUsers = 0;
let idleTimer: ReturnType<typeof setTimeout> | undefined;

async function withAsr<T>(onStatus: (s: string) => void, fn: (m: LoadedAsr) => Promise<T>): Promise<T> {
  clearTimeout(idleTimer);
  asrUsers++;
  try {
    return await fn(await loadAsr(onStatus));
  } finally {
    if (--asrUsers === 0) idleTimer = setTimeout(releaseSpeechModel, ASR_IDLE_MS);
  }
}

/** Free the speech model now (it reloads on next use). Safe to call anytime. */
export async function releaseSpeechModel(): Promise<void> {
  if (asrUsers > 0 || !asrPromise) return;
  const p = asrPromise;
  asrPromise = null;
  try {
    await (await p).asr.dispose?.();
  } catch {
    /* already gone */
  }
}

function loadAsr(onStatus: (s: string) => void) {
  asrPromise ??= (async () => {
    const { pipeline, env } = await import("@huggingface/transformers");
    const onnx = env.backends.onnx as { wasm?: { wasmPaths?: unknown } };
    if (onnx.wasm) onnx.wasm.wasmPaths = { ...ORT_PATHS };
    // Load the WASM glue straight from /ort/ (a blob: copy would need script-src blob:).
    env.useWasmCache = false;
    const hasGpu = typeof navigator !== "undefined" && "gpu" in navigator;
    // Progress fires many times per percent; only report whole-percent steps.
    let last = "";
    const progress = (p: { status: string; file?: string; progress?: number }) => {
      if (p.status !== "progress" || !p.file) return;
      const msg = `Downloading speech model (${p.file.split("/").pop()}) ${Math.round(p.progress ?? 0)}%`;
      if (msg !== last) onStatus((last = msg));
    };
    if (hasGpu) {
      try {
        const asr = await pipeline("automatic-speech-recognition", MODEL, {
          device: "webgpu",
          dtype: { encoder_model: "fp32", decoder_model_merged: "q4" },
          revision: MODEL_REVISION,
          progress_callback: progress,
        });
        return { asr: asr as unknown as LoadedAsr["asr"], device: "webgpu" as const };
      } catch (e) {
        console.warn("[loso] WebGPU Whisper failed, falling back to WASM", e);
      }
    }
    const asr = await pipeline("automatic-speech-recognition", MODEL, {
      device: "wasm",
      dtype: "q8",
      revision: MODEL_REVISION,
      progress_callback: progress,
    });
    return { asr: asr as unknown as LoadedAsr["asr"], device: "wasm" as const };
  })();
  asrPromise.catch(() => (asrPromise = null));
  return asrPromise;
}

export async function transcribeLocal(
  file: Blob,
  { maxSec = 30, startSec = 0, onStatus = () => {} }: { maxSec?: number; startSec?: number; onStatus?: (s: string) => void } = {}
): Promise<LocalTranscript> {
  onStatus("Reading audio…");
  const t0 = performance.now();
  const audio = await decodeAudio16k(file, maxSec, startSec);
  const t1 = performance.now();
  onStatus("Loading speech model…");
  let t2 = 0;
  const { out, device } = await withAsr(onStatus, async ({ asr, device }) => {
    t2 = performance.now();
    onStatus(`Transcribing on ${device === "webgpu" ? "the graphics card" : "the CPU"}…`);
    return { out: await asr(audio, { return_timestamps: "word", chunk_length_s: 30 }), device };
  });
  const t3 = performance.now();
  return {
    text: out.text.trim(),
    words: (out.chunks ?? []).map((c) => ({
      word: c.text.trim(),
      start: c.timestamp[0],
      end: c.timestamp[1] ?? c.timestamp[0],
    })),
    device,
    audioSec: audio.length / SAMPLE_RATE,
    decodeMs: t1 - t0,
    modelLoadMs: t2 - t1,
    transcribeMs: t3 - t2,
  };
}

/** Turn a short voice note (anything the browser can decode) into text, for the chat box. */
export async function transcribeSpeech(note: Blob, onStatus: (s: string) => void = () => {}): Promise<string> {
  // decodeAudioData resamples to the context's rate, so a 16 kHz context gives Whisper its input directly.
  const decoded = await new OfflineAudioContext(1, 1, SAMPLE_RATE).decodeAudioData(await note.arrayBuffer());
  const mono = new Float32Array(decoded.length);
  for (let c = 0; c < decoded.numberOfChannels; c++) {
    const ch = decoded.getChannelData(c);
    for (let i = 0; i < ch.length; i++) mono[i] += ch[i] / decoded.numberOfChannels;
  }
  onStatus("Getting ready to listen…");
  return withAsr(onStatus, async ({ asr }) => {
    onStatus("Writing down what you said…");
    return (await asr(mono, { chunk_length_s: 30 })).text.trim();
  });
}
