import type { AppContext } from '../context.ts';
import type { SessionRow } from './rows.ts';
import { parseArtifact, parseTerms } from './rows.ts';
import {
  evidenceRoot,
  loadConsent,
  loadIntervals,
  intervalRowsToRaw,
  sessionModelRow,
  sessionObjectRow,
  sessionTermsRow,
} from './sessions.ts';
import { hashCanonical } from '../lib/hash.ts';
import { shortRef } from '../lib/hash.ts';
import { quoteBreakdown } from '../../../../packages/meter/src/pricing.ts';
import { summariseIntervals } from '../../../../packages/meter/src/intervals.ts';
import { verifyAuditChain } from '../lib/audit.ts';
import { renterRef } from '../lib/auth.ts';
import type {
  DisputeView,
  EvidenceReceipt,
  ReceiptVerification,
} from '../../../../packages/contracts/src/types.ts';

function paymentMode(session: SessionRow): EvidenceReceipt['payment']['mode'] {
  if (session.payment_state === 'DEMO_MODE') return 'DEMO_NO_PAYMENT';
  if (
    session.paypal_order_id ||
    session.paypal_authorization_id ||
    session.paypal_capture_id ||
    session.paypal_refund_id
  ) {
    return 'PAYPAL_SANDBOX';
  }
  return 'PENDING';
}

function disputeViews(ctx: AppContext, sessionId: string): DisputeView[] {
  const rows = ctx.store.all<import('./rows.ts').DisputeRow>(
    'SELECT * FROM disputes WHERE session_id = ? ORDER BY created_at ASC',
    sessionId,
  );
  return rows.map((row) => ({
    id: row.id,
    sessionId: row.session_id,
    intervalIds: JSON.parse(row.interval_ids_json) as string[],
    reason: row.reason,
    reasonCode: (row.reason_code ?? 'OTHER') as DisputeView['reasonCode'],
    status: row.status,
    resolution: row.resolution,
    creditMinor: row.credit_minor,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
  }));
}

export function buildReceipt(ctx: AppContext, session: SessionRow): EvidenceReceipt {
  const object = sessionObjectRow(ctx, session);
  const termsRow = sessionTermsRow(ctx, session);
  const terms = parseTerms(termsRow);
  const modelRow = sessionModelRow(ctx, session);
  const model = parseArtifact(modelRow);
  const intervals = loadIntervals(ctx, session.id);
  const summary = summariseIntervals(intervalRowsToRaw(intervals));
  const consent = loadConsent(ctx, session.id);
  const breakdown = quoteBreakdown(
    session.minor_per_minute,
    summary.billableMs,
    session.cap_minor,
    session.credit_minor,
    session.currency,
  );
  const owner = ctx.store.get<{ display_name: string | null }>(
    'SELECT display_name FROM users WHERE id = ?',
    object.owner_id,
  );
  const disputes = disputeViews(ctx, session.id);
  const refund = ctx.store.get<{ provider_id: string; amount_minor: number | null }>(
    "SELECT provider_id, amount_minor FROM paypal_resources WHERE session_id = ? AND kind = 'REFUND' ORDER BY created_at DESC LIMIT 1",
    session.id,
  );
  const limitations = [...model.limitations];
  if (paymentMode(session) === 'DEMO_NO_PAYMENT') {
    limitations.unshift(
      'This session ran in demo metering mode because PayPal Sandbox credentials were not configured. No payment was processed, authorized, captured or refunded.',
    );
  }
  if (session.review_mode === 'OPERATOR_REQUIRED') {
    limitations.push('Because this model is LIMITED, the operator reviewed and approved the final amount before capture.');
  }

  const timeline = intervals.map((row) => ({
    startMs: row.start_ms,
    endMs: row.end_ms,
    state: row.state,
    confidence: row.confidence,
    qualityFlags: JSON.parse(row.quality_flags_json) as string[],
    ...(row.explanation_json ? { explanation: JSON.parse(row.explanation_json) as import('../../../../packages/contracts/src/types.ts').IntervalExplanation } : {}),
  }));
  const passportMismatches = timeline.filter((entry) => entry.qualityFlags.includes('SOUNDPRINT_MISMATCH'));
  const passportMismatchMs = passportMismatches.reduce(
    (total, entry) => total + Math.max(0, entry.endMs - entry.startMs),
    0,
  );

  const base: Omit<EvidenceReceipt, 'evidenceSha256' | 'verification'> = {
    schema: 'whirr.receipt.v1',
    receiptId: shortRef('rcp', session.id),
    sessionId: session.id,
    object: {
      id: object.id,
      name: object.name,
      category: object.category,
      ownerLabel: owner?.display_name ?? 'Whirr operator',
    },
    createdAt: session.finalized_at ?? session.stopped_at ?? session.created_at,
    renterRef: renterRef(session.renter_id),
    terms,
    termsHash: session.terms_hash,
    model: {
      version: modelRow.version,
      hash: session.model_hash,
      status: modelRow.status,
      provenance: model.provenance,
      precision: model.metrics.precision,
      recall: model.metrics.recall,
      falseBillableRatio: model.metrics.falseBillableRatio,
      takeCount: model.training.takeCount,
      soundprint: model.soundprint
        ? {
            status: model.soundprint.status,
            gateEnabled: model.soundprint.gateEnabled,
            matchThreshold: model.soundprint.matchThreshold,
            activeMedianSimilarity: model.soundprint.activeMedianSimilarity,
            nonActiveP95Similarity: model.soundprint.nonActiveP95Similarity,
            activeBlockRatio: model.soundprint.activeBlockRatio,
            nonActivePassRatio: model.soundprint.nonActivePassRatio,
          }
        : null,
    },
    consent: {
      acceptedAt: consent?.accepted_at ?? session.consented_at,
      termsHash: consent?.terms_hash ?? session.terms_hash,
      modelHash: consent?.model_hash ?? session.model_hash,
    },
    passport: {
      status: model.soundprint?.status ?? 'NOT_ENROLLED',
      gateEnabled: model.soundprint?.gateEnabled ?? false,
      matchThreshold: model.soundprint?.matchThreshold ?? 0,
      mismatchIntervals: passportMismatches.length,
      mismatchMs: passportMismatchMs,
    },
    timeline,
    totals: {
      observedMs: summary.observedMs,
      billableMs: summary.billableMs,
      uncertainMs: summary.uncertainMs,
      idleMs: summary.idleMs,
      disconnectedMs: summary.disconnectedMs,
    },
    pricing: {
      currency: session.currency,
      minorPerMinute: session.minor_per_minute,
      capMinor: session.cap_minor,
      baseQuoteMinor: breakdown.cappedMinor + breakdown.creditMinor,
      creditMinor: breakdown.creditMinor,
      quoteMinor: breakdown.finalMinor,
      rounding: 'ROUND_ONCE_AT_END',
      formula: breakdown.formula,
    },
    payment: {
      state: session.payment_state,
      mode: paymentMode(session),
      orderId: session.paypal_order_id,
      authorizationId: session.paypal_authorization_id,
      captureId: session.paypal_capture_id,
      refundId: refund?.provider_id ?? session.paypal_refund_id,
      refundMinor: refund?.amount_minor ?? null,
      providerStatus: session.provider_status,
      providerReconciledAt: session.provider_reconciled_at,
      capturedMinor: session.captured_minor,
    },
    disputes,
    review: {
      quoteHash: session.quote_hash ?? '',
      acceptedAt: session.reviewed_at,
      operatorApprovedAt: session.operator_approved_at,
      reviewMode: session.review_mode,
    },
    limitations,
    sessionEvidenceSha256: session.evidence_hash,
    finalized: Boolean(session.finalized_at),
  };
  const evidenceSha256 = hashCanonical(base);
  return { ...base, evidenceSha256 };
}

export function verifyReceipt(ctx: AppContext, session: SessionRow, receipt: EvidenceReceipt): ReceiptVerification {
  const intervals = loadIntervals(ctx, session.id);
  const summary = summariseIntervals(intervalRowsToRaw(intervals));
  const breakdown = quoteBreakdown(
    session.minor_per_minute,
    summary.billableMs,
    session.cap_minor,
    session.credit_minor,
    session.currency,
  );
  const root = evidenceRoot(session, intervals, { billableMs: summary.billableMs });
  const audit = verifyAuditChain(ctx.store);
  const timeline = intervals.map((row) => ({
    startMs: row.start_ms,
    endMs: row.end_ms,
    qualityFlags: JSON.parse(row.quality_flags_json) as string[],
  }));
  const passportMismatches = timeline.filter((entry) => entry.qualityFlags.includes('SOUNDPRINT_MISMATCH'));
  const passportMismatchMs = passportMismatches.reduce(
    (total, entry) => total + Math.max(0, entry.endMs - entry.startMs),
    0,
  );
  const expectedPassportStatus = receipt.model.soundprint?.status ?? 'NOT_ENROLLED';
  const expectedPassportGate = receipt.model.soundprint?.gateEnabled ?? false;
  const expectedPassportThreshold = receipt.model.soundprint?.matchThreshold ?? 0;
  const recomputed: EvidenceReceipt = { ...receipt, evidenceSha256: '' };
  delete (recomputed as Partial<EvidenceReceipt>).verification;
  const freshBase = { ...recomputed } as Record<string, unknown>;
  delete freshBase.evidenceSha256;
  const freshHash = hashCanonical(freshBase);

  const stored = ctx.store.get<{ receipt_json: string; receipt_sha256: string }>(
    'SELECT receipt_json, receipt_sha256 FROM settlement_receipts WHERE session_id = ?',
    session.id,
  );
  let storedHashValid = true;
  if (stored) {
    storedHashValid = hashCanonical(JSON.parse(stored.receipt_json) as unknown) === stored.receipt_sha256;
  }

  const providerAmountMatches =
    session.captured_minor === null
      ? null
      : session.payment_state === 'CAPTURE_COMPLETED' ||
          session.payment_state === 'REFUNDED' ||
          session.payment_state === 'REFUND_REQUESTED'
        ? session.captured_minor === breakdown.finalMinor
        : session.captured_minor <= session.cap_minor;

  return {
    checkedAt: ctx.now().toISOString(),
    quoteMatches: receipt.pricing.quoteMinor === breakdown.finalMinor && summary.billableMs === receipt.totals.billableMs,
    capRespected:
      breakdown.finalMinor <= session.cap_minor &&
      (session.captured_minor === null || session.captured_minor <= session.cap_minor),
    evidenceMatches: root === session.evidence_hash,
    receiptHashMatches: storedHashValid && freshHash === receipt.evidenceSha256,
    intervalsConsistent: !summary.overlaps && summary.invalid === 0,
    passportConsistent:
      receipt.passport.status === expectedPassportStatus &&
      receipt.passport.gateEnabled === expectedPassportGate &&
      receipt.passport.matchThreshold === expectedPassportThreshold &&
      receipt.passport.mismatchIntervals === passportMismatches.length &&
      receipt.passport.mismatchMs === passportMismatchMs,
    providerAmountMatches,
    auditChainValid: audit.valid,
    recomputedQuoteMinor: breakdown.finalMinor,
  };
}

export function receiptForSession(ctx: AppContext, session: SessionRow): {
  receipt: EvidenceReceipt;
  verification: ReceiptVerification;
  stored: boolean;
} {
  const receipt = buildReceipt(ctx, session);
  const verification = verifyReceipt(ctx, session, receipt);
  const stored = Boolean(
    ctx.store.get<{ session_id: string }>('SELECT session_id FROM settlement_receipts WHERE session_id = ?', session.id),
  );
  return { receipt: { ...receipt, verification }, verification, stored };
}

export function generateAndStoreReceipt(ctx: AppContext, session: SessionRow): EvidenceReceipt {
  const receipt = buildReceipt(ctx, session);
  ctx.store.run(
    `INSERT INTO settlement_receipts (session_id, receipt_json, receipt_sha256, created_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(session_id) DO UPDATE SET receipt_json = excluded.receipt_json,
       receipt_sha256 = excluded.receipt_sha256, created_at = excluded.created_at`,
    session.id,
    JSON.stringify(receipt),
    hashCanonical(receipt),
    ctx.now().toISOString(),
  );
  return receipt;
}

export function redactReceipt(receipt: EvidenceReceipt): EvidenceReceipt {
  const mask = (value: string | null): string | null => {
    if (!value) return null;
    if (value.length <= 4) return '••••';
    return `••••${value.slice(-4)}`;
  };
  return {
    ...receipt,
    renterRef: receipt.renterRef,
    payment: {
      ...receipt.payment,
      orderId: mask(receipt.payment.orderId),
      authorizationId: mask(receipt.payment.authorizationId),
      captureId: mask(receipt.payment.captureId),
      refundId: mask(receipt.payment.refundId),
    },
    disputes: receipt.disputes.map((d) => ({ ...d, reason: d.reason.slice(0, 120) })),
  };
}

export function receiptJsonDownload(receipt: EvidenceReceipt): string {
  return `${JSON.stringify(receipt, null, 2)}\n`;
}
