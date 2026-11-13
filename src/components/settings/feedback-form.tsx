"use client";

import { useId, useState } from "react";
import { Loader2 } from "lucide-react";
import { cx } from "@/components/ui";

// "Tell us": ideas, problems, kind words. Loso has no server, so this posts
// to Netlify Forms (the form is declared in public/__forms.html so Netlify
// sees it at deploy). Only what's typed here is sent, plus which page it
// came from. Never the video, the files or the AI key.

const KINDS = [
  { id: "idea", label: "I have an idea" },
  { id: "problem", label: "Something isn't working" },
  { id: "love", label: "I like something" },
] as const;

const LOOKS_LIKE_KEY = /sk-ant-|\bsk-[A-Za-z0-9]{16}|gsk_|xai-[A-Za-z0-9]{16}|AIza/;
const MAX = 2000;

type Kind = (typeof KINDS)[number]["id"];

export function FeedbackForm() {
  const id = useId();
  const [kind, setKind] = useState<Kind>("idea");
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [note, setNote] = useState<string | null>(null);

  async function send() {
    const text = message.trim();
    if (!text) return setNote("Write a few words first.");
    if (LOOKS_LIKE_KEY.test(text)) return setNote("That looks like an AI key. Take it out first. Keys stay on your computer.");
    if (email && !/^\S+@\S+\.\S+$/.test(email.trim())) return setNote("That email doesn't look right. Leave it empty if you don't need a reply.");
    if (["localhost", "127.0.0.1"].includes(location.hostname)) {
      return setNote("This is the local copy, so nothing was sent. Feedback sends from loso.sylvastudio.com.");
    }
    setNote(null);
    setState("sending");
    try {
      const body = new URLSearchParams({
        "form-name": "feedback",
        kind,
        message: text.slice(0, MAX),
        email: email.trim(),
        page: location.pathname,
      });
      const res = await fetch("/__forms.html", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });
      if (!res.ok) throw new Error(String(res.status));
      setState("sent");
      setMessage("");
    } catch {
      setState("error");
    }
  }

  if (state === "sent") {
    return (
      <div role="status" className="flex flex-col gap-3">
        <p className="font-serif text-[26px] font-light italic leading-tight text-ink">Thank you. We read every one.</p>
        <button type="button" onClick={() => setState("idle")} className="min-h-10 self-start text-[14px] text-lime hover:underline">
          Send another
        </button>
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      <p className="text-[14px] leading-relaxed text-ink-dim">Tell the people who make Loso what you think. Short is fine.</p>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-[12.5px] text-ink-dim">What is it?</legend>
        <div className="flex flex-wrap gap-2">
          {KINDS.map((k) => (
            <label
              key={k.id}
              className={cx(
                "flex min-h-10 cursor-pointer items-center border px-3 text-[14px] transition-colors focus-within:border-lime",
                kind === k.id ? "border-lime text-ink" : "border-line text-ink-dim hover:text-ink"
              )}
            >
              <input type="radio" name={`${id}-kind`} value={k.id} checked={kind === k.id} onChange={() => setKind(k.id)} className="sr-only" />
              {k.label}
            </label>
          ))}
        </div>
      </fieldset>

      <label className="flex flex-col gap-2">
        <span className="text-[12.5px] text-ink-dim">Your message</span>
        <textarea
          value={message}
          maxLength={MAX}
          rows={5}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={kind === "problem" ? "What happened, and what did you expect?" : kind === "love" ? "What do you like?" : "What should Loso do?"}
          className="resize-y border border-line bg-ground px-3 py-2.5 text-[16px] leading-snug text-ink outline-none placeholder:text-ink-faint focus:border-lime/70"
        />
      </label>

      <label className="flex flex-col gap-2">
        <span className="text-[12.5px] text-ink-dim">Email, only if you&rsquo;d like a reply (kids: ask a grown-up)</span>
        <input
          type="email"
          value={email}
          autoComplete="email"
          onChange={(e) => setEmail(e.target.value)}
          className="border border-line bg-ground px-3 py-2 text-[16px] text-ink outline-none focus:border-lime/70"
        />
      </label>

      {(note || state === "error") && (
        <p role="alert" className="text-[13px] leading-snug text-ink-dim">
          {state === "error" ? "It didn't send. Check your internet and try again." : note}
        </p>
      )}

      <div className="flex items-center gap-4">
        <button
          type="submit"
          disabled={state === "sending"}
          className="flex min-h-11 items-center gap-2 bg-lime-fill px-5 text-[14px] text-black transition-colors hover:bg-lime-deep disabled:opacity-70"
        >
          {state === "sending" && <Loader2 size={14} className="animate-spin" />} Send
        </button>
        <span className="text-[12px] leading-snug text-ink-faint">Only these words are sent. Never your videos or your AI key.</span>
      </div>
    </form>
  );
}
