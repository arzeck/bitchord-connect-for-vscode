/**
 * BitChord Webview View Provider
 * Bridges VS Code Webview with the BitChordPartyClient, LocalPartyServer, and LyricsRepository.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { BitChordPartyClient } from '../client/BitChordPartyClient.js';
import { LyricsRepository } from '../lyrics/LyricsRepository.js';
import { LocalPartyServer } from '../server/LocalPartyServer.js';
import { LyricResult } from '../lyrics/sources.js';
import { extractCodeAndServer } from '../protocol/codes.js';
import { resolveAudioStream } from '../playback/StreamResolver.js';
import { AudioProxyServer } from '../playback/AudioProxyServer.js';

export class BitChordViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'bitchord.sidebarView';
  private _view?: vscode.WebviewView;
  private client: BitChordPartyClient;
  private lyricsRepo: LyricsRepository;
  private localServer: LocalPartyServer;
  private audioProxy?: AudioProxyServer;
  private extensionUri: vscode.Uri;
  private currentLyricResult: LyricResult | null = null;
  private availableLyricSources: Map<string, LyricResult> = new Map();
  private lastFetchedTrackKey: string = '';
  private currentStreamUrl: string | null = null;
  private currentStreamVideoId: string | null = null;

  constructor(
    extensionUri: vscode.Uri,
    client: BitChordPartyClient,
    lyricsRepo: LyricsRepository,
    localServer: LocalPartyServer,
    audioProxy?: AudioProxyServer
  ) {
    this.extensionUri = extensionUri;
    this.client = client;
    this.lyricsRepo = lyricsRepo;
    this.localServer = localServer;
    this.audioProxy = audioProxy;

    this.registerClientListeners();
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };

    webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (message) => {
      await this.handleWebviewMessage(message);
    });

    // Send initial state once webview is ready
    this.sendFullState();
  }

  private registerClientListeners(): void {
    this.client.on('connectionStateChanged', (state, roundTripMs) => {
      this.postMessage({
        type: 'CONNECTION_UPDATE',
        state,
        code: this.client.code,
        roundTripMs,
        serverUrl: this.client.serverUrl,
        you: this.client.you,
      });

      if (state === 'connected') {
        this.sendFullState();
      }
    });

    this.client.on('latencyChanged', (roundTripMs) => {
      this.postMessage({
        type: 'LATENCY_UPDATE',
        roundTripMs,
      });
    });

    this.client.on('stateChanged', (playback, playheadMs) => {
      this.postMessage({
        type: 'STATE_UPDATE',
        playback,
        playheadMs,
        roundTripMs: this.client.clock.roundTripMs,
      });

      this.postMessage({
        type: 'LYRICS_PROGRESS',
        playheadMs,
      });
    });

    this.client.on('queueChanged', (queue) => {
      this.postMessage({
        type: 'QUEUE_UPDATE',
        queue,
      });
    });

    this.client.on('membersChanged', (members, hostOnlyControl) => {
      this.postMessage({
        type: 'MEMBERS_UPDATE',
        members,
        hostOnlyControl,
      });
    });

    this.client.on('trackChanged', (track) => {
      this.onTrackChanged(track);
    });

    this.client.on('error', (errorMessage) => {
      this.postMessage({
        type: 'ERROR',
        message: errorMessage,
      });
    });
  }

  private async onTrackChanged(track: any): Promise<void> {
    if (!track) {
      this.currentLyricResult = null;
      this.availableLyricSources.clear();
      this.currentStreamUrl = null;
      this.currentStreamVideoId = null;
      this.postMessage({
        type: 'LYRICS_UPDATE',
        lyrics: null,
      });
      return;
    }

    const key = this.lyricsRepo.getTrackKey(
      track.title,
      track.artist,
      track.durationMs,
      track.videoId
    );

    if (this.lastFetchedTrackKey === key) return;
    this.lastFetchedTrackKey = key;

    // Reset lyrics cache for new track so webview drops previous lyrics immediately
    this.currentLyricResult = null;
    this.availableLyricSources.clear();
    this.currentStreamUrl = null;
    this.currentStreamVideoId = track.videoId || null;
    this.postMessage({
      type: 'LYRICS_UPDATE',
      lyrics: null,
    });

    this.postMessage({
      type: 'LYRICS_LOADING',
      title: track.title,
      artist: track.artist,
    });

    // Resolve and stream audio track in the webview
    if (this.audioProxy) {
      const streamUrl = this.audioProxy.getStreamUrl(track.videoId, track.title, track.artist);
      this.currentStreamUrl = streamUrl;
      this.currentStreamVideoId = track.videoId || null;
      this.postMessage({
        type: 'STREAM_UPDATE',
        streamUrl,
        videoId: track.videoId,
        title: track.title,
      });
    } else {
      resolveAudioStream(track.title, track.artist, track.videoId).then((streamUrl) => {
        if (streamUrl) {
          this.currentStreamUrl = streamUrl;
          this.currentStreamVideoId = track.videoId || null;
          this.postMessage({
            type: 'STREAM_UPDATE',
            streamUrl,
            videoId: track.videoId,
            title: track.title,
          });
        }
      });
    }

    const res = await this.lyricsRepo.fetchLyrics(
      {
        title: track.title,
        artist: track.artist,
        durationMs: track.durationMs,
        videoId: track.videoId,
      },
      (best, all) => {
        this.currentLyricResult = best;
        this.availableLyricSources = all;
        this.broadcastLyrics();
      }
    );

    this.currentLyricResult = res.activeResult;
    this.availableLyricSources = res.allResults;
    this.broadcastLyrics();
  }

  private broadcastLyrics(): void {
    const sources = Array.from(this.availableLyricSources.values()).map((s) => ({
      source: s.source,
      label: s.label,
      isWordSynced: s.isWordSynced,
    }));

    this.postMessage({
      type: 'LYRICS_UPDATE',
      lyrics: this.currentLyricResult
        ? {
            source: this.currentLyricResult.source,
            label: this.currentLyricResult.label,
            isWordSynced: this.currentLyricResult.isWordSynced,
            lines: this.currentLyricResult.lines,
            rawTtml: this.currentLyricResult.rawTtml,
          }
        : null,
      sources,
    });
  }

  private async handleWebviewMessage(message: any): Promise<void> {
    switch (message.type) {
      case 'READY': {
        this.sendFullState();
        this.probeServerHealth(message.serverUrl || this.client.serverUrl);
        break;
      }

      case 'PROBE_SERVER': {
        this.probeServerHealth(message.serverUrl);
        break;
      }

      case 'TOGGLE_LOCAL_SERVER': {
        try {
          if (this.localServer.isRunning) {
            await this.localServer.stop();
            vscode.window.showInformationMessage('Local party server stopped.');
          } else {
            const url = await this.localServer.start();
            vscode.window.showInformationMessage(`Local party server started at: ${url}`);
          }
          this.postMessage({
            type: 'LOCAL_SERVER_STATUS',
            isRunning: this.localServer.isRunning,
            url: this.localServer.getBaseUrl(),
            ip: this.localServer.getLocalIp(),
            port: this.localServer.port,
          });
        } catch (err: any) {
          vscode.window.showErrorMessage(`Failed to toggle local server: ${err.message}`);
        }
        break;
      }

      case 'JOIN': {
        const parsed = extractCodeAndServer(message.code);
        if (!parsed) {
          this.postMessage({ type: 'ERROR', message: 'Please enter a valid 6-character party code or invite link.' });
          vscode.window.showErrorMessage('Please enter a valid 6-character party code or invite link.');
          return;
        }

        const config = vscode.workspace.getConfiguration('bitchord');
        const defaultServer = config.get<string>('serverUrl') || 'https://bitchord-listen-together.onrender.com';
        const displayName = config.get<string>('displayName') || 'VS Code';

        // Target server: parsed invite link server wins first, then custom UI server if specified, then default
        const targetServer = parsed.serverUrl || message.serverUrl || defaultServer;

        try {
          await this.client.joinParty(parsed.code, {
            serverUrl: targetServer,
            displayName,
          });
          vscode.window.showInformationMessage(`Joined BitChord party: ${parsed.code}`);
        } catch (err: any) {
          this.postMessage({ type: 'ERROR', message: err.message || 'Failed to join party' });
          vscode.window.showErrorMessage(`Failed to join party: ${err.message}`);
        }
        break;
      }

      case 'CREATE': {
        const config = vscode.workspace.getConfiguration('bitchord');
        const defaultServer = config.get<string>('serverUrl') || 'https://bitchord-listen-together.onrender.com';
        const displayName = config.get<string>('displayName') || 'VS Code';
        const targetServer = message.serverUrl || defaultServer;

        try {
          const code = await this.client.createParty({
            serverUrl: targetServer,
            displayName,
          });
          vscode.window.showInformationMessage(`Created BitChord party: ${code}`);
        } catch (err: any) {
          this.postMessage({ type: 'ERROR', message: err.message || 'Failed to create party' });
          vscode.window.showErrorMessage(`Failed to create party: ${err.message}`);
        }
        break;
      }

      case 'LEAVE': {
        await this.client.leaveParty();
        vscode.window.showInformationMessage('Left BitChord party.');
        break;
      }

      case 'PLAY': {
        this.client.play(message.positionMs);
        break;
      }

      case 'PAUSE': {
        this.client.pause(message.positionMs);
        break;
      }

      case 'TOGGLE_PLAY_PAUSE': {
        this.client.togglePlayPause();
        break;
      }

      case 'SEEK': {
        this.client.seek(message.positionMs);
        break;
      }

      case 'NEXT': {
        this.client.next();
        break;
      }

      case 'PREV': {
        this.client.previous();
        break;
      }

      case 'QUEUE_REMOVE': {
        if (message.videoId) {
          this.client.queueRemove(message.videoId);
        }
        break;
      }

      case 'QUEUE_MOVE': {
        this.client.queueMove(message.fromIndex, message.toIndex, message.videoId);
        break;
      }

      case 'QUEUE_CLEAR': {
        this.client.queueClear();
        break;
      }

      case 'SELECT_LYRICS_SOURCE': {
        if (message.source && this.availableLyricSources.has(message.source)) {
          this.currentLyricResult = this.availableLyricSources.get(message.source)!;
          this.broadcastLyrics();
        }
        break;
      }

      case 'COPY_INVITE': {
        if (this.client.code) {
          let inviteUrl = `https://bitchord.kushagrasingh.in/invite/${this.client.code}`;
          if (this.client.serverUrl && !this.client.serverUrl.includes('bitchord-listen-together.onrender.com')) {
            inviteUrl += `?server=${encodeURIComponent(this.client.serverUrl)}`;
          }
          await vscode.env.clipboard.writeText(inviteUrl);
          vscode.window.showInformationMessage(`Party invite link copied to clipboard: ${inviteUrl}`);
        }
        break;
      }
    }
  }

  public async probeServerHealth(serverUrl: string): Promise<void> {
    const raw = (serverUrl || this.client.serverUrl).trim().replace(/\/+$/, '');
    this.postMessage({ type: 'SERVER_HEALTH', status: 'checking', serverUrl: raw });

    const start = Date.now();
    try {
      const res = await fetch(`${raw}/healthz`, { signal: AbortSignal.timeout(6000) });
      const elapsed = Date.now() - start;
      if (res.ok) {
        this.postMessage({
          type: 'SERVER_HEALTH',
          status: 'online',
          latencyMs: elapsed,
          serverUrl: raw,
        });
      } else {
        this.postMessage({
          type: 'SERVER_HEALTH',
          status: 'offline',
          error: `HTTP ${res.status}`,
          serverUrl: raw,
        });
      }
    } catch (err: any) {
      this.postMessage({
        type: 'SERVER_HEALTH',
        status: 'offline',
        error: err.message || 'Cannot connect',
        serverUrl: raw,
      });
    }
  }

  public sendFullState(): void {
    this.postMessage({
      type: 'INIT',
      state: this.client.connectionState,
      code: this.client.code,
      serverUrl: this.client.serverUrl,
      roundTripMs: this.client.clock.roundTripMs,
      you: this.client.you,
      playback: this.client.playback,
      queue: this.client.queue,
      members: this.client.members,
      hostOnlyControl: this.client.hostOnlyControl,
      playheadMs: this.client.getCurrentPlayhead(),
    });

    this.postMessage({
      type: 'LOCAL_SERVER_STATUS',
      isRunning: this.localServer.isRunning,
      url: this.localServer.getBaseUrl(),
      ip: this.localServer.getLocalIp(),
      port: this.localServer.port,
    });

    if (this.currentLyricResult) {
      this.broadcastLyrics();
    }

    if (this.client.playback?.track) {
      const trk = this.client.playback.track;
      if (this.audioProxy) {
        const streamUrl = this.audioProxy.getStreamUrl(trk.videoId, trk.title, trk.artist);
        this.currentStreamUrl = streamUrl;
        this.currentStreamVideoId = trk.videoId || null;
        this.postMessage({
          type: 'STREAM_UPDATE',
          streamUrl,
          videoId: trk.videoId,
          title: trk.title,
        });
      } else if (this.currentStreamUrl && (!trk.videoId || this.currentStreamVideoId === trk.videoId)) {
        this.postMessage({
          type: 'STREAM_UPDATE',
          streamUrl: this.currentStreamUrl,
          videoId: trk.videoId,
          title: trk.title,
        });
      } else {
        resolveAudioStream(trk.title, trk.artist, trk.videoId).then((streamUrl) => {
          if (streamUrl) {
            this.currentStreamUrl = streamUrl;
            this.currentStreamVideoId = trk.videoId || null;
            this.postMessage({
              type: 'STREAM_UPDATE',
              streamUrl,
              videoId: trk.videoId,
              title: trk.title,
            });
          }
        });
      }
    }
  }

  private postMessage(data: any): void {
    if (this._view) {
      this._view.webview.postMessage(data);
    }
  }

  private getHtmlForWebview(webview: vscode.Webview): string {
    let uiDir = path.join(this.extensionUri.fsPath, 'dist', 'webview');
    if (!fs.existsSync(uiDir)) {
      uiDir = path.join(this.extensionUri.fsPath, 'src', 'webview', 'ui');
    }
    const htmlPath = path.join(uiDir, 'index.html');

    const stylesUri = webview.asWebviewUri(
      vscode.Uri.file(path.join(uiDir, 'styles.css'))
    );
    const fontsUri = webview.asWebviewUri(
      vscode.Uri.file(path.join(uiDir, 'fonts'))
    );
    const appUri = webview.asWebviewUri(
      vscode.Uri.file(path.join(uiDir, 'app.js'))
    );
    const amLyricsUri = webview.asWebviewUri(
      vscode.Uri.file(path.join(uiDir, 'am-lyrics.js'))
    );

    let html = fs.readFileSync(htmlPath, 'utf8');
    html = html.replace(/\{\{CSP_SOURCE\}\}/g, webview.cspSource);
    html = html.replace('{{STYLES_URI}}', stylesUri.toString());
    html = html.replace(/\{\{FONTS_URI\}\}/g, fontsUri.toString());
    html = html.replace('{{AM_LYRICS_URI}}', amLyricsUri.toString());
    html = html.replace('{{APP_URI}}', appUri.toString());
    return html;
  }
}
