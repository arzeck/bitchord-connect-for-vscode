/**
 * Synced Lyrics Models & Timing Mathematics
 * Ported from yt-music-better / BitChord.
 */

export interface LyricWord {
  startMs: number;
  endMs: number;
  text: string;
}

export interface LyricLine {
  timeMs: number;
  text: string;
  words: LyricWord[];
  sungUntilMs?: number | null;
  background?: LyricLine | null;
  alignment: 'Start' | 'End';
  roman?: string;
  translation?: string;
  isGap?: boolean;
}

const MIN_GAP_MS = 4000;
const RISE_MS = 200;

export function smoothHermite(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
}

export function createLyricWord(startMs: number, endMs: number, text: string): LyricWord {
  return {
    startMs: Math.round(startMs),
    endMs: Math.round(endMs),
    text,
  };
}

export function createLyricLine(options: {
  timeMs?: number;
  text?: string;
  words?: LyricWord[];
  sungUntilMs?: number | null;
  background?: LyricLine | null;
  alignment?: 'Start' | 'End';
  roman?: string;
  translation?: string;
}): LyricLine {
  const text = (options.text || '').trim();
  return {
    timeMs: Math.round(options.timeMs || 0),
    text,
    words: options.words || [],
    sungUntilMs: options.sungUntilMs != null ? Math.round(options.sungUntilMs) : null,
    background: options.background || null,
    alignment: options.alignment || 'Start',
    roman: options.roman || '',
    translation: options.translation || '',
    isGap: text.length === 0,
  };
}

/**
 * Calculates how far (0..1) the word has lifted off the floor at [positionMs].
 */
export function wordLift(word: LyricWord, positionMs: number): number {
  const rising = Math.max(0, Math.min(1, (positionMs - word.startMs) / RISE_MS));
  const falling = Math.max(0, Math.min(1, 1 - (positionMs - word.endMs) / RISE_MS));
  return smoothHermite(Math.min(rising, falling));
}

/**
 * Fractional character index into [text] revealed by the karaoke sweep at [positionMs].
 */
export function revealedChars(line: LyricLine, positionMs: number): number {
  if (line.words.length === 0) {
    return positionMs >= line.timeMs ? line.text.length : 0;
  }

  const first = line.words[0];
  const last = line.words[line.words.length - 1];

  if (positionMs <= first.startMs) return 0;
  if (positionMs >= last.endMs) return line.text.length;

  let revealed = 0;
  for (let i = 0; i < line.words.length; i++) {
    const word = line.words[i];
    const len = word.text.length + (i < line.words.length - 1 ? 1 : 0);

    if (positionMs >= word.endMs) {
      revealed += len;
    } else if (positionMs >= word.startMs) {
      const dur = Math.max(1, word.endMs - word.startMs);
      const frac = Math.max(0, Math.min(1, (positionMs - word.startMs) / dur));
      revealed += frac * len;
      break;
    } else {
      break;
    }
  }

  return Math.min(line.text.length, revealed);
}

/**
 * Extracts bracketed background vocal answering phrases e.g. "(yeah yeah)"
 */
export function withBackgroundVocals(lines: LyricLine[]): LyricLine[] {
  const BG_PAREN_RE = /\s*[(（]([^)）]+)[)）]\s*$/;
  return lines.map((line) => {
    if (line.words.length > 0 || line.background || !line.text) {
      return line;
    }
    const match = line.text.match(BG_PAREN_RE);
    if (match && match.index != null && match.index > 0) {
      const mainText = line.text.slice(0, match.index).trim();
      const bgText = match[1].trim();
      if (mainText && bgText) {
        return {
          ...line,
          text: mainText,
          background: createLyricLine({
            timeMs: line.timeMs,
            text: bgText,
            alignment: line.alignment === 'Start' ? 'End' : 'Start',
          }),
        };
      }
    }
    return line;
  });
}

/**
 * Inserts breathing dot gap lines for instrumental sections >= 4000ms.
 */
export function withInstrumentalGaps(lines: LyricLine[]): LyricLine[] {
  if (lines.length === 0) return [];
  const result: LyricLine[] = [];

  for (let i = 0; i < lines.length; i++) {
    const cur = lines[i];
    const prev = i > 0 ? lines[i - 1] : null;

    if (prev) {
      const prevEnd = prev.words.length > 0
        ? prev.words[prev.words.length - 1].endMs
        : (prev.sungUntilMs ?? prev.timeMs);
      const gap = cur.timeMs - prevEnd;

      if (gap >= MIN_GAP_MS) {
        result.push(
          createLyricLine({
            timeMs: prevEnd + 500,
            text: '', // gap line
            sungUntilMs: cur.timeMs - 500,
            alignment: 'Start',
          })
        );
      }
    }

    result.push(cur);
  }

  return result;
}

/**
 * Alternates duet voice lines between Start (left) and End (right).
 */
export function computeLineAlignments(lines: LyricLine[]): LyricLine[] {
  let isLeft = true;
  return lines.map((line) => {
    const align = isLeft ? 'Start' : 'End';
    isLeft = !isLeft;
    return { ...line, alignment: align };
  });
}
