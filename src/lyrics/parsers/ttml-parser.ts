/**
 * Apple Music TTML parser for word-timed and syllable-timed lyrics.
 * Ported from yt-music-better / BitChord TtmlLyrics.kt.
 */

import {
  LyricLine,
  LyricWord,
  createLyricLine,
  createLyricWord,
  withInstrumentalGaps,
  computeLineAlignments,
} from '../models.js';

export function parseTtmlTime(val: string | null | undefined): number | null {
  if (!val) return null;
  const raw = String(val).trim();
  if (!raw) return null;

  if (raw.endsWith('ms')) {
    const num = parseFloat(raw.slice(0, -2));
    return isNaN(num) ? null : Math.round(num);
  }

  const clean = raw.replace(/s$/i, '');
  const parts = clean.split(':');

  let seconds: number | null = null;
  if (parts.length === 1) {
    seconds = parseFloat(parts[0]);
  } else if (parts.length === 2) {
    const m = parseFloat(parts[0]);
    const s = parseFloat(parts[1]);
    if (!isNaN(m) && !isNaN(s)) seconds = m * 60 + s;
  } else if (parts.length === 3) {
    const h = parseFloat(parts[0]);
    const m = parseFloat(parts[1]);
    const s = parseFloat(parts[2]);
    if (!isNaN(h) && !isNaN(m) && !isNaN(s)) seconds = h * 3600 + m * 60 + s;
  }

  return seconds != null && !isNaN(seconds) ? Math.round(seconds * 1000) : null;
}

function extractAttr(tagStr: string, attrName: string): string {
  // e.g. begin="00:01:23.400" or ttm:role="x-bg"
  const re = new RegExp(`(?:${attrName}|${attrName.replace(/^.*:/, '')})\\s*=\\s*["']([^"']*)["']`, 'i');
  const match = tagStr.match(re);
  return match ? match[1] : '';
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, '').trim();
}

/**
 * Parses Apple Music TTML string into an array of LyricLine objects.
 */
export function parseTtmlLyrics(ttmlText: string): LyricLine[] {
  if (!ttmlText || typeof ttmlText !== 'string') return [];

  const rawSung: { line: LyricLine; agent: string | null }[] = [];

  // Match all <p ...>...</p> elements
  const pRegex = /<p\b([^>]*)>([\s\S]*?)<\/p>/gi;
  let pMatch: RegExpExecArray | null;

  while ((pMatch = pRegex.exec(ttmlText)) !== null) {
    const pAttrs = pMatch[1];
    const pBody = pMatch[2];

    const pBegin = parseTtmlTime(extractAttr(pAttrs, 'begin'));
    const pEnd = parseTtmlTime(extractAttr(pAttrs, 'end'));
    const agent = extractAttr(pAttrs, 'ttm:agent') || extractAttr(pAttrs, 'agent') || null;

    const leadWords: LyricWord[] = [];
    const bgWords: LyricWord[] = [];
    let romanText = '';
    let transText = '';

    // Match spans inside pBody: <span ...>...</span>
    const spanRegex = /<span\b([^>]*)>([\s\S]*?)<\/span>/gi;
    let sMatch: RegExpExecArray | null;
    let hasSpans = false;

    while ((sMatch = spanRegex.exec(pBody)) !== null) {
      hasSpans = true;
      const sAttrs = sMatch[1];
      const sContent = stripTags(sMatch[2]);
      const role = extractAttr(sAttrs, 'ttm:role') || extractAttr(sAttrs, 'role');

      if (role === 'x-translation') {
        transText = (transText + ' ' + sContent).trim();
        continue;
      }
      if (role === 'x-roman') {
        romanText = (romanText + ' ' + sContent).trim();
        continue;
      }

      const isBg = role === 'x-bg';
      const sBegin = parseTtmlTime(extractAttr(sAttrs, 'begin')) ?? pBegin;
      const sEnd = parseTtmlTime(extractAttr(sAttrs, 'end')) ?? pEnd;

      if (sBegin != null && sEnd != null && sContent) {
        const word = createLyricWord(sBegin, sEnd, sContent);
        if (isBg) {
          bgWords.push(word);
        } else {
          leadWords.push(word);
        }
      }
    }

    let bgLine: LyricLine | null = null;
    if (bgWords.length > 0) {
      bgLine = createLyricLine({
        timeMs: bgWords[0].startMs,
        text: bgWords.map((w) => w.text).join(' '),
        words: bgWords,
      });
    }

    if (leadWords.length === 0) {
      // Line-level paragraph
      const text = stripTags(pBody);
      if (!text || pBegin == null) continue;

      rawSung.push({
        line: createLyricLine({
          timeMs: pBegin,
          text,
          sungUntilMs: pEnd && pEnd > pBegin ? pEnd : null,
          background: bgLine,
          roman: romanText,
          translation: transText,
        }),
        agent,
      });
    } else {
      // Word/syllable-timed paragraph
      const startTime = pBegin != null ? Math.min(pBegin, leadWords[0].startMs) : leadWords[0].startMs;
      const text = leadWords.map((w) => w.text).join(' ');

      rawSung.push({
        line: createLyricLine({
          timeMs: startTime,
          text,
          words: leadWords,
          sungUntilMs: pEnd,
          background: bgLine,
          roman: romanText,
          translation: transText,
        }),
        agent,
      });
    }
  }

  if (rawSung.length === 0) return [];

  // Sort by start timestamp
  rawSung.sort((a, b) => a.line.timeMs - b.line.timeMs);

  // Duet alignments
  const uniqueAgents = Array.from(new Set(rawSung.map((r) => r.agent).filter(Boolean)));
  const lines: LyricLine[] = rawSung.map((r) => {
    let alignment: 'Start' | 'End' = 'Start';
    if (uniqueAgents.length > 1 && r.agent) {
      alignment = r.agent === uniqueAgents[0] ? 'Start' : 'End';
    }
    return {
      ...r.line,
      alignment,
    };
  });

  return withInstrumentalGaps(lines);
}
