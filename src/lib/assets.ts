import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ASSETS_DIR } from "./db";
import { insertAsset, type AssetMeta } from "./repo";

const EXT_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "image/gif": "gif",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/mp4": "m4a",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
};

export function storeAsset(
  buffer: Buffer,
  mime: string,
  originalName: string,
  kind: string
): Omit<AssetMeta, "createdAt"> {
  const ext = EXT_BY_MIME[mime] ?? (path.extname(originalName).slice(1) || "bin");
  const hash = crypto.createHash("sha256").update(buffer).digest("hex").slice(0, 24);
  const filePath = path.join(ASSETS_DIR, `${hash}.${ext}`);
  if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, buffer);
  const meta = { hash, ext, mime, bytes: buffer.length, originalName, kind };
  insertAsset(meta);
  return meta;
}

export function assetPath(hash: string, ext: string): string {
  return path.join(ASSETS_DIR, `${hash}.${ext}`);
}
