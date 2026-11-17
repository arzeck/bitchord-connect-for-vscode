/**
 * VS Code Status Bar Controller for BitChord
 */

import * as vscode from 'vscode';
import { BitChordPartyClient } from '../client/BitChordPartyClient.js';

function formatDuration(ms: number): string {
  if (!ms || ms < 0 || isNaN(ms)) return '00:00';
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

export class StatusBarController implements vscode.Disposable {
  private statusBarItem: vscode.StatusBarItem;
  private client: BitChordPartyClient;
  private enabled: boolean = true;

  constructor(client: BitChordPartyClient) {
    this.client = client;
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100
    );
    this.statusBarItem.command = 'bitchord.focusView';

    const config = vscode.workspace.getConfiguration('bitchord');
    this.enabled = config.get<boolean>('showStatusBar', true);

    this.registerListeners();
    this.update();
  }

  private registerListeners(): void {
    this.client.on('stateChanged', () => this.update());
    this.client.on('connectionStateChanged', () => this.update());
    this.client.on('trackChanged', () => this.update());

    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('bitchord.showStatusBar')) {
        const config = vscode.workspace.getConfiguration('bitchord');
        this.enabled = config.get<boolean>('showStatusBar', true);
        this.update();
      }
    });
  }

  public update(): void {
    if (!this.enabled) {
      this.statusBarItem.hide();
      return;
    }

    if (this.client.connectionState === 'disconnected') {
      this.statusBarItem.text = '$(radio-tower) BitChord: Offline';
      this.statusBarItem.tooltip = 'BitChord Listen Together is offline. Click to join or create a party.';
      this.statusBarItem.show();
      return;
    }

    if (this.client.connectionState === 'connecting') {
      this.statusBarItem.text = '$(sync~spin) BitChord: Connecting…';
      this.statusBarItem.tooltip = `Connecting to ${this.client.serverUrl}…`;
      this.statusBarItem.show();
      return;
    }

    const track = this.client.playback.track;
    const isPlaying = this.client.playback.isPlaying;
    const playhead = this.client.getCurrentPlayhead();
    const duration = track?.durationMs || 0;

    const icon = isPlaying ? '$(play)' : '$(debug-pause)';
    const room = this.client.code ? `[${this.client.code}] ` : '';

    if (track) {
      const timeStr = `${formatDuration(playhead)} / ${formatDuration(duration)}`;
      this.statusBarItem.text = `${icon} ${track.title} - ${track.artist} (${timeStr})`;
      this.statusBarItem.tooltip = `${room}${track.title}\nArtist: ${track.artist}\nPing: ${this.client.clock.roundTripMs}ms\nClick to open BitChord`;
    } else {
      this.statusBarItem.text = `${icon} BitChord ${room}(No track playing)`;
      this.statusBarItem.tooltip = `Connected to room ${this.client.code}. Click to open BitChord.`;
    }

    this.statusBarItem.show();
  }

  public dispose(): void {
    this.statusBarItem.dispose();
  }
}
