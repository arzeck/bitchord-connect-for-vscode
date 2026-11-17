# BitChord Connect for VS Code 🎵

Connect Visual Studio Code directly to your **BitChord** Android music app using the **Listen Together** synchronization protocol.

Monitor live playback, manage the upcoming queue, control playback from your editor, and sing along with real-time **word/syllable-level synchronized karaoke lyrics** (ported directly from `yt-music-better`).

---

## ✨ Features

- **🔗 Real-Time Synchronization with BitChord Android**:
  - Connects to BitChord party servers using WebSocket and monotonic NTP-style clock sync.
  - Zero-drift playhead arithmetic (`positionMs + (serverNow - anchorMs)`).
  - Sequence guard ensures out-of-order frames never cause playback oscillations.

- **📻 Now Playing Showcase**:
  - High-res album artwork, title marquee, artist name, and attribution ("Added by Kabir").
  - Interactive scrub slider with smooth live progress.
  - Controls: Previous Track, Seek -10s, Play/Pause Toggle, Seek +10s, Next Track.

- **🎤 Synced Karaoke Lyrics (Ported from `yt-music-better`)**:
  - Multi-source racing across **lrc.red**, **BiniLyrics**, **BetterLyrics**, **SimpMusic**, and **LRCLIB**.
  - **Word/Syllable-Level Karaoke**: As the music plays, sung syllables glow and lift off the floor with smooth Hermite easing.
  - **Click-to-Seek**: Click on any lyric line to jump the song to that exact timestamp on your Android phone and all devices in the party!
  - **Auto-Scroll**: Automatically centers the sung line in the viewport. Temporarily disengages if you manually scroll to read ahead.
  - **Subtext**: Includes romanised text and translations where available.
  - **Instrumental Gaps**: Displays pulsating breathing dots during instrumental breaks ($\ge 4\text{s}$).

- **📋 Upcoming Queue**:
  - Live view of upcoming songs in the party.
  - Highlights currently active track.
  - Remove songs from the party queue or clear upcoming tracks.

- **👥 Party Members**:
  - Real-time list of connected devices, member display names, and host indicators.
  - One-click invite link copying: `https://bitchord.kushagrasingh.in/invite/<CODE>`.

- **⚡ Status Bar Controller**:
  - Compact status bar widget in VS Code:
    `$(play) Song Name - Artist (01:23 / 03:45) [Room: 7A9K2M]`
  - Clicking focuses the Listen Together sidebar.

---

## 🚀 Getting Started

### 1. Connect to an Existing Party
1. Open the **BitChord** app on your Android device and tap **Listen Together**.
2. Create or join a party to generate a 6-character room code (e.g., `7A9K2M`).
3. In VS Code, click the **BitChord** icon in the Activity Bar.
4. Enter the 6-character code (or paste the invite link) and click **Join Party**.

### 2. Create a Party from VS Code
1. Open the **BitChord** sidebar.
2. Click **Create Party**.
3. Copy the 6-character code or share the invite link with your phone or friends.

### 3. Local Wi-Fi Direct Connection (Zero Latency & Reliable)
If your phone is on the same Wi-Fi network as your PC and Render is slow or timing out:
1. In the BitChord sidebar, expand **"Start Local Party Server (Wi-Fi)"**.
2. Click **Start Server on Port 8000**.
3. In the BitChord Android app: Go to **Settings ➔ Listen Together / Party Server** (or your app's custom server setting) and set it to:
   `http://<YOUR_PC_LAN_IP>:8000` (the exact URL will be displayed in the sidebar).
4. Now both VS Code and your phone connect locally over Wi-Fi with sub-millisecond latency!

---

## ⚙️ Configuration Settings

Customize BitChord Connect in VS Code Settings (`Ctrl+,` / `Cmd+,` searching for `BitChord`):

| Setting | Default | Description |
|---|---|---|
| `bitchord.serverUrl` | `https://bitchord-listen-together.onrender.com` | Party server URL for Listen Together. Can be set to a custom self-hosted server. |
| `bitchord.displayName` | `VS Code` | Member display name shown in the party members list. |
| `bitchord.autoConnect` | `true` | Automatically reconnect to the previous party when VS Code launches. |
| `bitchord.showStatusBar` | `true` | Toggle the bottom status bar now-playing widget. |

---

## ⌨️ Command Palette Commands

- `BitChord: Join Party` (`bitchord.joinParty`)
- `BitChord: Create Party` (`bitchord.createParty`)
- `BitChord: Leave Party` (`bitchord.leaveParty`)
- `BitChord: Play / Pause` (`bitchord.togglePlayPause`)
- `BitChord: Next Track` (`bitchord.nextTrack`)
- `BitChord: Previous Track` (`bitchord.previousTrack`)
- `BitChord: Open Listen Together` (`bitchord.focusView`)

---

## 🛠️ Development & Building

```bash
# Install dependencies
npm install

# Run unit tests
npm test

# Build bundle
npm run compile

# Watch mode for development
npm run watch
```

Press `F5` in VS Code to launch the Extension Development Host and test the extension live.
