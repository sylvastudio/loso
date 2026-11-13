"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Say it instead of typing it: record from the microphone, then Whisper (the
// same in-browser model the captions use) writes it down. Nothing leaves the
// computer. The words go into the chat box, not straight to Loso, so people
// can check them first.

const MAX_SEC = 60;

export type VoiceState = "idle" | "starting" | "listening" | "writing";

export function canUseVoice(): boolean {
  return typeof window !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined";
}

export function useVoice(onText: (text: string) => void) {
  const [state, setState] = useState<VoiceState>("idle");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  const rec = useRef<MediaRecorder | null>(null);
  const cancelled = useRef(false);
  const onTextRef = useRef(onText);
  onTextRef.current = onText;

  const release = () => {
    rec.current?.stream.getTracks().forEach((t) => t.stop());
    rec.current = null;
  };

  const start = useCallback(async () => {
    setError(null);
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
  }, []);

  const stop = useCallback(() => {
    if (rec.current?.state === "recording") rec.current.stop();
  }, []);

  const cancel = useCallback(() => {
    cancelled.current = true;
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
      release();
    },
    []
  );

  return { state, status, error, seconds, start, stop, cancel, clearError: () => setError(null) };
}
