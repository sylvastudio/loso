import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "better-sqlite3",
    "@remotion/renderer",
    "@remotion/bundler",
    "esbuild",
  ],
};

export default nextConfig;
