import type { Currency } from '../../meter/src/currency.ts';
import type {
  PromiseAgreementTerms,
  PromiseEvaluation,
  PromiseObservation,
} from '../../promise/src/types.ts';
import type { EventModelArtifact } from '../../audio/src/event-model.ts';

export const PHYSICAL_PROOF_SCHEMA = 'whirr.physical-proof.v1';

export interface PhysicalProofPayment {
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

export interface PhysicalProofPayload {
  schema: typeof PHYSICAL_PROOF_SCHEMA;
  proofId: string;
  executionId: string;
  createdAt: string;
  representativeRef: string;
  object: { id: string; name: string; glyph: string };
  agreement: {
    id: string;
    hash: string;
    terms: PromiseAgreementTerms;
  };
  model: {
    id: string;
    version: string;
    hash: string;
    status: 'READY' | 'LIMITED';
    provenance: 'SYNTHETIC_REFERENCE' | 'USER_CALIBRATION';
    datasetHash: string;
    artifact: EventModelArtifact;
    metrics: {
      frameAccuracy: number;
      macroRecall: number;
      unknownRate: number;
    };
  };
  session: {
    createdAt: string;
    consentedAt: string | null;
    authorizedAt: string | null;
    observationStartedAt: string | null;
    observationStoppedAt: string | null;
    completedAt: string | null;
    demo: boolean;
    observationMode: 'LIVE' | 'REPLAY';
  };
  observations: PromiseObservation[];
  observationsHash: string;
  evaluation: PromiseEvaluation;
  evidenceRoot: string;
  approvals: {
    ownerApprovedAt: string;
    buyerConsentedAt: string | null;
    buyerTermsHash: string | null;
    humanAcceptance: unknown | null;
  };
  payment: PhysicalProofPayment;
  trust: Array<{
    domain: 'INTEGRITY' | 'SENSOR_PROVENANCE' | 'INFERENCE' | 'CONTRACT_COMPLIANCE' | 'FINANCIAL_CONFIRMATION' | 'REAL_WORLD_FULFILLMENT';
    status: 'CHECKED' | 'NOT_VERIFIABLE_OFFLINE' | 'NOT_CONFIRMED' | 'NOT_CLAIMED';
    detail: string;
  }>;
  limitations: string[];
  attestation: string;
}

export type SignedPhysicalProof = {
  schema: 'whirr.signed.v2';
  type: 'physical-proof';
  algorithm: 'ECDSA_P256_SHA256';
  keyId: string;
  publicKey: string;
  payload: PhysicalProofPayload;
  signature: string;
};

export interface PhysicalProofCheck {
  id: string;
  label: string;
  pass: boolean;
  detail: string;
}

export interface PhysicalProofVerification {
  valid: boolean;
  signatureValid: boolean;
  agreementHashValid: boolean;
  modelHashValid: boolean;
  observationsHashValid: boolean;
  evidenceRootValid: boolean;
  evaluationMatches: boolean;
  paymentConsistent: boolean;
  checks: PhysicalProofCheck[];
  disclaimer: string;
}
