/**
 * Whirr's small, portable evidence protocol.
 *
 * The signature is installation attestation: it proves that the holder of a
 * particular local signing key produced these bytes. It does not prove that a
 * physical object exists, that a microphone was honest, or that any external
 * timestamp authority observed the document.
 */

export const SIGNED_SCHEMA = 'whirr.signed.v2';
export const PASSPORT_SCHEMA = 'whirr.passport.v2';
export const RECEIPT_PROOF_SCHEMA = 'whirr.receipt-proof.v2';
export const SIGNING_ALGORITHM = 'ECDSA_P256_SHA256';

export interface QuoteRecomputeInput {
  minorPerMinute: number;
  billableMs: number;
  capMinor: number;
  creditMinor?: number;
}

export interface QuoteRecomputeResult {
  roundedMinor: number;
  baseQuoteMinor: number;
  quoteMinor: number;
}

/**
 * Recompute the billable quote with the same half-up, once-at-the-end rule as
 * the meter. Kept dependency-free so a verifier in any runtime can check a
 * proof's arithmetic without importing server code.
 */
export function recomputeQuoteMinor(input: QuoteRecomputeInput): QuoteRecomputeResult {
  const { minorPerMinute, billableMs, capMinor } = input;
  const creditMinor = input.creditMinor ?? 0;
  if (!Number.isSafeInteger(minorPerMinute) || minorPerMinute < 0) throw new RangeError('Invalid rate');
  if (!Number.isSafeInteger(billableMs) || billableMs < 0) throw new RangeError('Invalid duration');
  if (!Number.isSafeInteger(capMinor) || capMinor < 0) throw new RangeError('Invalid cap');
  if (!Number.isSafeInteger(creditMinor) || creditMinor < 0) throw new RangeError('Invalid credit');
  const numerator = minorPerMinute * billableMs;
  if (!Number.isSafeInteger(numerator)) throw new RangeError('Quote exceeds safe integer range');
  const roundedMinor = Math.floor((numerator + 30_000) / 60_000);
  const baseQuoteMinor = Math.min(capMinor, roundedMinor);
  const appliedCredit = Math.min(creditMinor, baseQuoteMinor);
  return {
    roundedMinor,
    baseQuoteMinor,
    quoteMinor: Math.max(0, baseQuoteMinor - appliedCredit),
  };
}

export type SignedDocumentType = 'passport' | 'receipt-proof';

export interface SignedEnvelope<T> {
  schema: typeof SIGNED_SCHEMA;
  type: SignedDocumentType;
  algorithm: typeof SIGNING_ALGORITHM;
  keyId: string;
  publicKey: string;
  payload: T;
  signature: string;
}

export function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Cannot canonicalise a non-finite number');
    return JSON.stringify(value);
  }
  if (typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item === undefined ? null : item)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
  }
  throw new Error(`Unsupported value in canonical JSON: ${typeof value}`);
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function arrayBufferOf(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export async function sha256Hex(input: string | Uint8Array): Promise<string> {
  const bytes = typeof input === 'string' ? encoder.encode(input) : input;
  const digest = await globalThis.crypto.subtle.digest('SHA-256', arrayBufferOf(bytes));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function keyIdForPublicKey(publicKeySpki: string): Promise<string> {
  return (await sha256Hex(base64ToBytes(publicKeySpki))).slice(0, 32);
}

function importPublicKey(publicKeySpki: string): Promise<CryptoKey> {
  return globalThis.crypto.subtle.importKey(
    'spki',
    arrayBufferOf(base64ToBytes(publicKeySpki)),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify'],
  );
}

function importPrivateKey(privateKeyPkcs8: string): Promise<CryptoKey> {
  return globalThis.crypto.subtle.importKey(
    'pkcs8',
    arrayBufferOf(base64ToBytes(privateKeyPkcs8)),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
}

export function signaturePayload<T>(
  input: Pick<SignedEnvelope<T>, 'type' | 'algorithm' | 'keyId' | 'publicKey' | 'payload'>,
): string {
  return canonicalJson({
    schema: SIGNED_SCHEMA,
    type: input.type,
    algorithm: input.algorithm,
    keyId: input.keyId,
    publicKey: input.publicKey,
    payload: input.payload,
  });
}

export async function signEnvelope<T>(
  type: SignedDocumentType,
  payload: T,
  privateKeyPkcs8: string,
  publicKeySpki: string,
): Promise<SignedEnvelope<T>> {
  const keyId = await keyIdForPublicKey(publicKeySpki);
  const base: Omit<SignedEnvelope<T>, 'signature'> = {
    schema: SIGNED_SCHEMA,
    type,
    algorithm: SIGNING_ALGORITHM,
    keyId,
    publicKey: publicKeySpki,
    payload,
  };
  const privateKey = await importPrivateKey(privateKeyPkcs8);
  const signature = await globalThis.crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    encoder.encode(signaturePayload(base)),
  );
  return { ...base, signature: bytesToBase64(new Uint8Array(signature)) };
}

export interface EnvelopeVerification {
  valid: boolean;
  signatureValid: boolean;
  keyIdMatches: boolean;
  errors: string[];
}

export async function verifyEnvelope<T>(value: unknown): Promise<EnvelopeVerification> {
  const result: EnvelopeVerification = {
    valid: false,
    signatureValid: false,
    keyIdMatches: false,
    errors: [],
  };
  if (!value || typeof value !== 'object') {
    result.errors.push('Document is not an object.');
    return result;
  }
  const envelope = value as Partial<SignedEnvelope<T>>;
  if (envelope.schema !== SIGNED_SCHEMA) result.errors.push('Unsupported signed-document schema.');
  if (envelope.algorithm !== SIGNING_ALGORITHM) result.errors.push('Unsupported signing algorithm.');
  if (envelope.type !== 'passport' && envelope.type !== 'receipt-proof') {
    result.errors.push('Unsupported document type.');
  }
  if (typeof envelope.keyId !== 'string' || typeof envelope.publicKey !== 'string') {
    result.errors.push('Missing key identifier or public key.');
  }
  if (typeof envelope.signature !== 'string') result.errors.push('Missing signature.');
  if (result.errors.length > 0) return result;

  try {
    const expectedKeyId = await keyIdForPublicKey(envelope.publicKey!);
    result.keyIdMatches = expectedKeyId === envelope.keyId;
    if (!result.keyIdMatches) result.errors.push('Public key does not match the embedded key identifier.');
    const publicKey = await importPublicKey(envelope.publicKey!);
    result.signatureValid = await globalThis.crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      publicKey,
      arrayBufferOf(base64ToBytes(envelope.signature!)),
      encoder.encode(
        signaturePayload({
          type: envelope.type!,
          algorithm: envelope.algorithm!,
          keyId: envelope.keyId!,
          publicKey: envelope.publicKey!,
          payload: envelope.payload as T,
        }),
      ),
    );
    if (!result.signatureValid) result.errors.push('Signature does not match this document.');
  } catch (error) {
    result.errors.push(`Verification failed: ${(error as Error).message}`);
  }
  result.valid = result.signatureValid && result.keyIdMatches && result.errors.length === 0;
  return result;
}

export function decodeJsonUtf8(bytes: Uint8Array): unknown {
  return JSON.parse(decoder.decode(bytes)) as unknown;
}
