"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ImagePlus, Loader2, Music4, Plus, Trash2 } from "lucide-react";
import { FONT_CHOICES, defaultBrand, type Brand, type Presenter } from "@/lib/brand";
import { Button, ErrorState, Field, InlineError, Input, Section, Select, Switch, Textarea } from "@/components/ui";
import { fetchJson, jsonInit } from "@/lib/fetch-json";
import { FontLoader } from "@/components/font-loader";

async function uploadFile(file: File, kind: string): Promise<{ hash: string; url: string }> {
  const form = new FormData();
  form.append("file", file);
  form.append("kind", kind);
  const d = await fetchJson<{ asset: { hash: string; url: string } }>("/api/assets", {
    method: "POST",
    body: form,
  });
  return d.asset;
}

function assetUrl(hash: string | null): string | null {
  return hash ? `/api/assets/${hash}` : null;
}

// ---------- Live 9:16 preview ----------

function BrandPreview({ brand }: { brand: Brand }) {
  const { colors, fonts } = brand;
  const logo = assetUrl(brand.logoHash);
  return (
    <div className="sticky top-8">
      <p className="micro mb-2.5">Live preview</p>
      <div
        className="relative mx-auto aspect-[9/16] w-full max-w-[240px] overflow-hidden border border-line-strong shadow-[0_30px_80px_-30px_rgba(0,0,0,0.9)]"
        style={{ background: colors.backgroundColor }}
      >
        {/* caption sample */}
        <div
          className="absolute inset-x-0 top-[48%] -translate-y-1/2 px-3 text-center"
          style={{ fontFamily: `'${fonts.caption}', sans-serif` }}
        >
          <span
            className="text-[15px] font-extrabold leading-snug"
            style={{ color: colors.primaryColor, textShadow: "0 2px 10px rgba(0,0,0,0.65)" }}
          >
            your captions <span style={{ color: colors.captionHighlightColor }}>look</span> like
            this
          </span>
        </div>

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

        {/* outro block */}
        <div className="absolute inset-x-0 bottom-0 flex flex-col items-center gap-1.5 px-4 pb-5 text-center">
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logo} alt="logo" className="mb-1 h-10 w-10 object-contain" />
          ) : (
            <div
              className="mb-1 flex h-10 w-10 items-center justify-center rounded-full text-sm font-black"
              style={{
                background: colors.accentColor,
                color: colors.backgroundColor,
                fontFamily: `'${fonts.display}', sans-serif`,
              }}
            >
              {(brand.brandName || "S")[0]?.toUpperCase()}
            </div>
          )}
          <p
            className="text-[15px] font-extrabold leading-tight"
            style={{ color: colors.primaryColor, fontFamily: `'${fonts.display}', sans-serif` }}
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
            <p className="mt-1 text-[6px] leading-tight opacity-40" style={{ color: colors.primaryColor }}>
              {brand.disclaimer}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

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
    <div>
      <span className="micro mb-1.5 block">{label}</span>
      <div className="flex items-center gap-2.5">
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} />
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-24 font-mono text-[12px] uppercase"
        />
      </div>
    </div>
  );
}

type UploadSlot = "logo" | "presenter" | "music";

// Section notes: be honest about which brand settings the renderer uses today.
const IN_USE = <span className="micro text-lime">in use · captions</span>;
const SOON = <span className="micro text-ink-dim">coming soon</span>;

export function BrandPanel({ onDirtyChange }: { onDirtyChange?: (dirty: boolean) => void }) {
  const [brand, setBrand] = useState<Brand | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [savedJson, setSavedJson] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const [uploadingSlot, setUploadingSlot] = useState<UploadSlot | null>(null);
  const [uploadError, setUploadError] = useState<{ slot: UploadSlot; msg: string } | null>(null);
  const logoInput = useRef<HTMLInputElement>(null);
  const presenterInput = useRef<HTMLInputElement>(null);
  const musicInput = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    setLoadError(null);
    fetchJson<{ brand: Brand }>("/api/brand")
      .then((d) => {
        setBrand(d.brand);
        setSavedJson(JSON.stringify(d.brand));
      })
      .catch((e: Error) => setLoadError(e.message));
  }, []);

  useEffect(load, [load]);

  const dirty = brand !== null && JSON.stringify(brand) !== savedJson;
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);

  /** Upload into a slot with a per-slot spinner and inline error. */
  async function uploadInto(slot: UploadSlot, file: File, apply: (hash: string) => void) {
    setUploadingSlot(slot);
    setUploadError(null);
    try {
      const asset = await uploadFile(file, slot);
      apply(asset.hash);
    } catch (e) {
      setUploadError({ slot, msg: `Upload failed — ${(e as Error).message}` });
    } finally {
      setUploadingSlot(null);
    }
  }

  const slotError = (slot: UploadSlot) =>
    uploadError?.slot === slot ? (
      <InlineError className="mt-2" onDismiss={() => setUploadError(null)}>
        {uploadError.msg}
      </InlineError>
    ) : null;

  const patch = useCallback((p: Partial<Brand>) => {
    setBrand((b) => (b ? { ...b, ...p } : b));
  }, []);

  async function save() {
    if (!brand) return;
    setSaving(true);
    setSaveError(null);
    try {
      const d = await fetchJson<{ brand: Brand }>("/api/brand", jsonInit("PUT", { brand }));
      setBrand(d.brand);
      setSavedJson(JSON.stringify(d.brand));
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1800);
    } catch (e) {
      setSaveError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (loadError) {
    return <ErrorState detail={`Brand settings couldn't load (${loadError}).`} onRetry={load} />;
  }
  if (!brand) {
    return <p className="py-16 text-center text-sm text-ink-faint">Loading brand…</p>;
  }

  return (
    <>
      <FontLoader families={[brand.fonts.caption, brand.fonts.display]} />

      <div className="grid grid-cols-1 gap-10 pt-4 lg:grid-cols-[1fr_260px]">
        <div>
          <Section
            n="01"
            title="Identity"
            description="Name, logo, and the calls-to-action for the outro card."
            actions={SOON}
          >
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
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

            <div className="mt-7 flex items-center gap-4">
              <input
                ref={logoInput}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (f) await uploadInto("logo", f, (hash) => patch({ logoHash: hash }));
                  e.target.value = "";
                }}
              />
              <button
                type="button"
                onClick={() => logoInput.current?.click()}
                aria-label={brand.logoHash ? "Replace logo" : "Upload logo"}
                disabled={uploadingSlot === "logo"}
                className="flex h-14 w-14 items-center justify-center overflow-hidden border border-dashed border-line-strong transition-colors hover:border-lime"
              >
                {uploadingSlot === "logo" ? (
                  <Loader2 size={16} className="animate-spin text-lime" />
                ) : brand.logoHash ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={assetUrl(brand.logoHash)!}
                    alt="logo"
                    className="h-full w-full object-contain p-1.5"
                  />
                ) : (
                  <ImagePlus size={16} className="text-ink-faint" />
                )}
              </button>
              <div>
                <p className="text-[13px]">Logo — PNG with transparency works best.</p>
                {brand.logoHash && (
                  <button
                    className="mt-0.5 text-[12px] text-danger/70 hover:text-danger"
                    onClick={() => patch({ logoHash: null })}
                  >
                    Remove
                  </button>
                )}
                {slotError("logo")}
              </div>
            </div>
          </Section>

          <Section
            n="02"
            title="Look & tone"
            description="Background, primary, highlight and caption font style your captions today. Accent, display font and tone words apply when overlays and AI visuals ship."
            actions={IN_USE}
          >
            <div className="grid grid-cols-2 gap-x-8 gap-y-6">
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
                label="Highlight"
                value={brand.colors.captionHighlightColor}
                onChange={(v) => patch({ colors: { ...brand.colors, captionHighlightColor: v } })}
              />
            </div>

            <div className="mt-7 grid grid-cols-1 gap-6 sm:grid-cols-2">
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

            <div className="mt-7">
              <Field label="Visual tone words" hint="for AI visuals · coming soon">
                <Input
                  value={brand.toneWords}
                  placeholder="bright, modern, editorial"
                  onChange={(e) => patch({ toneWords: e.target.value })}
                />
              </Field>
            </div>
          </Section>

          <Section
            n="03"
            title="Presenters"
            description="Optional corner presenter with an audio-reactive visualizer. Not rendered yet — set it up now and it will be ready."
            actions={
              <div className="flex flex-col items-start gap-3">
                {SOON}
              <Button
                size="sm"
                variant="outline"
                disabled={uploadingSlot === "presenter"}
                onClick={() => presenterInput.current?.click()}
              >
                {uploadingSlot === "presenter" ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <Plus size={13} />
                )}{" "}
                Add
              </Button>
              </div>
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
                  await uploadInto("presenter", f, (hash) => {
                    const presenter: Presenter = {
                      id: Math.random().toString(36).slice(2, 9),
                      name: f.name.replace(/\.[^.]+$/, ""),
                      imageHash: hash,
                      voiceId: null,
                    };
                    setBrand((b) => (b ? { ...b, presenters: [...b.presenters, presenter] } : b));
                  });
                }
                e.target.value = "";
              }}
            />
            {brand.presenters.length === 0 ? (
              <p className="text-[13px] text-ink-faint">
                No presenters yet — videos render without one, or add a face for your brand.
              </p>
            ) : (
              <div className="flex flex-wrap gap-6">
                {brand.presenters.map((p) => (
                  <div key={p.id} className="flex items-center gap-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={assetUrl(p.imageHash) ?? ""}
                      alt={p.name}
                      className="h-11 w-11 rounded-full border border-line-strong object-cover"
                    />
                    <Input
                      value={p.name}
                      className="w-28 text-[13px]"
                      onChange={(e) =>
                        patch({
                          presenters: brand.presenters.map((x) =>
                            x.id === p.id ? { ...x, name: e.target.value } : x
                          ),
                        })
                      }
                    />
                    <button
                      aria-label={`Remove presenter ${p.name}`}
                      title="Remove presenter"
                      className="flex h-7 w-7 items-center justify-center text-ink-faint transition-colors hover:text-danger"
                      onClick={() =>
                        patch({ presenters: brand.presenters.filter((x) => x.id !== p.id) })
                      }
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            {slotError("presenter")}
          </Section>

          <Section
            n="04"
            title="Bookends & music"
            description="Intro / outro animations and an optional looped music bed under the voice."
            actions={SOON}
          >
            <div className="flex flex-col gap-6">
              <div className="flex items-center gap-10">
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

              <div className="flex flex-wrap items-center gap-4">
                <input
                  ref={musicInput}
                  type="file"
                  accept="audio/*"
                  className="hidden"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (f) {
                      await uploadInto("music", f, (hash) =>
                        setBrand((b) => (b ? { ...b, music: { ...b.music, assetHash: hash } } : b))
                      );
                    }
                    e.target.value = "";
                  }}
                />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={uploadingSlot === "music"}
                  onClick={() => musicInput.current?.click()}
                >
                  {uploadingSlot === "music" ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <Music4 size={13} />
                  )}
                  {brand.music.assetHash ? "Replace music" : "Upload music bed"}
                </Button>
                {brand.music.assetHash && (
                  <>
                    <audio controls src={assetUrl(brand.music.assetHash)!} className="h-8 max-w-[200px]" />
                    <div className="flex items-center gap-2">
                      <span className="micro">vol</span>
                      <input
                        type="range"
                        aria-label="Music volume"
                        min={0}
                        max={0.4}
                        step={0.01}
                        value={brand.music.volume}
                        onChange={(e) =>
                          patch({ music: { ...brand.music, volume: Number(e.target.value) } })
                        }
                      />
                    </div>
                    <button
                      aria-label="Remove music bed"
                      title="Remove music bed"
                      className="flex h-7 w-7 items-center justify-center text-ink-faint transition-colors hover:text-danger"
                      onClick={() => patch({ music: { ...brand.music, assetHash: null } })}
                    >
                      <Trash2 size={13} />
                    </button>
                  </>
                )}
              </div>
              {slotError("music")}

              <Field label="Disclaimer" hint="optional — small print on the outro">
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

        <BrandPreview brand={brand} />
      </div>

      {/* Save bar */}
      <div
        className={`pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center pb-6 transition-all duration-300 ${
          dirty || savedFlash ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"
        }`}
      >
        <div className="pointer-events-auto flex items-center gap-4 border border-line-strong bg-black/90 py-2.5 pl-5 pr-2.5 backdrop-blur-md">
          {savedFlash && !dirty ? (
            <span className="pr-3 text-[13px] text-lime">Brand saved</span>
          ) : (
            <>
              {saveError ? (
                <span className="text-[13px] text-danger" role="alert">
                  Save failed — {saveError}
                </span>
              ) : (
                <span className="text-[13px] text-ink-dim">Unsaved changes</span>
              )}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setBrand(JSON.parse(savedJson || JSON.stringify(defaultBrand)))}
              >
                Discard
              </Button>
              <Button size="sm" onClick={save} disabled={saving}>
                {saving ? "Saving…" : saveError ? "Retry save" : "Save brand"}
              </Button>
            </>
          )}
        </div>
      </div>
    </>
  );
}
