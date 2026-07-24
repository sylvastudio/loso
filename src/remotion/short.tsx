import React from "react";
import {
  AbsoluteFill,
  Audio,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import type { CaptionGroup } from "@/lib/captions";

export interface CaptionTheme {
  fontFamily: string;
  textColor: string;
  highlightColor: string;
  fontSize: number;
  verticalPct: number;
}

export interface ShortProps {
  audioUrl: string | null;
  backgroundColor: string;
  captionStyle: "clean" | "dynamic";
  captionTheme: CaptionTheme;
  groups: CaptionGroup[];
  leadInSec: number;
}

export const SHORT_FPS = 30;

const CleanWord: React.FC<{
  word: string;
  active: boolean;
  past: boolean;
  theme: CaptionTheme;
}> = ({ word, active, past, theme }) => (
  <span
    style={{
      color: active ? theme.highlightColor : theme.textColor,
      opacity: past || active ? 1 : 0.85,
      transform: active ? "scale(1.04)" : "scale(1)",
      display: "inline-block",
      transition: "none",
    }}
  >
    {word}
  </span>
);

const DynamicWord: React.FC<{
  word: string;
  startFrame: number;
  active: boolean;
  theme: CaptionTheme;
}> = ({ word, startFrame, active, theme }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({
    frame: frame - startFrame,
    fps,
    config: { damping: 12, stiffness: 200, mass: 0.5 },
    durationInFrames: 12,
  });
  return (
    <span
      style={{
        color: active ? theme.highlightColor : theme.textColor,
        display: "inline-block",
        transform: `scale(${0.6 + 0.4 * pop}) translateY(${active ? -6 : 0}px)`,
        opacity: pop,
      }}
    >
      {word}
    </span>
  );
};

export const ShortComposition: React.FC<ShortProps> = ({
  audioUrl,
  backgroundColor,
  captionStyle,
  captionTheme,
  groups,
  leadInSec,
}) => {
  const frame = useCurrentFrame();
  const { fps, height } = useVideoConfig();
  const t = frame / fps - leadInSec;

  const group = groups.find((g) => t >= g.start && t <= g.end + 0.12);

  return (
    <AbsoluteFill style={{ backgroundColor }}>
      {audioUrl && <Audio src={audioUrl} />}

      {group && (
        <div
          style={{
            position: "absolute",
            left: 40,
            right: 40,
            top: height * (captionTheme.verticalPct / 100),
            transform: "translateY(-50%)",
            textAlign: "center",
            fontFamily: `'${captionTheme.fontFamily}', sans-serif`,
            fontWeight: 800,
            fontSize: captionTheme.fontSize,
            lineHeight: 1.18,
            textShadow: "0 3px 18px rgba(0,0,0,0.75), 0 1px 3px rgba(0,0,0,0.9)",
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "center",
            columnGap: "0.32em",
            rowGap: "0.1em",
            opacity:
              captionStyle === "clean"
                ? interpolate(t - group.start, [0, 0.12], [0, 1], {
                    extrapolateLeft: "clamp",
                    extrapolateRight: "clamp",
                  })
                : 1,
          }}
        >
          {group.words.map((w, i) => {
            const active = t >= w.start && t < w.end + 0.05;
            const past = t >= w.end;
            return captionStyle === "dynamic" ? (
              <DynamicWord
                key={i}
                word={w.word}
                startFrame={Math.round((w.start + leadInSec) * fps)}
                active={active}
                theme={captionTheme}
              />
            ) : (
              <CleanWord key={i} word={w.word} active={active} past={past} theme={captionTheme} />
            );
          })}
        </div>
      )}
    </AbsoluteFill>
  );
};
