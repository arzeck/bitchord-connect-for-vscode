/**
 * BitChord Stream Resolver
 * Resolves high-fidelity (320kbps) audio streams from BitChord's CDN sources.
 * Self-contained pure-JS DES cipher with zero external dependencies.
 */

interface CacheEntry {
  url: string;
  expiresAt: number;
}

const streamCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

// ─── Pure JavaScript DES ECB Decryptor for Fixed Key '38346591' ───────────────

const IP = [
  58, 50, 42, 34, 26, 18, 10, 2, 60, 52, 44, 36, 28, 20, 12, 4,
  62, 54, 46, 38, 30, 22, 14, 6, 64, 56, 48, 40, 32, 24, 16, 8,
  57, 49, 41, 33, 25, 17, 9, 1, 59, 51, 43, 35, 27, 19, 11, 3,
  61, 53, 45, 37, 29, 21, 13, 5, 63, 55, 47, 39, 31, 23, 15, 7
];

const FP = [
  40, 8, 48, 16, 56, 24, 64, 32, 39, 7, 47, 15, 55, 23, 63, 31,
  38, 6, 46, 14, 54, 22, 62, 30, 37, 5, 45, 13, 53, 21, 61, 29,
  36, 4, 44, 12, 52, 20, 60, 28, 35, 3, 43, 11, 51, 19, 59, 27,
  34, 2, 42, 10, 50, 18, 58, 26, 33, 1, 41, 9, 49, 17, 57, 25
];

const E = [
  32, 1, 2, 3, 4, 5, 4, 5, 6, 7, 8, 9,
  8, 9, 10, 11, 12, 13, 12, 13, 14, 15, 16, 17,
  16, 17, 18, 19, 20, 21, 20, 21, 22, 23, 24, 25,
  24, 25, 26, 27, 28, 29, 28, 29, 30, 31, 32, 1
];

const P = [
  16, 7, 20, 21, 29, 12, 28, 17, 1, 15, 23, 26, 5, 18, 31, 10,
  2, 8, 24, 14, 32, 27, 3, 9, 19, 13, 30, 6, 22, 11, 4, 25
];

const S = [
  [14,4,13,1,2,15,11,8,3,10,6,12,5,9,0,7, 0,15,7,4,14,2,13,1,10,6,12,11,9,5,3,8, 4,1,14,8,13,6,2,11,15,12,9,7,3,10,5,0, 15,12,8,2,4,9,1,7,5,11,3,14,10,0,6,13],
  [15,1,8,14,6,11,3,4,9,7,2,13,12,0,5,10, 3,13,4,7,15,2,8,14,12,0,1,10,6,9,11,5, 0,14,7,11,10,4,13,1,5,8,12,6,9,3,2,15, 13,8,10,1,3,15,4,2,11,6,7,12,0,5,14,9],
  [10,0,9,14,6,3,15,5,1,13,12,7,11,4,2,8, 13,7,0,9,3,4,6,10,2,8,5,14,12,11,15,1, 13,6,4,9,8,15,3,0,11,1,2,12,5,10,14,7, 1,10,13,0,6,9,8,7,4,15,14,3,11,5,2,12],
  [7,13,14,3,0,6,9,10,1,2,8,5,11,12,4,15, 13,8,11,5,6,15,0,3,4,7,2,12,1,10,14,9, 10,6,9,0,12,11,7,13,15,1,3,14,5,2,8,4, 3,15,0,6,10,1,13,8,9,4,5,11,12,7,2,14],
  [2,12,4,1,7,10,11,6,8,5,3,15,13,0,14,9, 14,11,2,12,4,7,13,1,5,0,15,10,3,9,8,6, 4,2,1,11,10,13,7,8,15,9,12,5,6,3,0,14, 11,8,12,7,1,14,2,13,6,15,0,9,10,4,5,3],
  [12,1,10,15,9,2,6,8,0,13,3,4,14,7,5,11, 10,15,4,2,7,12,9,5,6,1,13,14,0,11,3,8, 9,14,15,5,2,8,12,3,7,0,4,10,1,13,11,6, 4,3,2,12,9,5,15,10,11,14,1,7,6,0,8,13],
  [4,11,2,14,15,0,8,13,3,12,9,7,5,10,6,1, 13,0,11,7,4,9,1,10,14,3,5,12,2,15,8,6, 1,4,11,13,12,3,7,14,10,15,6,8,0,5,9,2, 6,11,13,8,1,4,10,7,9,5,0,15,14,2,3,12],
  [13,2,8,4,6,15,11,1,10,9,3,14,5,0,12,7, 1,15,13,8,10,3,7,4,12,5,6,11,0,14,9,2, 7,11,4,1,9,12,14,2,0,6,10,13,15,3,5,8, 2,1,14,7,4,10,8,13,15,12,9,0,3,5,6,11]
];

const PC1 = [57,49,41,33,25,17,9,1,58,50,42,34,26,18,10,2,59,51,43,35,27,19,11,3,60,52,44,36,63,55,47,39,31,23,15,7,62,54,46,38,30,22,14,6,61,53,45,37,29,21,13,5,28,20,12,4];
const PC2 = [14,17,11,24,1,5,3,28,15,6,21,10,23,19,12,4,26,8,16,7,27,20,13,2,41,52,31,37,47,55,30,40,51,45,33,48,44,49,39,56,34,53,46,42,50,36,29,32];
const SHIFTS = [1,1,2,2,2,2,2,2,1,2,2,2,2,2,2,1];

function bytesToBits(buf: Buffer): number[] {
  const bits: number[] = [];
  for (let i = 0; i < buf.length; i++) {
    for (let j = 7; j >= 0; j--) bits.push((buf[i] >> j) & 1);
  }
  return bits;
}

function bitsToBytes(bits: number[]): Buffer {
  const buf = Buffer.alloc(bits.length / 8);
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
    buf[i / 8] = b;
  }
  return buf;
}

function permute(bits: number[], table: number[]): number[] {
  return table.map(pos => bits[pos - 1]);
}

// Precompute reverse subkeys for fixed key '38346591'
const keyBits = bytesToBits(Buffer.from('38346591', 'utf8'));
const pc1 = permute(keyBits, PC1);
let C = pc1.slice(0, 28);
let D = pc1.slice(28, 56);
const decryptSubkeys: number[][] = [];
for (let r = 0; r < 16; r++) {
  const s = SHIFTS[r];
  C = C.slice(s).concat(C.slice(0, s));
  D = D.slice(s).concat(D.slice(0, s));
  decryptSubkeys.push(permute(C.concat(D), PC2));
}
decryptSubkeys.reverse();

function feistel(R: number[], subkey: number[]): number[] {
  const expanded = permute(R, E);
  const xored = expanded.map((b, i) => b ^ subkey[i]);
  const sOutput: number[] = [];
  for (let i = 0; i < 8; i++) {
    const chunk = xored.slice(i * 6, (i + 1) * 6);
    const row = (chunk[0] << 1) | chunk[5];
    const col = (chunk[1] << 3) | (chunk[2] << 2) | (chunk[3] << 1) | chunk[4];
    const val = S[i][row * 16 + col];
    for (let j = 3; j >= 0; j--) sOutput.push((val >> j) & 1);
  }
  return permute(sOutput, P);
}

export function decryptSaavnMediaUrl(base64Str: string): string {
  try {
    const cipherBytes = Buffer.from(base64Str, 'base64');
    const outBits: number[] = [];
    for (let blk = 0; blk < cipherBytes.length; blk += 8) {
      const blkBits = bytesToBits(cipherBytes.slice(blk, blk + 8));
      const ip = permute(blkBits, IP);
      let L = ip.slice(0, 32);
      let R = ip.slice(32, 64);
      for (let r = 0; r < 16; r++) {
        const f = feistel(R, decryptSubkeys[r]);
        const nextL = R;
        const nextR = L.map((b, i) => b ^ f[i]);
        L = nextL;
        R = nextR;
      }
      const fp = permute(R.concat(L), FP);
      outBits.push(...fp);
    }
    const decBytes = bitsToBytes(outBits);
    const padLen = decBytes[decBytes.length - 1];
    const unpadded = (padLen > 0 && padLen <= 8) ? decBytes.slice(0, -padLen) : decBytes;
    return unpadded.toString('utf8').trim();
  } catch {
    return '';
  }
}

// ─── Public Resolver ──────────────────────────────────────────────────────────

export async function resolveAudioStream(title: string, artist: string, videoId?: string): Promise<string | null> {
  const cacheKey = videoId || `${title}:::${artist}`;
  const now = Date.now();
  const cached = streamCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.url;
  }

  // Clean title & artist for matching against catalogue
  const cleanTitle = title
    .replace(/\([^)]*\)|\[[^\]]*\]/g, '')
    .replace(/[®™]/g, '')
    .trim();
  const cleanArtist = artist.replace(/[®™]/g, '').trim();
  const primaryArtist = cleanArtist.split(/[,&/]|(?:\b(?:feat|ft|vs|x)\b)/i)[0].trim();

  // Try candidate search strings in specificity order
  const candidates: string[] = [];
  if (cleanTitle && primaryArtist) candidates.push(`${cleanTitle} ${primaryArtist}`);
  if (cleanTitle && cleanArtist && cleanArtist !== primaryArtist) candidates.push(`${cleanTitle} ${cleanArtist}`);
  if (cleanTitle) candidates.push(cleanTitle);

  for (const query of candidates) {
    try {
      const endpoint = `https://www.jiosaavn.com/api.php?__call=search.getResults&_format=json&api_version=4&ctx=android&q=${encodeURIComponent(query)}&n=5`;
      const res = await fetch(endpoint, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
          'Accept': 'application/json'
        },
        signal: AbortSignal.timeout(6000),
      });

      if (!res.ok) continue;
      const data: any = await res.json();
      const results = data.results || [];
      if (!results.length) continue;

      // Pick top result
      const song = results[0];
      const encUrl = song?.more_info?.encrypted_media_url;
      if (!encUrl) continue;

      const decrypted = decryptSaavnMediaUrl(encUrl);
      if (!decrypted) continue;

      // Upgrade to 320kbps rendition if supported (matching BitChord selectBestSaavnStream)
      const supports320 = song.more_info?.['320kbps'] === 'true' || song.more_info?.['320kbps'] === true;
      let finalUrl = decrypted;
      const renditionRegex = /_(48|96|160|320)\.(mp4|aac|mp3)(?=[?#]|$)/i;
      if (supports320) {
        finalUrl = decrypted.replace(renditionRegex, '_320.$2');
      } else {
        finalUrl = decrypted.replace(/_(48|96)\.(mp4|aac|mp3)(?=[?#]|$)/i, '_160.$2');
      }

      streamCache.set(cacheKey, { url: finalUrl, expiresAt: now + CACHE_TTL_MS });
      return finalUrl;
    } catch {
      continue;
    }
  }

  return null;
}
