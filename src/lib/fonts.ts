// The fonts Loso offers for words on screen, and the one place that turns
// family names into a Google Fonts URL (shared by the editor preview and the
// Remotion composition, so the export matches what you see).

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

/** Google font family names are letters, digits and spaces. Anything else is dropped. */
const FAMILY_RE = /^[A-Za-z0-9][A-Za-z0-9 ]{0,62}$/;

/**
 * css2 URL for the given families, or null when none are usable. Each family is
 * validated and URL-encoded, so a name from a shared .loso file can't add its
 * own query parameters.
 */
export function googleFontsUrl(families: Iterable<string>, axes: string): string | null {
  const names = [...new Set([...families].map((f) => (f ?? "").trim()).filter((f) => FAMILY_RE.test(f)))];
  if (!names.length) return null;
  const q = names.map((f) => `family=${encodeURIComponent(f).replace(/%20/g, "+")}:${axes}`).join("&");
  return `https://fonts.googleapis.com/css2?${q}&display=swap`;
}
