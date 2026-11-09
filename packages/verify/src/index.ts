import {
  canonicalJson,
  recomputeQuoteMinor,
  sha256Hex,
  verifyEnvelope,
  type EnvelopeVerification,
  type SignedEnvelope,
} from '../../protocol/src/index.ts';

export interface DocumentCheck {
  id: string;
  label: string;
  pass: boolean;
  detail: string;
}

export interface DocumentVerification {
  valid: boolean;
  kind: 'passport' | 'receipt-proof' | 'unknown';
  envelope: EnvelopeVerification;
  checks: DocumentCheck[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function add(checks: DocumentCheck[], id: string, label: string, pass: boolean, detail: string): void {
  checks.push({ id, label, pass, detail });
}

export async function verifyDocument(value: unknown): Promise<DocumentVerification> {
  const envelope = await verifyEnvelope(value);
  const checks: DocumentCheck[] = [];
  add(checks, 'schema', 'Signed document envelope', envelope.valid, envelope.valid ? 'Signature and key identifier verify.' : envelope.errors.join(' '));

  if (!isRecord(value) || !isRecord(value.payload)) {
    return { valid: false, kind: 'unknown', envelope, checks };
  }
  const payload = value.payload as Record<string, unknown>;
  const kind = value.type === 'passport' ? 'passport' : value.type === 'receipt-proof' ? 'receipt-proof' : 'unknown';

  if (kind === 'passport') {
    add(
      checks,
      'passport_schema',
      'Passport schema',
      payload.schema === 'whirr.passport.v2',
      payload.schema === 'whirr.passport.v2' ? 'Recognised passport v2 payload.' : 'Payload is not a Whirr passport v2.',
    );
    const model = isRecord(payload.model) ? payload.model : null;
    const object = isRecord(payload.object) ? payload.object : null;
    add(checks, 'object', 'Object identity present', Boolean(object?.id && object?.name), object?.id ? `${String(object.name)} (${String(object.id)})` : 'Object metadata is missing.');
    add(checks, 'model', 'Model hash present', typeof model?.hash === 'string' && /^[a-f0-9]{64}$/.test(model.hash), model?.hash ? 'Model artifact is pinned by SHA-256.' : 'No model hash.');
    add(
      checks,
      'key',
      'Installation key identifier',
      typeof value.keyId === 'string' && value.keyId.length >= 16,
      typeof value.keyId === 'string' ? `Key ${value.keyId.slice(0, 12)}… · installation-signed, not a third-party identity.` : 'No key identifier.',
    );
  } else if (kind === 'receipt-proof') {
    add(
      checks,
      'receipt_schema',
      'Receipt proof schema',
      payload.schema === 'whirr.receipt-proof.v2',
      payload.schema === 'whirr.receipt-proof.v2' ? 'Recognised receipt-proof v2 payload.' : 'Payload is not a Whirr receipt proof v2.',
    );
    add(
      checks,
      'receipt_hash',
      'Receipt hash present',
      typeof payload.receiptHash === 'string' && /^[a-f0-9]{64}$/.test(payload.receiptHash),
      payload.receiptHash ? 'Receipt summary hash is pinned.' : 'No receipt hash.',
    );
    const pricing = isRecord(payload.pricing) ? payload.pricing : null;
    const quoteMinor = typeof pricing?.quoteMinor === 'number' ? pricing.quoteMinor : null;
    const capMinor = typeof pricing?.capMinor === 'number' ? pricing.capMinor : null;
    const baseQuoteMinor = typeof pricing?.baseQuoteMinor === 'number' ? pricing.baseQuoteMinor : null;
    const creditMinor = typeof pricing?.creditMinor === 'number' ? pricing.creditMinor : null;
    const minorPerMinute = typeof pricing?.minorPerMinute === 'number' ? pricing.minorPerMinute : null;
    const billableMs = typeof pricing?.billableMs === 'number' ? pricing.billableMs : null;
    add(
      checks,
      'cap',
      'Proof quote respects its cap',
      quoteMinor !== null && capMinor !== null && quoteMinor >= 0 && quoteMinor <= capMinor,
      quoteMinor !== null && capMinor !== null ? `${quoteMinor} minor units against cap ${capMinor}.` : 'Pricing is missing.',
    );
    let arithmetic = false;
    let arithmeticDetail = 'Pricing fields are missing.';
    if (
      quoteMinor !== null &&
      capMinor !== null &&
      baseQuoteMinor !== null &&
      creditMinor !== null &&
      minorPerMinute !== null &&
      billableMs !== null
    ) {
      try {
        const expected = recomputeQuoteMinor({ minorPerMinute, billableMs, capMinor, creditMinor });
        // Receipt v1 stores its reference base as capped time plus credits, while
        // the chargeable quote subtracts the credit. Match that documented shape
        // instead of silently redefining an existing receipt field.
        const expectedReferenceBase = expected.baseQuoteMinor + creditMinor;
        arithmetic = expectedReferenceBase === baseQuoteMinor && expected.quoteMinor === quoteMinor;
        arithmeticDetail = `rate ${minorPerMinute} × ${billableMs} ms, credit ${creditMinor}, reference base ${expectedReferenceBase} → ${expected.quoteMinor} minor (proof says ${quoteMinor}).`;
      } catch (error) {
        arithmeticDetail = `Quote fields are not valid integers: ${(error as Error).message}`;
      }
    }
    add(checks, 'quote', 'Proof quote arithmetic', arithmetic, arithmeticDetail);
  } else {
    add(checks, 'kind', 'Document kind', false, 'Only passport and receipt-proof documents are supported.');
  }

  // A second independent digest of the payload makes accidental edits obvious
  // even to a reader that only has the JSON file.
  if (payload.schema === 'whirr.passport.v2' || payload.schema === 'whirr.receipt-proof.v2') {
    const digest = await sha256Hex(canonicalJson(payload));
    add(checks, 'payload_digest', 'Payload digest', /^[a-f0-9]{64}$/.test(digest), `SHA-256 ${digest.slice(0, 16)}…`);
  }

  return {
    valid: checks.every((check) => check.pass),
    kind,
    envelope,
    checks,
  };
}

export function summarizeDocument(value: unknown): string {
  if (!isRecord(value) || !isRecord(value.payload)) return 'Unrecognised document';
  const payload = value.payload;
  if (value.type === 'passport' && isRecord(payload.object) && isRecord(payload.model)) {
    return `${String(payload.object.name)} · model ${String(payload.model.version)} · passport v${String(payload.passportVersion ?? '?')}`;
  }
  if (value.type === 'receipt-proof' && isRecord(payload.object)) {
    return `${String(payload.object.name)} · ${String(payload.sessionId ?? 'session')} · proof v2`;
  }
  return 'Whirr signed document';
}

export type { SignedEnvelope };
