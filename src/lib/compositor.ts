import { z } from "zod";

// ---------- Layer schema (discriminated union on `type`) ----------

export const ANIM_PRESETS = ["none", "fade", "rise", "scale", "hero"] as const;

export const animSchema = z.object({
  preset: z.enum(ANIM_PRESETS).default("none"),
  delay: z.number().default(0), // frames before this layer animates in
  duration: z.number().default(18), // frames the entrance takes
});
export type Anim = z.infer<typeof animSchema>;

const baseLayer = {
  id: z.string(),
  x: z.number().default(0),
  y: z.number().default(0),
  width: z.number().default(200),
  height: z.number().default(200),
  rotation: z.number().default(0),
  opacity: z.number().min(0).max(1).default(1),
  z: z.number().default(0),
  from: z.number().default(0),
  durationInFrames: z.number().default(150),
  radius: z.number().default(0),
  borderWidth: z.number().default(0),
  borderColor: z.string().default("#ffffff"),
  anim: animSchema.optional(),
};

export const videoLayerSchema = z.object({
  ...baseLayer,
  type: z.literal("video"),
  assetHash: z.string(),
  trimStart: z.number().default(0),
  trimEnd: z.number().nullable().default(null),
  volume: z.number().min(0).max(1).default(1),
  objectFit: z.enum(["cover", "contain"]).default("cover"),
});

export const imageLayerSchema = z.object({
  ...baseLayer,
  type: z.literal("image"),
  assetHash: z.string(),
  objectFit: z.enum(["cover", "contain"]).default("cover"),
});

export const audioLayerSchema = z.object({
  ...baseLayer,
  type: z.literal("audio"),
  assetHash: z.string(),
  trimStart: z.number().default(0),
  trimEnd: z.number().nullable().default(null),
  volume: z.number().min(0).max(1).default(1),
});

export const textLayerSchema = z.object({
  ...baseLayer,
  type: z.literal("text"),
  text: z.string().default("Text"),
  fontFamily: z.string().default("Montserrat"),
  fontSize: z.number().default(64),
  color: z.string().default("#ffffff"),
  fontWeight: z.number().default(800),
  italic: z.boolean().default(false),
  align: z.enum(["left", "center", "right"]).default("center"),
  backgroundColor: z.string().nullable().default(null),
});

export const layerSchema = z.discriminatedUnion("type", [
  videoLayerSchema,
  imageLayerSchema,
  audioLayerSchema,
  textLayerSchema,
]);

export const compositorOutputSchema = z.object({
  width: z.number().default(1080),
  height: z.number().default(1920),
  fps: z.number().default(30),
  durationInFrames: z.number().default(300),
  background: z.string().default("#000000"),
});

export const compositorDocSchema = z.object({
  output: compositorOutputSchema.default({}),
  layers: z.array(layerSchema).default([]),
});

export type VideoLayer = z.infer<typeof videoLayerSchema>;
export type ImageLayer = z.infer<typeof imageLayerSchema>;
export type AudioLayer = z.infer<typeof audioLayerSchema>;
export type TextLayer = z.infer<typeof textLayerSchema>;
export type Layer = z.infer<typeof layerSchema>;
export type CompositorOutput = z.infer<typeof compositorOutputSchema>;
export type CompositorDoc = z.infer<typeof compositorDocSchema>;

export const emptyCompositorDoc = (): CompositorDoc => compositorDocSchema.parse({});

// Output-size presets (label + dimensions). fps stays configurable separately.
export const OUTPUT_PRESETS: { id: string; label: string; width: number; height: number }[] = [
  { id: "9x16", label: "Vertical · 9:16", width: 1080, height: 1920 },
  { id: "16x9", label: "Landscape · 16:9", width: 1920, height: 1080 },
  { id: "1x1", label: "Square · 1:1", width: 1080, height: 1080 },
  { id: "4x5", label: "Portrait · 4:5", width: 1080, height: 1350 },
];

// ---------- Resolved doc (media layers carry a concrete `src`) ----------
// The Remotion composition consumes ResolvedLayer/ResolvedCompositorDoc so it
// never has to know how a hash maps to a URL. Browsers get an HTTP url here;
// the server render swaps in a file:// path (see src/lib/render.ts).

export type ResolvedLayer =
  | (VideoLayer & { src: string })
  | (ImageLayer & { src: string })
  | (AudioLayer & { src: string })
  | TextLayer;

export interface ResolvedCompositorDoc {
  output: CompositorOutput;
  layers: ResolvedLayer[];
}

export function assetUrl(hash: string): string {
  return `/api/assets/${hash}`;
}

// Resolve for the browser Player: media hashes -> /api/assets/<hash> URLs.
export function resolveDocForBrowser(doc: CompositorDoc): ResolvedCompositorDoc {
  return {
    output: doc.output,
    layers: doc.layers.map((l) =>
      l.type === "text" ? l : { ...l, src: assetUrl(l.assetHash) }
    ),
  };
}
