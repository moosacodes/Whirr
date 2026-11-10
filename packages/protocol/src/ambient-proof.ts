import type {
  AmbientAgreementTerms,
  AmbientEvaluation,
  AmbientModelRef,
  AmbientObservation,
  AmbientTarget,
} from '../../ambient-engine/src/types.ts';
import type { Currency } from '../../meter/src/currency.ts';

export const AMBIENT_PROOF_SCHEMA = 'whirr.ambient-proof.v1';

export interface AmbientProofPayment {
  mode: 'PAYPAL_SANDBOX' | 'DEMO_NO_PAYMENT';
  state: string;
  orderId: string | null;
  authorizationId: string | null;
  captureId: string | null;
  voidId: string | null;
  providerStatus: string | null;
  providerConfirmed: boolean;
  capturedMinor: number | null;
  currency: Currency;
  providerLookup: 'NOT_PERFORMED' | 'AUTHORIZATION_CREATED' | 'CAPTURE_COMPLETED' | 'VOIDED' | 'UNKNOWN';
}

export interface AmbientProofConsent {
  buyerAcceptedAt: string;
  buyerTermsHash: string;
  providerAcceptedAt: string | null;
  providerTermsHash: string | null;
  humanAcceptance: unknown | null;
}

export interface AmbientProofPayload {
  schema: typeof AMBIENT_PROOF_SCHEMA;
  proofId: string;
  sessionId: string;
  agreementId: string;
  createdAt: string;
  buyerRef: string;
  providerRef: string;
  target: AmbientTarget;
  agreement: {
    id: string;
    revision: number;
    hash: string;
    terms: AmbientAgreementTerms;
  };
  model: AmbientModelRef;
  session: {
    createdAt: string;
    acceptedAt: string;
    authorizedAt: string | null;
    observationStartedAt: string | null;
    observationStoppedAt: string;
    demo: boolean;
    observationMode: 'LIVE' | 'REPLAY';
  };
  observations: AmbientObservation[];
  observationsHash: string;
  evaluation: AmbientEvaluation;
  evidenceRoot: string;
  consent: AmbientProofConsent;
  payment: AmbientProofPayment;
  trust: Array<{
    domain:
      | 'INTEGRITY'
      | 'SENSOR_PROVENANCE'
      | 'SOURCE_INFERENCE'
      | 'TEMPORAL_EVALUATION'
      | 'HUMAN_ACCEPTANCE'
      | 'FINANCIAL_OUTCOME'
      | 'REAL_WORLD_TRUTH';
    status: 'CHECKED' | 'NOT_VERIFIABLE_OFFLINE' | 'NOT_CONFIRMED' | 'NOT_CLAIMED';
    detail: string;
  }>;
  limitations: string[];
  attestation: string;
}

export type SignedAmbientProof = {
  schema: 'whirr.signed.v2';
  type: 'ambient-proof';
  algorithm: 'ECDSA_P256_SHA256';
  keyId: string;
  publicKey: string;
  payload: AmbientProofPayload;
  signature: string;
};

export interface AmbientProofCheck {
  id: string;
  label: string;
  pass: boolean;
  detail: string;
}

export interface AmbientProofVerification {
  valid: boolean;
  signatureValid: boolean;
  agreementHashValid: boolean;
  modelBindingValid: boolean;
  observationsHashValid: boolean;
  evidenceRootValid: boolean;
  evaluationMatches: boolean;
  consentOrderValid: boolean;
  paymentConsistent: boolean;
  checks: AmbientProofCheck[];
  disclaimer: string;
}
