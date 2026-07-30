import { z } from "zod";

export const FONT_CHOICES = [
  "Montserrat",
  "Inter",
  "Playfair Display",
  "Archivo Black",
  "Bebas Neue",
  "Poppins",
  "Bricolage Grotesque",
  "DM Serif Display",
  "Anton",
  "Sora",
] as const;

export const presenterSchema = z.object({
  id: z.string(),
  name: z.string().default(""),
  imageHash: z.string().nullable().default(null),
  voiceId: z.string().nullable().default(null),
});

export const brandSchema = z.object({
  brandName: z.string().default(""),
  tagline: z.string().default(""),
  ctaText: z.string().default(""),
  ctaBadge: z.string().default(""),
  disclaimer: z.string().default(""),
  logoHash: z.string().nullable().default(null),
  colors: z
    .object({
      backgroundColor: z.string().default("#101014"),
      primaryColor: z.string().default("#FFFFFF"),
      accentColor: z.string().default("#FFB224"),
      captionHighlightColor: z.string().default("#FFD60A"),
    })
    .default({}),
  fonts: z
    .object({
      caption: z.string().default("Montserrat"),
      display: z.string().default("Archivo Black"),
    })
    .default({}),
  toneWords: z.string().default("bright, modern, editorial"),
  presenters: z.array(presenterSchema).default([]),
  intro: z.object({ enabled: z.boolean().default(false) }).default({}),
  outro: z.object({ enabled: z.boolean().default(true) }).default({}),
  music: z
    .object({
      assetHash: z.string().nullable().default(null),
      volume: z.number().min(0).max(1).default(0.08),
    })
    .default({}),
});

export type Brand = z.infer<typeof brandSchema>;
export type Presenter = z.infer<typeof presenterSchema>;

export const defaultBrand: Brand = brandSchema.parse({});
