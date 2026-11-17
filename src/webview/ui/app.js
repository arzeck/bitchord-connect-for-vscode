// BitChord Connect Webview Application - Faithful BitChord Mobile UX

(function () {
  'use strict';

  const vscode = acquireVsCodeApi();

  // ─── DOM References ──────────────────────────────────────────────────────────
  const ambientBackdrop = document.getElementById('ambient-backdrop');
  const errorBanner = document.getElementById('error-banner');
  const errorMessage = document.getElementById('error-message');
  const btnDismissError = document.getElementById('btn-dismiss-error');

  const offlineView = document.getElementById('offline-view');
  const connectedView = document.getElementById('connected-view');

  // Screens
  const screenPlayer = document.getElementById('screen-player');
  const screenLyrics = document.getElementById('screen-lyrics');
  const screenQueue = document.getElementById('screen-queue');
  const screenMembers = document.getElementById('screen-members');

  // Offline / Server Controls
  const serverDot = document.getElementById('server-dot');
  const serverHealthText = document.getElementById('server-health-text');
  const serverUrlDisplay = document.getElementById('server-url-display');
  const btnRecheckServer = document.getElementById('btn-recheck-server');

  const btnToggleLocal = document.getElementById('btn-toggle-local');
  const localServerBadge = document.getElementById('local-server-badge');
  const localServerInstructions = document.getElementById('local-server-instructions');
  const localServerUrlCode = document.getElementById('local-server-url-code');
  const btnUseLocal = document.getElementById('btn-use-local');

  const roomCodeInput = document.getElementById('room-code-input');
  const serverUrlInput = document.getElementById('server-url-input');
  const btnPresetOfficial = document.getElementById('btn-preset-official');
  const btnPresetDefault = document.getElementById('btn-preset-default');
  const btnPresetLocal = document.getElementById('btn-preset-local');
  const btnJoin = document.getElementById('btn-join');
  const btnCreate = document.getElementById('btn-create');

  const ICON_LINK_SVG = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';
  const ICON_SPARKLE_SVG = '<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M12 2l2.4 5.4L20 8.5l-4 4.2 1 6-5-3-5 3 1-6-4-4.2 5.6-1.1L12 2z"/></svg>';

  // Header
  const roomCodeText = document.getElementById('room-code-text');
  const btnCopyCode = document.getElementById('btn-copy-code');
  const latencyText = document.getElementById('latency-text');
  const btnLeave = document.getElementById('btn-leave');

  // Player Screen Elements
  const heroArtWrapper = document.getElementById('hero-art-wrapper');
  const trackArt = document.getElementById('track-art');
  const artPlaceholder = document.getElementById('art-placeholder');
  const trackTitle = document.getElementById('track-title');
  const trackArtist = document.getElementById('track-artist');
  const trackAttribution = document.getElementById('track-attribution');
  const startedByName = document.getElementById('started-by-name');
  const btnFavorite = document.getElementById('btn-favorite');
  const btnOptions = document.getElementById('btn-options');

  const liveLyricBar = document.getElementById('live-lyric-bar');
  const liveLyricText = document.getElementById('live-lyric-text');

  const seekSlider = document.getElementById('seek-slider');
  const timeCurrent = document.getElementById('time-current');
  const timeRemaining = document.getElementById('time-remaining');

  const btnPrev = document.getElementById('btn-prev');
  const btnPlayPause = document.getElementById('btn-play-pause');
  const iconPlay = document.getElementById('icon-play');
  const iconPause = document.getElementById('icon-pause');
  const btnNext = document.getElementById('btn-next');

  // Bottom Action Bar
  const btnNavLyrics = document.getElementById('btn-nav-lyrics');
  const btnPartyPill = document.getElementById('btn-party-pill');
  const partyCount = document.getElementById('party-count');
  const partySublabel = document.getElementById('party-sublabel');
  const btnNavQueue = document.getElementById('btn-nav-queue');

  // Lyrics Screen Elements
  const lyricsDragHandle = document.getElementById('lyrics-drag-handle');
  const miniTrackInfo = document.getElementById('mini-track-info');
  const miniTrackArt = document.getElementById('mini-track-art');
  const miniTrackTitle = document.getElementById('mini-track-title');
  const miniTrackArtist = document.getElementById('mini-track-artist');
  const miniBtnFavorite = document.getElementById('mini-btn-favorite');
  const miniBtnShare = document.getElementById('mini-btn-share') || document.getElementById('btn-close-lyrics');
  const lyricsPlaceholder = document.getElementById('lyrics-placeholder');
  const amLyrics = document.getElementById('am-lyrics-player');

  // Queue Screen Elements
  const btnQueueClear = document.getElementById('btn-queue-clear');
  const btnCloseQueue = document.getElementById('btn-close-queue');
  const queueList = document.getElementById('queue-list');

  // Members Screen Elements
  const btnCloseMembers = document.getElementById('btn-close-members');
  const btnCopyCodeCard = document.getElementById('btn-copy-code-card');
  const roomCodeCardText = document.getElementById('room-code-card-text');
  const partyServerCardText = document.getElementById('party-server-card-text');
  const membersList = document.getElementById('members-list');
  const btnToggleAudio = document.getElementById('btn-toggle-audio');

  // ─── Native Audio Playback Engine (PartySync architecture) ───────────────────
  const partyAudio = document.getElementById('bitchord-audio') || new Audio();
  partyAudio.preload = 'auto';
  let isAudioMuted = false;

  partyAudio.addEventListener('error', () => {
    console.error('[BitChord Audio] Playback error code:', partyAudio.error?.code, partyAudio.error?.message);
  });

  // User Gesture Unlocker for Chromium/Electron Autoplay Restrictions
  function unlockAudioPlayback() {
    if (partyAudio && partyAudio.src && !isAudioMuted && playback && playback.isPlaying && partyAudio.paused) {
      partyAudio.play().then(() => {
        console.log('[BitChord Audio] Audio playback unlocked by user interaction');
      }).catch((e) => {
        console.warn('[BitChord Audio] Unlock play deferred:', e.message);
      });
    }
  }

  window.addEventListener('pointerdown', unlockAudioPlayback, { passive: true });
  window.addEventListener('click', unlockAudioPlayback, { passive: true });
  window.addEventListener('keydown', unlockAudioPlayback, { passive: true });

  // ─── Local State ─────────────────────────────────────────────────────────────
  let connectionState = 'disconnected';
  let currentRoomCode = '';
  let currentScreen = 'player'; // 'player' | 'lyrics' | 'queue' | 'members'
  let isFavorite = false;

  let playback = {
    isPlaying: false,
    positionMs: 0,
    anchorMs: 0,
    seq: 0,
    track: null,
    startedByName: null,
  };
  let basePlayheadMs = 0;
  let baseAnchorTime = performance.now();
  let currentPlayhead = 0;
  let isDraggingSeek = false;
  let currentLyrics = null;

  function formatTime(ms) {
    if (!ms || ms < 0 || isNaN(ms)) return '0:00';
    const totalSec = Math.floor(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  function showError(msg) {
    if (!msg) return;
    errorMessage.textContent = msg;
    errorBanner.classList.remove('hidden');
  }

  function hideError() {
    errorBanner.classList.add('hidden');
  }

  btnDismissError?.addEventListener('click', hideError);

  // ─── Screen Switching Navigation ─────────────────────────────────────────────
  function showScreen(screenId) {
    currentScreen = screenId;
    const screens = {
      player: screenPlayer,
      lyrics: screenLyrics,
      queue: screenQueue,
      members: screenMembers,
    };

    Object.entries(screens).forEach(([id, el]) => {
      if (!el) return;
      if (id === screenId) {
        el.classList.remove('hidden');
        requestAnimationFrame(() => el.classList.add('active'));
      } else {
        el.classList.remove('active');
        el.classList.add('hidden');
      }
    });

    if (btnNavLyrics) btnNavLyrics.classList.toggle('active', screenId === 'lyrics');
    if (btnNavQueue) btnNavQueue.classList.toggle('active', screenId === 'queue');
    if (btnPartyPill) btnPartyPill.classList.toggle('active', screenId === 'members');
  }

  // Navigation Event Triggers
  heroArtWrapper?.addEventListener('click', () => showScreen('lyrics'));
  liveLyricBar?.addEventListener('click', () => showScreen('lyrics'));

  btnNavLyrics?.addEventListener('click', () => {
    showScreen(currentScreen === 'lyrics' ? 'player' : 'lyrics');
  });

  btnNavQueue?.addEventListener('click', () => {
    showScreen(currentScreen === 'queue' ? 'player' : 'queue');
  });

  btnPartyPill?.addEventListener('click', () => {
    showScreen(currentScreen === 'members' ? 'player' : 'members');
  });

  lyricsDragHandle?.addEventListener('click', () => showScreen('player'));
  miniTrackInfo?.addEventListener('click', () => showScreen('player'));
  miniTrackArt?.addEventListener('click', () => showScreen('player'));
  miniBtnShare?.addEventListener('click', (e) => {
    e.stopPropagation();
    vscode.postMessage({ type: 'COPY_INVITE' });
  });
  btnCloseQueue?.addEventListener('click', () => showScreen('player'));
  btnCloseMembers?.addEventListener('click', () => showScreen('player'));

  // Keyboard shortcut: Escape returns to main player
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && currentScreen !== 'player') {
      showScreen('player');
    }
  });

  // Favorite button toggling
  function toggleFavorite() {
    isFavorite = !isFavorite;
    btnFavorite?.classList.toggle('starred', isFavorite);
    miniBtnFavorite?.classList.toggle('starred', isFavorite);
  }
  btnFavorite?.addEventListener('click', toggleFavorite);
  miniBtnFavorite?.addEventListener('click', toggleFavorite);

  // ─── Active Lyric Line Helper ────────────────────────────────────────────────
  function getActiveLyricLineText(positionMs) {
    if (amLyrics && Array.isArray(amLyrics.lyrics) && amLyrics.lyrics.length > 0) {
      const lines = amLyrics.lyrics;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const nextTime = i + 1 < lines.length ? lines[i + 1].timestamp : (line.endtime || line.timestamp + 5000);
        if (positionMs >= line.timestamp && positionMs < nextTime) {
          if (Array.isArray(line.text)) {
            return line.text.map((t) => t.text).join('').trim();
          }
          return (line.text || '').trim();
        }
      }
      if (positionMs < lines[0].timestamp) {
        const firstText = Array.isArray(lines[0].text)
          ? lines[0].text.map((t) => t.text).join('')
          : lines[0].text;
        return (firstText || '').trim();
      }
    }

    if (currentLyrics && Array.isArray(currentLyrics.lines) && currentLyrics.lines.length > 0) {
      const lines = currentLyrics.lines;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const nextTime = i + 1 < lines.length ? lines[i + 1].timeMs : (line.timeMs + 5000);
        if (positionMs >= line.timeMs && positionMs < nextTime) {
          return (line.text || '').trim();
        }
      }
    }

    return 'Tap to view lyrics';
  }

  // ─── Playhead Animation Loop ─────────────────────────────────────────────────
  function tick() {
    if (connectionState === 'connected' && playback.track) {
      if (playback.isPlaying) {
        const elapsed = Math.max(0, performance.now() - baseAnchorTime);
        currentPlayhead = basePlayheadMs + elapsed;
        const dur = playback.track.durationMs || 0;
        if (dur > 0 && currentPlayhead > dur) {
          currentPlayhead = dur;
        }
      } else {
        currentPlayhead = basePlayheadMs;
      }

      const dur = playback.track.durationMs || 0;
      if (!isDraggingSeek) {
        if (timeCurrent) timeCurrent.textContent = formatTime(currentPlayhead);
        if (timeRemaining) {
          const remainingMs = Math.max(0, dur - currentPlayhead);
          timeRemaining.textContent = dur > 0 ? `-${formatTime(remainingMs)}` : '-0:00';
        }

        if (seekSlider) {
          if (dur > 0) {
            const pct = ((currentPlayhead / dur) * 100).toFixed(1);
            seekSlider.value = pct;
            seekSlider.style.setProperty('--seek-pct', `${pct}%`);
          } else {
            seekSlider.value = 0;
            seekSlider.style.setProperty('--seek-pct', '0%');
          }
        }
      }

      // Update am-lyrics playhead
      if (amLyrics) {
        amLyrics.currentTime = currentPlayhead;
        amLyrics.paused = !playback.isPlaying;
      }

      // Update live lyric teaser bar under artist
      if (liveLyricText) {
        const activeText = getActiveLyricLineText(currentPlayhead);
        if (activeText && activeText.length > 0) {
          liveLyricText.textContent = activeText;
        }
      }
    }

    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  // Apple Music line-click seeking
  if (amLyrics) {
    amLyrics.addEventListener('line-click', (event) => {
      const timestampMs = event.detail?.timestamp;
      if (typeof timestampMs === 'number' && Number.isFinite(timestampMs)) {
        basePlayheadMs = timestampMs;
        baseAnchorTime = performance.now();
        currentPlayhead = timestampMs;
        if (timeCurrent) timeCurrent.textContent = formatTime(currentPlayhead);
        const dur = playback.track?.durationMs || 0;
        if (dur > 0 && seekSlider) {
          const pct = ((currentPlayhead / dur) * 100).toFixed(1);
          seekSlider.value = pct;
          seekSlider.style.setProperty('--seek-pct', `${pct}%`);
        }
        if (amLyrics) {
          amLyrics.currentTime = timestampMs;
        }
        if (partyAudio.src) {
          partyAudio.currentTime = timestampMs / 1000;
        }
        vscode.postMessage({ type: 'SEEK', positionMs: timestampMs });
      }
    });
  }

  // ─── Server & Local Hosting Controls ─────────────────────────────────────────
  btnRecheckServer?.addEventListener('click', () => {
    hideError();
    const serverUrl = serverUrlInput.value.trim();
    vscode.postMessage({ type: 'PROBE_SERVER', serverUrl });
  });

  serverUrlInput?.addEventListener('change', () => {
    if (serverUrlDisplay) serverUrlDisplay.textContent = serverUrlInput.value.trim();
    btnRecheckServer?.click();
  });

  btnPresetOfficial?.addEventListener('click', () => {
    serverUrlInput.value = 'https://api.bitchord.kushagrasingh.in';
    if (serverUrlDisplay) serverUrlDisplay.textContent = serverUrlInput.value;
    btnRecheckServer?.click();
  });

  btnPresetDefault?.addEventListener('click', () => {
    serverUrlInput.value = 'https://bitchord-listen-together.onrender.com';
    if (serverUrlDisplay) serverUrlDisplay.textContent = serverUrlInput.value;
    btnRecheckServer?.click();
  });

  btnPresetLocal?.addEventListener('click', () => {
    serverUrlInput.value = 'http://127.0.0.1:8000';
    if (serverUrlDisplay) serverUrlDisplay.textContent = serverUrlInput.value;
    btnRecheckServer?.click();
  });

  btnToggleLocal?.addEventListener('click', () => {
    hideError();
    vscode.postMessage({ type: 'TOGGLE_LOCAL_SERVER' });
  });

  btnUseLocal?.addEventListener('click', () => {
    serverUrlInput.value = localServerUrlCode.textContent.trim() || 'http://127.0.0.1:8000';
    if (serverUrlDisplay) serverUrlDisplay.textContent = serverUrlInput.value;
    btnRecheckServer?.click();
  });

  // ─── User Interactions ───────────────────────────────────────────────────────
  btnJoin?.addEventListener('click', () => {
    hideError();
    const code = roomCodeInput.value.trim();
    const serverUrl = serverUrlInput.value.trim();
    if (!code) {
      showError('Please enter a 6-character room code or invite link.');
      return;
    }
    btnJoin.textContent = 'Connecting…';
    btnJoin.disabled = true;
    btnCreate.disabled = true;
    vscode.postMessage({ type: 'JOIN', code, serverUrl });
  });

  roomCodeInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      btnJoin?.click();
    }
  });

  btnCreate?.addEventListener('click', () => {
    hideError();
    const serverUrl = serverUrlInput.value.trim();
    btnCreate.textContent = 'Creating…';
    btnCreate.disabled = true;
    btnJoin.disabled = true;
    vscode.postMessage({ type: 'CREATE', serverUrl });
  });

  btnLeave?.addEventListener('click', () => {
    vscode.postMessage({ type: 'LEAVE' });
  });

  const btnLeaveParty = document.getElementById('btn-leave-party');
  btnLeaveParty?.addEventListener('click', () => {
    vscode.postMessage({ type: 'LEAVE' });
  });

  btnCopyCode?.addEventListener('click', () => {
    vscode.postMessage({ type: 'COPY_INVITE' });
  });

  btnCopyCodeCard?.addEventListener('click', () => {
    vscode.postMessage({ type: 'COPY_INVITE' });
  });

  btnPlayPause?.addEventListener('click', () => {
    vscode.postMessage({ type: 'TOGGLE_PLAY_PAUSE' });
    if (partyAudio.src && !isAudioMuted) {
      if (playback.isPlaying) {
        partyAudio.pause();
      } else {
        partyAudio.currentTime = currentPlayhead / 1000;
        partyAudio.play().catch(() => {});
      }
    }
  });

  btnToggleAudio?.addEventListener('click', () => {
    isAudioMuted = !isAudioMuted;
    btnToggleAudio.classList.toggle('muted', isAudioMuted);
    if (isAudioMuted) {
      partyAudio.pause();
    } else if (playback.isPlaying && partyAudio.src) {
      partyAudio.currentTime = currentPlayhead / 1000;
      partyAudio.play().catch(() => {});
    }
  });

  btnPrev?.addEventListener('click', () => {
    vscode.postMessage({ type: 'PREV' });
  });

  btnNext?.addEventListener('click', () => {
    vscode.postMessage({ type: 'NEXT' });
  });

  // Seek slider scrubbing
  seekSlider?.addEventListener('input', () => {
    isDraggingSeek = true;
    seekSlider.style.setProperty('--seek-pct', `${seekSlider.value}%`);
    const dur = playback.track?.durationMs || 0;
    const frac = parseFloat(seekSlider.value) / 100;
    currentPlayhead = Math.round(frac * dur);
    if (timeCurrent) timeCurrent.textContent = formatTime(currentPlayhead);
    if (timeRemaining) {
      const remainingMs = Math.max(0, dur - currentPlayhead);
      timeRemaining.textContent = dur > 0 ? `-${formatTime(remainingMs)}` : '-0:00';
    }
    if (amLyrics) {
      amLyrics.currentTime = currentPlayhead;
    }
  });

  seekSlider?.addEventListener('change', () => {
    isDraggingSeek = false;
    const dur = playback.track?.durationMs || 0;
    const frac = parseFloat(seekSlider.value) / 100;
    seekSlider.style.setProperty('--seek-pct', `${seekSlider.value}%`);
    const targetMs = Math.round(frac * dur);
    basePlayheadMs = targetMs;
    baseAnchorTime = performance.now();
    currentPlayhead = targetMs;
    if (amLyrics) {
      amLyrics.currentTime = targetMs;
    }
    if (partyAudio.src) {
      partyAudio.currentTime = targetMs / 1000;
    }
    vscode.postMessage({ type: 'SEEK', positionMs: targetMs });
  });

  btnQueueClear?.addEventListener('click', () => {
    vscode.postMessage({ type: 'QUEUE_CLEAR' });
  });

  // ─── Rendering Methods ───────────────────────────────────────────────────────

  function updateConnectionUI(state, code, roundTripMs) {
    const wasConnected = connectionState === 'connected';
    connectionState = state;
    if (code) currentRoomCode = code;

    btnJoin.disabled = false;
    btnCreate.disabled = false;
    btnJoin.innerHTML = `<span class="btn-icon">${ICON_LINK_SVG}</span><span>Join Party</span>`;
    btnCreate.innerHTML = `<span class="btn-icon">${ICON_SPARKLE_SVG}</span><span>Create Party</span>`;

    if (state === 'connected') {
      hideError();
      offlineView.classList.add('hidden');
      connectedView.classList.remove('hidden');
      if (roomCodeText) roomCodeText.textContent = code || '------';
      if (roomCodeCardText) roomCodeCardText.textContent = code || '------';
      if (latencyText) latencyText.textContent = `${roundTripMs || 0} ms`;

      // Only switch screen on initial connection transition
      if (!wasConnected) {
        showScreen('player');
      }
    } else if (state === 'connecting') {
      offlineView.classList.remove('hidden');
      connectedView.classList.add('hidden');
      btnJoin.textContent = 'Connecting…';
      btnJoin.disabled = true;
      btnCreate.disabled = true;
    } else {
      offlineView.classList.remove('hidden');
      connectedView.classList.add('hidden');
      if (ambientBackdrop) {
        ambientBackdrop.classList.remove('active');
      }

      if (partyAudio.src) {
        partyAudio.pause();
        partyAudio.src = '';
      }
      if (partyAudio.src) {
        partyAudio.pause();
        partyAudio.src = '';
      }
    }
  }

  function updateServerHealth(status, latencyMs, errorMsg, serverUrl) {
    if (serverUrl && serverUrlDisplay) {
      serverUrlDisplay.textContent = serverUrl;
    }
    if (serverUrl && partyServerCardText) {
      partyServerCardText.textContent = serverUrl.replace(/^https?:\/\//, '');
    }
    if (serverDot) serverDot.className = 'server-dot ' + status;

    if (serverHealthText) {
      if (status === 'online') {
        serverHealthText.textContent = `Server Online · ${latencyMs} ms`;
      } else if (status === 'checking') {
        serverHealthText.textContent = 'Checking server…';
      } else {
        serverHealthText.textContent = `Server Offline (${errorMsg || 'Unreachable'})`;
      }
    }
  }

  function updateLocalServerUI(isRunning, url, ip, port) {
    if (!localServerBadge || !btnToggleLocal || !localServerInstructions) return;
    if (isRunning) {
      localServerBadge.textContent = 'ACTIVE';
      localServerBadge.className = 'badge-tag active';
      btnToggleLocal.textContent = 'Stop Local Server';
      localServerInstructions.classList.remove('hidden');
      if (localServerUrlCode) localServerUrlCode.textContent = `http://${ip}:${port}`;
    } else {
      localServerBadge.textContent = 'OFF';
      localServerBadge.className = 'badge-tag';
      btnToggleLocal.textContent = 'Start Local Server';
      localServerInstructions.classList.add('hidden');
    }
  }

  function updatePlaybackUI(newPlayback, playheadMs) {
    playback = newPlayback;

    // Use authoritative playhead from server clock
    const serverPlayhead =
      playheadMs !== undefined && playheadMs !== null
        ? playheadMs
        : newPlayback.positionMs || 0;

    basePlayheadMs = serverPlayhead;
    baseAnchorTime = performance.now();
    currentPlayhead = serverPlayhead;

    // Play/Pause icon
    if (playback.isPlaying) {
      iconPlay?.classList.add('hidden');
      iconPause?.classList.remove('hidden');
    } else {
      iconPlay?.classList.remove('hidden');
      iconPause?.classList.add('hidden');
    }

    // Sync native HTML5 audio stream with BitChord Party
    if (partyAudio.src) {
      const targetSec = serverPlayhead / 1000;
      if (playback.isPlaying && !isAudioMuted) {
        if (partyAudio.paused) {
          if (partyAudio.readyState >= 1) {
            try { partyAudio.currentTime = targetSec; } catch (e) {}
          }
          partyAudio.play().catch(() => {});
        } else if (Math.abs(partyAudio.currentTime - targetSec) > 1.2) {
          try { partyAudio.currentTime = targetSec; } catch (e) {}
        }
      } else {
        if (!partyAudio.paused) {
          partyAudio.pause();
        }
        if (Math.abs(partyAudio.currentTime - targetSec) > 0.4) {
          if (partyAudio.readyState >= 1) {
            try { partyAudio.currentTime = targetSec; } catch (e) {}
          }
        }
      }
    }

    const track = playback.track;
    if (track) {
      const title = track.title || 'Untitled Track';
      const artist = track.artist || 'Unknown Artist';

      if (trackTitle) trackTitle.textContent = title;
      if (trackArtist) trackArtist.textContent = artist;
      if (miniTrackTitle) miniTrackTitle.textContent = title;
      if (miniTrackArtist) miniTrackArtist.textContent = artist;

      if (track.thumbnailUrl) {
        if (trackArt) {
          trackArt.src = track.thumbnailUrl;
          trackArt.classList.remove('hidden');
        }
        if (miniTrackArt) {
          miniTrackArt.src = track.thumbnailUrl;
        }
        if (artPlaceholder) artPlaceholder.classList.add('hidden');

        // Ambient mesh backdrop update
        if (ambientBackdrop) {
          ambientBackdrop.style.backgroundImage = `url("${track.thumbnailUrl}")`;
          ambientBackdrop.classList.add('active');
        }
      } else {
        if (trackArt) trackArt.classList.add('hidden');
        if (artPlaceholder) artPlaceholder.classList.remove('hidden');
      }

      if (playback.startedByName) {
        if (startedByName) startedByName.textContent = playback.startedByName;
        trackAttribution?.classList.remove('hidden');
        if (partySublabel) partySublabel.textContent = `${playback.startedByName}'s Jam`;
      } else {
        trackAttribution?.classList.add('hidden');
        if (partySublabel) {
          partySublabel.textContent = currentRoomCode ? `Room ${currentRoomCode}` : "Aneesh's Jam";
        }
      }

      if (amLyrics) {
        const trackKey = `${track.videoId || ''}|${track.title || ''}|${track.artist || ''}|${track.durationMs || 0}`;
        if (amLyrics.dataset.currentTrackKey !== trackKey) {
          amLyrics.dataset.currentTrackKey = trackKey;

          // 1. Clear any prior song's TTML, lyrics, and playback clocks
          amLyrics.removeAttribute('ttml');
          amLyrics.ttml = undefined;
          amLyrics.lyrics = undefined;
          amLyrics.availableSources = [];
          amLyrics.currentSourceIndex = 0;
          amLyrics.currentTime = 0;

          // 2. Set DOM attributes and JS properties so Lit picks up both
          const durationMs = track.durationMs || 0;
          const query = `${title} ${artist}`.trim();

          amLyrics.setAttribute('song-title', title);
          amLyrics.setAttribute('song-artist', artist);
          amLyrics.songTitle = title;
          amLyrics.songArtist = artist;

          if (durationMs > 0) {
            amLyrics.setAttribute('song-duration', String(durationMs));
            amLyrics.songDurationMs = durationMs;
            amLyrics.duration = durationMs;
          } else {
            amLyrics.removeAttribute('song-duration');
            amLyrics.songDurationMs = undefined;
            amLyrics.duration = undefined;
          }

          amLyrics.setAttribute('query', query);
          amLyrics.query = query;

          amLyrics.classList.remove('hidden');
          if (lyricsPlaceholder) {
            lyricsPlaceholder.classList.add('hidden');
          }

          // 3. Immediately trigger fetchLyrics on the component
          if (typeof amLyrics.fetchLyrics === 'function') {
            amLyrics.fetchLyrics();
          }
        }
        amLyrics.paused = !playback.isPlaying;
      }
    } else {
      if (trackTitle) trackTitle.textContent = 'Waiting for music…';
      if (trackArtist) trackArtist.textContent = 'Play any track in BitChord on your phone';
      if (trackArt) trackArt.classList.add('hidden');
      if (artPlaceholder) artPlaceholder.classList.remove('hidden');
      trackAttribution?.classList.add('hidden');

      if (ambientBackdrop) {
        ambientBackdrop.classList.remove('active');
      }

      if (partyAudio.src) {
        partyAudio.pause();
        partyAudio.src = '';
      }

      if (amLyrics) {
        amLyrics.dataset.currentTrackKey = '';
        amLyrics.removeAttribute('ttml');
        amLyrics.ttml = undefined;
        amLyrics.lyrics = undefined;
        amLyrics.availableSources = [];
        amLyrics.duration = -1;
        amLyrics.classList.add('hidden');
        if (lyricsPlaceholder) {
          lyricsPlaceholder.textContent = 'Waiting for song playback from phone…';
          lyricsPlaceholder.classList.remove('hidden');
        }
      }
    }
  }

  function updateQueueUI(queue) {
    const items = queue?.items || [];
    if (!queueList) return;

    if (items.length === 0) {
      queueList.innerHTML = '<div class="empty-state">Queue is empty</div>';
      return;
    }

    queueList.innerHTML = '';
    items.forEach((track, i) => {
      const isCurrent = i === queue.index;
      const el = document.createElement('div');
      el.className = `queue-item ${isCurrent ? 'current-track' : ''}`;

      const thumbUrl = track.thumbnailUrl || '';
      el.innerHTML = `
        <img class="queue-thumb" src="${thumbUrl}" alt="" onerror="this.style.display='none'" />
        <div class="queue-info">
          <div class="queue-title">${escapeHtml(track.title || 'Untitled')}</div>
          <div class="queue-artist">${escapeHtml(track.artist || '')} • ${formatTime(track.durationMs)}</div>
        </div>
        <div class="queue-actions">
          <button class="queue-btn btn-remove" title="Remove song">✕</button>
        </div>
      `;

      el.querySelector('.btn-remove')?.addEventListener('click', (e) => {
        e.stopPropagation();
        vscode.postMessage({ type: 'QUEUE_REMOVE', videoId: track.videoId });
      });

      queueList.appendChild(el);
    });
  }

  function updateMembersUI(members) {
    members = members || [];
    if (partyCount) partyCount.textContent = members.length.toString();

    if (!membersList) return;

    if (members.length === 0) {
      membersList.innerHTML = '<div class="empty-state">No members connected</div>';
      return;
    }

    membersList.innerHTML = '';
    members.forEach((m) => {
      const el = document.createElement('div');
      el.className = 'member-item';
      const initial = (m.displayName || '?')[0].toUpperCase();

      el.innerHTML = `
        <div class="member-avatar">${escapeHtml(initial)}</div>
        <div class="member-details">
          <div class="member-name">
            <span>${escapeHtml(m.displayName || 'Anonymous')}</span>
            ${m.isHost ? '<span class="host-tag">HOST</span>' : ''}
          </div>
          <div class="member-status"><span class="member-status-dot ${m.connected ? 'online' : 'idle'}"></span>${m.connected ? 'Online' : 'Idle'}</div>
        </div>
      `;
      membersList.appendChild(el);
    });
  }

  function renderLyrics(lyricsData) {
    currentLyrics = lyricsData;

    if (lyricsData?.rawTtml && amLyrics) {
      amLyrics.ttml = lyricsData.rawTtml;
      amLyrics.classList.remove('hidden');
      if (lyricsPlaceholder) lyricsPlaceholder.classList.add('hidden');
      if (typeof amLyrics.fetchLyrics === 'function') {
        amLyrics.fetchLyrics();
      }
    }
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ─── Extension Message Listener ──────────────────────────────────────────────
  window.addEventListener('message', (event) => {
    const msg = event.data;
    switch (msg.type) {
      case 'INIT': {
        updateConnectionUI(msg.state, msg.code, msg.roundTripMs);
        updatePlaybackUI(msg.playback, msg.playheadMs);
        updateQueueUI(msg.queue);
        updateMembersUI(msg.members);
        break;
      }

      case 'SERVER_HEALTH': {
        updateServerHealth(msg.status, msg.latencyMs, msg.error, msg.serverUrl);
        break;
      }

      case 'LOCAL_SERVER_STATUS': {
        updateLocalServerUI(msg.isRunning, msg.url, msg.ip, msg.port);
        break;
      }

      case 'CONNECTION_UPDATE': {
        updateConnectionUI(msg.state, msg.code, msg.roundTripMs);
        break;
      }

      case 'LATENCY_UPDATE': {
        if (latencyText) {
          latencyText.textContent = `${msg.roundTripMs || 0} ms`;
        }
        break;
      }

      case 'STATE_UPDATE': {
        updatePlaybackUI(msg.playback, msg.playheadMs);
        if (msg.roundTripMs !== undefined && latencyText) {
          latencyText.textContent = `${msg.roundTripMs} ms`;
        }
        break;
      }

      case 'LYRICS_PROGRESS': {
        if (!playback.isPlaying) {
          currentPlayhead = msg.playheadMs || 0;
          basePlayheadMs = currentPlayhead;
          baseAnchorTime = performance.now();
          if (amLyrics) {
            amLyrics.currentTime = currentPlayhead;
          }
          if (liveLyricText) {
            const activeText = getActiveLyricLineText(currentPlayhead);
            if (activeText && activeText.length > 0) {
              liveLyricText.textContent = activeText;
            }
          }
        }
        break;
      }

      case 'QUEUE_UPDATE': {
        updateQueueUI(msg.queue);
        break;
      }

      case 'MEMBERS_UPDATE': {
        updateMembersUI(msg.members);
        break;
      }

      case 'LYRICS_LOADING': {
        if (lyricsPlaceholder && (!amLyrics || amLyrics.classList.contains('hidden'))) {
          lyricsPlaceholder.textContent = `Finding lyrics for "${msg.title}"…`;
          lyricsPlaceholder.classList.remove('hidden');
        }
        break;
      }

      case 'LYRICS_UPDATE': {
        renderLyrics(msg.lyrics);
        break;
      }

      case 'STREAM_UPDATE': {
        if (msg.streamUrl) {
          console.log('[BitChord Audio] Received audio stream for:', msg.title);
          const wasPlaying = playback && playback.isPlaying && !isAudioMuted;
          if (partyAudio.src !== msg.streamUrl) {
            partyAudio.src = msg.streamUrl;
            partyAudio.load();

            const targetSec = currentPlayhead > 0 ? (currentPlayhead / 1000) : 0;
            const applyInitialSync = () => {
              if (targetSec > 0 && Math.abs(partyAudio.currentTime - targetSec) > 0.5) {
                try { partyAudio.currentTime = targetSec; } catch (e) {}
              }
              if (playback && playback.isPlaying && !isAudioMuted && partyAudio.paused) {
                partyAudio.play().catch((err) => {
                  console.warn('[BitChord Audio] Autoplay deferred until user interaction:', err.message);
                });
              }
            };

            partyAudio.onloadedmetadata = applyInitialSync;
            partyAudio.oncanplay = applyInitialSync;

            if (wasPlaying) {
              partyAudio.play().catch((err) => {
                console.warn('[BitChord Audio] Immediate play deferred:', err.message);
              });
            }
          }
        }
        break;
      }

      case 'ERROR': {
        showError(msg.message);
        btnJoin.disabled = false;
        btnCreate.disabled = false;
        btnJoin.innerHTML = `<span class="btn-icon">${ICON_LINK_SVG}</span><span>Join Party</span>`;
        btnCreate.innerHTML = `<span class="btn-icon">${ICON_SPARKLE_SVG}</span><span>Create Party</span>`;
        break;
      }
    }
  });

  // Tell extension webview is ready
  vscode.postMessage({ type: 'READY', serverUrl: serverUrlInput?.value.trim() });
})();
