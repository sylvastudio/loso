import { readFile } from "node:fs/promises";
import path from "node:path";

// Shared drawing for the link-preview card (Open Graph / Twitter) and the
// home-screen icon. Rendered once at build time; fonts ship with the repo so
// the build never depends on the network.

const INK = "#f2f1ec";
const VOID = "#0b0b0c";
const LIME = "#d4f53c";

export async function fonts() {
  const dir = path.join(process.cwd(), "src/app/_og");
  const [light, italic, mono] = await Promise.all(
    ["fraunces-light.ttf", "fraunces-italic.ttf", "plex-mono.ttf"].map((f) => readFile(path.join(dir, f)))
  );
  return [
    { name: "Fraunces", data: light, weight: 300 as const, style: "normal" as const },
    { name: "Fraunces", data: italic, weight: 400 as const, style: "italic" as const },
    { name: "Plex", data: mono, weight: 400 as const, style: "normal" as const },
  ];
}

/** The Onion Skin mark at a given size (three frames + the lime "now" dot). */
export function Mark({ size, stroke = INK }: { size: number; stroke?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none">
      <rect x="26" y="10" width="28" height="28" rx="6" stroke={stroke} strokeWidth="4.5" opacity="0.3" />
      <rect x="18" y="18" width="28" height="28" rx="6" stroke={stroke} strokeWidth="4.5" opacity="0.6" />
      <rect x="10" y="26" width="28" height="28" rx="6" stroke={stroke} strokeWidth="4.5" />
      <circle cx="24" cy="40" r="5" fill={LIME} />
    </svg>
  );
}

export function ShareCard() {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        background: VOID,
        color: INK,
        padding: "64px 80px",
        fontFamily: "Fraunces",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
        <Mark size={56} />
        <div style={{ fontSize: 48, fontStyle: "italic", letterSpacing: -1 }}>Loso</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ fontFamily: "Plex", fontSize: 20, letterSpacing: 4, color: "#9a988f", marginBottom: 22 }}>
          TELL IT THE VIDEO YOU WANT
        </div>
        <div style={{ fontSize: 96, fontWeight: 300, lineHeight: 1.02, letterSpacing: -3 }}>Say what you want.</div>
        <div style={{ fontSize: 96, fontStyle: "italic", lineHeight: 1.08, letterSpacing: -3, color: LIME }}>
          Loso makes the video.
        </div>
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          borderTop: "1px solid #2a2a2c",
          paddingTop: 22,
          fontFamily: "Plex",
          fontSize: 20,
          color: "#9a988f",
        }}
      >
        <div>Your files stay on your computer.</div>
        <div>loso.sylvastudio.com</div>
      </div>
    </div>
  );
}

export function HomeIcon() {
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: VOID }}>
      <Mark size={128} />
    </div>
  );
}
