/**
 * BitChord Party Client
 * Handles room creation, joining, WebSockets, heartbeat, sequence tracking, and controls.
 */

import { EventEmitter } from 'events';
import WebSocket from 'ws';
import {
  PartyTrack,
  PartyMember,
  PartyPlayback,
  PartyQueue,
  PartySnapshot,
  JoinResponse,
  ClientFrame,
  ServerFrame,
} from '../protocol/types.js';
import { ServerClock } from './ServerClock.js';
import { normaliseCode } from '../protocol/codes.js';

export type ConnectionState = 'disconnected' | 'connecting' | 'connected';

/** All known BitChord party servers, in priority order. */
export const KNOWN_SERVERS = [
  'https://bitchord-listen-together.onrender.com',    // Render (default on BitChord Android APK)
  'https://api.bitchord.kushagrasingh.in',           // Official Oracle Cloud (always-on)
];

export class BitChordPartyClient extends EventEmitter {
  public code: string | null = null;
  public token: string | null = null;
  public you: PartyMember | null = null;
  public members: PartyMember[] = [];
  public hostOnlyControl: boolean = false;
  public playback: PartyPlayback = {
    seq: 0,
    queueSeq: 0,
    queueLength: 0,
    queueIndex: -1,
    isPlaying: false,
    positionMs: 0,
    anchorMs: 0,
  };
  public queue: PartyQueue = {
    seq: 0,
    index: -1,
    items: [],
  };

  public connectionState: ConnectionState = 'disconnected';
  public serverUrl: string = 'https://bitchord-listen-together.onrender.com';
  public readonly clock: ServerClock = new ServerClock();

  private ws: WebSocket | null = null;
  private pingInterval: NodeJS.Timeout | null = null;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private playheadTicker: NodeJS.Timeout | null = null;
  private lastAppliedSeq: number = 0;
  private isIntentionallyClosed: boolean = false;
  private reconnectAttempts: number = 0;
  private deviceId: string;
  private userId: string;

  constructor(serverUrl?: string) {
    super();
    if (serverUrl) {
      this.serverUrl = serverUrl.trim().replace(/\/+$/, '');
    }
    this.deviceId = 'vscode-' + Math.random().toString(36).substring(2, 10);
    this.userId = 'user-' + Math.random().toString(36).substring(2, 10);
  }

  public setServerUrl(url: string): void {
    this.serverUrl = url.trim().replace(/\/+$/, '');
  }

  public getCurrentPlayhead(): number {
    return this.clock.computePlayhead(
      this.playback.positionMs,
      this.playback.anchorMs,
      this.playback.isPlaying,
      this.playback.track?.durationMs
    );
  }

  public async joinParty(
    code: string,
    options?: { displayName?: string; serverUrl?: string }
  ): Promise<void> {
    const normCode = normaliseCode(code);
    if (!normCode) {
      throw new Error('Invalid party code. Must be 6 alphanumeric characters.');
    }

    if (options?.serverUrl) {
      this.setServerUrl(options.serverUrl);
    }

    this.isIntentionallyClosed = false;
    this.reconnectAttempts = 0;
    this.setConnectionState('connecting');

    // Build a list of servers to try: configured first, then all known servers
    const current = this.serverUrl.trim().replace(/\/+$/, '');
    const serversToTry: string[] = [current];
    for (const known of KNOWN_SERVERS) {
      const normalised = known.trim().replace(/\/+$/, '');
      if (!serversToTry.includes(normalised)) {
        serversToTry.push(normalised);
      }
    }

    let lastError: Error | null = null;

    for (const server of serversToTry) {
      try {
        const body = JSON.stringify({
          userId: this.userId,
          deviceId: this.deviceId,
          displayName: options?.displayName || 'VS Code',
        });

        const resp = await fetch(`${server}/api/parties/${normCode}/join`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          signal: AbortSignal.timeout(8000),
        });

        if (resp.status === 404) {
          // Party not found on this server — try next
          lastError = new Error(`Party "${normCode}" not found on ${server}`);
          continue;
        }

        if (!resp.ok) {
          const errorText = await resp.text();
          let message = `Failed to join party (HTTP ${resp.status})`;
          try {
            const errObj = JSON.parse(errorText);
            if (errObj.message) {
              message = errObj.message;
            } else if (errObj.error === 'party_full' || resp.status === 409) {
              message = `Party "${normCode}" is full (maximum 5 devices).`;
            }
          } catch {
            if (errorText) message = errorText;
          }
          throw new Error(message);
        }

        // Success! Use this server.
        this.serverUrl = server;
        const data = (await resp.json()) as JoinResponse;
        this.code = data.code;
        this.token = data.token;
        this.you = data.you;
        this.applySnapshot(data.party);
        this.connectWebSocket();
        return;
      } catch (err: any) {
        if (err.message?.includes('full')) {
          // A definitive error — don't try other servers
          this.setConnectionState('disconnected');
          this.emit('error', err.message);
          throw err;
        }
        lastError = err;
        // Network failure or 404 — try next server
        continue;
      }
    }

    // All servers exhausted
    this.setConnectionState('disconnected');
    const msg = `Party "${normCode}" was not found on any server.\n\nServers tried:\n${serversToTry.map(s => '  • ' + s).join('\n')}\n\nMake sure the party is active on your phone.`;
    this.emit('error', msg);
    throw new Error(msg);
  }

  public async createParty(options?: {
    displayName?: string;
    serverUrl?: string;
    maxMembers?: number;
  }): Promise<string> {
    if (options?.serverUrl) {
      this.setServerUrl(options.serverUrl);
    }

    this.isIntentionallyClosed = false;
    this.reconnectAttempts = 0;
    this.setConnectionState('connecting');

    try {
      const resp = await fetch(`${this.serverUrl}/api/parties`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: this.userId,
          deviceId: this.deviceId,
          displayName: options?.displayName || 'VS Code',
          maxMembers: options?.maxMembers || 5,
        }),
        signal: AbortSignal.timeout(10000),
      });

      if (!resp.ok) {
        const errorText = await resp.text();
        let message = `Failed to create party (HTTP ${resp.status})`;
        try {
          const errObj = JSON.parse(errorText);
          if (errObj.message) message = errObj.message;
        } catch {
          if (errorText) message = errorText;
        }
        throw new Error(message);
      }

      const data = (await resp.json()) as JoinResponse;
      this.code = data.code;
      this.token = data.token;
      this.you = data.you;
      this.applySnapshot(data.party);

      this.connectWebSocket();
      return data.code;
    } catch (err: any) {
      this.setConnectionState('disconnected');
      let msg = err.message || 'Failed to create party';
      if (msg.includes('fetch failed') || msg.includes('ECONNREFUSED')) {
        msg = `Cannot reach server at ${this.serverUrl}. Ensure the server is online or use Local Wi-Fi server.`;
      }
      this.emit('error', msg);
      throw new Error(msg);
    }
  }

  public async leaveParty(): Promise<void> {
    this.isIntentionallyClosed = true;
    const currentCode = this.code;
    const currentToken = this.token;

    this.cleanupSocket();

    if (currentCode && currentToken) {
      try {
        await fetch(`${this.serverUrl}/api/parties/${currentCode}/leave`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${currentToken}`,
          },
        });
      } catch {}
    }

    this.code = null;
    this.token = null;
    this.you = null;
    this.members = [];
    this.playback = {
      seq: 0,
      queueSeq: 0,
      queueLength: 0,
      queueIndex: -1,
      isPlaying: false,
      positionMs: 0,
      anchorMs: 0,
    };
    this.queue = { seq: 0, index: -1, items: [] };
    this.clock.reset();
    this.setConnectionState('disconnected');
    this.emit('trackChanged', null);
  }

  public play(positionMs?: number): void {
    const pos = positionMs ?? this.getCurrentPlayhead();
    this.sendControl({
      type: 'control',
      action: 'play',
      positionMs: Math.round(pos),
    });
  }

  public pause(positionMs?: number): void {
    const pos = positionMs ?? this.getCurrentPlayhead();
    this.sendControl({
      type: 'control',
      action: 'pause',
      positionMs: Math.round(pos),
    });
  }

  public togglePlayPause(): void {
    if (this.playback.isPlaying) {
      this.pause();
    } else {
      this.play();
    }
  }

  public seek(positionMs: number): void {
    this.sendControl({
      type: 'control',
      action: 'seek',
      positionMs: Math.max(0, Math.round(positionMs)),
    });
  }

  public next(): void {
    this.sendControl({
      type: 'control',
      action: 'next',
    });
  }

  public previous(): void {
    this.sendControl({
      type: 'control',
      action: 'previous',
    });
  }

  public setTrack(track: PartyTrack, positionMs: number = 0, isPlaying: boolean = true): void {
    this.sendControl({
      type: 'control',
      action: 'setTrack',
      track,
      positionMs: Math.max(0, Math.round(positionMs)),
      isPlaying,
    });
  }

  public queueAdd(tracks: PartyTrack[], playNext: boolean = false): void {
    this.sendControl({
      type: 'control',
      action: 'queueAdd',
      tracks,
      playNext,
    });
  }

  public queueRemove(videoId: string): void {
    this.sendControl({
      type: 'control',
      action: 'queueRemove',
      videoId,
    });
  }

  public queueClear(): void {
    this.sendControl({
      type: 'control',
      action: 'queueClear',
    });
  }

  public queueMove(fromIndex: number, toIndex: number, videoId?: string): void {
    this.sendControl({
      type: 'control',
      action: 'queueMove',
      fromIndex,
      toIndex,
      videoId,
    });
  }

  public setHostOnlyControl(enabled: boolean): void {
    this.sendControl({
      type: 'control',
      action: 'setHostOnlyControl',
      enabled,
    });
  }

  public kickMember(memberId: string): void {
    this.sendControl({
      type: 'control',
      action: 'kick',
      memberId,
    });
  }

  private connectWebSocket(): void {
    if (!this.code || !this.token) return;
    this.cleanupSocket();

    const wsUrl = this.serverUrl.replace(/^http/i, 'ws') + `/ws/parties/${this.code}`;

    try {
      this.ws = new WebSocket(wsUrl, {
        headers: {
          Authorization: `Bearer ${this.token}`,
        },
      });

      this.ws.on('open', () => {
        this.reconnectAttempts = 0;
        this.setConnectionState('connected');
        this.startPingLoop();
        this.startPlayheadTicker();
      });

      this.ws.on('message', (raw: WebSocket.RawData) => {
        this.handleMessage(raw.toString());
      });

      this.ws.on('close', (code, reason) => {
        this.cleanupSocket();
        if (!this.isIntentionallyClosed && this.code) {
          this.reconnectAttempts++;
          if (this.reconnectAttempts > 5) {
            this.setConnectionState('disconnected');
            this.emit('error', 'Lost connection to party server.');
            return;
          }
          this.setConnectionState('connecting');
          this.reconnectTimeout = setTimeout(() => {
            if (!this.isIntentionallyClosed && this.code) {
              this.connectWebSocket();
            }
          }, 3000);
        } else {
          this.setConnectionState('disconnected');
        }
      });

      this.ws.on('error', (err) => {
        this.emit('error', err.message || 'WebSocket connection error');
      });
    } catch (err: any) {
      this.emit('error', err.message || 'Failed to establish WebSocket');
      this.setConnectionState('disconnected');
    }
  }

  private handleMessage(jsonStr: string): void {
    try {
      const frame = JSON.parse(jsonStr) as ServerFrame;

      switch (frame.type) {
        case 'welcome': {
          this.you = frame.you;
          if (frame.serverMs) {
            const localNow = ServerClock.localNowMs();
            this.clock.record(localNow - 50, frame.serverMs, localNow);
          }
          this.applySnapshot(frame.party);
          break;
        }

        case 'pong': {
          const localNow = ServerClock.localNowMs();
          this.clock.record(frame.clientMs, frame.serverMs, localNow);
          this.emit('latencyChanged', this.clock.roundTripMs);
          break;
        }

        case 'state': {
          if (frame.serverMs && this.clock.offsetMs === null) {
            const localNow = ServerClock.localNowMs();
            this.clock.record(localNow - 50, frame.serverMs, localNow);
          }
          const getTrackKey = (t?: PartyTrack | null) =>
            t ? `${t.videoId || ''}|${t.title || ''}|${t.artist || ''}` : '';
          const oldTrackKey = getTrackKey(this.playback.track);

          if (frame.playback.seq <= this.lastAppliedSeq) {
            return;
          }
          this.lastAppliedSeq = frame.playback.seq;
          this.playback = frame.playback;

          if (frame.playback.queueSeq !== this.queue.seq) {
            this.sendFrame({ type: 'syncQueue' });
          }

          const newTrackKey = getTrackKey(this.playback.track);
          if (oldTrackKey !== newTrackKey) {
            this.emit('trackChanged', this.playback.track || null);
          }

          this.emit('stateChanged', this.playback, this.getCurrentPlayhead());
          break;
        }

        case 'queue': {
          this.queue = frame.queue;
          this.emit('queueChanged', this.queue);
          break;
        }

        case 'members': {
          this.members = frame.members;
          if (frame.hostOnlyControl !== undefined) {
            this.hostOnlyControl = frame.hostOnlyControl;
          }
          this.emit('membersChanged', this.members, this.hostOnlyControl);
          break;
        }

        case 'error': {
          this.emit('error', frame.message || frame.error);
          break;
        }

        case 'bye': {
          this.leaveParty();
          break;
        }
      }
    } catch {}
  }

  private applySnapshot(snapshot: PartySnapshot): void {
    if (snapshot.serverMs && this.clock.offsetMs === null) {
      const localNow = ServerClock.localNowMs();
      this.clock.record(localNow - 50, snapshot.serverMs, localNow);
    }
    this.members = snapshot.members || [];
    this.hostOnlyControl = !!snapshot.hostOnlyControl;
    this.lastAppliedSeq = snapshot.playback?.seq || 0;
    this.playback = snapshot.playback || this.playback;
    this.queue = snapshot.queue || this.queue;

    this.emit('membersChanged', this.members, this.hostOnlyControl);
    this.emit('queueChanged', this.queue);
    this.emit('stateChanged', this.playback, this.getCurrentPlayhead());
    this.emit('trackChanged', this.playback.track || null);
  }

  private sendControl(frame: ClientFrame): void {
    this.sendFrame(frame);
  }

  private sendFrame(frame: ClientFrame): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify(frame));
      } catch (err: any) {
        this.emit('error', err.message || 'Failed to send message to party');
      }
    }
  }

  private startPingLoop(): void {
    if (this.pingInterval) clearInterval(this.pingInterval);
    this.sendPing();

    this.pingInterval = setInterval(() => {
      this.sendPing();
    }, 12000);
  }

  private sendPing(): void {
    const clientMs = ServerClock.localNowMs();
    this.sendFrame({ type: 'ping', clientMs });
  }

  private startPlayheadTicker(): void {
    if (this.playheadTicker) clearInterval(this.playheadTicker);
    this.playheadTicker = setInterval(() => {
      if (this.playback.isPlaying && this.connectionState === 'connected') {
        const current = this.getCurrentPlayhead();
        this.emit('stateChanged', this.playback, current);
      }
    }, 500);
  }

  private cleanupSocket(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    if (this.playheadTicker) {
      clearInterval(this.playheadTicker);
      this.playheadTicker = null;
    }
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    if (this.ws) {
      this.ws.on('error', () => {});
      this.ws.removeAllListeners();
      try {
        this.ws.close();
      } catch {}
      this.ws = null;
    }
  }

  private setConnectionState(state: ConnectionState): void {
    if (this.connectionState !== state) {
      this.connectionState = state;
      this.emit('connectionStateChanged', state, this.clock.roundTripMs);
    }
  }
}
