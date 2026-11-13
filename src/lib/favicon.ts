// The tab icon moves while Loso works. Firefox animates the SVG favicon by
// itself; Chrome and Safari show only its first frame, so here the Onion Skin
// frames are stepped by swapping the icon link (about 6 frames a second).
// Reduced motion keeps the still icon.

const STILL = "/icon.svg";
const FRAMES = 12;
const STEP_MS = 175;

function frameSvg(i: number): string {
  // Phase 0..1 through one film-gate step: the three frames slide forward one place.
  const t = i / FRAMES;
  const ease = t < 0.4 ? 0 : t > 0.8 ? 1 : (t - 0.4) / 0.4;
  const frames = [0, 1, 2].map((k) => {
    const pos = k - ease; // 0 = front, 2 = back
    const off = Math.max(-1, pos) * 8;
    const opacity = pos < 0 ? Math.max(0, 1 + pos * 1.6) : [1, 0.7, 0.45][Math.round(pos)] ?? 0.45;
    return `<rect x="9" y="25" width="30" height="30" rx="6" transform="translate(${off} ${-off})" opacity="${opacity.toFixed(2)}"/>`;
  });
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#0b0b0c"/>` +
    `<g fill="none" stroke="#f2f1ec" stroke-width="5.5">${frames.reverse().join("")}</g>` +
    `<circle cx="24" cy="40" r="6" fill="#d4f53c" opacity="${ease > 0 && ease < 1 ? 0.35 : 1}"/></svg>`
  );
}

let urls: string[] | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let users = 0;

function iconLink(): HTMLLinkElement | null {
  return document.querySelector<HTMLLinkElement>('link[rel="icon"][type="image/svg+xml"]') ?? document.querySelector('link[rel="icon"]');
}

/** Call with true when Loso starts working and false when it stops (calls are counted). */
export function setFaviconWorking(on: boolean) {
  if (typeof window === "undefined") return;
  users = Math.max(0, users + (on ? 1 : -1));
  const link = iconLink();
  if (!link) return;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (users > 0 && !timer && !reduce) {
    urls ??= Array.from({ length: FRAMES }, (_, i) => `data:image/svg+xml,${encodeURIComponent(frameSvg(i))}`);
    let i = 0;
    timer = setInterval(() => {
      link.href = urls![i++ % FRAMES];
    }, STEP_MS);
  } else if (users === 0 && timer) {
    clearInterval(timer);
    timer = null;
    link.href = link.dataset.still ?? STILL;
  }
  if (!link.dataset.still && !link.href.startsWith("data:")) link.dataset.still = link.getAttribute("href") ?? STILL;
}
