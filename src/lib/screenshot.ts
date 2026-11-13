// Screenshots are almost always "look at this problem", not "put this in my
// video". These guesses decide where a pasted or dropped picture goes first;
// the other place is always one click away.

const SHOT_NAME = /^(screen ?shot|screenshot|cleanshot|capture|snip|snipping|screen recording|bildschirmfoto|captura|capture d['’]écran|schermata)\b|^image\.png$|^pasted/i;

/** A picture whose name (or lack of one) says "screenshot". */
export function looksLikeScreenshot(file: File): boolean {
  if (!file.type.startsWith("image/")) return false;
  const name = (file.name ?? "").trim();
  // Clipboard pictures arrive nameless or as "image.png".
  if (!name) return true;
  return SHOT_NAME.test(name);
}

export function allScreenshots(files: File[]): boolean {
  return files.length > 0 && files.every(looksLikeScreenshot);
}

/**
 * During a drag the browser only shows types, not names. Screenshot tools
 * save PNG; camera photos are JPEG / HEIC. So "only PNG pictures" is the best
 * early guess, and the drop itself checks the real names.
 */
export function likelyScreenshotDrag(types: string[]): boolean {
  return types.length > 0 && types.every((t) => t === "image/png");
}

/** "0:04" from frames. */
export function clockAt(frame: number, fps: number): string {
  const s = Math.max(0, Math.floor(frame / fps));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
