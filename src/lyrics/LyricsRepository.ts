/**
 * Concurrent Lyrics Racing Repository
 * Ported from yt-music-better / BitChord.
 */

import {
  LyricResult,
  cleanSearchTitle,
  cleanSearchArtist,
  fetchLrcRed,
  fetchBiniLyrics,
  fetchBetterLyrics,
  fetchSimpMusicLyrics,
  fetchLrcLib,
} from './sources.js';

export interface LyricsProgressCallback {
  (bestResult: LyricResult | null, allResults: Map<string, LyricResult>): void;
}

export class LyricsRepository {
  private cache = new Map<string, { activeResult: LyricResult; allResults: Map<string, LyricResult> }>();
  private inFlightKey: string = '';

  public getTrackKey(title: string, artist: string, durationMs?: number | null, videoId?: string): string {
    return `${(title || '').trim().toLowerCase()}|${(artist || '').trim().toLowerCase()}|${Math.round((durationMs || 0) / 1000)}|${videoId || ''}`;
  }

  public clearCache(): void {
    this.cache.clear();
  }

  public async fetchLyrics(
    trackInfo: {
      title: string;
      artist: string;
      durationMs?: number | null;
      videoId?: string;
    },
    onProgress?: LyricsProgressCallback
  ): Promise<{ activeResult: LyricResult | null; allResults: Map<string, LyricResult> }> {
    const { title, artist, durationMs, videoId } = trackInfo;
    const key = this.getTrackKey(title, artist, durationMs, videoId);
    this.inFlightKey = key;

    // Check memory cache
    if (this.cache.has(key)) {
      const cached = this.cache.get(key)!;
      if (onProgress) {
        onProgress(cached.activeResult, cached.allResults);
      }
      return cached;
    }

    const cleanTitle = cleanSearchTitle(title);
    const cleanArtist = cleanSearchArtist(artist);
    const allResults = new Map<string, LyricResult>();
    let bestResult: LyricResult | null = null;

    const priorityOrder = ['lrc.red', 'BiniLyrics', 'BetterLyrics', 'SimpMusic', 'LRCLIB'];

    const recordResult = (res: LyricResult | null) => {
      if (!res || !res.lines || res.lines.length === 0) return;
      if (this.inFlightKey !== key) return; // Stale request

      allResults.set(res.source, res);

      let shouldPromote = false;
      if (!bestResult) {
        shouldPromote = true;
      } else if (res.isWordSynced && !bestResult.isWordSynced) {
        shouldPromote = true;
      } else if (res.isWordSynced === bestResult.isWordSynced) {
        const curPriority = priorityOrder.indexOf(bestResult.source);
        const newPriority = priorityOrder.indexOf(res.source);
        if (newPriority >= 0 && (curPriority < 0 || newPriority < curPriority)) {
          shouldPromote = true;
        }
      }

      if (shouldPromote) {
        bestResult = res;
      }

      if (onProgress && this.inFlightKey === key) {
        onProgress(bestResult, allResults);
      }
    };

    // Race providers concurrently
    const tasks = [
      // 1. SimpMusic (fastest for YouTube videoId)
      (async () => {
        if (videoId) {
          const res = await fetchSimpMusicLyrics(videoId);
          recordResult(res);
        }
      })(),

      // 2. lrc.red (Apple Music TTML)
      (async () => {
        const res = await fetchLrcRed(cleanTitle, cleanArtist, durationMs);
        recordResult(res);
      })(),

      // 3. BiniLyrics (Apple Music TTML)
      (async () => {
        const res = await fetchBiniLyrics(cleanTitle, cleanArtist, durationMs);
        recordResult(res);
      })(),

      // 4. BetterLyrics
      (async () => {
        const res = await fetchBetterLyrics(cleanTitle, cleanArtist, durationMs);
        recordResult(res);
      })(),

      // 5. LRCLIB (Line-synced community fallback)
      (async () => {
        const res = await fetchLrcLib(cleanTitle, cleanArtist, durationMs);
        recordResult(res);
      })(),
    ];

    await Promise.allSettled(tasks);

    if (bestResult && this.inFlightKey === key) {
      this.cache.set(key, { activeResult: bestResult, allResults });
    }

    return { activeResult: bestResult, allResults };
  }
}
