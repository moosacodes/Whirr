import {
  canonicalJson,
  sha256Hex,
  verifyEnvelope,
  type AmbientProofPayload,
  type AmbientProofVerification,
  type EnvelopeVerification,
} from '../../protocol/src/index.ts';
import {
  evaluateAmbientAgreement,
  hashAmbientTerms,
  validateAmbientTermsShape,
} from '../../ambient-engine/src/index.ts';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function sameJson(a: unknown, b: unknown): boolean {
  try {
    return canonicalJson(a) === canonicalJson(b);
  } catch {
    return false;
  }
}

function add(
  checks: AmbientProofVerification['checks'],
  id: string,
  label: string,
  pass: boolean,
  detail: string,
): void {
  checks.push({ id, label, pass, detail });
}

function canonicalObservation(observation: {
  seq: number;
  startMs: number;
  endMs: number;
  sourceState: string;
  confidence: number;
  qualityFlags: string[];
  eventMatch?: number;
}): Record<string, unknown> {
  return {
    seq: observation.seq,
    startMs: observation.startMs,
    endMs: observation.endMs,
    sourceState: observation.sourceState,
    confidence: observation.confidence,
    qualityFlags: [...observation.qualityFlags].sort(),
    ...(observation.eventMatch === undefined ? {} : { eventMatch: observation.eventMatch }),
  };
}

function acceptedByHuman(value: unknown): { accepted: boolean; acceptedAt: string | null } {
  if (!isRecord(value)) return { accepted: false, acceptedAt: null };
  return {
    accepted: value.accepted === true,
    acceptedAt: typeof value.acceptedAt === 'string' ? value.acceptedAt : null,
  };
}

export async function verifyAmbientProofDocument(
  value: unknown,
): Promise<AmbientProofVerification & { envelope: EnvelopeVerification }> {
  const checks: AmbientProofVerification['checks'] = [];
  const envelope = await verifyEnvelope(value);
  add(
    checks,
    'signature',
    'Installation signature',
    envelope.valid,
    envelope.valid ? 'The proof signature and embedded key identifier verify.' : envelope.errors.join(' '),
  );

  const result: AmbientProofVerification & { envelope: EnvelopeVerification } = {
    valid: false,
    signatureValid: envelope.valid,
    agreementHashValid: false,
    modelBindingValid: false,
    observationsHashValid: false,
    evidenceRootValid: false,
    evaluationMatches: false,
    consentOrderValid: false,
    paymentConsistent: false,
    checks,
    disclaimer:
      'This verifier checks the signed agreement, observation ledger, negative-space rule, consent ordering and internal payment consistency. It cannot prove that the microphone was honest, that the room was silent, that the enrolled source was physically powered off, or that PayPal currently holds the stated transaction state. It does not establish real-world safety, legal authority, or service quality.',
    envelope,
  };

  if (!isRecord(value) || value.type !== 'ambient-proof' || !isRecord(value.payload)) {
    add(checks, 'kind', 'Ambient proof document', false, 'Document is not a signed ambient proof.');
    return result;
  }

  const payload = value.payload as unknown as AmbientProofPayload;
  add(
    checks,
    'schema',
    'Ambient proof v1 schema',
    payload.schema === 'whirr.ambient-proof.v1',
    payload.schema === 'whirr.ambient-proof.v1' ? 'Recognised whirr.ambient-proof.v1.' : 'Unsupported ambient proof schema.',
  );

  const terms = payload.agreement?.terms;
  const termsValid = validateAmbientTermsShape(terms);
  add(
    checks,
    'agreement_shape',
    'Executable agreement shape',
    termsValid,
    termsValid
      ? 'The bounded condition, model binding, fixed price, and policies are present.'
      : 'Agreement terms are missing or malformed.',
  );

  let recomputedAgreementHash = '';
  if (termsValid) {
    recomputedAgreementHash = hashAmbientTerms(terms);
    result.agreementHashValid = recomputedAgreementHash === payload.agreement.hash;
    add(
      checks,
      'agreement_hash',
      'Agreement hash recomputation',
      result.agreementHashValid,
      result.agreementHashValid
        ? `SHA-256 ${payload.agreement.hash.slice(0, 16)}... matches the exact approved terms.`
        : `Terms hash to ${recomputedAgreementHash.slice(0, 16)}... but the proof claims ${String(payload.agreement.hash).slice(0, 16)}....`,
    );
  }

  result.modelBindingValid =
    termsValid &&
    payload.model?.id === terms.eventModel.id &&
    payload.model?.hash === terms.eventModel.hash &&
    payload.model?.version === terms.eventModel.version &&
    payload.evaluation?.modelHash === terms.eventModel.hash &&
    payload.agreement.revision === terms.revision;
  add(
    checks,
    'model_binding',
    'Model identity is bound to the agreement',
    result.modelBindingValid,
    result.modelBindingValid
      ? `Model ${payload.model.version} / ${payload.model.hash.slice(0, 16)}... matches the approved reference.`
      : 'The proof model, evaluation model, or agreement revision does not match the approved terms.',
  );

  const observations = Array.isArray(payload.observations) ? payload.observations : [];
  const recomputedObservationsHash = await sha256Hex(
    canonicalJson({
      schema: 'whirr.ambient-observations.v1',
      observations: observations.map(canonicalObservation),
    }),
  );
  result.observationsHashValid =
    recomputedObservationsHash === payload.observationsHash &&
    payload.evaluation?.observationsHash === recomputedObservationsHash;
  add(
    checks,
    'observations_hash',
    'Observation ledger hash',
    result.observationsHashValid,
    result.observationsHashValid
      ? `${observations.length} intervals hash to ${payload.observationsHash.slice(0, 16)}....`
      : 'The observation ledger does not match its claimed hash.',
  );

  if (
    termsValid &&
    result.agreementHashValid &&
    payload.evaluation &&
    payload.evaluation.agreementHash === payload.agreement.hash
  ) {
    const stoppedAt = payload.session?.observationStoppedAt;
    if (typeof stoppedAt !== 'string') {
      add(checks, 'temporal_replay', 'Independent temporal replay', false, 'Observation stop time is missing.');
    } else {
      const replay = await evaluateAmbientAgreement({
        terms,
        agreementHash: payload.agreement.hash,
        observations,
        currentModelHash: terms.eventModel.hash,
        now: stoppedAt,
      });
      result.evidenceRootValid = replay.evidenceRoot === payload.evidenceRoot;
      result.evaluationMatches =
        replay.outcome === payload.evaluation.outcome &&
        replay.eligibleForCapture === payload.evaluation.eligibleForCapture &&
        replay.evidenceRoot === payload.evaluation.evidenceRoot &&
        replay.observationsHash === payload.evaluation.observationsHash &&
        replay.baselineActiveMs === payload.evaluation.baselineActiveMs &&
        replay.activeMs === payload.evaluation.activeMs &&
        replay.inactiveMs === payload.evaluation.inactiveMs &&
        replay.unknownMs === payload.evaluation.unknownMs &&
        replay.sensorLossMs === payload.evaluation.sensorLossMs &&
        replay.longestInactiveMs === payload.evaluation.longestInactiveMs &&
        replay.qualifyingStartMs === payload.evaluation.qualifyingStartMs &&
        replay.qualifyingEndMs === payload.evaluation.qualifyingEndMs &&
        replay.interruptions === payload.evaluation.interruptions &&
        replay.maxGapMs === payload.evaluation.maxGapMs &&
        replay.priceMinor === payload.evaluation.priceMinor &&
        replay.currency === payload.evaluation.currency &&
        replay.evaluatedAt === payload.evaluation.evaluatedAt &&
        sameJson(replay.checks, payload.evaluation.checks) &&
        sameJson(replay.events, payload.evaluation.events);
      add(
        checks,
        'temporal_replay',
        'Independent negative-space replay',
        result.evaluationMatches,
        result.evaluationMatches
          ? `Replay reproduces ${replay.outcome}, ${replay.inactiveMs}ms of non-detection, and the same contract checks.`
          : `Independent replay produced ${replay.outcome} with ${replay.inactiveMs}ms of non-detection, which differs from the proof.`,
      );
      add(
        checks,
        'evidence_root',
        'Evidence root',
        result.evidenceRootValid,
        result.evidenceRootValid
          ? 'The evidence root recomputes from the agreement, observation ledger, and temporal result.'
          : 'Evidence root mismatch.',
      );
      add(
        checks,
        'eligibility',
        'Capture eligibility follows the contract',
        payload.evaluation.eligibleForCapture === (replay.outcome === 'QUALIFIED' && replay.eligibleForCapture),
        replay.outcome === 'QUALIFIED'
          ? 'The proof records capture eligibility for a completed qualifying window.'
          : 'The proof does not claim automatic capture for a non-qualified result.',
      );
    }
  } else {
    add(checks, 'temporal_replay', 'Independent negative-space replay', false, 'Agreement or evaluation binding is missing.');
    add(checks, 'evidence_root', 'Evidence root', false, 'Cannot verify the evidence root without a valid agreement.');
  }

  const session = payload.session;
  const consent = payload.consent;
  const accepted = acceptedByHuman(consent?.humanAcceptance);
  const consentOrder =
    termsValid &&
    Boolean(session?.createdAt) &&
    Boolean(session?.acceptedAt) &&
    Boolean(consent?.buyerAcceptedAt) &&
    consent?.buyerTermsHash === payload.agreement.hash &&
    consent?.providerTermsHash === payload.agreement.hash &&
    typeof consent?.providerAcceptedAt === 'string' &&
    Date.parse(session.acceptedAt) >= Date.parse(terms!.createdAt) &&
    Date.parse(consent!.buyerAcceptedAt) >= Date.parse(terms!.createdAt) &&
    Date.parse(consent!.providerAcceptedAt!) >= Date.parse(terms!.createdAt) &&
    (!session.observationStartedAt ||
      (Date.parse(session.observationStartedAt) >= Date.parse(session.acceptedAt) &&
        Date.parse(session.observationStartedAt) >= Date.parse(consent!.buyerAcceptedAt))) &&
    (!session.authorizedAt ||
      !session.observationStartedAt ||
      Date.parse(session.observationStartedAt) >= Date.parse(session.authorizedAt)) &&
    Date.parse(session.observationStoppedAt) >= Date.parse(session.observationStartedAt ?? session.createdAt);
  const humanAcceptanceValid =
    !payload.evaluation?.eligibleForCapture ||
    (accepted.accepted &&
      accepted.acceptedAt !== null &&
      Date.parse(accepted.acceptedAt) >= Date.parse(session.observationStoppedAt));
  result.consentOrderValid = Boolean(consentOrder && humanAcceptanceValid);
  add(
    checks,
    'consent_order',
    'Consent and acceptance ordering',
    result.consentOrderValid,
    result.consentOrderValid
      ? payload.evaluation.eligibleForCapture
        ? 'Provider and buyer accepted the same terms, observation began after both consents, and the buyer accepted the completed result.'
        : 'Provider and buyer accepted the same terms before observation.'
      : 'The buyer/provider terms hashes, timestamps, or required human acceptance are inconsistent.',
  );

  const payment = payload.payment;
  if (payment) {
    const currencyMatches = payment.currency === terms?.financial.currency;
    const ceilingRespected =
      payment.capturedMinor === null ||
      (Number.isSafeInteger(payment.capturedMinor) &&
        payment.capturedMinor >= 0 &&
        payment.capturedMinor <= (terms?.financial.maximumChargeMinor ?? -1));
    const demoPayment =
      payment.mode === 'DEMO_NO_PAYMENT' &&
      payment.providerConfirmed === false &&
      payment.capturedMinor === null &&
      payment.captureId === null;
    const providerCapture =
      payment.mode === 'PAYPAL_SANDBOX' &&
      payment.providerConfirmed === true &&
      Boolean(payment.captureId) &&
      Boolean(payment.authorizationId) &&
      payment.capturedMinor === terms?.financial.fixedPriceMinor &&
      payment.state === 'CAPTURED';
    const unpaid =
      payment.mode === 'PAYPAL_SANDBOX' &&
      payment.providerConfirmed === false &&
      payment.captureId === null &&
      ['AUTHORIZED', 'VOIDED', 'NOT_QUALIFIED', 'BUYER_REJECTED', 'EXPIRED'].includes(payment.state);
    result.paymentConsistent = Boolean(currencyMatches && ceilingRespected && (demoPayment || providerCapture || unpaid));
    add(
      checks,
      'payment_consistent',
      'Financial claim is internally consistent',
      result.paymentConsistent,
      result.paymentConsistent
        ? payment.providerConfirmed
          ? `Sandbox capture ${String(payment.captureId).slice(-6)} confirms ${payment.capturedMinor} minor units.`
          : 'No provider-confirmed capture is claimed.'
        : 'Payment amount, currency, mode, state, or capture identity conflicts with the agreement.',
    );
    add(
      checks,
      'capture_ceiling',
      'Capture does not exceed the approved ceiling',
      ceilingRespected,
      `Captured ${payment.capturedMinor ?? 0} minor units; ceiling ${terms?.financial.maximumChargeMinor ?? 0} ${terms?.financial.currency ?? ''}.`,
    );
  } else {
    add(checks, 'payment_consistent', 'Financial claim is internally consistent', false, 'Payment block is missing.');
  }

  const domains = new Set((payload.trust ?? []).map((entry) => entry.domain));
  const requiredDomains = [
    'INTEGRITY',
    'SENSOR_PROVENANCE',
    'SOURCE_INFERENCE',
    'TEMPORAL_EVALUATION',
    'HUMAN_ACCEPTANCE',
    'FINANCIAL_OUTCOME',
    'REAL_WORLD_TRUTH',
  ] as const;
  add(
    checks,
    'trust_domains',
    'Trust domains are separated',
    requiredDomains.every((domain) => domains.has(domain)),
    [...domains].join(', ') || 'No trust domains present.',
  );

  const serialized = canonicalJson(payload);
  add(
    checks,
    'no_raw_audio',
    'No raw audio embedded',
    !/"rawAudio"|data:audio\//i.test(serialized),
    'The proof carries interval states and hashes, not raw microphone audio.',
  );

  // A proof of a failed condition is still a valid proof. These checks describe
  // the contractual outcome, not the integrity of the signed document.
  const outcomeChecks = new Set([
    'baseline',
    'sensor_continuity',
    'qualifying_window',
    'interruption_policy',
    'agreement_expiry',
  ]);
  result.valid = checks.filter((entry) => !outcomeChecks.has(entry.id)).every((entry) => entry.pass);
  return result;
}
