/**
 * Code generation, normalization, and invite link parser.
 * Matches BitChord's backend/codes/codes.go and JamInviteLink.kt.
 */

export const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const CODE_LENGTH = 6;

/**
 * Normalises a user-typed or pasted party code:
 * - Removes non-alphanumeric characters and spaces
 * - Converts to uppercase
 * - Maps ambiguous characters: 'I' -> '1', 'L' -> '1', 'O' -> '0'
 */
export function normaliseCode(input: string): string {
  let result = '';
  const upper = input.trim().toUpperCase();
  for (let i = 0; i < upper.length; i++) {
    const ch = upper[i];
    if (ch === 'I' || ch === 'L') {
      result += '1';
    } else if (ch === 'O') {
      result += '0';
    } else if (ALPHABET.includes(ch)) {
      result += ch;
    }
  }
  return result;
}

/**
 * Validates if the code is exactly 6 characters and belongs to the alphabet.
 */
export function isValidCode(code: string): boolean {
  if (code.length !== CODE_LENGTH) return false;
  for (let i = 0; i < code.length; i++) {
    if (!ALPHABET.includes(code[i])) return false;
  }
  return true;
}

/**
 * Parses a code or invite link:
 * - "bitchord://party/7A9K2M"
 * - "https://bitchord.kushagrasingh.in/invite/7A9K2M"
 * - "7A9K2M"
 */
export function extractCodeAndServer(raw: string): { code: string; serverUrl?: string } | null {
  if (!raw) return null;
  let str = raw.trim();

  // If looks like invite link without protocol, prepend https://
  if (!str.includes('://') && (str.includes('/invite/') || str.includes('bitchord'))) {
    str = 'https://' + str;
  }

  // Try URL parsing
  if (str.includes('://')) {
    try {
      const url = new URL(str);
      const queryServer = url.searchParams.get('server') || undefined;

      // 1. bitchord://party/<CODE> or bitchord://party?code=<CODE>
      if (url.protocol.startsWith('bitchord')) {
        const pathPart = url.pathname.replace(/^\/+|\/+$/g, '');
        const candidate = pathPart || url.searchParams.get('code') || '';
        const norm = normaliseCode(candidate);
        if (isValidCode(norm)) {
          return { code: norm, serverUrl: queryServer };
        }
      }

      // 2. /invite/<CODE> or /party/<CODE>
      const match = url.pathname.match(/(?:\/invite\/|\/party\/|^)([a-zA-Z0-9]{6})(?:\/|$)/i);
      if (match && match[1]) {
        const norm = normaliseCode(match[1]);
        if (isValidCode(norm)) {
          return { code: norm, serverUrl: queryServer };
        }
      }

      // 3. Query param ?code=<CODE>
      const queryCode = url.searchParams.get('code');
      if (queryCode) {
        const norm = normaliseCode(queryCode);
        if (isValidCode(norm)) {
          return { code: norm, serverUrl: queryServer };
        }
      }
    } catch {
      // Not a valid URL, fall through
    }
  }

  // Treat as direct code
  const direct = normaliseCode(str);
  if (isValidCode(direct)) {
    return { code: direct };
  }

  // Check if any 6-character token inside the string matches
  const tokens = str.split(/[^a-zA-Z0-9]+/);
  for (const t of tokens) {
    const norm = normaliseCode(t);
    if (isValidCode(norm)) {
      return { code: norm };
    }
  }

  return null;
}
