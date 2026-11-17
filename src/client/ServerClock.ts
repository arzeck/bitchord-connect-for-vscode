/**
 * Monotonic Server Clock Synchronization
 * Ported from BitChord's ServerClock.kt.
 */

interface ClockSample {
  offsetMs: number;
  roundTripMs: number;
  takenAtMs: number;
}

const WINDOW_SIZE = 12;
const SAMPLE_TTL_MS = 120_000;

export class ServerClock {
  private samples: ClockSample[] = [];
  public offsetMs: number | null = null;
  public roundTripMs: number = 0;

  /**
   * Monotonic local timestamp in milliseconds.
   * Immune to system clock steps, NTP adjustments, or DST shifts.
   */
  public static localNowMs(): number {
    return Number(process.hrtime.bigint() / 1_000_000n);
  }

  /**
   * Records a ping/pong exchange.
   */
  public record(sentAtLocalMs: number, serverMs: number, receivedAtLocalMs: number): void {
    const roundTrip = Math.max(0, receivedAtLocalMs - sentAtLocalMs);
    const midpoint = sentAtLocalMs + roundTrip / 2;
    const sampleOffset = serverMs - midpoint;

    this.samples.push({
      offsetMs: sampleOffset,
      roundTripMs: roundTrip,
      takenAtMs: receivedAtLocalMs,
    });

    while (this.samples.length > WINDOW_SIZE) {
      this.samples.shift();
    }

    // Discard samples older than TTL
    const cutoff = receivedAtLocalMs - SAMPLE_TTL_MS;
    const usable = this.samples.filter((s) => s.takenAtMs >= cutoff);
    const pool = usable.length > 0 ? usable : this.samples;

    // The sample with the smallest round-trip latency wins
    let best = pool[0];
    for (let i = 1; i < pool.length; i++) {
      if (pool[i].roundTripMs < best.roundTripMs) {
        best = pool[i];
      }
    }

    if (best) {
      this.offsetMs = best.offsetMs;
      this.roundTripMs = best.roundTripMs;
    }
  }

  /**
   * Approximates the current server timestamp in milliseconds.
   * Returns null if no sync sample has arrived yet.
   */
  public serverNowMs(): number | null {
    if (this.offsetMs === null) return null;
    return ServerClock.localNowMs() + this.offsetMs;
  }

  /**
   * Computes the current playhead position in milliseconds.
   */
  public computePlayhead(
    positionMs: number,
    anchorMs: number,
    isPlaying: boolean,
    durationMs?: number | null
  ): number {
    if (!isPlaying) {
      return Math.max(0, positionMs);
    }

    const sNow = this.serverNowMs();
    if (sNow === null) {
      if (anchorMs > 1_000_000_000_000) {
        const elapsed = Math.max(0, Date.now() - anchorMs);
        const current = positionMs + elapsed;
        if (durationMs && durationMs > 0 && current > durationMs) {
          return durationMs;
        }
        return Math.max(0, current);
      }
      return Math.max(0, positionMs);
    }

    const elapsed = Math.max(0, sNow - anchorMs);
    const current = positionMs + elapsed;

    if (durationMs && durationMs > 0 && current > durationMs) {
      return durationMs;
    }
    return Math.max(0, current);
  }

  public reset(): void {
    this.samples = [];
    this.offsetMs = null;
    this.roundTripMs = 0;
  }
}
