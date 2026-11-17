/**
 * BitChord Audio Proxy Server
 * Local loopback HTTP streaming server inspired by Aftertone's audio architecture.
 * Proxies YouTube audio streams (via yt-dlp) and JioSaavn CDN audio with Range/206 support.
 */

import http from 'http';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { resolveAudioStream } from './StreamResolver.js';

const execFileAsync = promisify(execFile);

interface CachedStream {
  url: string;
  expires: number;
}

const streamCache = new Map<string, CachedStream>();
const CACHE_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

/**
 * Resolves direct audio stream URL from yt-dlp using visionos/mweb clients
 * (Ported from Aftertone's tested production stream resolver)
 */
async function resolveYoutubeStreamUrl(videoId: string, forceFallback = false): Promise<string> {
  const now = Date.now();
  if (!forceFallback) {
    const cached = streamCache.get(videoId);
    if (cached && cached.expires > now) {
      return cached.url;
    }
  }

  const args = [
    '--force-ipv4',
    '-g',
    '-f', '140/251/ba/bestaudio',
    '--extractor-args', 'youtube:player_client=visionos,android_creator,web_creator',
    `https://www.youtube.com/watch?v=${videoId}`
  ];

  const res = await execFileAsync('yt-dlp', args, {
    timeout: 18000,
    windowsHide: true,
  });

  const lines = res.stdout.trim().split('\n').map(l => l.trim()).filter(Boolean);
  const streamUrl = lines.find(l => l.includes('videoplayback') && !l.includes('.m3u8'))
    || lines.find(l => !l.includes('.m3u8'))
    || lines[0];

  if (!streamUrl || !streamUrl.startsWith('http')) {
    throw new Error('Could not resolve valid audio stream URL from yt-dlp');
  }

  streamCache.set(videoId, {
    url: streamUrl,
    expires: now + CACHE_TTL_MS
  });

  return streamUrl;
}

/**
 * Attempts to fetch audio stream chunks with automatic edge node fallback
 * (from Aftertone's stream router, resolving unreachable regional ISP nodes)
 */
async function fetchWithNodeFallback(
  originalUrl: string,
  fetchHeaders: Record<string, string>,
  isHead: boolean
): Promise<{ response: Response; workingUrl: string }> {
  let candidateNodes: string[] = [];
  try {
    const urlObj = new URL(originalUrl);
    const mnParam = urlObj.searchParams.get('mn');
    if (mnParam) {
      for (const p of mnParam.split(',')) {
        const trimmed = p.trim();
        if (trimmed && !candidateNodes.includes(trimmed)) {
          candidateNodes.push(trimmed);
        }
      }
    }
  } catch {}

  const urlsToTry: string[] = [originalUrl];
  try {
    const urlObj = new URL(originalUrl);
    for (const node of candidateNodes) {
      const altHostname = urlObj.hostname.replace(/sn-[a-z0-9-]+/, node);
      const altUrl = originalUrl.replace(urlObj.hostname, altHostname);
      if (!urlsToTry.includes(altUrl)) {
        urlsToTry.push(altUrl);
      }
    }
  } catch {}

  let lastError: any = null;

  for (let i = 0; i < urlsToTry.length; i++) {
    const targetUrl = urlsToTry[i];
    try {
      const timeoutMs = i === 0 && urlsToTry.length > 1 ? 4500 : 7000;
      const res = await fetch(targetUrl, {
        method: isHead ? 'HEAD' : 'GET',
        headers: fetchHeaders,
        signal: AbortSignal.timeout(timeoutMs)
      });

      if (res.ok || res.status === 206) {
        return { response: res, workingUrl: targetUrl };
      }

      if (res.status === 403 || res.status === 410) {
        throw new Error(`Upstream returned ${res.status}`);
      }
    } catch (err: any) {
      lastError = err;
    }
  }

  throw lastError || new Error('All stream nodes failed to connect');
}

export class AudioProxyServer {
  private server: http.Server | null = null;
  public port: number = 0;
  public isRunning: boolean = false;

  public async start(): Promise<string> {
    if (this.isRunning && this.port > 0) {
      return this.getBaseUrl();
    }

    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res);
      });

      this.server.on('error', (err) => {
        reject(err);
      });

      // Listen on ephemeral port on 127.0.0.1
      this.server.listen(0, '127.0.0.1', () => {
        const addr = this.server?.address();
        if (addr && typeof addr === 'object') {
          this.port = addr.port;
          this.isRunning = true;
          resolve(this.getBaseUrl());
        } else {
          reject(new Error('Failed to obtain loopback address for AudioProxyServer'));
        }
      });
    });
  }

  public getBaseUrl(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  public getStreamUrl(videoId?: string | null, title?: string | null, artist?: string | null): string {
    const params = new URLSearchParams();
    if (videoId) params.set('id', videoId);
    if (title) params.set('title', title);
    if (artist) params.set('artist', artist);
    return `${this.getBaseUrl()}/api/stream?${params.toString()}`;
  }

  public async stop(): Promise<void> {
    if (!this.isRunning || !this.server) return;
    return new Promise((resolve) => {
      this.server!.close(() => {
        this.isRunning = false;
        this.server = null;
        resolve();
      });
    });
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    // CORS headers for Webview consumption
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type, Accept');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const rawUrl = req.url || '';
    if (rawUrl === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, port: this.port }));
      return;
    }

    if (!rawUrl.startsWith('/api/stream')) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
      return;
    }

    const urlObj = new URL(rawUrl, `http://127.0.0.1:${this.port}`);
    const videoId = urlObj.searchParams.get('id') || '';
    const title = urlObj.searchParams.get('title') || '';
    const artist = urlObj.searchParams.get('artist') || '';
    const directCdnUrl = urlObj.searchParams.get('url') || '';
    const forceRetry = urlObj.searchParams.get('retry') === '1';
    const isHead = req.method === 'HEAD';

    const rangeHeader = req.headers['range'] as string | undefined;

    let targetDirectUrl = directCdnUrl;

    // 1. Try YouTube resolution via yt-dlp if valid 11-char videoId exists
    if (!targetDirectUrl && videoId && /^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
      try {
        targetDirectUrl = await resolveYoutubeStreamUrl(videoId, forceRetry);
      } catch (ytErr: any) {
        console.warn('[AudioProxy] yt-dlp resolution failed, falling back to CDN catalogue:', ytErr.message);
      }
    }

    // 2. Fall back to JioSaavn stream resolver via title & artist
    if (!targetDirectUrl && (title || videoId)) {
      try {
        const saavnUrl = await resolveAudioStream(title, artist, videoId || undefined);
        if (saavnUrl) {
          targetDirectUrl = saavnUrl;
        }
      } catch (saavnErr: any) {
        console.warn('[AudioProxy] JioSaavn resolution error:', saavnErr.message);
      }
    }

    if (!targetDirectUrl) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Could not resolve audio stream' }));
      return;
    }

    const fetchHeaders: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
      'Accept': 'audio/*,*/*',
      'Accept-Encoding': 'identity',
    };
    if (rangeHeader) {
      fetchHeaders['Range'] = rangeHeader;
    }

    try {
      const { response: upstreamRes } = await fetchWithNodeFallback(targetDirectUrl, fetchHeaders, isHead);

      const responseHeaders: Record<string, string> = {
        'Content-Type': upstreamRes.headers.get('content-type') || 'audio/mp4',
        'Accept-Ranges': 'bytes',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Cache-Control': 'public, max-age=3600',
      };

      const clen = upstreamRes.headers.get('content-length');
      if (clen) responseHeaders['Content-Length'] = clen;

      const crange = upstreamRes.headers.get('content-range');
      if (crange) responseHeaders['Content-Range'] = crange;

      res.writeHead(upstreamRes.status, responseHeaders);

      if (isHead || !upstreamRes.body) {
        res.end();
        return;
      }

      // Stream upstream body chunks to response
      const reader = upstreamRes.body.getReader();
      let aborted = false;

      req.on('close', () => {
        aborted = true;
        try { reader.cancel(); } catch {}
      });

      const pump = (): void => {
        if (aborted) return;
        reader.read().then(({ done, value }) => {
          if (done) {
            res.end();
            return;
          }
          res.write(value);
          pump();
        }).catch(() => {
          if (!res.writableEnded) res.end();
        });
      };

      pump();
    } catch (err: any) {
      console.error('[AudioProxy] Stream proxying error:', err?.message || err);
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to fetch audio stream', detail: String(err) }));
      } else {
        res.end();
      }
    }
  }
}
