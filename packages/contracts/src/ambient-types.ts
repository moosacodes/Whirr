import type { Currency } from '../../meter/src/currency.ts';
import type {
  AmbientAgreementStatus,
  AmbientAgreementTerms,
  AmbientEvaluation,
  AmbientInterpretation,
  AmbientOfferStatus,
  AmbientOutcome,
  AmbientSessionState,
  AmbientTarget,
} from '../../ambient-engine/src/types.ts';
import type { AmbientProofVerification } from '../../protocol/src/ambient-proof.ts';

export interface AmbientObjectView extends AmbientTarget {
  description: string;
  ownerLabel: string;
}

export interface AmbientModelSummaryView {
  id: string;
  version: string;
  hash: string;
  status: 'READY' | 'LIMITED';
  provenance: 'SYNTHETIC_REFERENCE' | 'USER_CALIBRATION';
  datasetHash: string;
  takeCount: number;
  frameCount: number;
  groupCount: number;
  macroRecall: number;
  unknownRate: number;
  limitations: string[];
}

export interface AmbientOfferView {
  id: string;
  revision: number;
  terms: AmbientAgreementTerms;
  termsHash: string;
  proposedBy: 'BUYER' | 'PROVIDER';
  priceMinor: number;
  durationMs: number;
  status: AmbientOfferStatus;
  note: string | null;
  createdAt: string;
  decidedAt: string | null;
}

export interface AmbientSessionSummary {
  id: string;
  state: AmbientSessionState;
  demo: boolean;
  outcome: AmbientOutcome | null;
  eligibleForCapture: boolean;
  capturedMinor: number | null;
  createdAt: string;
  stoppedAt: string | null;
}

export interface AmbientAgreementView {
  id: string;
  status: AmbientAgreementStatus;
  revision: number;
  serviceName: string;
  target: AmbientObjectView;
  terms: AmbientAgreementTerms;
  termsHash: string;
  interpretation: AmbientInterpretation;
  model: AmbientModelSummaryView;
  offers: AmbientOfferView[];
  currentOffer: AmbientOfferView | null;
  buyerRef: string;
  providerRef: string;
  roles: { buyer: boolean; provider: boolean };
  createdAt: string;
  updatedAt: string;
  offerExpiresAt: string;
  offerExpired: boolean;
  buyerAcceptedAt: string | null;
  providerAcceptedAt: string | null;
  financial: {
    currency: Currency;
    fixedPriceMinor: number;
    maximumChargeMinor: number;
    displayPrice: string;
    displayMaximum: string;
  };
  latestSession: AmbientSessionSummary | null;
  flags: {
    canMakeOffer: boolean;
    canRespond: boolean;
    canBuyerDecide: boolean;
    canWithdraw: boolean;
    canOpenSession: boolean;
    awaitingBuyer: boolean;
    awaitingProvider: boolean;
  };
  limitations: string[];
  sandbox: { configured: boolean; env: 'sandbox'; webhookConfigured: boolean };
}

export interface AmbientLiveSnapshotView {
  elapsedMs: number;
  state: 'CLOSED' | 'ACTIVE' | 'INACTIVE' | 'UNKNOWN' | 'DISCONNECTED';
  confidence: number;
  event: string | null;
  eventMatch: number;
  baselineActiveMs: number;
  inactiveMs: number;
  unknownMs: number;
  sensorLossMs: number;
  longestInactiveMs: number;
  targetInactiveMs: number;
  progress: number;
  started: boolean;
  qualified: boolean;
}

export interface AmbientSessionView {
  id: string;
  agreementId: string;
  agreementRevision: number;
  agreementHash: string;
  target: AmbientObjectView;
  serviceName: string;
  state: AmbientSessionState;
  paymentState: string;
  demo: boolean;
  observationMode: 'LIVE' | 'REPLAY';
  terms: AmbientAgreementTerms;
  interpretation: AmbientInterpretation;
  model: AmbientModelSummaryView;
  createdAt: string;
  acceptedAt: string;
  authorizedAt: string | null;
  observationStartedAt: string | null;
  observationStoppedAt: string | null;
  authorizationExpiresAt: string | null;
  authorizationExpired: boolean;
  meterClockMs: number;
  evaluation: AmbientEvaluation | null;
  observations: Array<{
    seq: number;
    startMs: number;
    endMs: number;
    sourceState: string;
    confidence: number;
    qualityFlags: string[];
  }>;
  acceptance: { accepted: boolean; acceptedAt: string; note: string | null; buyerRef: string } | null;
  payment: {
    orderId: string | null;
    approveUrl: string | null;
    authorizationId: string | null;
    captureId: string | null;
    voidId: string | null;
    providerStatus: string | null;
    capturedMinor: number | null;
  };
  proofId: string | null;
  proofHash: string | null;
  ownership: { buyer: boolean; provider: boolean };
  flags: {
    canOrder: boolean;
    canAuthorize: boolean;
    canStart: boolean;
    canSubmitObservations: boolean;
    canStop: boolean;
    canAcceptResult: boolean;
    canCapture: boolean;
    canVoid: boolean;
    canProof: boolean;
    awaitingBuyer: boolean;
    awaitingProvider: boolean;
  };
  limitations: string[];
  sandboxNotice: string;
}

export interface AmbientProofView {
  id: string;
  sessionId: string;
  agreementHash: string;
  createdAt: string;
  document: unknown;
  publicDocument: unknown;
  verification: AmbientProofVerification;
}

export interface AmbientCatalogItem {
  agreementId: string;
  serviceName: string;
  target: AmbientObjectView;
  model: AmbientModelSummaryView;
  termsHash: string;
  fixedPriceMinor: number;
  currency: Currency;
  requiredInactiveMs: number;
  sessionCount: number;
  qualifiedCount: number;
  capturedCount: number;
  latestSessionId: string | null;
  latestOutcome: AmbientOutcome | null;
  demoOnly: boolean;
}

export interface AmbientSourceView {
  target: AmbientObjectView;
  model: AmbientModelSummaryView;
  publishedVia: 'PUBLISHED_TERMS' | 'PUBLISHED_PROMISE';
}

export interface AmbientCatalogView {
  generatedAt: string;
  items: AmbientCatalogItem[];
  sources: AmbientSourceView[];
  sandbox: { configured: boolean; env: 'sandbox'; webhookConfigured: boolean };
  limitations: string[];
}

export interface AmbientJudgeView {
  available: boolean;
  generatedAt: string;
  seed: {
    agreementId: string | null;
    objectId: string | null;
    provenance: 'SYNTHETIC_REFERENCE' | 'USER_CALIBRATION' | null;
    interruptedSessionId: string | null;
    qualifiedSessionId: string | null;
  };
  sessions: AmbientSessionSummary[];
  evidence: {
    physicalFieldTrial: 'OPEN_NOT_RUN';
    genuineSandboxCapture: 'OPEN_NOT_RUN' | 'OBSERVED';
    webhookDelivery: 'OPEN_NOT_VERIFIED' | 'OBSERVED';
    buyerComprehension: 'OPEN_NOT_RUN';
  };
  limitations: string[];
}
