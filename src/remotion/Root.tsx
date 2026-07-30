import React from "react";
import { z } from "zod";
import { Composition } from "remotion";
import { CompositorComposition } from "./compositor";
import {
  emptyCompositorDoc,
  resolveDocForBrowser,
  type ResolvedCompositorDoc,
} from "../lib/compositor";

// The composition input is a fully-resolved doc (media layers carry `src`).
// z.custom keeps `doc` required and typed without re-declaring the union.
const inputSchema = z.object({ doc: z.custom<ResolvedCompositorDoc>() });

// The bundle registers a single dynamic composition. Real dimensions, fps and
// duration come from inputProps.doc.output via calculateMetadata, so every
// project renders at its own size without re-registering compositions.
export const RemotionRoot: React.FC = () => {
  const fallback = resolveDocForBrowser(emptyCompositorDoc());
  return (
    <Composition
      id="compositor"
      component={CompositorComposition}
      schema={inputSchema}
      width={1080}
      height={1920}
      fps={30}
      durationInFrames={300}
      defaultProps={{ doc: fallback }}
      calculateMetadata={({ props }) => ({
        width: props.doc.output.width,
        height: props.doc.output.height,
        fps: props.doc.output.fps,
        durationInFrames: Math.max(1, props.doc.output.durationInFrames),
      })}
    />
  );
};
