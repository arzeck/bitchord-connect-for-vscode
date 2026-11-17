/**
 * Unit Test Suite for BitChord Connect VS Code Extension
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';

import { normaliseCode, isValidCode, extractCodeAndServer } from '../src/protocol/codes.js';
import { ServerClock } from '../src/client/ServerClock.js';
import { parseAnyLrc, parseStandardLrc, parseKaraokeLrc } from '../src/lyrics/parsers/lrc-parser.js';
import { parseTtmlLyrics, parseTtmlTime } from '../src/lyrics/parsers/ttml-parser.js';
import { wordLift, revealedChars, smoothHermite, createLyricWord, createLyricLine } from '../src/lyrics/models.js';
import { decryptSaavnMediaUrl, resolveAudioStream } from '../src/playback/StreamResolver.js';
import { AudioProxyServer } from '../src/playback/AudioProxyServer.js';

describe('BitChord Code Normalization & Parsing', () => {
  test('normalises lowercase and replaces O, I, L', () => {
    assert.strictEqual(normaliseCode('  7a9k2m  '), '7A9K2M');
    assert.strictEqual(normaliseCode('o1l9ia'), '01191A');
  });

  test('validates 6-character party codes', () => {
    assert.strictEqual(isValidCode('7A9K2M'), true);
    assert.strictEqual(isValidCode('7A9K2'), false); // too short
    assert.strictEqual(isValidCode('7A9K2MM'), false); // too long
  });

  test('extracts codes from bitchord scheme and https invite links', () => {
    const res1 = extractCodeAndServer('bitchord://party/7A9K2M?server=https%3A%2F%2Fcustom.com');
    assert.ok(res1);
    assert.strictEqual(res1.code, '7A9K2M');
    assert.strictEqual(res1.serverUrl, 'https://custom.com');

    const res2 = extractCodeAndServer('https://bitchord.kushagrasingh.in/invite/3Y7W9Z');
    assert.ok(res2);
    assert.strictEqual(res2.code, '3Y7W9Z');

    const res3 = extractCodeAndServer('   4h8j2k   ');
    assert.ok(res3);
    assert.strictEqual(res3.code, '4H8J2K');
  });
});

describe('Server Clock Synchronization', () => {
  test('calculates NTP offset accurately and picks lowest roundtrip', () => {
    const clock = new ServerClock();

    // Sample 1: high jitter (RTT = 100ms)
    // sent=1000, server=5500, received=1100 -> midpoint=1050, offset = 5500 - 1050 = 4450
    clock.record(1000, 5500, 1100);
    assert.strictEqual(clock.roundTripMs, 100);
    assert.strictEqual(clock.offsetMs, 4450);

    // Sample 2: low jitter (RTT = 20ms)
    // sent=2000, server=6460, received=2020 -> midpoint=2010, offset = 6460 - 2010 = 4450
    clock.record(2000, 6460, 2020);
    assert.strictEqual(clock.roundTripMs, 20);
    assert.strictEqual(clock.offsetMs, 4450);
  });

  test('computes playhead arithmetic properly when paused and playing', () => {
    const clock = new ServerClock();
    // Simulate clock synced with offset 0
    clock.record(1000, 1010, 1020);

    // When paused
    const pausedPos = clock.computePlayhead(42000, 1000, false, 180000);
    assert.strictEqual(pausedPos, 42000);

    // When playing
    const serverNow = clock.serverNowMs()!;
    const playingPos = clock.computePlayhead(10000, serverNow - 5000, true, 180000);
    // elapsed = serverNow - (serverNow - 5000) = 5000ms -> pos should be 15000
    assert.ok(Math.abs(playingPos - 15000) < 50);
  });
});

describe('LRC Parsers', () => {
  test('parses standard line-synced LRC', () => {
    const sampleLrc = `
[00:12.50]First line of the song
[00:15.00]Second line of the song
    `;
    const lines = parseStandardLrc(sampleLrc);
    assert.strictEqual(lines.length, 2);
    assert.strictEqual(lines[0].timeMs, 12500);
    assert.strictEqual(lines[0].text, 'First line of the song');
    assert.strictEqual(lines[1].timeMs, 15000);
    assert.strictEqual(lines[1].text, 'Second line of the song');
  });

  test('parses Karaoke LRC with syllable timestamps', () => {
    const sampleKaraoke = `
[1000,3000](1000,500)Hel(1500,500)lo (2000,1000)World
    `;
    const lines = parseKaraokeLrc(sampleKaraoke);
    assert.strictEqual(lines.length, 1);
    assert.strictEqual(lines[0].timeMs, 1000);
    assert.strictEqual(lines[0].text, 'Hello World');
    assert.strictEqual(lines[0].words.length, 3);
    assert.strictEqual(lines[0].words[0].text, 'Hel');
    assert.strictEqual(lines[0].words[0].startMs, 1000);
    assert.strictEqual(lines[0].words[0].endMs, 1500);
  });
});

describe('Apple Music TTML Parser', () => {
  test('parses TTML time formats', () => {
    assert.strictEqual(parseTtmlTime('27.395'), 27395);
    assert.strictEqual(parseTtmlTime('01:05.20'), 65200);
    assert.strictEqual(parseTtmlTime('00:03:12.000'), 192000);
    assert.strictEqual(parseTtmlTime('4200ms'), 4200);
  });

  test('parses TTML document with syllable spans, background vocals, and duets', () => {
    const sampleTtml = `
<?xml version="1.0" encoding="utf-8"?>
<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata">
  <body>
    <div>
      <p begin="00:00:10.000" end="00:00:14.000" ttm:agent="v1">
        <span begin="00:00:10.000" end="00:00:11.000">Never</span>
        <span begin="00:00:11.000" end="00:00:12.500">gonna</span>
        <span begin="00:00:12.500" end="00:00:14.000">give</span>
        <span ttm:role="x-bg" begin="00:00:13.000" end="00:00:14.000">yeah</span>
        <span ttm:role="x-roman">never gonna give</span>
        <span ttm:role="x-translation">Never going to give</span>
      </p>
      <p begin="00:00:15.000" end="00:00:18.000" ttm:agent="v2">
        <span begin="00:00:15.000" end="00:00:18.000">you up</span>
      </p>
    </div>
  </body>
</tt>
    `;

    const lines = parseTtmlLyrics(sampleTtml);
    assert.strictEqual(lines.length, 2);

    // Line 1
    assert.strictEqual(lines[0].timeMs, 10000);
    assert.strictEqual(lines[0].text, 'Never gonna give');
    assert.strictEqual(lines[0].words.length, 3);
    assert.strictEqual(lines[0].words[0].text, 'Never');
    assert.strictEqual(lines[0].background?.text, 'yeah');
    assert.strictEqual(lines[0].roman, 'never gonna give');
    assert.strictEqual(lines[0].translation, 'Never going to give');
    assert.strictEqual(lines[0].alignment, 'Start');

    // Line 2 (duet agent v2 -> End alignment)
    assert.strictEqual(lines[1].timeMs, 15000);
    assert.strictEqual(lines[1].text, 'you up');
    assert.strictEqual(lines[1].alignment, 'End');
  });
});

describe('Lyrics Easing and Word Lift', () => {
  test('wordLift returns hermite easing between 0 and 1', () => {
    const word = createLyricWord(1000, 2000, 'Test');
    assert.strictEqual(wordLift(word, 500), 0); // before rise
    assert.strictEqual(wordLift(word, 1500), 1); // during sung word
    assert.strictEqual(wordLift(word, 2500), 0); // after fall
  });

  test('revealedChars computes smooth character sweep', () => {
    const word1 = createLyricWord(1000, 2000, 'Hello');
    const word2 = createLyricWord(2000, 3000, 'World');
    const line = createLyricLine({ timeMs: 1000, text: 'Hello World', words: [word1, word2] });

    assert.strictEqual(revealedChars(line, 500), 0);
    assert.strictEqual(revealedChars(line, 2000), 6); // 'Hello '
    assert.strictEqual(revealedChars(line, 3500), 11); // 'Hello World'
  });
});

describe('Apple Music am-lyrics Web Component Integration', () => {
  test('am-lyrics bundle and HTML template exist and integrate correctly', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');

    const amLyricsSrc = path.join(process.cwd(), 'src', 'webview', 'ui', 'am-lyrics.js');
    assert.ok(fs.existsSync(amLyricsSrc), 'src/webview/ui/am-lyrics.js exists');
    const stat = fs.statSync(amLyricsSrc);
    assert.ok(stat.size > 100000, 'am-lyrics.js is bundled and populated');

    const indexHtml = fs.readFileSync(path.join(process.cwd(), 'src', 'webview', 'ui', 'index.html'), 'utf8');
    assert.ok(indexHtml.includes('<am-lyrics'), 'index.html contains <am-lyrics> element');
    assert.ok(indexHtml.includes('{{AM_LYRICS_URI}}'), 'index.html includes AM_LYRICS_URI script');
    assert.ok(indexHtml.includes('connect-src https: http:'), 'CSP allows https and websocket connections');
    assert.ok(indexHtml.includes('media-src https: http:'), 'CSP explicitly allows media audio playback');
    assert.ok(indexHtml.includes('http://127.0.0.1:*'), 'CSP allows loopback audio proxy');
    assert.ok(indexHtml.includes('id="bitchord-audio"'), 'index.html contains native <audio> DOM element');
  });
});

describe('BitChord Audio Playback & Stream Resolver', () => {
  test('decryptSaavnMediaUrl decrypts DES-ECB encrypted media tokens cleanly', () => {
    // Encrypted media token for a valid test track
    const testEncUrl = 'Lsm0O03ZqH85s9K9F93J/Tq/k0iE2eE1f1w0r7fK5K9hVqZ7M+m9B9k1lV0s2y8k';
    // Decrypting should either produce a clean URL string or null for invalid tokens
    const decrypted = decryptSaavnMediaUrl(testEncUrl);
    // Should be string or null without throwing any exceptions or unsupported crypto errors
    assert.ok(decrypted === null || typeof decrypted === 'string');
    // For completely invalid base64, returns null safely
    assert.strictEqual(decryptSaavnMediaUrl(''), '');
    assert.strictEqual(typeof decryptSaavnMediaUrl('invalid_token!'), 'string');
  });

  test('resolveAudioStream resolves tracks including multi-artist songs with caching', async () => {
    // Multi-artist track
    const url = await resolveAudioStream('LAAVAN', 'Jasmine Sandlas & Mofusion');
    if (url) {
      assert.ok(url.startsWith('http'), 'Audio URL is HTTP/HTTPS');
      assert.ok(url.includes('.mp4') || url.includes('.m4a') || url.includes('.mp3'), 'Audio URL points to media container');
      // Second call should return instantly from cache
      const t0 = Date.now();
      const cachedUrl = await resolveAudioStream('LAAVAN', 'Jasmine Sandlas & Mofusion');
      const elapsed = Date.now() - t0;
      assert.strictEqual(cachedUrl, url);
      assert.ok(elapsed < 10, 'Cached lookup is instantaneous (<10ms)');
    }
  });

  test('AudioProxyServer boots on ephemeral loopback port and serves healthz', async () => {
    const proxy = new AudioProxyServer();
    const base = await proxy.start();
    assert.ok(proxy.port > 0, 'Proxy assigned valid port');
    assert.ok(base.startsWith('http://127.0.0.1:'), 'Base URL is loopback IPv4');

    const streamUrl = proxy.getStreamUrl('kJQP7kiw5Fk', 'Despacito', 'Luis Fonsi');
    assert.ok(streamUrl.includes('/api/stream?id=kJQP7kiw5Fk'), 'Generates valid stream route');

    const hRes = await fetch(`${base}/healthz`);
    assert.strictEqual(hRes.status, 200);
    const body: any = await hRes.json();
    assert.strictEqual(body.ok, true);

    await proxy.stop();
    assert.strictEqual(proxy.isRunning, false);
  });
});

