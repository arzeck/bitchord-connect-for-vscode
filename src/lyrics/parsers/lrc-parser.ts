/**
 * Enhanced LRC, Karaoke LRC, and Standard LRC Parser.
 * Ported from yt-music-better / BitChord.
 */

import {
  LyricLine,
  LyricWord,
  createLyricLine,
  createLyricWord,
  withBackgroundVocals,
  withInstrumentalGaps,
} from '../models.js';

const LINE_RE = /^\[(\d{1,3}):(\d{2})[.:](\d{2,3})](.*)$/;
const WORD_RE = /<(\d{1,3}):(\d{2})[.:](\d{2,3})>([^<]*)/g;
const META_RE = /^\[(?:ti|ar|al|by|offset|length|re|ve):/i;

const KARAOKE_LINE = /^\[(\d{1,8}),(\d{1,8})](.*)$/;
const KARAOKE_WORD = /\((\d{1,8}),(\d{1,8})(?:,\d{1,8})?\)([^()]*)/g;

function stamp(min: string, sec: string, frac: string): number {
  const fracMs = frac.length === 3 ? parseInt(frac, 10) : parseInt(frac, 10) * 10;
  return parseInt(min, 10) * 60000 + parseInt(sec, 10) * 1000 + fracMs;
}

export function decodeEntities(s: string): string {
  if (!s) return '';
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

/**
 * Parses Enhanced LRC (Musixmatch rich sync, SimpMusic rich sync).
 */
export function parseEnhancedLrc(lrc: string): LyricLine[] {
  const rows: { timeMs: number; wordMatches: { startMs: number; rawText: string }[]; plain: string }[] = [];
  const lines = lrc.split('\n');

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || META_RE.test(line)) continue;

    const m = LINE_RE.exec(line);
    if (!m) continue;

    const lineMs = stamp(m[1], m[2], m[3]);
    const content = m[4];

    const wordMatches: { startMs: number; rawText: string }[] = [];
    let wm: RegExpExecArray | null;
    WORD_RE.lastIndex = 0;
    while ((wm = WORD_RE.exec(content)) !== null) {
      wordMatches.push({ startMs: stamp(wm[1], wm[2], wm[3]), rawText: wm[4] });
    }

    const plain = decodeEntities(content.replace(/<[^>]+>/g, '').trim());
    rows.push({ timeMs: lineMs, wordMatches, plain });
  }

  if (!rows.some((r) => r.wordMatches.length > 0)) return [];

  const parsedLines: LyricLine[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const nextLineMs = i + 1 < rows.length ? rows[i + 1].timeMs : null;

    if (row.wordMatches.length === 0) {
      parsedLines.push(createLyricLine({ timeMs: row.timeMs, text: row.plain, words: [] }));
      continue;
    }

    const words: LyricWord[] = row.wordMatches
      .map((w, j) => {
        const nextStart =
          j + 1 < row.wordMatches.length
            ? row.wordMatches[j + 1].startMs
            : (nextLineMs ?? (w.startMs + 2000));
        return createLyricWord(w.startMs, nextStart, decodeEntities(w.rawText.trim()));
      })
      .filter((w) => w.text !== '');

    parsedLines.push(
      createLyricLine({
        timeMs: row.timeMs,
        text: row.plain,
        words,
      })
    );
  }

  return withInstrumentalGaps(withBackgroundVocals(parsedLines));
}

/**
 * Parses Karaoke LRC (QQ Music / NetEase format: [startMs, durMs](startMs, durMs)text).
 */
export function parseKaraokeLrc(lrc: string): LyricLine[] {
  const parsedLines: LyricLine[] = [];
  const lines = lrc.split('\n');

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || META_RE.test(line)) continue;

    const m = KARAOKE_LINE.exec(line);
    if (!m) continue;

    const lineStart = parseInt(m[1], 10);
    const lineDur = parseInt(m[2], 10);
    const content = m[3];

    const words: LyricWord[] = [];
    let wm: RegExpExecArray | null;
    KARAOKE_WORD.lastIndex = 0;

    while ((wm = KARAOKE_WORD.exec(content)) !== null) {
      const wStart = parseInt(wm[1], 10);
      const wDur = parseInt(wm[2], 10);
      const wText = decodeEntities(wm[3].trim());
      if (wText) {
        words.push(createLyricWord(wStart, wStart + wDur, wText));
      }
    }

    const plain = decodeEntities(content.replace(/\(\d+,\d+(?:,\d+)?\)/g, '').trim());

    if (plain || words.length > 0) {
      parsedLines.push(
        createLyricLine({
          timeMs: lineStart,
          text: plain,
          words,
          sungUntilMs: lineStart + lineDur,
        })
      );
    }
  }

  return withInstrumentalGaps(withBackgroundVocals(parsedLines));
}

/**
 * Parses Standard line-synced LRC [mm:ss.xx]text.
 */
export function parseStandardLrc(lrc: string): LyricLine[] {
  const entries: { timeMs: number; text: string }[] = [];
  const lines = lrc.split('\n');

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || META_RE.test(line)) continue;

    const m = LINE_RE.exec(line);
    if (!m) continue;

    const timeMs = stamp(m[1], m[2], m[3]);
    const text = decodeEntities(m[4].trim());
    if (text) {
      entries.push({ timeMs, text });
    }
  }

  entries.sort((a, b) => a.timeMs - b.timeMs);

  const parsedLines: LyricLine[] = entries.map((entry, i) => {
    const nextTime = i + 1 < entries.length ? entries[i + 1].timeMs : null;
    return createLyricLine({
      timeMs: entry.timeMs,
      text: entry.text,
      sungUntilMs: nextTime,
    });
  });

  return withInstrumentalGaps(withBackgroundVocals(parsedLines));
}

/**
 * Auto-detects and parses any LRC variant.
 */
export function parseAnyLrc(lrc: string): LyricLine[] {
  if (!lrc || typeof lrc !== 'string') return [];

  if (lrc.includes('(') && KARAOKE_LINE.test(lrc)) {
    const res = parseKaraokeLrc(lrc);
    if (res.length > 0) return res;
  }

  if (lrc.includes('<') && lrc.includes('>')) {
    const res = parseEnhancedLrc(lrc);
    if (res.length > 0) return res;
  }

  return parseStandardLrc(lrc);
}
