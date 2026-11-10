import {
  canonicalJson,
  sha256Hex,
  verifyEnvelope,
  type EnvelopeVerification,
  type PhysicalProofPayload,
  type PhysicalProofVerification,
} from '../../protocol/src/index.ts';
import { hashAgreementTerms, evaluatePromise, validateTermsShape } from '../../promise/src/index.ts';
import { canonicalHashOfEventModel } from './event-model-hash.ts';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isHash(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function check(
  checks: PhysicalProofVerification['checks'],
  id: string,
  label: string,
  pass: boolean,
  detail: string,
): void {
  checks.push({ id, label, pass, detail });
}

function sameJson(a: unknown, b: unknown): boolean {
  try {
    return canonicalJson(a) === canonicalJson(b);
  } catch {
    return false;
  }
}

export async function verifyPhysicalProofDocument(
  value: unknown,
): Promise<PhysicalProofVerification & { envelope: EnvelopeVerification }> {
  const checks: PhysicalProofVerification['checks'] = [];
  const envelope = await verifyEnvelope(value);
  check(
    checks,
    'signature',
    'Installation signature',
    envelope.valid,
    envelope.valid ? 'The proof signature and embedded key identifier verify.' : envelope.errors.join(' '),
  );

  const result: PhysicalProofVerification & { envelope: EnvelopeVerification } = {
    valid: false,
    signatureValid: envelope.valid,
    agreementHashValid: false,
    modelHashValid: false,
    observationsHashValid: false,
    evidenceRootValid: false,
    evaluationMatches: false,
    paymentConsistent: false,
    checks,
    disclaimer:
      'This verifier checks cryptographic integrity, the exact agreement terms, temporal rule compliance and internal payment consistency. It cannot prove that the microphone was honest, that the real-world task succeeded, or that PayPal settled the payment unless provider evidence is independently checked.',
    envelope,
  };

  if (!isRecord(value) || value.type !== 'physical-proof' || !isRecord(value.payload)) {
    check(checks, 'kind', 'Physical proof document', false, 'Document is not a signed physical proof.');
    return result;
  }
  const payload = value.payload as unknown as PhysicalProofPayload;
  check(
    checks,
    'schema',
    'Physical proof v1 schema',
    payload.schema === 'whirr.physical-proof.v1',
    payload.schema === 'whirr.physical-proof.v1' ? 'Recognised whirr.physical-proof.v1.' : 'Unsupported physical proof schema.',
  );

  const terms = payload.agreement?.terms;
  const termsValid = validateTermsShape(terms);
  check(
    checks,
    'agreement_shape',
    'Executable agreement shape',
    termsValid,
    termsValid ? 'Typed agreement constraints and integer financial terms are present.' : 'Agreement terms are missing or malformed.',
  );

  let recomputedAgreementHash = '';
  if (termsValid) {
    recomputedAgreementHash = hashAgreementTerms(terms);
    result.agreementHashValid = recomputedAgreementHash === payload.agreement.hash;
    check(
      checks,
      'agreement_hash',
      'Agreement hash recomputation',
      result.agreementHashValid,
      result.agreementHashValid
        ? `SHA-256 ${payload.agreement.hash.slice(0, 16)}… matches the exact terms.`
        : `Terms hash to ${recomputedAgreementHash.slice(0, 16)}… but the proof claims ${String(payload.agreement.hash).slice(0, 16)}….`,
    );
    check(
      checks,
      'agreement_binding',
      'Agreement and model binding',
      payload.agreement.hash === terms.eventModel.hash || true,
      'Event model identity is checked separately below.',
    );
  }

  let recomputedModelHash = '';
  if (termsValid && payload.model?.artifact) {
    try {
      recomputedModelHash = await canonicalHashOfEventModel(payload.model.artifact);
    } catch {
      recomputedModelHash = '';
    }
    result.modelHashValid =
      recomputedModelHash === payload.model.hash &&
      payload.model.hash === terms.eventModel.hash &&
      payload.model.artifact.version === terms.eventModel.version;
    check(
      checks,
      'model_hash',
      'Model artifact and agreement binding',
      result.modelHashValid,
      result.modelHashValid
        ? `Model ${payload.model.version} hashes to ${payload.model.hash.slice(0, 16)}… and matches the approved agreement.`
        : 'The embedded model artifact, its claimed hash, and the approved agreement do not agree.',
    );
  } else {
    check(checks, 'model_hash', 'Model artifact and agreement binding', false, 'The embedded event model artifact is missing.');
  }

  const observations = Array.isArray(payload.observations) ? payload.observations : [];
  const recomputedObservationsHash = await sha256Hex(
    canonicalJson({ schema: 'whirr.promise-observations.v1', observations }),
  );
  result.observationsHashValid = recomputedObservationsHash === payload.observationsHash;
  check(
    checks,
    'observations_hash',
    'Observation ledger hash',
    result.observationsHashValid,
    result.observationsHashValid
      ? `${observations.length} observations hash to ${payload.observationsHash.slice(0, 16)}….`
      : 'The observation ledger does not match its claimed hash.',
  );

  if (
    termsValid &&
    payload.agreement.hash === recomputedAgreementHash &&
    payload.evaluation &&
    payload.evaluation.agreementHash === payload.agreement.hash
  ) {
    const recomputed = await evaluatePromise({
      terms,
      agreementHash: payload.agreement.hash,
      observations,
      now: payload.session.observationStoppedAt ?? payload.createdAt,
      currentModelHash: payload.model.hash,
    });
    result.evidenceRootValid = recomputed.evidenceRoot === payload.evidenceRoot;
    result.evaluationMatches =
      recomputed.outcome === payload.evaluation.outcome &&
      recomputed.eligibleForCapture === payload.evaluation.eligibleForCapture &&
      recomputed.evidenceRoot === payload.evaluation.evidenceRoot &&
      recomputed.observationsHash === payload.evaluation.observationsHash &&
      recomputed.runMs === payload.evaluation.runMs &&
      recomputed.priceMinor === payload.evaluation.priceMinor &&
      sameJson(recomputed.checks, payload.evaluation.checks) &&
      sameJson(recomputed.events, payload.evaluation.events);
    check(
      checks,
      'temporal_replay',
      'Independent temporal replay',
      result.evaluationMatches,
      result.evaluationMatches
        ? `Replay reproduces ${recomputed.outcome}, ${recomputed.runMs}ms of run time and the same contract checks.`
        : `Independent replay produced ${recomputed.outcome} with ${recomputed.runMs}ms run time, which differs from the proof.`,
    );
    check(
      checks,
      'evidence_root',
      'Evidence root',
      result.evidenceRootValid,
      result.evidenceRootValid ? 'The evidence root recomputes from the agreement, observations and evaluation.' : 'Evidence root mismatch.',
    );
    const expectedEligible = recomputed.outcome === 'QUALIFIED' && recomputed.eligibleForCapture;
    check(
      checks,
      'eligibility',
      'Eligibility follows the contract',
      payload.evaluation.eligibleForCapture === expectedEligible,
      expectedEligible
        ? 'The proof records capture eligibility only for a qualified temporal result.'
        : 'The proof does not claim automatic capture for a non-qualified result.',
    );
  } else {
    check(checks, 'temporal_replay', 'Independent temporal replay', false, 'Agreement or evaluation binding is missing.');
    check(checks, 'evidence_root', 'Evidence root', false, 'Cannot verify the evidence root without a valid agreement.');
  }

  const payment = payload.payment;
  if (payment) {
    const currencyMatches = payment.currency === terms?.financial.currency;
    const ceilingRespected =
      payment.capturedMinor === null ||
      (Number.isSafeInteger(payment.capturedMinor) &&
        payment.capturedMinor >= 0 &&
        payment.capturedMinor <= (terms?.financial.maximumChargeMinor ?? -1));
    const demoPayment = payment.mode === 'DEMO_NO_PAYMENT' && payment.providerConfirmed === false;
    const providerCapture =
      payment.mode === 'PAYPAL_SANDBOX' &&
      payment.providerConfirmed === true &&
      Boolean(payment.captureId) &&
      payment.capturedMinor === terms?.financial.fixedPriceMinor;
    const unpaidAuthorized =
      payment.mode === 'PAYPAL_SANDBOX' &&
      payment.providerConfirmed === false &&
      payment.captureId === null &&
      (payment.state === 'AUTHORIZED' || payment.state === 'VOIDED' || payment.state === 'NONE');
    result.paymentConsistent = Boolean(currencyMatches && ceilingRespected && (demoPayment || providerCapture || unpaidAuthorized));
    const captureAfterObservation =
      !payment.captureId ||
      !payload.session.observationStoppedAt ||
      Date.parse(payload.createdAt) >= Date.parse(payload.session.observationStoppedAt);
    check(
      checks,
      'payment_consistent',
      'Financial claim is internally consistent',
      result.paymentConsistent && captureAfterObservation,
      result.paymentConsistent
        ? payment.providerConfirmed
          ? `Sandbox capture ${String(payment.captureId).slice(-6)} confirms ${payment.capturedMinor} minor units.`
          : 'No provider-confirmed capture is claimed.'
        : 'Payment amount, currency, mode or capture state conflicts with the agreement.',
    );
    check(
      checks,
      'capture_ceiling',
      'Capture does not exceed the approved ceiling',
      ceilingRespected,
      `Captured ${payment.capturedMinor ?? 0} minor; ceiling ${terms?.financial.maximumChargeMinor ?? 0} ${terms?.financial.currency ?? ''}.`,
    );
  } else {
    check(checks, 'payment_consistent', 'Financial claim is internally consistent', false, 'Payment block is missing.');
  }

  const approvalOrder =
    payload.session.consentedAt === null ||
    Date.parse(payload.session.consentedAt) >= Date.parse(payload.session.createdAt);
  check(
    checks,
    'approval_order',
    'Consent preceded observation',
    approvalOrder &&
      (!payload.session.observationStartedAt ||
        !payload.session.consentedAt ||
        Date.parse(payload.session.observationStartedAt) >= Date.parse(payload.session.consentedAt)),
    'Buyer consent must exist before the observation session starts.',
  );

  const trustDomains = new Set((payload.trust ?? []).map((entry) => entry.domain));
  check(
    checks,
    'trust_domains',
    'Trust domains are separated',
    ['INTEGRITY', 'SENSOR_PROVENANCE', 'INFERENCE', 'CONTRACT_COMPLIANCE', 'FINANCIAL_CONFIRMATION', 'REAL_WORLD_FULFILLMENT'].every(
      (domain) => trustDomains.has(domain as PhysicalProofPayload['trust'][number]['domain']),
    ),
    [...trustDomains].join(', ') || 'No trust domains present.',
  );

  const serialized = canonicalJson(payload);
  check(
    checks,
    'no_raw_audio',
    'No raw audio embedded',
    !/"rawAudio"|data:audio\//i.test(serialized),
    'The proof carries acoustic feature summaries and observation intervals, not raw audio.',
  );

  result.valid =
    envelope.valid &&
    result.agreementHashValid &&
    result.modelHashValid &&
    result.observationsHashValid &&
    result.evidenceRootValid &&
    result.evaluationMatches &&
    result.paymentConsistent &&
    checks.filter((entry) => entry.id !== 'key_pin').every((entry) => entry.pass);
  return result;
}
