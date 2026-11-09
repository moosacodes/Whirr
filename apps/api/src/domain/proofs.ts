import type { AppContext } from '../context.ts';
import type { SessionRow } from './rows.ts';
import type { EvidenceReceipt, ReceiptProofPayload, SignedReceiptProof } from '../../../../packages/contracts/src/types.ts';
import { hashCanonical } from '../lib/hash.ts';
import { newId } from '../lib/ids.ts';

interface ProofRow {
  id: string;
  session_id: string;
  payload_hash: string;
  document_json: string;
  created_at: string;
}

export function proofPayload(receipt: EvidenceReceipt, proofId: string): ReceiptProofPayload {
  return {
    schema: 'whirr.receipt-proof.v2',
    proofId,
    receiptId: receipt.receiptId,
    sessionId: receipt.sessionId,
    createdAt: receipt.createdAt,
    object: { id: receipt.object.id, name: receipt.object.name, category: receipt.object.category },
    receiptHash: receipt.evidenceSha256,
    sessionEvidenceHash: receipt.sessionEvidenceSha256,
    model: {
      version: receipt.model.version,
      hash: receipt.model.hash,
      status: receipt.model.status,
      provenance: receipt.model.provenance,
    },
    terms: {
      hash: receipt.termsHash,
      currency: receipt.terms.currency,
      minorPerMinute: receipt.terms.minorPerMinute,
      capMinor: receipt.terms.capMinor,
    },
    pricing: {
      currency: receipt.pricing.currency,
      minorPerMinute: receipt.pricing.minorPerMinute,
      capMinor: receipt.pricing.capMinor,
      baseQuoteMinor: receipt.pricing.baseQuoteMinor,
      creditMinor: receipt.pricing.creditMinor,
      quoteMinor: receipt.pricing.quoteMinor,
      billableMs: receipt.totals.billableMs,
      formula: receipt.pricing.formula,
    },
    payment: {
      mode: receipt.payment.mode,
      state: receipt.payment.state,
      capturedMinor: receipt.payment.capturedMinor,
      refundMinor: receipt.payment.refundMinor,
    },
    passport: {
      status: receipt.passport.status,
      gateEnabled: receipt.passport.gateEnabled,
      mismatchMs: receipt.passport.mismatchMs,
    },
    intervals: {
      count: receipt.timeline.length,
      billableMs: receipt.totals.billableMs,
      uncertainMs: receipt.totals.uncertainMs,
      idleMs: receipt.totals.idleMs,
      disconnectedMs: receipt.totals.disconnectedMs,
    },
    review: {
      quoteHash: receipt.review.quoteHash,
      acceptedAt: receipt.review.acceptedAt,
      reviewMode: receipt.review.reviewMode,
    },
    limitations: [
      ...receipt.limitations,
      'This proof is a redacted, installation-signed summary. It contains no renter identifier, full payment ID or audio.',
    ],
    attestation:
      'Signed by this Whirr installation. It attests the stored receipt facts, not physical truth or third-party identity.',
  };
}

export async function ensureReceiptProof(
  ctx: AppContext,
  session: SessionRow,
  receipt: EvidenceReceipt,
): Promise<SignedReceiptProof> {
  const existing = ctx.store.get<ProofRow>(
    'SELECT * FROM receipt_proofs WHERE session_id = ?',
    session.id,
  );
  if (existing) {
    const document = JSON.parse(existing.document_json) as SignedReceiptProof;
    if (document.payload.receiptHash === receipt.evidenceSha256) return document;
  }
  const proofId = existing?.id ?? newId('prf');
  const payload = proofPayload(receipt, proofId);
  const envelope = await ctx.signer.sign('receipt-proof', payload);
  const payloadHash = hashCanonical(payload);
  if (existing) {
    ctx.store.run(
      'UPDATE receipt_proofs SET payload_hash = ?, document_json = ?, created_at = ? WHERE id = ?',
      payloadHash,
      JSON.stringify(envelope),
      ctx.now().toISOString(),
      existing.id,
    );
  } else {
    ctx.store.run(
      `INSERT INTO receipt_proofs (id, session_id, payload_hash, document_json, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      proofId,
      session.id,
      payloadHash,
      JSON.stringify(envelope),
      ctx.now().toISOString(),
    );
  }
  return envelope;
}

export function proofById(ctx: AppContext, id: string): SignedReceiptProof | null {
  const row = ctx.store.get<ProofRow>('SELECT * FROM receipt_proofs WHERE id = ?', id);
  return row ? (JSON.parse(row.document_json) as SignedReceiptProof) : null;
}

export function proofForSession(ctx: AppContext, sessionId: string): SignedReceiptProof | null {
  const row = ctx.store.get<ProofRow>('SELECT * FROM receipt_proofs WHERE session_id = ?', sessionId);
  return row ? (JSON.parse(row.document_json) as SignedReceiptProof) : null;
}
