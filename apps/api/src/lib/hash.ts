import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Cannot canonicalise a non-finite number');
    return JSON.stringify(value);
  }
  if (typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item === undefined ? null : item)).join(',')}]`;
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
  }
  throw new Error(`Unsupported value in canonical JSON: ${typeof value}`);
}

export function sha256Hex(input: string | Uint8Array): string {
  return createHash('sha256').update(input).digest('hex');
}

export function hashCanonical(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}

export function hmacHex(secret: string, message: string): string {
  return createHmac('sha256', secret).update(message).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function equalsKey(provided: string, expected: string): boolean {
  return safeEqual(sha256Hex(provided), sha256Hex(expected));
}

export interface SessionTokenPayload {
  sid: string;
  rid: string;
  th: string;
  mh: string;
  exp: number;
}

function base64UrlEncode(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function sessionTokenSecret(secret: string): string {
  return hmacHex(secret, 'whirr-session-token-v1');
}

export function signSessionToken(payload: SessionTokenPayload, secret: string, ttlMs = 24 * 60 * 60 * 1000): string {
  const body = { ...payload, exp: payload.exp || Date.now() + ttlMs };
  const encoded = base64UrlEncode(canonicalJson(body));
  const signature = hmacHex(sessionTokenSecret(secret), encoded);
  return `${encoded}.${signature}`;
}

export function verifySessionToken(
  token: string,
  secret: string,
): { valid: true; payload: SessionTokenPayload } | { valid: false; reason: string } {
  const parts = token.split('.');
  if (parts.length !== 2) return { valid: false, reason: 'Malformed session token' };
  const [encoded, signature] = parts as [string, string];
  const expected = hmacHex(sessionTokenSecret(secret), encoded);
  if (!safeEqual(expected, signature)) return { valid: false, reason: 'Invalid session token signature' };
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as SessionTokenPayload;
    if (!payload.sid || !payload.rid || !payload.th || !payload.mh || !payload.exp) {
      return { valid: false, reason: 'Incomplete session token' };
    }
    if (payload.exp < Date.now()) return { valid: false, reason: 'Session token expired' };
    return { valid: true, payload };
  } catch {
    return { valid: false, reason: 'Unreadable session token' };
  }
}

export function redactProviderId(value: string | null): string | null {
  if (!value) return null;
  if (value.length <= 4) return '••••';
  return `••••${value.slice(-4)}`;
}

export function shortRef(prefix: string, value: string): string {
  return `${prefix}_${sha256Hex(value).slice(0, 10)}`;
}

/** Keyed, non-reversible reference for low-entropy values such as IPs. */
export function hmacRef(secret: string, prefix: string, value: string): string {
  return `${prefix}_${hmacHex(secret, value).slice(0, 16)}`;
}
