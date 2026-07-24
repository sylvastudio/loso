export interface Word {
  word: string;
  start: number;
  end: number;
}

export interface CaptionGroup {
  words: Word[];
  start: number;
  end: number;
}

const PAUSE_THRESHOLD = 0.35;
const MAX_WORDS = 4;

/**
 * Group word timestamps into caption chunks: break on pauses (~0.35s) and cap
 * group size (~4 words) so captions stay glanceable at 9:16 sizes.
 */
export function groupWords(
  words: Word[],
  opts: { pauseThreshold?: number; maxWords?: number } = {}
): CaptionGroup[] {
  const pause = opts.pauseThreshold ?? PAUSE_THRESHOLD;
  const max = opts.maxWords ?? MAX_WORDS;
  const groups: CaptionGroup[] = [];
  let current: Word[] = [];

  const flush = () => {
    if (current.length) {
      groups.push({
        words: current,
        start: current[0].start,
        end: current[current.length - 1].end,
      });
      current = [];
    }
  };

  for (const raw of words) {
    const w = { ...raw, word: raw.word.trim() };
    if (!w.word) continue;
    const prev = current[current.length - 1];
    if (current.length >= max || (prev && w.start - prev.end > pause)) flush();
    current.push(w);
  }
  flush();
  return groups;
}
