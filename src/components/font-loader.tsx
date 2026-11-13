"use client";

import { useMemo } from "react";
import { googleFontsUrl } from "@/lib/fonts";

/** Loads Google fonts by family name so previews render in the real brand fonts. */
export function FontLoader({ families }: { families: string[] }) {
  const href = useMemo(() => googleFontsUrl(families, "wght@400;700;800"), [families]);
  if (!href) return null;
  // eslint-disable-next-line @next/next/no-page-custom-font
  return <link rel="stylesheet" href={href} />;
}
