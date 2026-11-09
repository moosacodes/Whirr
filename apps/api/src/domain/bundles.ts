import type { AppContext } from '../context.ts';
import type { IntervalRow, SessionRow } from './rows.ts';
import type {
  CaptureClaim,
  EvidenceReceipt,
  ProofBundleInterval,
  ProofBundlePayload,
  SignedPassport,
  SignedProofBundle,
  SignedReceiptProof,
  TrustDomainStatus,
  UncertaintyReason,
  PaymentTimelineEvent,
} from '../../../../packages/contracts/src/types.ts';
import {
  evidenceLeafHash,
  merkleBatchProofs,
  merkleRoot,
  PROOF_BUNDLE_SCHEMA,
} from '../../../../packages/protocol/src/index.ts';
import { hashCanonical } from '../lib/hash.ts';
import { newId } from '../lib/ids.ts';
import { ensureReceiptProof } from './proofs.ts';
import { passportForObject } from './passport.ts';
import { getObject } from './objects.ts';
import { loadIntervals, sessionModelRow, sessionTermsRow } from './sessions.ts';
import { parseArtifact } from './rows.ts';

interface BundleRow {
  id: string;
  session_id: string;
  payload_hash: string;
  document_json: string;
  public_document_json: string;
  created_at: string;
}

function captureClaim(session: SessionRow): CaptureClaim | null {
  if (!session.capture_claim_json) return null;
  try {
    const claim = JSON.parse(session.capture_claim_json) as CaptureClaim;
    if (claim.schema !== 'whirr.capture-claim.v1') return null;
    return claim;
  } catch {
    return null;
  }
}

function uncertaintyReasons(flags: string[]): UncertaintyReason[] {
  const reasons = new Set<UncertaintyReason>();
  for (const flag of flags) {
    if (flag === 'SOUNDPRINT_MISMATCH') reasons.add('SOUNDPRINT_MISMATCH');
    if (flag === 'UNKNOWN_OBJECT') reasons.add('UNKNOWN_OBJECT');
    if (flag === 'LOW_CONFIDENCE') reasons.add('LOW_CONFIDENCE');
    if (flag === 'CLIPPED') reasons.add('CLIPPED');
    if (flag === 'SILENT') reasons.add('SILENT');
    if (flag === 'LOW_LEVEL') reasons.add('LOW_LEVEL');
    if (flag === 'GAP') reasons.add('GAP');
    if (flag === 'DEVICE_LOST') reasons.add('DEVICE_LOST');
    if (flag === 'TAB_HIDDEN') reasons.add('TAB_HIDDEN');
  }
  return [...reasons];
}

async function intervalLeaves(rows: IntervalRow[], sessionId: string): Promise<Array<ProofBundleInterval & { leaf: string }>> {
  const material: Array<Omit<ProofBundleInterval, 'leafHash' | 'merkleProof'> & { leaf: string }> = [];
  for (const row of rows) {
    const explanation = row.explanation_json
      ? (JSON.parse(row.explanation_json) as ProofBundleInterval['explanation'])
      : undefined;
    const flags = JSON.parse(row.quality_flags_json) as string[];
    const leaf = await evidenceLeafHash({
      sessionId,
      seq: row.seq,
      startMs: row.start_ms,
      endMs: row.end_ms,
      state: row.state,
      modelVersion: row.model_version,
      confidence: row.confidence,
      qualityFlags: flags,
      ...(explanation ? { explanation } : {}),
    });
    material.push({
      seq: row.seq,
      startMs: row.start_ms,
      endMs: row.end_ms,
      state: row.state,
      confidence: row.confidence,
      qualityFlags: flags,
      modelVersion: row.model_version,
      evidenceHash: row.evidence_hash,
      uncertaintyReasons: uncertaintyReasons(flags),
      ...(explanation ? { explanation } : {}),
      leaf,
    });
  }
  const { proofs } = await merkleBatchProofs(material.map((entry) => entry.leaf));
  return material.map((entry, index) => {
    const { leaf, ...rest } = entry;
    return { ...rest, leafHash: leaf, merkleProof: proofs[index] ?? [], leaf };
  });
}

function redactedReceipt(receipt: EvidenceReceipt): EvidenceReceipt {
  const mask = (value: string | null): string | null => (value ? `REDACTED-${value.slice(-4)}` : null);
  return {
    ...receipt,
    renterRef: 'REDACTED',
    payment: {
      ...receipt.payment,
      orderId: mask(receipt.payment.orderId),
      authorizationId: mask(receipt.payment.authorizationId),
      captureId: mask(receipt.payment.captureId),
      refundId: mask(receipt.payment.refundId),
    },
    disputes: receipt.disputes.map((dispute) => ({
      ...dispute,
      intervalIds: [],
      reason: 'Dispute text redacted from the public bundle.',
    })),
  };
}

function trustMatrix(input: {
  receipt: EvidenceReceipt;
  capture: CaptureClaim | null;
  merkleRoot: string;
  redacted: boolean;
}): TrustDomainStatus[] {
  return [
    {
      domain: 'INTEGRITY',
      status: 'VERIFIED_OFFLINE',
      detail: `ECDSA P-256 envelope, canonical JSON and a Merkle root over ${input.receipt.timeline.length} interval leaves (${input.merkleRoot.slice(0, 16)}…).`,
    },
    {
      domain: 'SENSING',
      status: 'DECLARED',
      detail: input.capture
        ? `Capture provenance ${input.capture.provenance} is a signed client claim, not physical proof of an object. Passport score and quality exclusions are evidence, not anti-spoofing.`
        : 'No capture claim is stored for this session. Sensing is declared by the installation but cannot be attributed to a microphone path.',
    },
    {
      domain: 'PAYMENT',
      status: 'NOT_VERIFIABLE_OFFLINE',
      detail:
        input.receipt.payment.mode === 'DEMO_NO_PAYMENT'
          ? 'Demo metering: no provider payment exists. The bundle can prove the recorded state, not a PayPal transaction.'
          : 'Offline verification cannot query PayPal. Provider status is installation-recorded; only live reconciliation can claim provider confirmation.',
    },
  ];
}

function limitations(input: {
  receipt: EvidenceReceipt;
  redacted: boolean;
  capture: CaptureClaim | null;
}): string[] {
  return [
    'This bundle is signed installation attestation. It proves which local key signed these bytes, not third-party identity or physical truth.',
    'Offline verification cannot query PayPal. A payment reference is installation-recorded unless separately reconciled with the provider.',
    input.capture
      ? 'Capture provenance is client-reported. A CLIENT_CLAIMED_LIVE_MICROPHONE claim does not prove that a physical object was running.'
      : 'No capture provenance claim is stored; treat sensing attribution as unverified.',
    'Audio is not included and was never uploaded. The record contains acoustic features, state intervals and quality flags only.',
    'The acoustic passport is a calibration-fit similarity gate, not anti-spoofing. Playback or a similar machine can be mistaken for the enrolled object.',
    ...(input.redacted
      ? ['This is the redacted public bundle: renter reference and full provider identifiers are removed.']
      : []),
    ...input.receipt.limitations,
  ];
}

export function bundlePaymentTimeline(ctx: AppContext, sessionId: string): PaymentTimelineEvent[] {
  const rows = ctx.store.all<{
    id: string;
    operation_type: string;
    state: string;
    provider_ref: string | null;
    created_at: string;
    updated_at: string;
  }>(
    'SELECT id, operation_type, state, provider_ref, created_at, updated_at FROM payment_operations WHERE session_id = ? ORDER BY created_at ASC',
    sessionId,
  );
  return rows.map((row) => {
    const state: 'PENDING' | 'DENIED' | 'UNKNOWN' | 'RECONCILED' =
      row.state === 'COMPLETED'
        ? 'RECONCILED'
        : row.state === 'FAILED'
          ? 'DENIED'
          : row.state === 'UNKNOWN'
            ? 'UNKNOWN'
            : 'PENDING';
    return {
      id: row.id,
      at: row.updated_at || row.created_at,
      type: row.operation_type,
      state,
      providerRef: row.provider_ref,
      detail:
        state === 'RECONCILED'
          ? 'Provider operation completed and local state reconciled.'
          : state === 'DENIED'
            ? 'Provider or local validation denied this operation; no success is implied.'
            : state === 'UNKNOWN'
              ? 'Outcome unknown. Operator reconciliation is required.'
              : 'Operation recorded but not yet confirmed.',
    };
  });
}

function buildPayload(input: {
  ctx: AppContext;
  bundleId: string;
  createdAt: string;
  session: SessionRow;
  receipt: EvidenceReceipt;
  proof: SignedReceiptProof;
  passport: SignedPassport | null;
  intervals: Array<ProofBundleInterval & { leaf: string }>;
  root: string;
  redacted: boolean;
  capture: CaptureClaim | null;
}): ProofBundlePayload {
  const { session, receipt, proof, passport, intervals, root, redacted, capture } = input;
  const outputReceipt = redacted ? redactedReceipt(receipt) : receipt;
  const modelRow = sessionModelRow(input.ctx, input.session);
  const artifact = parseArtifact(modelRow);
  const termsRow = sessionTermsRow(input.ctx, input.session);
  return {
    schema: PROOF_BUNDLE_SCHEMA,
    bundleVersion: 3,
    bundleId: input.bundleId,
    createdAt: input.createdAt,
    redacted,
    sessionId: session.id,
    receipt: outputReceipt,
    receiptProof: proof,
    passport,
    capture: redacted && capture ? { ...capture, deviceLabel: capture.deviceLabel ? 'microphone' : null } : capture,
    intervals: intervals.map(({ leaf: _leaf, ...interval }) => interval),
    merkle: {
      schema: 'whirr.merkle.v1',
      algorithm: 'SHA-256',
      leafSchema: 'whirr.evidence-leaf.v1',
      leafCount: intervals.length,
      root,
    },
    model: {
      version: modelRow.version,
      hash: session.model_hash,
      status: modelRow.status,
      provenance: modelRow.provenance,
      precision: receipt.model.precision,
      recall: receipt.model.recall,
      falseBillableRatio: receipt.model.falseBillableRatio,
      takeCount: receipt.model.takeCount,
      featureSpecVersion: artifact.featureSpecVersion,
      datasetHash: artifact.training.datasetHash,
    },
    terms: {
      id: session.terms_id,
      hash: session.terms_hash,
      currency: session.currency,
      minorPerMinute: session.minor_per_minute,
      capMinor: session.cap_minor,
      version: termsRow.version,
    },
    pricing: outputReceipt.pricing,
    payment: outputReceipt.payment,
    trust: trustMatrix({ receipt: outputReceipt, capture, merkleRoot: root, redacted }),
    verification: {
      verifier: 'whirr-offline-v3',
      independentOfApplication: true,
      offline: true,
      instructions: [
        'Open /verify-offline.html in a modern browser, or run npm run proof:verify -- <bundle.json>.',
        'The verifier checks the ECDSA envelope, receipt arithmetic, nested proof and every Merkle inclusion proof.',
        'Pin the installation key fingerprint out of band when the signer is known. Without a pin the key is self-attested.',
        'Payment must be reconciled online with PayPal; an offline bundle cannot prove provider settlement.',
      ],
      keyPinning:
        'Optional: supply a trusted key ID. A bundle signed by a different key fails pinning even if its embedded signature is internally consistent.',
    },
    limitations: limitations({ receipt, redacted, capture }),
    attestation:
      'Signed by this Whirr installation. The integrity domain is independently checkable from these bytes; sensing is a signed client claim; payment is installation-recorded and not verified offline.',
  };
}



export async function ensureProofBundle(
  ctx: AppContext,
  session: SessionRow,
  receipt: EvidenceReceipt,
): Promise<{ authenticated: SignedProofBundle; public: SignedProofBundle }> {
  const rows = loadIntervals(ctx, session.id);
  const leaves = await intervalLeaves(rows, session.id);
  const root = await merkleRoot(leaves.map((entry) => entry.leaf));
  const proof = await ensureReceiptProof(ctx, session, receipt);
  const object = getObject(ctx.store, session.object_id);
  const passport = object ? (await passportForObject(ctx, object)).envelope : null;
  const capture = captureClaim(session);
  const existing = ctx.store.get<BundleRow>('SELECT * FROM proof_bundles WHERE session_id = ?', session.id);
  const bundleId = existing?.id ?? newId('bnd');
  const createdAt = ctx.now().toISOString();
  const authenticatedPayload = buildPayload({
    ctx,
    bundleId,
    createdAt,
    session,
    receipt,
    proof,
    passport,
    intervals: leaves,
    root,
    redacted: false,
    capture,
  });
  const publicPayload = buildPayload({
    ctx,
    bundleId,
    createdAt,
    session,
    receipt,
    proof,
    passport,
    intervals: leaves,
    root,
    redacted: true,
    capture,
  });
  const authenticated = await ctx.signer.sign('proof-bundle', authenticatedPayload);
  const publicBundle = await ctx.signer.sign('proof-bundle', publicPayload);
  const publicJson = JSON.stringify(publicBundle);
  const payloadHash = hashCanonical(authenticatedPayload);
  if (existing) {
    ctx.store.run(
      `UPDATE proof_bundles SET payload_hash = ?, document_json = ?, public_document_json = ?, created_at = ? WHERE id = ?`,
      payloadHash,
      JSON.stringify(authenticated),
      publicJson,
      createdAt,
      existing.id,
    );
  } else {
    ctx.store.run(
      `INSERT INTO proof_bundles (id, session_id, payload_hash, document_json, public_document_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      bundleId,
      session.id,
      payloadHash,
      JSON.stringify(authenticated),
      publicJson,
      createdAt,
    );
  }
  return { authenticated, public: publicBundle };
}

export function proofBundleForSession(ctx: AppContext, sessionId: string): SignedProofBundle | null {
  const row = ctx.store.get<BundleRow>('SELECT * FROM proof_bundles WHERE session_id = ?', sessionId);
  return row ? (JSON.parse(row.document_json) as SignedProofBundle) : null;
}

export function publicProofBundleById(ctx: AppContext, id: string): SignedProofBundle | null {
  const row = ctx.store.get<BundleRow>('SELECT * FROM proof_bundles WHERE id = ?', id);
  return row ? (JSON.parse(row.public_document_json) as SignedProofBundle) : null;
}

export function proofBundleIdForSession(ctx: AppContext, sessionId: string): string | null {
  return (
    ctx.store.get<{ id: string }>('SELECT id FROM proof_bundles WHERE session_id = ?', sessionId)?.id ?? null
  );
}

