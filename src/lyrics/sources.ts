/**
 * Multi-Source Lyric Providers & Query Sanitization
 * Ported from yt-music-better / BitChord.
 */

import { LyricLine, createLyricLine, createLyricWord, withBackgroundVocals, withInstrumentalGaps } from './models.js';
import { parseAnyLrc } from './parsers/lrc-parser.js';
import { parseTtmlLyrics } from './parsers/ttml-parser.js';

export interface LyricResult {
  source: string;
  label: string;
  isrc?: string | null;
  isWordSynced: boolean;
  lines: LyricLine[];
  rawTtml?: string;
}

// ─── Query Sanitization ──────────────────────────────────────────────────────────────

const CREDITS_REGEXES = [
  /\s*\((?:feat\.?|ft\.?|featuring|with)\s+[^)]+\)/gi,
  /\s*\[(?:feat\.?|ft\.?|featuring|with)\s+[^\]]+\]/gi,
];

const PACKAGING_REGEXES = [
  /\s*[([]\s*(?:official\s+(?:music\s+)?(?:video|audio)|music\s+video|lyric(?:s)?(?:\s+video)?|visualizer|audio\s+track|full\s+song|album\s+version|hd|4k|hq|exclusive|stream|clip\s+officiel)[^)\]]*[)\]]/gi,
  /\s*\|\s*(?:official\s+(?:music\s+)?video|visualizer|lyric\s+video|audio).*$/gi,
  /\s*-\s*(?:official\s+(?:music\s+)?video|visualizer|lyric\s+video|audio).*$/gi,
];

export function cleanSearchTitle(rawTitle: string): string {
  if (!rawTitle) return '';
  let name = rawTitle.replace(/[♪♫★☆【】《》「」~_]/g, ' ');
  for (const re of CREDITS_REGEXES) name = name.replace(re, ' ');
  for (const re of PACKAGING_REGEXES) name = name.replace(re, ' ');
  name = name.replace(/\s+/g, ' ').trim().replace(/[,–—-]+$/g, '').trim();
  return name.length > 0 ? name : rawTitle.trim();
}

export function cleanSearchArtist(rawArtist: string): string {
  if (!rawArtist) return '';
  let a = rawArtist.replace(/\s*-\s*Topic\s*$/i, '').trim();
  a = a.split('•')[0].split('·')[0].trim();
  return a.length > 0 ? a : rawArtist.trim();
}

// Helper fetch with timeout
async function safeFetch(url: string, options: RequestInit = {}, timeoutMs = 8000): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ─── 1. lrc.red ──────────────────────────────────────────────────────────────────────

const LRC_RED = 'https://lrc.red/';
const ISRC_REGEX = /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/i;

export async function fetchLrcRed(
  title: string,
  artist: string,
  durationMs?: number | null,
  isrc?: string | null
): Promise<LyricResult | null> {
  try {
    // 1. Direct ISRC hit
    if (isrc && ISRC_REGEX.test(isrc.trim().toUpperCase())) {
      const isrcUrl = `${LRC_RED}s/${isrc.trim().toUpperCase()}.ttml`;
      const res = await safeFetch(isrcUrl);
      if (res && res.ok) {
        const text = await res.text();
        const lines = parseTtmlLyrics(text);
        if (lines.length > 0) {
          return {
            source: 'lrc.red',
            label: 'lrc.red (Apple Music)',
            isrc,
            isWordSynced: lines.some((l) => l.words.length > 0),
            lines,
            rawTtml: text,
          };
        }
      }
    }

    // 2. Search
    const searchUrl = `${LRC_RED}search.json?q=${encodeURIComponent(`${title} ${artist}`.trim())}`;
    const sRes = await safeFetch(searchUrl);
    if (!sRes || !sRes.ok) return null;

    const data = (await sRes.json()) as any;
    const hits = data?.hits;
    if (!Array.isArray(hits) || hits.length === 0) return null;

    const hit = hits[0];
    if (!hit?.isrc) return null;

    const ttmlRes = await safeFetch(`${LRC_RED}s/${hit.isrc}.ttml`);
    if (!ttmlRes || !ttmlRes.ok) return null;

    const ttml = await ttmlRes.text();
    const lines = parseTtmlLyrics(ttml);
    if (lines.length === 0) return null;

    return {
      source: 'lrc.red',
      label: 'lrc.red (Apple Music)',
      isrc: hit.isrc,
      isWordSynced: lines.some((l) => l.words.length > 0),
      lines,
      rawTtml: ttml,
    };
  } catch {
    return null;
  }
}

// ─── 2. BiniLyrics ───────────────────────────────────────────────────────────────────

export async function fetchBiniLyrics(
  title: string,
  artist: string,
  durationMs?: number | null,
  isrc?: string | null
): Promise<LyricResult | null> {
  try {
    const url = new URL('https://lyrics-api.binimum.org/');
    if (isrc) {
      url.searchParams.set('isrc', isrc);
    } else {
      url.searchParams.set('track', title);
      url.searchParams.set('artist', artist);
      if (durationMs && durationMs > 0) {
        url.searchParams.set('duration', Math.round(durationMs / 1000).toString());
      }
    }

    const res = await safeFetch(url.toString());
    if (!res || !res.ok) return null;

    const data = (await res.json()) as any;
    const hit = data?.results?.[0];
    if (!hit?.lyricsUrl) return null;

    const ttmlRes = await safeFetch(hit.lyricsUrl);
    if (!ttmlRes || !ttmlRes.ok) return null;

    const ttmlText = await ttmlRes.text();
    const lines = parseTtmlLyrics(ttmlText);
    if (lines.length === 0) return null;

    return {
      source: 'BiniLyrics',
      label: 'BiniLyrics (Apple Music)',
      isrc: hit.isrc || null,
      isWordSynced: lines.some((l) => l.words.length > 0),
      lines,
      rawTtml: ttmlText,
    };
  } catch {
    return null;
  }
}

// ─── 3. BetterLyrics ─────────────────────────────────────────────────────────────────

export async function fetchBetterLyrics(
  title: string,
  artist: string,
  durationMs?: number | null
): Promise<LyricResult | null> {
  try {
    const url = new URL('https://lyrics-api.boidu.dev/getLyrics');
    url.searchParams.set('s', title);
    url.searchParams.set('a', artist);
    if (durationMs && durationMs > 0) {
      url.searchParams.set('d', Math.round(durationMs / 1000).toString());
    }

    const res = await safeFetch(url.toString());
    if (!res || !res.ok) return null;

    const text = await res.text();
    if (!text) return null;

    let content = text.trim();
    try {
      const parsed = JSON.parse(content);
      content = parsed.ttml || parsed.lyrics || parsed.content || parsed.text || content;
    } catch {}

    let lines: LyricLine[] = [];
    if (content.includes('<tt') || content.includes('http://www.w3.org/ns/ttml')) {
      lines = parseTtmlLyrics(content);
    } else {
      lines = parseAnyLrc(content);
    }

    if (lines.length === 0) return null;

    return {
      source: 'BetterLyrics',
      label: 'BetterLyrics (Apple Music)',
      isWordSynced: lines.some((l) => l.words.length > 0),
      lines,
      rawTtml: content.includes('<tt') ? content : undefined,
    };
  } catch {
    return null;
  }
}

// ─── 4. SimpMusic (YouTube Video ID Keyed) ──────────────────────────────────────────

export async function fetchSimpMusicLyrics(
  videoId: string
): Promise<LyricResult | null> {
  if (!videoId) return null;
  try {
    const res = await safeFetch(`https://api-lyrics.simpmusic.org/v1/${encodeURIComponent(videoId)}`);
    if (!res || !res.ok) return null;

    const data = (await res.json()) as any;
    const lyricsArray = Array.isArray(data) ? data : data?.lyrics || data?.result;
    if (!Array.isArray(lyricsArray) || lyricsArray.length === 0) return null;

    const rawLines: LyricLine[] = [];
    for (const item of lyricsArray) {
      const timeMs = item.startTimeMs || item.start || item.time;
      if (timeMs == null) continue;

      const text = (item.text || item.words || item.line || '').trim();
      if (!text) continue;

      let words: any[] = [];
      if (Array.isArray(item.syllables) && item.syllables.length > 0) {
        words = item.syllables.map((s: any) =>
          createLyricWord(s.startTimeMs || s.start, s.endTimeMs || s.end, s.text)
        );
      }

      rawLines.push(
        createLyricLine({
          timeMs: Math.round(timeMs),
          text,
          words,
          sungUntilMs: item.endTimeMs || item.end || null,
        })
      );
    }

    if (rawLines.length === 0) return null;
    rawLines.sort((a, b) => a.timeMs - b.timeMs);

    const lines = withInstrumentalGaps(withBackgroundVocals(rawLines));
    return {
      source: 'SimpMusic',
      label: 'SimpMusic (YouTube Sync)',
      isWordSynced: lines.some((l) => l.words.length > 0),
      lines,
    };
  } catch {
    return null;
  }
}

// ─── 5. LRCLIB ───────────────────────────────────────────────────────────────────────

export async function fetchLrcLib(
  title: string,
  artist: string,
  durationMs?: number | null
): Promise<LyricResult | null> {
  const sec = durationMs && durationMs > 0 ? Math.round(durationMs / 1000) : 0;

  // 1. Exact match
  try {
    const url = new URL('https://lrclib.net/api/get');
    url.searchParams.set('track_name', title);
    url.searchParams.set('artist_name', artist);
    if (sec > 0) url.searchParams.set('duration', sec.toString());

    const res = await safeFetch(url.toString(), {
      headers: { 'Lrclib-Client': 'BitChordConnectVSCode/1.0' },
    });

    if (res && res.ok) {
      const data = (await res.json()) as any;
      if (data?.syncedLyrics) {
        const lines = parseAnyLrc(data.syncedLyrics);
        if (lines.length > 0) {
          return {
            source: 'LRCLIB',
            label: 'LRCLIB (Synced)',
            isWordSynced: false,
            lines,
          };
        }
      }
    }
  } catch {}

  // 2. Fuzzy search fallback
  try {
    const sUrl = new URL('https://lrclib.net/api/search');
    sUrl.searchParams.set('track_name', title);
    sUrl.searchParams.set('artist_name', artist);

    const sRes = await safeFetch(sUrl.toString(), {
      headers: { 'Lrclib-Client': 'BitChordConnectVSCode/1.0' },
    });

    if (sRes && sRes.ok) {
      const hits = (await sRes.json()) as any[];
      if (Array.isArray(hits)) {
        const withSync = hits.filter((h) => h.syncedLyrics);
        if (withSync.length > 0) {
          if (sec > 0) {
            withSync.sort((a, b) => Math.abs((a.duration || 0) - sec) - Math.abs((b.duration || 0) - sec));
          }
          const lines = parseAnyLrc(withSync[0].syncedLyrics);
          if (lines.length > 0) {
            return {
              source: 'LRCLIB',
              label: 'LRCLIB (Synced)',
              isWordSynced: false,
              lines,
            };
          }
        }
      }
    }
  } catch {}

  return null;
}
