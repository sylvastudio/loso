import { ImageResponse } from "next/og";
import { ShareCard, fonts } from "./_og/card";

export const dynamic = "force-static";
export const alt = "Loso: say what you want, Loso makes the video.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  return new ImageResponse(<ShareCard />, { ...size, fonts: await fonts() });
}
