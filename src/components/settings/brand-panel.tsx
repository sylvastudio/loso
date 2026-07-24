"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ImagePlus, Music4, Plus, Trash2, UploadCloud } from "lucide-react";
import { FONT_CHOICES, defaultBrand, type Brand, type Presenter } from "@/lib/brand";
import { Button, Field, Input, Section, Select, Switch, Textarea } from "@/components/ui";

async function uploadFile(file: File, kind: string): Promise<{ hash: string; url: string }> {
  const form = new FormData();
  form.append("file", file);
  form.append("kind", kind);
  const res = await fetch("/api/assets", { method: "POST", body: form });
  if (!res.ok) throw new Error("Upload failed");
  const d = await res.json();
  return d.asset;
}

function assetUrl(hash: string | null): string | null {
  return hash ? `/api/assets/${hash}` : null;
}

/** Load selected Google fonts so the live preview is true to the render. */
function FontLoader({ families }: { families: string[] }) {
  const href = useMemo(() => {
    const parts = [...new Set(families)]
      .map((f) => `family=${f.replace(/ /g, "+")}:wght@400;700;800`)
      .join("&");
    return `https://fonts.googleapis.com/css2?${parts}&display=swap`;
  }, [families]);
  // eslint-disable-next-line @next/next/no-page-custom-font
  return <link rel="stylesheet" href={href} />;
}

// ---------- Live 9:16 preview ----------

function BrandPreview({ brand }: { brand: Brand }) {
  const { colors, fonts } = brand;
  const logo = assetUrl(brand.logoHash);
  return (
    <div className="sticky top-6">
      <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-faint">
        Live preview · captions + outro card
      </p>
      <div
        className="relative mx-auto aspect-[9/16] w-full max-w-[250px] overflow-hidden rounded-2xl border border-line-strong shadow-[0_20px_60px_-20px_rgba(0,0,0,0.8)]"
        style={{ background: colors.backgroundColor }}
      >
        {/* safe-zone guides */}
        <div className="pointer-events-none absolute inset-x-[8%] inset-y-[6%] rounded-lg border border-dashed border-white/10" />

        {/* caption sample at ~55% height */}
        <div
          className="absolute inset-x-0 top-[52%] px-3 text-center"
          style={{ fontFamily: `'${fonts.caption}', sans-serif` }}
        >
          <span
            className="text-[15px] font-bold leading-snug"
            style={{
              color: colors.primaryColor,
              textShadow: "0 2px 10px rgba(0,0,0,0.65)",
            }}
          >
            your captions{" "}
            <span style={{ color: colors.captionHighlightColor }}>look</span> like this
          </span>
        </div>

        {/* corner badge */}
        {brand.ctaBadge && (
          <div
            className="absolute right-2.5 top-2.5 rounded-full px-2 py-0.5 text-[8px] font-bold"
            style={{
              background: colors.accentColor,
              color: colors.backgroundColor,
              fontFamily: `'${fonts.caption}', sans-serif`,
            }}
          >
            {brand.ctaBadge}
          </div>
        )}

        {/* outro card block */}
        <div className="absolute inset-x-0 bottom-0 flex flex-col items-center gap-1.5 px-4 pb-5 text-center">
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logo}
              alt="logo"
              className="mb-1 h-10 w-10 rounded-xl object-contain"
            />
          ) : (
            <div
              className="mb-1 flex h-10 w-10 items-center justify-center rounded-xl text-sm font-black"
              style={{
                background: colors.accentColor,
                color: colors.backgroundColor,
                fontFamily: `'${fonts.display}', sans-serif`,
              }}
            >
              {(brand.brandName || "R")[0]?.toUpperCase()}
            </div>
          )}
          <p
            className="text-[16px] font-extrabold leading-tight"
            style={{
              color: colors.primaryColor,
              fontFamily: `'${fonts.display}', sans-serif`,
            }}
          >
            {brand.brandName || "Your Brand"}
          </p>
          {brand.tagline && (
            <p className="text-[9px] opacity-70" style={{ color: colors.primaryColor }}>
              {brand.tagline}
            </p>
          )}
          {brand.ctaText && (
            <span
              className="mt-1 rounded-full px-2.5 py-1 text-[8px] font-bold"
              style={{ background: colors.accentColor, color: colors.backgroundColor }}
            >
              {brand.ctaText}
            </span>
          )}
          {brand.disclaimer && (
            <p
              className="mt-1 text-[6px] leading-tight opacity-40"
              style={{ color: colors.primaryColor }}
            >
              {brand.disclaimer}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------- Color field ----------

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <Field label={label}>
      <div className="flex items-center gap-2">
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} />
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-[34px] w-28 font-mono text-[12px] uppercase"
        />
      </div>
    </Field>
  );
}

// ---------- Main panel ----------

export function BrandPanel() {
  const [brand, setBrand] = useState<Brand | null>(null);
  const [savedJson, setSavedJson] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const logoInput = useRef<HTMLInputElement>(null);
  const presenterInput = useRef<HTMLInputElement>(null);
  const musicInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/brand")
      .then((r) => r.json())
      .then((d) => {
        setBrand(d.brand);
        setSavedJson(JSON.stringify(d.brand));
      });
  }, []);

  const dirty = brand !== null && JSON.stringify(brand) !== savedJson;

  const patch = useCallback((p: Partial<Brand>) => {
    setBrand((b) => (b ? { ...b, ...p } : b));
  }, []);

  async function save() {
    if (!brand) return;
    setSaving(true);
    const res = await fetch("/api/brand", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ brand }),
    });
    if (res.ok) {
      const d = await res.json();
      setBrand(d.brand);
      setSavedJson(JSON.stringify(d.brand));
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1800);
    }
    setSaving(false);
  }

  if (!brand) {
    return <p className="py-16 text-center text-sm text-ink-faint">Loading brand…</p>;
  }

  return (
    <>
      <FontLoader families={[brand.fonts.caption, brand.fonts.display]} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_270px]">
        <div className="flex flex-col gap-4">
          {/* Identity */}
          <div className="rise" style={{ animationDelay: "0ms" }}>
          <Section
            title="Identity"
            description="Name, logo, and the calls-to-action that appear on every video."
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Brand name">
                <Input
                  value={brand.brandName}
                  placeholder="Acme Shorts"
                  onChange={(e) => patch({ brandName: e.target.value })}
                />
              </Field>
              <Field label="Tagline">
                <Input
                  value={brand.tagline}
                  placeholder="Daily ideas in 60 seconds"
                  onChange={(e) => patch({ tagline: e.target.value })}
                />
              </Field>
              <Field label="CTA text" hint="outro card">
                <Input
                  value={brand.ctaText}
                  placeholder="Follow for more"
                  onChange={(e) => patch({ ctaText: e.target.value })}
                />
              </Field>
              <Field label="CTA badge" hint="corner overlay">
                <Input
                  value={brand.ctaBadge}
                  placeholder="@acmeshorts"
                  onChange={(e) => patch({ ctaBadge: e.target.value })}
                />
              </Field>
            </div>

            <div className="mt-4 flex items-center gap-4">
              <input
                ref={logoInput}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (f) {
                    const asset = await uploadFile(f, "logo");
                    patch({ logoHash: asset.hash });
                  }
                  e.target.value = "";
                }}
              />
              <button
                type="button"
                onClick={() => logoInput.current?.click()}
                className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-xl border border-dashed border-line-strong bg-inset transition-colors hover:border-amber/60"
              >
                {brand.logoHash ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={assetUrl(brand.logoHash)!}
                    alt="logo"
                    className="h-full w-full object-contain p-1.5"
                  />
                ) : (
                  <ImagePlus size={18} className="text-ink-faint" />
                )}
              </button>
              <div>
                <p className="text-sm font-medium">Logo</p>
                <p className="text-[12px] text-ink-faint">PNG with transparency works best.</p>
                {brand.logoHash && (
                  <button
                    className="mt-1 text-[12px] text-danger/80 hover:text-danger"
                    onClick={() => patch({ logoHash: null })}
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>
          </Section>
          </div>

          {/* Look */}
          <div className="rise" style={{ animationDelay: "70ms" }}>
          <Section
            title="Look & tone"
            description="Colors and fonts flow into captions, overlays, and the outro. Tone words steer the AI's imagery."
          >
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <ColorField
                label="Background"
                value={brand.colors.backgroundColor}
                onChange={(v) => patch({ colors: { ...brand.colors, backgroundColor: v } })}
              />
              <ColorField
                label="Primary"
                value={brand.colors.primaryColor}
                onChange={(v) => patch({ colors: { ...brand.colors, primaryColor: v } })}
              />
              <ColorField
                label="Accent"
                value={brand.colors.accentColor}
                onChange={(v) => patch({ colors: { ...brand.colors, accentColor: v } })}
              />
              <ColorField
                label="Caption highlight"
                value={brand.colors.captionHighlightColor}
                onChange={(v) =>
                  patch({ colors: { ...brand.colors, captionHighlightColor: v } })
                }
              />
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Caption font">
                <Select
                  value={brand.fonts.caption}
                  onChange={(e) => patch({ fonts: { ...brand.fonts, caption: e.target.value } })}
                >
                  {FONT_CHOICES.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Display font" hint="outro & titles">
                <Select
                  value={brand.fonts.display}
                  onChange={(e) => patch({ fonts: { ...brand.fonts, display: e.target.value } })}
                >
                  {FONT_CHOICES.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            <div className="mt-4">
              <Field
                label="Visual tone words"
                hint="steers AI image prompts"
              >
                <Input
                  value={brand.toneWords}
                  placeholder="bright, modern, editorial"
                  onChange={(e) => patch({ toneWords: e.target.value })}
                />
              </Field>
            </div>
          </Section>
          </div>

          {/* Presenters */}
          <div className="rise" style={{ animationDelay: "140ms" }}>
          <Section
            title="Presenter avatars"
            description="Optional corner presenter with an audio-reactive visualizer. Voice mapping unlocks once your ElevenLabs key is set."
            actions={
              <Button size="sm" variant="outline" onClick={() => presenterInput.current?.click()}>
                <Plus size={14} /> Add
              </Button>
            }
          >
            <input
              ref={presenterInput}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) {
                  const asset = await uploadFile(f, "presenter");
                  const presenter: Presenter = {
                    id: Math.random().toString(36).slice(2, 9),
                    name: f.name.replace(/\.[^.]+$/, ""),
                    imageHash: asset.hash,
                    voiceId: null,
                  };
                  patch({ presenters: [...brand.presenters, presenter] });
                }
                e.target.value = "";
              }}
            />
            {brand.presenters.length === 0 ? (
              <p className="py-2 text-[13px] text-ink-faint">
                No presenters yet — videos render without one, or add a face for your brand.
              </p>
            ) : (
              <div className="flex flex-wrap gap-3">
                {brand.presenters.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center gap-3 rounded-xl border border-line bg-inset p-2.5 pr-3"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={assetUrl(p.imageHash) ?? ""}
                      alt={p.name}
                      className="h-11 w-11 rounded-full border border-line-strong object-cover"
                    />
                    <Input
                      value={p.name}
                      className="h-8 w-32 text-[13px]"
                      onChange={(e) =>
                        patch({
                          presenters: brand.presenters.map((x) =>
                            x.id === p.id ? { ...x, name: e.target.value } : x
                          ),
                        })
                      }
                    />
                    <button
                      className="text-ink-faint transition-colors hover:text-danger"
                      onClick={() =>
                        patch({ presenters: brand.presenters.filter((x) => x.id !== p.id) })
                      }
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </Section>
          </div>

          {/* Extras */}
          <div className="rise" style={{ animationDelay: "210ms" }}>
          <Section
            title="Intro, outro & music"
            description="Bookend animations and an optional looped music bed under the voiceover."
          >
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-8">
                <Switch
                  checked={brand.intro.enabled}
                  onChange={(v) => patch({ intro: { enabled: v } })}
                  label="Animated intro"
                />
                <Switch
                  checked={brand.outro.enabled}
                  onChange={(v) => patch({ outro: { enabled: v } })}
                  label="Outro brand card"
                />
              </div>

              <div className="flex items-center gap-3">
                <input
                  ref={musicInput}
                  type="file"
                  accept="audio/*"
                  className="hidden"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (f) {
                      const asset = await uploadFile(f, "music");
                      patch({ music: { ...brand.music, assetHash: asset.hash } });
                    }
                    e.target.value = "";
                  }}
                />
                <Button size="sm" variant="outline" onClick={() => musicInput.current?.click()}>
                  <Music4 size={14} />
                  {brand.music.assetHash ? "Replace music bed" : "Upload music bed"}
                </Button>
                {brand.music.assetHash && (
                  <>
                    <audio
                      controls
                      src={assetUrl(brand.music.assetHash)!}
                      className="h-8 max-w-[220px]"
                    />
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[10px] uppercase tracking-wider text-ink-faint">
                        vol
                      </span>
                      <input
                        type="range"
                        min={0}
                        max={0.4}
                        step={0.01}
                        value={brand.music.volume}
                        onChange={(e) =>
                          patch({
                            music: { ...brand.music, volume: Number(e.target.value) },
                          })
                        }
                      />
                    </div>
                    <button
                      className="text-ink-faint transition-colors hover:text-danger"
                      onClick={() => patch({ music: { ...brand.music, assetHash: null } })}
                    >
                      <Trash2 size={14} />
                    </button>
                  </>
                )}
              </div>

              <Field label="Disclaimer" hint="optional — shown small on the outro">
                <Textarea
                  rows={2}
                  value={brand.disclaimer}
                  placeholder="Not financial advice. For entertainment purposes only."
                  onChange={(e) => patch({ disclaimer: e.target.value })}
                />
              </Field>
            </div>
          </Section>
          </div>
        </div>

        <BrandPreview brand={brand} />
      </div>

      {/* Save bar */}
      <div
        className={`pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center pb-5 transition-all duration-300 ${
          dirty || savedFlash ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"
        }`}
      >
        <div className="pointer-events-auto flex items-center gap-4 rounded-full border border-line-strong bg-raised/90 py-2 pl-5 pr-2 shadow-[0_12px_40px_-8px_rgba(0,0,0,0.7)] backdrop-blur-md">
          {savedFlash && !dirty ? (
            <span className="pr-3 text-sm text-ok">Brand saved ✓</span>
          ) : (
            <>
              <span className="text-sm text-ink-dim">Unsaved brand changes</span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setBrand(JSON.parse(savedJson || JSON.stringify(defaultBrand)))}
              >
                Discard
              </Button>
              <Button size="sm" onClick={save} disabled={saving}>
                <UploadCloud size={14} />
                {saving ? "Saving…" : "Save brand"}
              </Button>
            </>
          )}
        </div>
      </div>
    </>
  );
}
