import { describe, expect, it } from 'vitest';
import { webcrypto } from 'node:crypto';
import {
  bytesToBase64,
  canonicalJson,
  keyIdForPublicKey,
  recomputeQuoteMinor,
  signEnvelope,
  verifyEnvelope,
} from '../../packages/protocol/src/index.ts';
import { verifyDocument } from '../../packages/verify/src/index.ts';

async function makeKey() {
  const pair = await webcrypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  );
  const privateKey = bytesToBase64(new Uint8Array(await webcrypto.subtle.exportKey('pkcs8', pair.privateKey)));
  const publicKey = bytesToBase64(new Uint8Array(await webcrypto.subtle.exportKey('spki', pair.publicKey)));
  return { privateKey, publicKey, keyId: await keyIdForPublicKey(publicKey) };
}

function passportPayload() {
  return {
    schema: 'whirr.passport.v2' as const,
    passportVersion: 1,
    object: { id: 'obj_test', name: 'Test fan', category: 'fan' },
    model: { version: 'v1', hash: 'a'.repeat(64) },
    attestation: 'installation attestation only',
  };
}

function proofPayload() {
  return {
    schema: 'whirr.receipt-proof.v2' as const,
    proofId: 'prf_test',
    receiptHash: 'b'.repeat(64),
    object: { id: 'obj_test', name: 'Test fan' },
    pricing: {
      currency: 'USD' as const,
      minorPerMinute: 20,
      billableMs: 21_000,
      capMinor: 500,
      baseQuoteMinor: 7,
      creditMinor: 0,
      quoteMinor: 7,
    },
    limitations: ['installation attestation, not physical truth'],
  };
}

describe('Whirr protocol', () => {
  it('canonicalises object keys deterministically', () => {
    expect(canonicalJson({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
    expect(canonicalJson([{ z: true, a: null }])).toBe('[{"a":null,"z":true}]');
  });

  it('signs and verifies a passport and a receipt proof', async () => {
    const key = await makeKey();
    const passport = await signEnvelope('passport', passportPayload(), key.privateKey, key.publicKey);
    const proof = await signEnvelope('receipt-proof', proofPayload(), key.privateKey, key.publicKey);

    expect(passport.keyId).toBe(key.keyId);
    expect((await verifyEnvelope(passport)).valid).toBe(true);
    expect((await verifyEnvelope(proof)).valid).toBe(true);
    expect((await verifyDocument(passport)).valid).toBe(true);
    expect((await verifyDocument(proof)).valid).toBe(true);
  });

  it('recomputes the same half-up cap and credit arithmetic as the meter', () => {
    expect(recomputeQuoteMinor({ minorPerMinute: 20, billableMs: 10_000, capMinor: 500 })).toEqual({
      roundedMinor: 3,
      baseQuoteMinor: 3,
      quoteMinor: 3,
    });
    expect(recomputeQuoteMinor({ minorPerMinute: 20, billableMs: 10_000, capMinor: 500, creditMinor: 50 })).toEqual({
      roundedMinor: 3,
      baseQuoteMinor: 3,
      quoteMinor: 0,
    });
    expect(recomputeQuoteMinor({ minorPerMinute: 2000, billableMs: 120_000, capMinor: 500 })).toEqual({
      roundedMinor: 4000,
      baseQuoteMinor: 500,
      quoteMinor: 500,
    });
  });

  it('fails every meaningful tamper of a signed proof', async () => {
    const key = await makeKey();
    const signed = await signEnvelope('receipt-proof', proofPayload(), key.privateKey, key.publicKey);
    const tampered = [
      { ...signed, signature: signed.signature.slice(0, -1) + (signed.signature.endsWith('A') ? 'B' : 'A') },
      { ...signed, keyId: '0'.repeat(32) },
      { ...signed, payload: { ...signed.payload, pricing: { quoteMinor: 8, capMinor: 500 } } },
      { ...signed, payload: { ...signed.payload, object: { id: 'obj_test', name: 'Different fan' } } },
      { ...signed, type: 'unknown' },
    ];
    for (const document of tampered) {
      const result = await verifyEnvelope(document);
      expect(result.valid, JSON.stringify(document).slice(0, 80)).toBe(false);
    }
  });

  it('keeps old signatures verifiable after key rotation', async () => {
    const first = await makeKey();
    const second = await makeKey();
    const firstDocument = await signEnvelope('passport', passportPayload(), first.privateKey, first.publicKey);
    const secondDocument = await signEnvelope('passport', passportPayload(), second.privateKey, second.publicKey);
    expect(first.keyId).not.toBe(second.keyId);
    expect((await verifyEnvelope(firstDocument)).valid).toBe(true);
    expect((await verifyEnvelope(secondDocument)).valid).toBe(true);
    expect((await verifyDocument(firstDocument)).valid).toBe(true);
  });

  it('labels legacy unsigned artifacts instead of trusting them', async () => {
    const legacy = { schema: 'whirr.receipt.v1', receiptId: 'rcp_legacy', pricing: { quoteMinor: 7, capMinor: 500 } };
    const result = await verifyDocument(legacy);
    expect(result.valid).toBe(false);
    expect(result.kind).toBe('unknown');
  });
});