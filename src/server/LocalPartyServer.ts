/**
 * Built-in BitChord Listen Together Party Server (Node.js)
 * Implements BitChord's Go backend protocol for local Wi-Fi party hosting.
 */

import http from 'http';
import os from 'os';
import WebSocket, { WebSocketServer } from 'ws';
import {
  PartyTrack,
  PartyMember,
  PartyPlayback,
  PartyQueue,
  PartySnapshot,
  ClientFrame,
  ServerFrame,
} from '../protocol/types.js';
import { normaliseCode, ALPHABET, CODE_LENGTH } from '../protocol/codes.js';

interface InternalParty {
  code: string;
  createdAtMs: number;
  maxMembers: number;
  hostOnlyControl: boolean;
  members: Map<string, PartyMember & { token: string }>;
  sockets: Map<string, WebSocket>;
  playback: PartyPlayback;
  queue: PartyQueue;
}

export class LocalPartyServer {
  private server: http.Server | null = null;
  private wss: WebSocketServer | null = null;
  private parties: Map<string, InternalParty> = new Map();
  public port: number = 8000;
  public isRunning: boolean = false;

  public getAllIps(): { name: string; address: string; isPhysical: boolean }[] {
    const results: { name: string; address: string; isPhysical: boolean }[] = [];
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
      const lower = name.toLowerCase();
      const isVirtual =
        lower.includes('tailscale') ||
        lower.includes('wsl') ||
        lower.includes('vethernet') ||
        lower.includes('docker') ||
        lower.includes('virtual') ||
        lower.includes('vmware') ||
        lower.includes('vbox');
      for (const net of nets[name] || []) {
        if (net.family === 'IPv4' && !net.internal) {
          const parts = net.address.split('.').map(Number);
          const isCgnat = parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127;
          results.push({
            name,
            address: net.address,
            isPhysical: !isVirtual && !isCgnat,
          });
        }
      }
    }
    return results;
  }

  public getLocalIp(): string {
    const ips = this.getAllIps();
    // 1. Prefer physical Wi-Fi
    const wifi = ips.find((i) => /wi-fi|wifi|wireless|wlan/i.test(i.name) && i.isPhysical);
    if (wifi) return wifi.address;

    // 2. Prefer physical Ethernet
    const eth = ips.find((i) => /ethernet|eth/i.test(i.name) && i.isPhysical);
    if (eth) return eth.address;

    // 3. Any non-virtual/non-CGNAT IPv4
    const anyPhysical = ips.find((i) => i.isPhysical);
    if (anyPhysical) return anyPhysical.address;

    // 4. Fallback to first available IPv4
    if (ips.length > 0) return ips[0].address;
    return '127.0.0.1';
  }

  public getBaseUrl(): string {
    return `http://${this.getLocalIp()}:${this.port}`;
  }

  public async start(port = 8000): Promise<string> {
    if (this.isRunning) return this.getBaseUrl();
    this.port = port;

    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.handleHttpRequest(req, res);
      });

      this.wss = new WebSocketServer({ noServer: true });

      this.server.on('upgrade', (req, socket, head) => {
        const url = req.url || '';
        const match = url.match(/^\/ws\/parties\/([a-zA-Z0-9]+)/);
        if (!match) {
          socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
          socket.destroy();
          return;
        }

        const code = normaliseCode(match[1]);
        const party = this.parties.get(code);
        if (!party) {
          socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
          socket.destroy();
          return;
        }

        const authHeader = req.headers['authorization'] || '';
        const token = authHeader.replace(/^Bearer\s+/i, '').trim();

        let authedMember: (PartyMember & { token: string }) | null = null;
        for (const m of party.members.values()) {
          if (m.token === token) {
            authedMember = m;
            break;
          }
        }

        if (!authedMember) {
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy();
          return;
        }

        this.wss!.handleUpgrade(req, socket, head, (ws) => {
          this.handleWebSocketConnection(code, authedMember!, ws);
        });
      });

      this.server.on('error', (err: any) => {
        if (err.code === 'EADDRINUSE') {
          // Retry on next port
          this.server?.close();
          this.start(port + 1).then(resolve).catch(reject);
        } else {
          reject(err);
        }
      });

      this.server.listen(this.port, '0.0.0.0', () => {
        this.isRunning = true;
        resolve(this.getBaseUrl());
      });
    });
  }

  public async stop(): Promise<void> {
    if (!this.isRunning) return;

    for (const party of this.parties.values()) {
      for (const ws of party.sockets.values()) {
        try {
          ws.close();
        } catch {}
      }
    }
    this.parties.clear();

    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }

    if (this.server) {
      await new Promise<void>((resolve) => this.server!.close(() => resolve()));
      this.server = null;
    }

    this.isRunning = false;
  }

  private handleHttpRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, HEAD');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Range');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = req.url || '';
    const now = Date.now();

    // /audio?url=... — Proxy JioSaavn CDN audio streams for the VS Code webview
    // The webview cannot load cross-origin audio directly (CSP + autoplay),
    // so the extension's local HTTP server proxies CDN bytes through localhost.
    if (url.startsWith('/audio') && (req.method === 'GET' || req.method === 'HEAD')) {
      const params = new URLSearchParams(url.includes('?') ? url.split('?')[1] : '');
      const cdnUrl = params.get('url');

      if (!cdnUrl || !cdnUrl.startsWith('https://')) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing or invalid cdn url parameter' }));
        return;
      }

      const rangeHeader = req.headers['range'];
      const fetchHeaders: Record<string, string> = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'audio/*,*/*',
        'Accept-Encoding': 'identity',
      };
      if (rangeHeader) {
        fetchHeaders['Range'] = rangeHeader;
      }

      fetch(cdnUrl, { method: req.method === 'HEAD' ? 'HEAD' : 'GET', headers: fetchHeaders })
        .then(upstream => {
          const responseHeaders: Record<string, string> = {
            'Content-Type': upstream.headers.get('content-type') || 'audio/mp4',
            'Accept-Ranges': 'bytes',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'public, max-age=3600',
          };

          const contentLength = upstream.headers.get('content-length');
          if (contentLength) responseHeaders['Content-Length'] = contentLength;

          const contentRange = upstream.headers.get('content-range');
          if (contentRange) responseHeaders['Content-Range'] = contentRange;

          res.writeHead(upstream.status, responseHeaders);

          if (req.method === 'HEAD' || !upstream.body) {
            res.end();
            return;
          }

          // Stream body to client
          const reader = upstream.body.getReader();
          const pump = (): void => {
            reader.read().then(({ done, value }) => {
              if (done) { res.end(); return; }
              res.write(value);
              pump();
            }).catch(() => res.end());
          };
          pump();
        })
        .catch(err => {
          if (!res.headersSent) {
            res.writeHead(502, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'CDN proxy error', detail: String(err) }));
          } else {
            res.end();
          }
        });
      return;
    }

    // 0. Root URL (Dashboard)
    if ((url === '/' || url === '') && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>BitChord Party Server</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #121214; color: #f0f0f5; padding: 2rem; max-width: 600px; margin: 0 auto; line-height: 1.6; }
    .status { display: inline-flex; align-items: center; gap: 8px; background: rgba(34, 197, 94, 0.15); color: #22c55e; padding: 6px 14px; border-radius: 9999px; font-weight: 600; font-size: 14px; }
    .card { background: #1c1c22; border: 1px solid #2e2e38; border-radius: 12px; padding: 20px; margin-top: 20px; }
    code { background: #262630; padding: 3px 8px; border-radius: 6px; font-family: monospace; color: #a78bfa; }
  </style>
</head>
<body>
  <h1>🎵 BitChord Listen Together Server</h1>
  <div class="status">🟢 Server is RUNNING on Port ${this.port}</div>
  <div class="card">
    <h3>Server Details</h3>
    <p><strong>Status:</strong> Active</p>
    <p><strong>Active Parties:</strong> ${this.parties.size}</p>
    <p><strong>Health Check:</strong> <a href="/healthz" style="color:#60a5fa">/healthz</a> (ok: true)</p>
    <p><strong>Time:</strong> <a href="/api/time" style="color:#60a5fa">/api/time</a></p>
  </div>
  <p style="color: #94a3b8; font-size: 13px; margin-top: 20px;">Use this server in BitChord: <code>${this.getBaseUrl()}</code></p>
</body>
</html>`);
      return;
    }

    // 1. Healthz
    if (url === '/healthz' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, serverMs: now }));
      return;
    }

    // 2. /api/time
    if (url === '/api/time' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ serverMs: now }));
      return;
    }

    // 3. POST /api/parties (Create)
    if (url === '/api/parties' && req.method === 'POST') {
      this.readJsonBody(req, (body) => {
        if (!body || !body.displayName) {
          res.writeHead(422, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'invalid_identity', message: 'displayName required' }));
          return;
        }

        let code = this.generateCode();
        while (this.parties.has(code)) {
          code = this.generateCode();
        }

        const memberId = Math.random().toString(16).substring(2, 10);
        const token = Math.random().toString(36).substring(2) + Math.random().toString(36).substring(2);

        const member: PartyMember & { token: string } = {
          memberId,
          userId: body.userId || `user-${memberId}`,
          displayName: body.displayName,
          avatarUrl: body.avatarUrl || null,
          isHost: true,
          connected: false,
          joinedAtMs: now,
          lastSeenMs: now,
          token,
        };

        const party: InternalParty = {
          code,
          createdAtMs: now,
          maxMembers: body.maxMembers || 5,
          hostOnlyControl: false,
          members: new Map([[memberId, member]]),
          sockets: new Map(),
          playback: {
            seq: 0,
            track: null,
            queueSeq: 0,
            queueLength: 0,
            queueIndex: -1,
            isPlaying: false,
            positionMs: 0,
            anchorMs: now,
            effectivePositionMs: 0,
            updatedBy: null,
            startedBy: null,
            startedByName: null,
            autoplayEnabled: false,
            updatedAtMs: now,
          },
          queue: {
            seq: 0,
            index: -1,
            items: [],
          },
        };

        this.parties.set(code, party);

        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            code,
            token,
            you: this.stripToken(member),
            party: this.toSnapshot(party),
          })
        );
      });
      return;
    }

    // 3.5 GET /api/parties/:code/preview
    const previewMatch = url.match(/^\/api\/parties\/([a-zA-Z0-9]+)\/preview$/);
    if (previewMatch && req.method === 'GET') {
      const code = normaliseCode(previewMatch[1]);
      const party = this.parties.get(code);
      if (!party) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ code: 'not_found', message: 'No party with that code exists.' }));
        return;
      }
      const host = Array.from(party.members.values()).find((m) => m.isHost);
      const preview = {
        code,
        hostName: host?.displayName || 'Host',
        isFull: party.members.size >= party.maxMembers,
        maxMembers: party.maxMembers,
        memberCount: party.members.size,
        members: Array.from(party.members.values()).map((m) => ({
          avatarUrl: m.avatarUrl,
          displayName: m.displayName,
          isHost: m.isHost,
        })),
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(preview));
      return;
    }

    // 4. POST /api/parties/:code/join
    const joinMatch = url.match(/^\/api\/parties\/([a-zA-Z0-9]+)\/join$/);
    if (joinMatch && req.method === 'POST') {
      const code = normaliseCode(joinMatch[1]);
      const party = this.parties.get(code);

      if (!party) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'not_found', message: 'Party not found' }));
        return;
      }

      this.readJsonBody(req, (body) => {
        if (!body || !body.displayName) {
          res.writeHead(422, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'invalid_identity', message: 'displayName required' }));
          return;
        }

        if (party.members.size >= party.maxMembers) {
          res.writeHead(409, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'party_full', message: 'Party is full' }));
          return;
        }

        const memberId = Math.random().toString(16).substring(2, 10);
        const token = Math.random().toString(36).substring(2) + Math.random().toString(36).substring(2);

        const member: PartyMember & { token: string } = {
          memberId,
          userId: body.userId || `user-${memberId}`,
          displayName: body.displayName,
          avatarUrl: body.avatarUrl || null,
          isHost: false,
          connected: false,
          joinedAtMs: now,
          lastSeenMs: now,
          token,
        };

        party.members.set(memberId, member);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            code,
            token,
            you: this.stripToken(member),
            party: this.toSnapshot(party),
          })
        );
      });
      return;
    }

    // 5. POST /api/parties/:code/leave
    const leaveMatch = url.match(/^\/api\/parties\/([a-zA-Z0-9]+)\/leave$/);
    if (leaveMatch && req.method === 'POST') {
      const code = normaliseCode(leaveMatch[1]);
      const party = this.parties.get(code);
      if (party) {
        const auth = req.headers['authorization'] || '';
        const token = auth.replace(/^Bearer\s+/i, '').trim();
        for (const [mId, m] of party.members.entries()) {
          if (m.token === token) {
            party.members.delete(mId);
            const ws = party.sockets.get(mId);
            if (ws) {
              try {
                ws.close();
              } catch {}
              party.sockets.delete(mId);
            }
            this.broadcastMembers(party);
            break;
          }
        }
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    // Fallback
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  }

  private handleWebSocketConnection(
    code: string,
    member: PartyMember & { token: string },
    ws: WebSocket
  ): void {
    const party = this.parties.get(code);
    if (!party) {
      ws.close();
      return;
    }

    member.connected = true;
    party.sockets.set(member.memberId, ws);

    // Send Welcome
    ws.send(
      JSON.stringify({
        type: 'welcome',
        you: this.stripToken(member),
        party: this.toSnapshot(party),
        serverMs: Date.now(),
      })
    );

    // Broadcast members
    this.broadcastMembers(party);

    ws.on('message', (data) => {
      try {
        const frame = JSON.parse(data.toString()) as ClientFrame;
        this.handleClientFrame(party, member, ws, frame);
      } catch {}
    });

    ws.on('close', () => {
      member.connected = false;
      party.sockets.delete(member.memberId);
      this.broadcastMembers(party);
    });
  }

  private handleClientFrame(
    party: InternalParty,
    member: PartyMember,
    ws: WebSocket,
    frame: ClientFrame
  ): void {
    const now = Date.now();

    switch (frame.type) {
      case 'ping': {
        ws.send(
          JSON.stringify({
            type: 'pong',
            clientMs: frame.clientMs,
            serverMs: now,
          })
        );
        break;
      }

      case 'sync': {
        ws.send(
          JSON.stringify({
            type: 'state',
            playback: party.playback,
            serverMs: now,
          })
        );
        break;
      }

      case 'syncQueue': {
        ws.send(
          JSON.stringify({
            type: 'queue',
            queue: party.queue,
            serverMs: now,
          })
        );
        break;
      }

      case 'control': {
        if (party.hostOnlyControl && !member.isHost) {
          ws.send(
            JSON.stringify({
              type: 'error',
              error: 'host_only',
              message: 'Host has locked party controls.',
            })
          );
          return;
        }

        this.applyControl(party, member, frame);
        break;
      }
    }
  }

  private applyControl(party: InternalParty, member: PartyMember, frame: any): void {
    const now = Date.now();
    let queueChanged = false;
    let playbackChanged = false;

    switch (frame.action) {
      case 'play': {
        party.playback.isPlaying = true;
        party.playback.positionMs = frame.positionMs != null ? frame.positionMs : party.playback.positionMs;
        party.playback.anchorMs = now + 350; // Lead lead-time
        playbackChanged = true;
        break;
      }

      case 'pause': {
        party.playback.isPlaying = false;
        party.playback.positionMs = frame.positionMs != null ? frame.positionMs : party.playback.positionMs;
        party.playback.anchorMs = now;
        playbackChanged = true;
        break;
      }

      case 'seek': {
        party.playback.positionMs = frame.positionMs;
        party.playback.anchorMs = now + (party.playback.isPlaying ? 350 : 0);
        playbackChanged = true;
        break;
      }

      case 'setTrack': {
        party.playback.track = frame.track;
        party.playback.positionMs = frame.positionMs || 0;
        party.playback.isPlaying = !!frame.isPlaying;
        party.playback.anchorMs = now + (party.playback.isPlaying ? 350 : 0);
        party.playback.startedBy = member.memberId;
        party.playback.startedByName = member.displayName;
        playbackChanged = true;
        break;
      }

      case 'next': {
        if (party.queue.items.length > 0 && party.queue.index + 1 < party.queue.items.length) {
          party.queue.index++;
          const nextTrack = party.queue.items[party.queue.index];
          party.playback.track = nextTrack;
          party.playback.positionMs = 0;
          party.playback.isPlaying = true;
          party.playback.anchorMs = now + 350;
          playbackChanged = true;
          queueChanged = true;
        }
        break;
      }

      case 'previous': {
        if (party.queue.items.length > 0 && party.queue.index > 0) {
          party.queue.index--;
          const prevTrack = party.queue.items[party.queue.index];
          party.playback.track = prevTrack;
          party.playback.positionMs = 0;
          party.playback.isPlaying = true;
          party.playback.anchorMs = now + 350;
          playbackChanged = true;
          queueChanged = true;
        }
        break;
      }

      case 'queueAdd': {
        if (Array.isArray(frame.tracks)) {
          party.queue.items.push(...frame.tracks);
          party.queue.seq++;
          party.playback.queueSeq = party.queue.seq;
          party.playback.queueLength = party.queue.items.length;
          queueChanged = true;
          playbackChanged = true;
        }
        break;
      }

      case 'queueRemove': {
        party.queue.items = party.queue.items.filter((t) => t.videoId !== frame.videoId);
        party.queue.seq++;
        party.playback.queueSeq = party.queue.seq;
        party.playback.queueLength = party.queue.items.length;
        queueChanged = true;
        playbackChanged = true;
        break;
      }

      case 'queueClear': {
        party.queue.items = [];
        party.queue.index = -1;
        party.queue.seq++;
        party.playback.queueSeq = party.queue.seq;
        party.playback.queueLength = 0;
        queueChanged = true;
        playbackChanged = true;
        break;
      }

      case 'setHostOnlyControl': {
        if (member.isHost) {
          party.hostOnlyControl = !!frame.enabled;
          this.broadcastMembers(party);
        }
        break;
      }
    }

    if (playbackChanged) {
      party.playback.seq++;
      party.playback.updatedBy = member.memberId;
      party.playback.updatedAtMs = now;
    }

    if (queueChanged) {
      this.broadcast(party, {
        type: 'queue',
        queue: party.queue,
        serverMs: now,
      });
    }

    if (playbackChanged) {
      this.broadcast(party, {
        type: 'state',
        playback: party.playback,
        serverMs: now,
      });
    }
  }

  private broadcast(party: InternalParty, frame: ServerFrame): void {
    const raw = JSON.stringify(frame);
    for (const ws of party.sockets.values()) {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(raw);
        } catch {}
      }
    }
  }

  private broadcastMembers(party: InternalParty): void {
    const membersList = Array.from(party.members.values()).map(this.stripToken);
    this.broadcast(party, {
      type: 'members',
      members: membersList,
      maxMembers: party.maxMembers,
      hostOnlyControl: party.hostOnlyControl,
      serverMs: Date.now(),
    });
  }

  private toSnapshot(party: InternalParty): PartySnapshot {
    return {
      code: party.code,
      createdAtMs: party.createdAtMs,
      maxMembers: party.maxMembers,
      hostOnlyControl: party.hostOnlyControl,
      members: Array.from(party.members.values()).map(this.stripToken),
      playback: party.playback,
      queue: party.queue,
      serverMs: Date.now(),
    };
  }

  private stripToken(m: PartyMember & { token: string }): PartyMember {
    const { token, ...rest } = m;
    return rest;
  }

  private readJsonBody(req: http.IncomingMessage, cb: (data: any) => void): void {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      try {
        cb(JSON.parse(raw));
      } catch {
        cb(null);
      }
    });
  }

  private generateCode(): string {
    let res = '';
    for (let i = 0; i < CODE_LENGTH; i++) {
      res += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    }
    return res;
  }
}
