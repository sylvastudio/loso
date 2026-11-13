"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Say it instead of typing it. On a computer: record from the microphone,
// then Whisper (the same in-browser model the captions use) writes it down,
// and nothing leaves the computer. On a phone the ~100 MB model is too heavy,
// so the phone's own speech recognizer is used instead (the keyboard mic's;
// Apple or Google may process the audio), with the words showing live.
// Either way the words go into the chat box, not straight to Loso, so people
// can check them first.

const MAX_SEC = 60;

interface Recognizer {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

function phoneRecognizer(): (new () => Recognizer) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => Recognizer; webkitSpeechRecognition?: new () => Recognizer };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  const phone = matchMedia("(pointer: coarse)").matches && navigator.maxTouchPoints > 0;
  return phone && Ctor ? Ctor : null;
}

export type VoiceState = "idle" | "starting" | "listening" | "writing";

export function canUseVoice(): boolean {
  if (typeof window === "undefined") return false;
  return !!phoneRecognizer() || (!!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined");
}

export function useVoice(onText: (text: string) => void) {
  const [state, setState] = useState<VoiceState>("idle");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  /** What the phone recognizer has heard so far (phones only). */
  const [live, setLive] = useState("");
  const rec = useRef<MediaRecorder | null>(null);
  const recognizer = useRef<Recognizer | null>(null);
  const cancelled = useRef(false);
  const onTextRef = useRef(onText);
  onTextRef.current = onText;

  const release = () => {
    rec.current?.stream.getTracks().forEach((t) => t.stop());
    rec.current = null;
  };

  // Phones: must start inside the tap itself, so no await before start().
  const startPhone = useCallback((Ctor: new () => Recognizer) => {
    const r = new Ctor();
    recognizer.current = r;
    cancelled.current = false;
    r.lang = navigator.language || "en-US";
    r.continuous = true;
    r.interimResults = true;
    let heard = "";
    let failed = false;
    r.onresult = (e) => {
      let final = "";
      let partial = "";
      for (let i = 0; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) final += res[0].transcript;
        else partial += res[0].transcript;
      }
      heard = (final + partial).trim();
      setLive(heard);
    };
    r.onerror = (e) => {
      if (e.error === "aborted") return;
      failed = true;
      console.warn("[loso] phone speech recognition:", e.error);
      setError(
        e.error === "not-allowed" || e.error === "service-not-allowed"
          ? "Loso can't hear you yet. Allow the microphone (and Speech Recognition) for this site in Settings, then try again."
          : e.error === "no-speech"
            ? "Loso didn't hear anything. Try again a little closer to the phone."
            : e.error === "network"
              ? "Speech-to-text needs the internet on a phone. Check your connection, or type instead."
              : "Loso couldn't write that down. Try again, or type instead."
      );
    };
    r.onend = () => {
      recognizer.current = null;
      setLive("");
      setState("idle");
      if (cancelled.current || failed) return;
      if (heard) onTextRef.current(heard);
      else setError("Loso didn't hear anything. Try again a little closer to the phone.");
    };
    try {
      r.start();
      setSeconds(0);
      setState("listening");
    } catch (e) {
      console.warn("[loso] phone speech recognition didn't start", e);
      recognizer.current = null;
      setError("The microphone didn't start. Try again, or type instead.");
    }
  }, []);

  const start = useCallback(async () => {
    setError(null);
    const Phone = phoneRecognizer();
    if (Phone) return startPhone(Phone);
    setState("starting");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (e) {
      setState("idle");
      const name = (e as DOMException)?.name;
      setError(
        name === "NotAllowedError"
          ? "Loso can't hear you yet. Allow the microphone from the icon in your browser's address bar, then try again."
          : name === "NotFoundError"
            ? "No microphone found. Plug one in, or type instead."
            : "The microphone didn't start. Try again, or type instead."
      );
      return;
    }
    const chunks: Blob[] = [];
    const r = new MediaRecorder(stream);
    rec.current = r;
    cancelled.current = false;
    r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    r.onstop = async () => {
      release();
      if (cancelled.current || chunks.length === 0) {
        setState("idle");
        return;
      }
      setState("writing");
      try {
        const { transcribeSpeech } = await import("@/lib/local/transcribe");
        const text = await transcribeSpeech(new Blob(chunks, { type: r.mimeType }), setStatus);
        if (text && !/^\[.*\]$/.test(text)) onTextRef.current(text);
        else setError("Loso didn't catch any words. Try again a little closer to the microphone.");
      } catch (e) {
        console.warn("[loso] voice note failed", e);
        setError("Loso couldn't write that down. Try again, or type instead.");
      } finally {
        setStatus(null);
        setState("idle");
      }
    };
    r.start(250);
    setSeconds(0);
    setState("listening");
  }, [startPhone]);

  const stop = useCallback(() => {
    if (rec.current?.state === "recording") rec.current.stop();
    recognizer.current?.stop();
  }, []);

  const cancel = useCallback(() => {
    cancelled.current = true;
    recognizer.current?.abort();
    stop();
  }, [stop]);

  // A clock while listening, with a hard stop so a forgotten mic doesn't run forever.
  useEffect(() => {
    if (state !== "listening") return;
    const t = setInterval(() => {
      setSeconds((s) => {
        if (s + 1 >= MAX_SEC) stop();
        return s + 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [state, stop]);

  useEffect(
    () => () => {
      cancelled.current = true;
      recognizer.current?.abort();
      release();
    },
    []
  );

  return { state, status, error, seconds, live, start, stop, cancel, clearError: () => setError(null) };
}
