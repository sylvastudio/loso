"use client";

import { useSyncExternalStore } from "react";
import { THEME_KEY } from "@/lib/theme-boot";

// Appearance: "system" follows the OS, "light" and "dark" pin it.
// The choice lives in localStorage and on <html data-theme>; the CSS in
// globals.css does the rest. layout.tsx applies it before first paint.

export type ThemeChoice = "system" | "light" | "dark";
export { THEME_KEY };
export const THEMES: ThemeChoice[] = ["system", "light", "dark"];
const EVENT = "loso:theme";


function read(): ThemeChoice {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

export function setTheme(t: ThemeChoice) {
  try {
    if (t === "system") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, t);
  } catch {
    // private window or blocked storage: still switch for this visit
  }
  document.documentElement.setAttribute("data-theme", t);
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(cb: () => void) {
  // Other toggles on the page, and other tabs.
  const onStorage = (e: StorageEvent) => {
    if (e.key !== THEME_KEY) return;
    document.documentElement.setAttribute("data-theme", read());
    cb();
  };
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", onStorage);
  };
}

function readAttr(): ThemeChoice {
  const v = document.documentElement.getAttribute("data-theme");
  return v === "light" || v === "dark" ? v : "system";
}

export function useTheme(): [ThemeChoice, (t: ThemeChoice) => void] {
  const theme = useSyncExternalStore(subscribe, readAttr, () => "system" as ThemeChoice);
  return [theme, setTheme];
}

export const THEME_LABEL: Record<ThemeChoice, string> = {
  system: "System",
  light: "Light",
  dark: "Dark",
};
