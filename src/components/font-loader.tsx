"use client";

import { useMemo } from "react";

/** Loads Google fonts by family name so previews render in the real brand fonts. */
export function FontLoader({ families }: { families: string[] }) {
  const href = useMemo(() => {
    const parts = [...new Set(families.filter(Boolean))]
      .map((f) => `family=${f.replace(/ /g, "+")}:wght@400;700;800`)
      .join("&");
    return parts ? `https://fonts.googleapis.com/css2?${parts}&display=swap` : null;
  }, [families]);
  if (!href) return null;
  // eslint-disable-next-line @next/next/no-page-custom-font
  return <link rel="stylesheet" href={href} />;
}
