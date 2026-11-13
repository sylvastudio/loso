import type { Metadata, Viewport } from "next";
import { Fraunces, Schibsted_Grotesk, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { AppShell } from "@/components/app-shell";
import { THEME_BOOT_SCRIPT } from "@/lib/theme-boot";

const fraunces = Fraunces({
  subsets: ["latin"],
  style: ["normal", "italic"],
  axes: ["opsz", "SOFT"],
  variable: "--font-fraunces",
});

const grotesk = Schibsted_Grotesk({
  subsets: ["latin"],
  variable: "--font-grotesk",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-plex-mono",
});

const DESCRIPTION = "Say what you want and Loso makes the video, right in the folder on your computer.";

export const metadata: Metadata = {
  metadataBase: new URL("https://loso.sylvastudio.com"),
  title: "Loso: tell it the video you want",
  description: DESCRIPTION,
  applicationName: "Loso",
  openGraph: {
    type: "website",
    siteName: "Loso",
    url: "/",
    title: "Loso: tell it the video you want",
    description: DESCRIPTION,
  },
  twitter: { card: "summary_large_image", title: "Loso: tell it the video you want", description: DESCRIPTION },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Android: shrink the page when the keyboard opens so the chat box stays
  // in view. (No viewport-fit=cover: the app header doesn't pad for the
  // notch, so the browser keeps the page inside the safe area.)
  interactiveWidget: "resizes-content",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0b0b0c" },
    { media: "(prefers-color-scheme: light)", color: "#f2eee3" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // data-theme is set by the boot script before React hydrates, so the
    // server always sends "system" and a saved choice is expected to differ.
    <html lang="en" data-theme="system" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body className={`${fraunces.variable} ${grotesk.variable} ${plexMono.variable}`}>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
