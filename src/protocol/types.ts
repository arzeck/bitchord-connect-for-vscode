/**
 * BitChord Listen Together Protocol Types
 * Matches BitChord's Go backend protocol & Android Kotlin PartyModels.
 */

export interface PartyTrack {
  videoId: string;
  title: string;
  artist: string;
  thumbnailUrl?: string | null;
  durationMs?: number | null;
  fromAutoplay?: boolean;
}

export interface PartyMember {
  memberId: string;
  userId: string;
  displayName: string;
  avatarUrl?: string | null;
  isHost: boolean;
  connected: boolean;
  joinedAtMs: number;
  lastSeenMs: number;
}

export interface PartyPlayback {
  seq: number;
  track?: PartyTrack | null;
  queueSeq: number;
  queueLength: number;
  queueIndex: number;
  isPlaying: boolean;
  positionMs: number;
  anchorMs: number;
  effectivePositionMs?: number;
  updatedBy?: string | null;
  startedBy?: string | null;
  startedByName?: string | null;
  autoplayEnabled?: boolean;
  updatedAtMs?: number;
}

export interface PartyQueue {
  seq: number;
  index: number;
  items: PartyTrack[];
}

export interface PartySnapshot {
  code: string;
  createdAtMs: number;
  maxMembers: number;
  hostOnlyControl: boolean;
  members: PartyMember[];
  playback: PartyPlayback;
  queue: PartyQueue;
  serverMs: number;
}

export interface JoinRequest {
  userId: string;
  deviceId: string;
  displayName: string;
  avatarUrl?: string | null;
  maxMembers?: number;
}

export interface JoinResponse {
  code: string;
  token: string;
  you: PartyMember;
  party: PartySnapshot;
}

// Control Actions
export type ControlAction =
  | 'play'
  | 'pause'
  | 'seek'
  | 'setTrack'
  | 'setQueue'
  | 'queueAdd'
  | 'queueRemove'
  | 'queueClear'
  | 'queueMove'
  | 'next'
  | 'previous'
  | 'kick'
  | 'setMaxMembers'
  | 'setAutoplay'
  | 'setHostOnlyControl';

// Client to Server Frame Types
export type ClientFrame =
  | { type: 'ping'; clientMs: number }
  | { type: 'sync' }
  | { type: 'syncQueue' }
  | { type: 'report'; positionMs: number; isPlaying: boolean }
  | {
      type: 'control';
      action: 'play';
      positionMs?: number;
    }
  | {
      type: 'control';
      action: 'pause';
      positionMs?: number;
    }
  | {
      type: 'control';
      action: 'seek';
      positionMs: number;
    }
  | {
      type: 'control';
      action: 'next';
    }
  | {
      type: 'control';
      action: 'previous';
    }
  | {
      type: 'control';
      action: 'setTrack';
      track: PartyTrack;
      positionMs: number;
      isPlaying: boolean;
    }
  | {
      type: 'control';
      action: 'queueAdd';
      tracks: PartyTrack[];
      playNext?: boolean;
    }
  | {
      type: 'control';
      action: 'queueRemove';
      videoId: string;
    }
  | {
      type: 'control';
      action: 'queueClear';
    }
  | {
      type: 'control';
      action: 'queueMove';
      fromIndex: number;
      toIndex: number;
      videoId?: string;
    }
  | {
      type: 'control';
      action: 'setHostOnlyControl';
      enabled: boolean;
    }
  | {
      type: 'control';
      action: 'kick';
      memberId: string;
    };

// Server to Client Frame Types
export type ServerFrame =
  | {
      type: 'welcome';
      you: PartyMember;
      party: PartySnapshot;
      serverMs: number;
    }
  | {
      type: 'pong';
      clientMs: number;
      serverMs: number;
    }
  | {
      type: 'state';
      playback: PartyPlayback;
      serverMs: number;
    }
  | {
      type: 'queue';
      queue: PartyQueue;
      serverMs: number;
    }
  | {
      type: 'members';
      members: PartyMember[];
      maxMembers: number;
      hostOnlyControl?: boolean;
      serverMs: number;
    }
  | {
      type: 'activity';
      action: string;
      actor?: string;
      actorName?: string;
      timestamp?: number;
    }
  | {
      type: 'error';
      error: string;
      message: string;
    }
  | {
      type: 'bye';
      reason: 'left' | 'kicked';
    };
