import { verifyPhysicalProofDocument } from './physical.ts';
import { verifyAmbientProofDocument } from './ambient.ts';
import {
  canonicalJson,
  evidenceLeafHash,
  merkleRoot,
  recomputeQuoteMinor,
  sha256Hex,
  verifyEnvelope,
  verifyMerkleProof,
  type EnvelopeVerification,
  type MerkleProofStep,
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
  kind: 'passport' | 'receipt-proof' | 'proof-bundle' | 'physical-proof' | 'ambient-proof' | 'unknown';
  envelope: EnvelopeVerification;
  checks: DocumentCheck[];
}

export interface VerifyDocumentOptions {
  /** Optional out-of-band pin. A different embedded key fails verification. */
  trustedKeyId?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function add(checks: DocumentCheck[], id: string, label: string, pass: boolean, detail: string): void {
  checks.push({ id, label, pass, detail });
}

function isHash(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function pricingChecks(
  pricing: Record<string, unknown> | null,
  billableMsOverride?: number | null,
): { pass: boolean; detail: string } {
  if (!pricing) return { pass: false, detail: 'Pricing is missing.' };
  const quoteMinor = typeof pricing.quoteMinor === 'number' ? pricing.quoteMinor : null;
  const capMinor = typeof pricing.capMinor === 'number' ? pricing.capMinor : null;
  const baseQuoteMinor = typeof pricing.baseQuoteMinor === 'number' ? pricing.baseQuoteMinor : null;
  const creditMinor = typeof pricing.creditMinor === 'number' ? pricing.creditMinor : null;
  const minorPerMinute = typeof pricing.minorPerMinute === 'number' ? pricing.minorPerMinute : null;
  const billableMs =
    typeof pricing.billableMs === 'number'
      ? pricing.billableMs
      : typeof billableMsOverride === 'number'
        ? billableMsOverride
        : null;
  if (
    quoteMinor === null ||
    capMinor === null ||
    baseQuoteMinor === null ||
    creditMinor === null ||
    minorPerMinute === null ||
    billableMs === null
  ) {
    return { pass: false, detail: 'Pricing fields are missing.' };
  }
  try {
    const expected = recomputeQuoteMinor({ minorPerMinute, billableMs, capMinor, creditMinor });
    const expectedReferenceBase = expected.baseQuoteMinor + creditMinor;
    const pass =
      expectedReferenceBase === baseQuoteMinor &&
      expected.quoteMinor === quoteMinor &&
      quoteMinor >= 0 &&
      quoteMinor <= capMinor;
    return {
      pass,
      detail: `rate ${minorPerMinute} × ${billableMs} ms, credit ${creditMinor}, reference base ${expectedReferenceBase} → ${expected.quoteMinor} minor (document says ${quoteMinor}, cap ${capMinor}).`,
    };
  } catch (error) {
    return { pass: false, detail: `Quote fields are not valid integers: ${(error as Error).message}` };
  }
}

async function verifyBundle(
  value: Record<string, unknown>,
  payload: Record<string, unknown>,
  options: VerifyDocumentOptions,
  checks: DocumentCheck[],
): Promise<boolean> {
  add(
    checks,
    'bundle_schema',
    'Proof bundle v3 schema',
    payload.schema === 'whirr.proof-bundle.v3' && payload.bundleVersion === 3,
    payload.schema === 'whirr.proof-bundle.v3'
      ? 'Recognised whirr.proof-bundle.v3 payload.'
      : 'Payload is not a Whirr proof bundle v3.',
  );

  if (options.trustedKeyId) {
    add(
      checks,
      'key_pin',
      'Verifier key pin',
      value.keyId === options.trustedKeyId,
      value.keyId === options.trustedKeyId
        ? `Signer key ${String(value.keyId).slice(0, 12)}… matches the pinned fingerprint.`
        : `Signer key ${String(value.keyId).slice(0, 12)}… does not match the pinned fingerprint.`,
    );
  } else {
    add(
      checks,
      'key_pin',
      'Key pinning (optional)',
      true,
      'No out-of-band key fingerprint was supplied. This is a self-attested installation key; pinning is required to detect key substitution.',
    );
  }

  const trust = Array.isArray(payload.trust) ? payload.trust : [];
  const domains = new Set(
    trust
      .filter(isRecord)
      .map((entry) => entry.domain)
      .filter((domain): domain is string => typeof domain === 'string'),
  );
  add(
    checks,
    'trust_domains',
    'Separate integrity, sensing and payment trust domains',
    ['INTEGRITY', 'SENSING', 'PAYMENT'].every((domain) => domains.has(domain)),
    [...domains].join(', ') || 'No trust-domain matrix is present.',
  );
  const paymentTrust = trust.find((entry) => isRecord(entry) && entry.domain === 'PAYMENT');
  add(
    checks,
    'payment_offline',
    'Payment is not claimed as verified offline',
    isRecord(paymentTrust) && paymentTrust.status === 'NOT_VERIFIABLE_OFFLINE',
    isRecord(paymentTrust)
      ? String(paymentTrust.detail)
      : 'The payment domain does not explicitly disclaim offline provider verification.',
  );

  const receipt = isRecord(payload.receipt) ? payload.receipt : null;
  const receiptProof = isRecord(payload.receiptProof) ? payload.receiptProof : null;
  add(checks, 'bundle_receipt', 'Receipt present', Boolean(receipt), receipt ? `Receipt ${String(receipt.receiptId)}.` : 'No receipt.');
  if (!receipt || !receiptProof) return false;

  const nestedProof = await verifyEnvelope(receiptProof);
  add(
    checks,
    'nested_receipt_proof',
    'Nested receipt proof signature',
    nestedProof.valid && receiptProof.type === 'receipt-proof' && isRecord(receiptProof.payload),
    nestedProof.valid ? 'The embedded receipt proof has its own valid installation signature.' : nestedProof.errors.join(' '),
  );
  const proofPayload = isRecord(receiptProof.payload) ? receiptProof.payload : {};
  add(
    checks,
    'receipt_proof_binding',
    'Receipt proof binds the full receipt',
    proofPayload.receiptHash === receipt.evidenceSha256 &&
      proofPayload.sessionId === payload.sessionId &&
      proofPayload.receiptId === receipt.receiptId,
    `proof receiptHash ${String(proofPayload.receiptHash).slice(0, 16)}… / receipt ${String(receipt.evidenceSha256).slice(0, 16)}…`,
  );

  const passport = payload.passport;
  if (passport !== null && passport !== undefined) {
    const nestedPassport = isRecord(passport) ? await verifyEnvelope(passport) : null;
    add(
      checks,
      'nested_passport',
      'Nested passport signature',
      Boolean(nestedPassport?.valid) && isRecord(passport) && passport.type === 'passport',
      nestedPassport?.valid
        ? 'The embedded acoustic passport has a valid installation signature.'
        : (nestedPassport?.errors.join(' ') ?? 'The passport block is not a signed envelope.'),
    );
  } else {
    add(checks, 'nested_passport', 'Nested passport signature', true, 'No passport is embedded in this bundle.');
  }

  const redacted = payload.redacted === true;
  if (redacted) {
    const payment = isRecord(receipt.payment) ? receipt.payment : {};
    const ids = ['orderId', 'authorizationId', 'captureId', 'refundId']
      .map((key) => payment[key])
      .filter((id) => typeof id === 'string');
    add(
      checks,
      'redaction',
      'Public redaction applied',
      receipt.renterRef === 'REDACTED' && ids.every((id) => String(id).startsWith('REDACTED')),
      "The public bundle removes the renter reference and full provider identifiers. Redaction is covered by the outer signature.",
    );
  } else {
    const fresh = { ...receipt } as Record<string, unknown>;
    delete fresh.verification;
    delete fresh.evidenceSha256;
    const recomputed = await sha256Hex(canonicalJson(fresh));
    add(
      checks,
      'full_receipt_hash',
      'Full receipt hash recomputes',
      recomputed === receipt.evidenceSha256,
      recomputed === receipt.evidenceSha256
        ? 'The full receipt canonical hash matches its evidenceSha256 field.'
        : 'The full receipt was edited after it was hashed.',
    );
  }

  const pricing = isRecord(receipt.pricing) ? receipt.pricing : null;
  const totals = isRecord(receipt.totals) ? receipt.totals : {};
  const arithmetic = pricingChecks(
    pricing,
    typeof totals.billableMs === 'number' ? totals.billableMs : null,
  );
  add(checks, 'bundle_quote', 'Bundle quote arithmetic and cap', arithmetic.pass, arithmetic.detail);

  const payment = isRecord(receipt.payment) ? receipt.payment : {};
  const bundlePayment = isRecord(payload.payment) ? payload.payment : {};
  add(
    checks,
    'payment_binding',
    'Payment block matches the receipt',
    payment.state === bundlePayment.state &&
      payment.mode === bundlePayment.mode &&
      payment.capturedMinor === bundlePayment.capturedMinor,
    `receipt ${String(payment.mode)} / ${String(payment.state)}; bundle ${String(bundlePayment.mode)} / ${String(bundlePayment.state)}.`,
  );

  const receiptModel = isRecord(receipt.model) ? receipt.model : {};
  const bundleModel = isRecord(payload.model) ? payload.model : {};
  add(
    checks,
    'model_binding',
    'Model metadata matches the receipt',
    bundleModel.version === receiptModel.version &&
      bundleModel.hash === receiptModel.hash &&
      bundleModel.status === receiptModel.status &&
      bundleModel.provenance === receiptModel.provenance &&
      bundleModel.precision === receiptModel.precision &&
      bundleModel.recall === receiptModel.recall &&
      bundleModel.falseBillableRatio === receiptModel.falseBillableRatio &&
      bundleModel.takeCount === receiptModel.takeCount,
    `bundle ${String(bundleModel.version)} / ${String(bundleModel.hash).slice(0, 12)}…; receipt ${String(receiptModel.version)} / ${String(receiptModel.hash).slice(0, 12)}…`,
  );

  const receiptTerms = isRecord(receipt.terms) ? receipt.terms : {};
  const bundleTerms = isRecord(payload.terms) ? payload.terms : {};
  add(
    checks,
    'terms_binding',
    'Terms match the receipt',
    bundleTerms.hash === receipt.termsHash &&
      bundleTerms.currency === receiptTerms.currency &&
      bundleTerms.minorPerMinute === receiptTerms.minorPerMinute &&
      bundleTerms.capMinor === receiptTerms.capMinor,
    `bundle ${String(bundleTerms.hash).slice(0, 12)}…; receipt ${String(receipt.termsHash).slice(0, 12)}…`,
  );

  const capture = isRecord(payload.capture) ? payload.capture : null;
  if (capture) {
    const validProvenance = [
      'CLIENT_CLAIMED_LIVE_MICROPHONE',
      'IMPORTED_EVIDENCE_REPLAY',
      'SYNTHETIC_FIXTURE_REPLAY',
      'DEMO_NO_PAYMENT',
    ].includes(String(capture.provenance));
    add(
      checks,
      'capture_claim',
      'Capture provenance labelled as a client claim',
      capture.schema === 'whirr.capture-claim.v1' && validProvenance,
      `${String(capture.provenance)}. This is signed client testimony, not physical proof that a microphone or object was present.`,
    );
  } else {
    add(
      checks,
      'capture_claim',
      'Capture provenance',
      true,
      'No capture claim is present. The bundle does not attribute the intervals to a particular microphone path.',
    );
  }

  const intervals = Array.isArray(payload.intervals) ? payload.intervals : [];
  const merkle = isRecord(payload.merkle) ? payload.merkle : {};
  const root = typeof merkle.root === 'string' ? merkle.root : '';
  const receiptTimeline = Array.isArray(receipt.timeline) ? receipt.timeline : [];
  add(
    checks,
    'interval_count',
    'Interval ledger matches the receipt',
    intervals.length === receiptTimeline.length &&
      merkle.leafCount === intervals.length &&
      isHash(root),
    `${intervals.length} bundle interval(s), ${receiptTimeline.length} receipt interval(s), leaf count ${String(merkle.leafCount)}.`,
  );

  const leafHashes: string[] = [];
  let merklePass = intervals.length > 0;
  let ledgerPass = true;
  let previousEnd = 0;
  const stateMs: Record<string, number> = {
    ACTIVE_CONFIDENT: 0,
    IDLE: 0,
    UNCERTAIN: 0,
    DISCONNECTED: 0,
  };
  for (let index = 0; index < intervals.length; index += 1) {
    const interval = intervals[index];
    if (!isRecord(interval)) {
      merklePass = false;
      ledgerPass = false;
      continue;
    }
    const proof = Array.isArray(interval.merkleProof) ? (interval.merkleProof as MerkleProofStep[]) : [];
    const explanation = isRecord(interval.explanation) ? interval.explanation : undefined;
    const leafHash = await evidenceLeafHash({
      sessionId: String(payload.sessionId),
      seq: Number(interval.seq),
      startMs: Number(interval.startMs),
      endMs: Number(interval.endMs),
      state: String(interval.state),
      modelVersion: String(interval.modelVersion),
      confidence: Number(interval.confidence),
      qualityFlags: Array.isArray(interval.qualityFlags) ? interval.qualityFlags.map(String) : [],
      ...(explanation ? { explanation } : {}),
    });
    leafHashes.push(leafHash);
    if (interval.leafHash !== leafHash) merklePass = false;
    if (!(await verifyMerkleProof(leafHash, proof, root))) merklePass = false;
    const receiptEntry = receiptTimeline[index];
    if (
      !isRecord(receiptEntry) ||
      receiptEntry.startMs !== interval.startMs ||
      receiptEntry.endMs !== interval.endMs ||
      receiptEntry.state !== interval.state ||
      receiptEntry.confidence !== interval.confidence ||
      canonicalJson(receiptEntry.qualityFlags ?? []) !== canonicalJson(interval.qualityFlags ?? []) ||
      canonicalJson(receiptEntry.explanation ?? null) !== canonicalJson(interval.explanation ?? null)
    ) {
      ledgerPass = false;
    }
    if (Number(interval.seq) !== index + 1 || Number(interval.startMs) < previousEnd || Number(interval.endMs) <= Number(interval.startMs)) {
      ledgerPass = false;
    }
    const state = String(interval.state);
    if (!(state in stateMs)) ledgerPass = false;
    else stateMs[state] += Number(interval.endMs) - Number(interval.startMs);
    if (Number(interval.confidence) < 0 || Number(interval.confidence) > 1) ledgerPass = false;
    if (!Array.isArray(interval.qualityFlags)) ledgerPass = false;
    previousEnd = Math.max(previousEnd, Number(interval.endMs));
  }
  const observedMs = Object.values(stateMs).reduce((total, value) => total + value, 0);
  const totalsPass =
    typeof totals.observedMs === 'number' &&
    typeof totals.billableMs === 'number' &&
    typeof totals.uncertainMs === 'number' &&
    typeof totals.idleMs === 'number' &&
    typeof totals.disconnectedMs === 'number' &&
    totals.observedMs === observedMs &&
    totals.billableMs === stateMs.ACTIVE_CONFIDENT &&
    totals.idleMs === stateMs.IDLE &&
    totals.uncertainMs === stateMs.UNCERTAIN &&
    totals.disconnectedMs === stateMs.DISCONNECTED;
  const recomputedRoot = await merkleRoot(leafHashes);
  add(
    checks,
    'merkle',
    'Every interval Merkle proof reaches the signed root',
    merklePass && recomputedRoot === root,
    merklePass
      ? `All ${intervals.length} inclusion proof(s) verify; root ${root.slice(0, 16)}…`
      : 'An interval leaf, inclusion proof, ordering or the Merkle root was edited.',
  );
  add(
    checks,
    'ledger',
    'Interval ledger matches the receipt timeline',
    ledgerPass,
    ledgerPass
      ? 'Sequence, timestamps, states, confidence, flags and explanations match the receipt exactly.'
      : 'The receipt timeline and the signed interval ledger disagree.',
  );
  add(
    checks,
    'ledger_totals',
    'Receipt totals recompute from interval states',
    totalsPass,
    totalsPass
      ? `Observed ${observedMs} ms = billable ${stateMs.ACTIVE_CONFIDENT} + idle ${stateMs.IDLE} + uncertain ${stateMs.UNCERTAIN} + disconnected ${stateMs.DISCONNECTED}.`
      : 'Receipt totals, state durations or observed duration do not match the signed interval ledger.',
  );

  add(
    checks,
    'limitations',
    'Limitations and verification instructions present',
    Array.isArray(payload.limitations) &&
      payload.limitations.length > 0 &&
      isRecord(payload.verification) &&
      payload.verification.offline === true,
    isRecord(payload.verification)
      ? String(payload.verification.attestation ?? 'Offline verification instructions are present.')
      : 'No verification instructions were included.',
  );

  const serialized = canonicalJson(payload);
  add(
    checks,
    'no_audio',
    'No raw audio embedded',
    !/"rawAudio"|data:audio\/|"samples"\s*:\s*\[/i.test(serialized),
    'The bundle contains interval metadata, hashes and feature explanations only.',
  );
  return checks.every((check) => check.pass);
}

export async function verifyDocument(
  value: unknown,
  options: VerifyDocumentOptions = {},
): Promise<DocumentVerification> {
  const envelope = await verifyEnvelope(value);
  const checks: DocumentCheck[] = [];
  add(
    checks,
    'schema',
    'Signed document envelope',
    envelope.valid,
    envelope.valid
      ? 'Signature and key identifier verify.'
      : envelope.errors.join(' '),
  );

  if (!isRecord(value) || !isRecord(value.payload)) {
    return { valid: false, kind: 'unknown', envelope, checks };
  }
  const payload = value.payload as Record<string, unknown>;
  const kind: DocumentVerification['kind'] =
    value.type === 'passport'
      ? 'passport'
      : value.type === 'receipt-proof'
        ? 'receipt-proof'
        : value.type === 'proof-bundle'
          ? 'proof-bundle'            : value.type === 'physical-proof'
              ? 'physical-proof'
              : value.type === 'ambient-proof'
                ? 'ambient-proof'
                : 'unknown';

  if (kind === 'physical-proof') {
    const physical = await verifyPhysicalProofDocument(value);
    checks.push(...physical.checks);
    return { valid: physical.valid, kind, envelope, checks };
  }

  if (kind === 'ambient-proof') {
    const ambient = await verifyAmbientProofDocument(value);
    checks.push(...ambient.checks);
    return { valid: ambient.valid, kind, envelope, checks };
  }

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
    add(
      checks,
      'cap',
      'Proof quote respects its cap',
      quoteMinor !== null && capMinor !== null && quoteMinor >= 0 && quoteMinor <= capMinor,
      quoteMinor !== null && capMinor !== null ? `${quoteMinor} minor units against cap ${capMinor}.` : 'Pricing is missing.',
    );
    const arithmetic = pricingChecks(pricing);
    add(checks, 'quote', 'Proof quote arithmetic', arithmetic.pass, arithmetic.detail);
  } else if (kind === 'proof-bundle') {
    const bundleValid = await verifyBundle(value, payload, options, checks);
    const complete = envelope.valid && bundleValid;
    return { valid: complete, kind, envelope, checks };
  } else {
    add(checks, 'kind', 'Document kind', false, 'Only passport, receipt-proof, proof-bundle v3 and physical-proof v1 documents are supported.');
  }

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
  if (value.type === 'proof-bundle' && isRecord(payload.receipt)) {
    const receipt = payload.receipt;
    const object = isRecord(receipt.object) ? receipt.object : null;
    const pricing = isRecord(receipt.pricing) ? receipt.pricing : null;
    return `${String(object?.name ?? 'Whirr object')} · ${String(pricing?.quoteMinor ?? '?')} minor · proof bundle v3`;
  }
  if (value.type === 'physical-proof' && isRecord(payload.object) && isRecord(payload.evaluation)) {
    return `${String(payload.object.name ?? 'Whirr object')} · ${String(payload.evaluation.outcome ?? '?')} · physical proof v1`;
  }
  if (value.type === 'ambient-proof' && isRecord(payload.target) && isRecord(payload.evaluation)) {
    return `${String(payload.target.objectName ?? 'Whirr object')} · ${String(payload.evaluation.outcome ?? '?')} · ambient proof v1`;
  }
  return 'Whirr signed document';
}

export { verifyPhysicalProofDocument } from './physical.ts';
export { verifyAmbientProofDocument } from './ambient.ts';
export type { SignedEnvelope };
