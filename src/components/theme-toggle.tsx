"use client";

import { useId } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { cx } from "@/components/ui";
import { THEMES, THEME_LABEL, useTheme, type ThemeChoice } from "@/lib/theme";

const ICON: Record<ThemeChoice, typeof Sun> = { system: Monitor, light: Sun, dark: Moon };

/**
 * Small header control: one button that steps System → Light → Dark.
 * It shows the current theme ("Theme: Light"); the accessible name and
 * tooltip also say what a press will do.
 */
export function ThemeToggle({ showLabel = false, accentHover = false }: { showLabel?: boolean; accentHover?: boolean }) {
  const [theme, setTheme] = useTheme();
  const next = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
  const Icon = ICON[theme];
  const label = `Theme: ${THEME_LABEL[theme]}. Press to switch to ${THEME_LABEL[next].toLowerCase()}`;
  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      aria-label={label}
      title={label}
      className={cx(
        "flex min-h-10 shrink-0 items-center justify-center gap-1.5 text-[13.5px] text-ink-dim transition-colors",
        accentHover ? "hover:text-lime" : "hover:text-ink",
        !showLabel && "w-10"
      )}
    >
      <Icon size={15} aria-hidden />
      {showLabel && (
        <span aria-hidden className="whitespace-nowrap">
          <span className="text-ink-faint">Theme:</span> {THEME_LABEL[theme]}
        </span>
      )}
    </button>
  );
}

// Specimens for the settings sheet: literal swatches of each theme, so they
// read the same whichever theme is showing.
const SPECIMEN: Record<"light" | "dark", { ground: string; ink: string; dim: string; accent: string; rule: string }> = {
  light: { ground: "#f2eee3", ink: "#16140f", dim: "#68625a", accent: "#4a6300", rule: "#c6bda9" },
  dark: { ground: "#0a0a0b", ink: "#f2f1ec", dim: "#7c7c84", accent: "#d4f53c", rule: "#2e2e36" },
};

function Specimen({ kind }: { kind: "light" | "dark" }) {
  const s = SPECIMEN[kind];
  return (
    <span className="flex h-full w-full flex-col justify-between p-2.5" style={{ background: s.ground, color: s.ink }}>
      <span className="font-serif text-[22px] italic leading-none tracking-tight">Aa</span>
      <span className="flex flex-col gap-1">
        <span className="h-px w-full" style={{ background: s.rule }} />
        <span className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: s.accent }} />
          <span className="h-[3px] w-8" style={{ background: s.dim }} />
        </span>
      </span>
    </span>
  );
}

/** Settings → Appearance: three specimen tiles as a radio group. */
export function AppearancePicker() {
  const [theme, setTheme] = useTheme();
  const name = useId();
  return (
    <fieldset className="flex flex-col gap-4">
      <legend className="sr-only">Appearance</legend>
      <div className="grid grid-cols-3 gap-3">
        {THEMES.map((t) => (
          <label
            key={t}
            className={cx(
              "group flex cursor-pointer flex-col gap-2 has-[:focus-visible]:outline has-[:focus-visible]:outline-1 has-[:focus-visible]:outline-offset-4 has-[:focus-visible]:outline-lime"
            )}
          >
            <input
              type="radio"
              name={name}
              value={t}
              checked={theme === t}
              onChange={() => setTheme(t)}
              className="sr-only"
            />
            <span
              className={cx(
                "relative flex aspect-[4/3] overflow-hidden border transition-colors",
                theme === t ? "border-lime outline outline-1 outline-lime" : "border-edge group-hover:border-ink-dim"
              )}
            >
              {t === "system" ? (
                <>
                  <span className="w-1/2 overflow-hidden">
                    <span className="block h-full w-[200%]">
                      <Specimen kind="light" />
                    </span>
                  </span>
                  <span className="w-1/2 overflow-hidden">
                    <span className="block h-full w-[200%] -translate-x-1/2">
                      <Specimen kind="dark" />
                    </span>
                  </span>
                </>
              ) : (
                <Specimen kind={t} />
              )}
            </span>
            <span className="flex items-center gap-1.5 text-[13.5px]">
              <span
                aria-hidden
                className={cx("h-1.5 w-1.5 rounded-full", theme === t ? "bg-lime" : "bg-transparent outline outline-1 outline-edge")}
              />
              <span className={theme === t ? "text-ink" : "text-ink-dim"}>{t === "system" ? "Match my computer" : THEME_LABEL[t]}</span>
            </span>
          </label>
        ))}
      </div>
      <p className="text-[13px] text-ink-dim">
        Light is warm paper; dark is the darkroom. The video itself always looks the same, and its stage stays dark so
        you judge colour fairly.
      </p>
    </fieldset>
  );
}
