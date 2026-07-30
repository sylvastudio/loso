import React, { useEffect, useRef, useState } from "react";
import {
  AbsoluteFill,
  Audio,
  Img,
  OffthreadVideo,
  Sequence,
  continueRender,
  delayRender,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import type { ResolvedCompositorDoc, ResolvedLayer } from "../lib/compositor";

// Entrance animation → extra transform + opacity composed onto a layer's box.
// Driven by springs so motion settles naturally and stays frame-accurate in
// the export. Hidden until the layer's delay is reached.
function useEntrance(layer: ResolvedLayer): { opacity: number; transform: string } {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const a = layer.anim;
  if (!a || a.preset === "none") return { opacity: 1, transform: "" };

  const p = spring({
    frame: frame - a.delay,
    fps,
    durationInFrames: Math.max(1, a.duration),
    config: a.preset === "hero"
      ? { damping: 16, stiffness: 110, mass: 0.9 }
      : { damping: 200, stiffness: 120, mass: 0.6 },
  });
  const clamp = (n: number) => Math.max(0, Math.min(1, n));

  if (layer.type === "text" || layer.type === "video" || layer.type === "image") {
    if (a.preset === "hero") {
      const finalCX = layer.x + layer.width / 2;
      const finalCY = layer.y + layer.height / 2;
      const offX = (width / 2 - finalCX) * (1 - p);
      const offY = (height / 2 - finalCY) * (1 - p);
      const scale = 1 + (1 - p) * 0.8;
      return {
        opacity: clamp(p * 3),
        transform: `translate(${offX}px, ${offY}px) scale(${scale})`,
      };
    }
    if (a.preset === "rise") return { opacity: clamp(p), transform: `translateY(${(1 - p) * 50}px)` };
    if (a.preset === "scale") return { opacity: clamp(p), transform: `scale(${0.8 + 0.2 * p})` };
    return { opacity: clamp(p), transform: "" }; // fade
  }
  return { opacity: 1, transform: "" };
}

// Loads the Google fonts used by text layers and blocks the render until they
// are ready — without this, exported frames fall back to a system font.
function useCompositionFonts(families: string[]) {
  const [handle] = useState(() => delayRender("Loading fonts"));
  const done = useRef(false);
  const key = families.join(",");
  useEffect(() => {
    const finish = () => {
      if (!done.current) {
        done.current = true;
        continueRender(handle);
      }
    };
    const list = Array.from(new Set(families.filter(Boolean)));
    if (list.length === 0 || typeof document === "undefined") return finish();
    const q = list
      .map((f) => `family=${f.replace(/ /g, "+")}:ital,wght@0,400;0,700;1,400;1,700`)
      .join("&");
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = `https://fonts.googleapis.com/css2?${q}&display=swap`;
    document.head.appendChild(link);
    const waits = list.flatMap((f) => [
      document.fonts.load(`400 16px '${f}'`),
      document.fonts.load(`italic 400 16px '${f}'`),
    ]);
    Promise.all(waits).then(() => document.fonts.ready).then(finish).catch(finish);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}

export type CompositorProps = {
  doc: ResolvedCompositorDoc;
};

const LayerView: React.FC<{ layer: ResolvedLayer }> = ({ layer }) => {
  const entrance = useEntrance(layer);

  if (layer.type === "audio") {
    return (
      <Audio
        src={layer.src}
        startFrom={layer.trimStart}
        endAt={layer.trimEnd ?? undefined}
        volume={layer.volume}
      />
    );
  }

  const box: React.CSSProperties = {
    position: "absolute",
    left: layer.x,
    top: layer.y,
    width: layer.width,
    height: layer.height,
    opacity: layer.opacity * entrance.opacity,
    transform: `${entrance.transform} rotate(${layer.rotation}deg)`,
    transformOrigin: "center center",
    overflow: "hidden",
    borderRadius: layer.radius || undefined,
    border: layer.borderWidth ? `${layer.borderWidth}px solid ${layer.borderColor}` : undefined,
    boxSizing: "border-box",
  };

  if (layer.type === "video") {
    return (
      <div style={box}>
        <OffthreadVideo
          src={layer.src}
          startFrom={layer.trimStart}
          endAt={layer.trimEnd ?? undefined}
          volume={layer.volume}
          style={{ width: "100%", height: "100%", objectFit: layer.objectFit }}
        />
      </div>
    );
  }

  if (layer.type === "image") {
    return (
      <div style={box}>
        <Img
          src={layer.src}
          style={{ width: "100%", height: "100%", objectFit: layer.objectFit }}
        />
      </div>
    );
  }

  // text
  return (
    <div
      style={{
        ...box,
        display: "flex",
        alignItems: "center",
        justifyContent:
          layer.align === "left" ? "flex-start" : layer.align === "right" ? "flex-end" : "center",
        backgroundColor: layer.backgroundColor ?? "transparent",
      }}
    >
      <span
        style={{
          width: "100%",
          fontFamily: `'${layer.fontFamily}', sans-serif`,
          fontSize: layer.fontSize,
          fontWeight: layer.fontWeight,
          fontStyle: layer.italic ? "italic" : "normal",
          color: layer.color,
          textAlign: layer.align,
          lineHeight: 1.15,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {layer.text}
      </span>
    </div>
  );
};

export const CompositorComposition: React.FC<CompositorProps> = ({ doc }) => {
  useCompositionFonts(
    doc.layers.filter((l): l is Extract<ResolvedLayer, { type: "text" }> => l.type === "text").map((l) => l.fontFamily)
  );
  const layers = [...doc.layers].sort((a, b) => a.z - b.z);
  return (
    <AbsoluteFill style={{ backgroundColor: doc.output.background ?? "#000000" }}>
      {layers.map((layer) => (
        <Sequence
          key={layer.id}
          from={layer.from}
          durationInFrames={Math.max(1, layer.durationInFrames)}
          layout="none"
        >
          <LayerView layer={layer} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};
