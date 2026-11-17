/**
 * BitChord Connect for VS Code
 * Extension Entry Point
 */

import * as vscode from 'vscode';
import { BitChordPartyClient } from './client/BitChordPartyClient.js';
import { LyricsRepository } from './lyrics/LyricsRepository.js';
import { StatusBarController } from './statusbar/StatusBarController.js';
import { BitChordViewProvider } from './webview/BitChordViewProvider.js';
import { LocalPartyServer } from './server/LocalPartyServer.js';
import { AudioProxyServer } from './playback/AudioProxyServer.js';
import { extractCodeAndServer } from './protocol/codes.js';

let client: BitChordPartyClient;
let lyricsRepo: LyricsRepository;
let statusBar: StatusBarController;
let viewProvider: BitChordViewProvider;
let localServer: LocalPartyServer;
let audioProxy: AudioProxyServer;

export function activate(context: vscode.ExtensionContext) {
  const config = vscode.workspace.getConfiguration('bitchord');
  const serverUrl = config.get<string>('serverUrl') || 'https://bitchord-listen-together.onrender.com';
  const displayName = config.get<string>('displayName') || 'VS Code';

  client = new BitChordPartyClient(serverUrl);
  lyricsRepo = new LyricsRepository();
  localServer = new LocalPartyServer();
  audioProxy = new AudioProxyServer();

  // Start background loopback audio proxy
  audioProxy.start().catch((err) => {
    console.warn('[BitChord] Failed to start local AudioProxyServer:', err);
  });

  statusBar = new StatusBarController(client);
  viewProvider = new BitChordViewProvider(context.extensionUri, client, lyricsRepo, localServer, audioProxy);

  // Register Webview View Provider in Activity Bar
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(BitChordViewProvider.viewType, viewProvider)
  );

  context.subscriptions.push(statusBar);

  // Save last party code in workspace state
  client.on('connectionStateChanged', (state) => {
    if (state === 'connected' && client.code) {
      context.globalState.update('bitchord.lastCode', client.code);
    } else if (state === 'disconnected') {
      context.globalState.update('bitchord.lastCode', undefined);
    }
  });

  // ─── Register Commands ─────────────────────────────────────────────────────

  // 1. Join Party Command
  context.subscriptions.push(
    vscode.commands.registerCommand('bitchord.joinParty', async () => {
      const input = await vscode.window.showInputBox({
        prompt: 'Enter 6-character BitChord party code or invite link',
        placeHolder: 'e.g. 7A9K2M or https://bitchord.kushagrasingh.in/invite/7A9K2M',
      });

      if (!input) return;

      const parsed = extractCodeAndServer(input);
      if (!parsed) {
        vscode.window.showErrorMessage('Invalid BitChord party code or link.');
        return;
      }

      try {
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `Joining BitChord party ${parsed.code}…`,
            cancellable: false,
          },
          async () => {
            await client.joinParty(parsed.code, {
              serverUrl: parsed.serverUrl || client.serverUrl,
              displayName,
            });
          }
        );
        vscode.window.showInformationMessage(`Connected to BitChord party: ${parsed.code}`);
      } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to join party: ${err.message}`);
      }
    })
  );

  // 2. Create Party Command
  context.subscriptions.push(
    vscode.commands.registerCommand('bitchord.createParty', async () => {
      try {
        let code = '';
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: 'Creating BitChord party…',
            cancellable: false,
          },
          async () => {
            code = await client.createParty({
              serverUrl: client.serverUrl,
              displayName,
            });
          }
        );

        const copyAction = 'Copy Invite Link';
        const choice = await vscode.window.showInformationMessage(
          `Created BitChord party: ${code}`,
          copyAction
        );

        if (choice === copyAction) {
          let inviteUrl = `https://bitchord.kushagrasingh.in/invite/${code}`;
          if (client.serverUrl && !client.serverUrl.includes('bitchord-listen-together.onrender.com')) {
            inviteUrl += `?server=${encodeURIComponent(client.serverUrl)}`;
          }
          await vscode.env.clipboard.writeText(inviteUrl);
        }
      } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to create party: ${err.message}`);
      }
    })
  );

  // 3. Leave Party Command
  context.subscriptions.push(
    vscode.commands.registerCommand('bitchord.leaveParty', async () => {
      await client.leaveParty();
      vscode.window.showInformationMessage('Left BitChord party.');
    })
  );

  // 4. Toggle Play / Pause
  context.subscriptions.push(
    vscode.commands.registerCommand('bitchord.togglePlayPause', () => {
      if (client.connectionState !== 'connected') {
        vscode.window.showWarningMessage('Not connected to any BitChord party.');
        return;
      }
      client.togglePlayPause();
    })
  );

  // 5. Next Track
  context.subscriptions.push(
    vscode.commands.registerCommand('bitchord.nextTrack', () => {
      if (client.connectionState !== 'connected') return;
      client.next();
    })
  );

  // 6. Previous Track
  context.subscriptions.push(
    vscode.commands.registerCommand('bitchord.previousTrack', () => {
      if (client.connectionState !== 'connected') return;
      client.previous();
    })
  );

  // 7. Focus Sidebar View
  context.subscriptions.push(
    vscode.commands.registerCommand('bitchord.focusView', () => {
      vscode.commands.executeCommand('bitchord.sidebarView.focus');
    })
  );

  // 8. Start Local Server Command
  context.subscriptions.push(
    vscode.commands.registerCommand('bitchord.startLocalServer', async () => {
      try {
        const url = await localServer.start();
        vscode.window.showInformationMessage(`BitChord local party server started at: ${url}`);
      } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to start local server: ${err.message}`);
      }
    })
  );

  // ─── Auto-Reconnect ────────────────────────────────────────────────────────
  const autoConnect = config.get<boolean>('autoConnect', true);
  const lastCode = context.globalState.get<string>('bitchord.lastCode');

  if (autoConnect && lastCode) {
    client.joinParty(lastCode, { displayName }).catch(() => {
      // Stale room ignored on launch
    });
  }
}

export function deactivate() {
  if (client) {
    client.leaveParty();
  }
  if (localServer) {
    localServer.stop();
  }
  if (audioProxy) {
    audioProxy.stop();
  }
}
