import type { Currency } from '../../meter/src/currency.ts';
import type { EventClass, EventModelArtifact } from '../../audio/src/event-model.ts';
import type {
  AgreementSummaryLine,
  PromiseAgreementTerms,
  PromiseCheck,
  PromiseEvaluation,
  PromiseEvent,
  PromiseExecutionState,
  PromiseOutcome,
} from '../../promise/src/types.ts';

export interface PromiseObjectView {
  id: string;
  name: string;
  glyph: string;
  description: string;
  ownerLabel: string;
}

export interface EventModelSummaryView {
  id: string;
  version: string;
  hash: string;
  status: 'READY' | 'LIMITED' | 'REJECTED';
  provenance: 'SYNTHETIC_REFERENCE' | 'USER_CALIBRATION';
  createdAt: string;
  datasetHash: string;
  takeCount: number;
  frameCount: number;
  groupCount: number;
  metrics: {
    frameAccuracy: number;
    macroRecall: number;
    unknownRate: number;
    perClass: Record<EventClass, { precision: number; recall: number; support: number }>;
    confusion: number[][];
    confusionLabels: EventClass[];
  };
  statusReasons: string[];
  limitations: string[];
}

export interface EventModelDetailView extends EventModelSummaryView {
  artifact: EventModelArtifact;
}

export interface EventDemonstrationView {
  id: string;
  objectId: string;
  label: 'idle' | 'active' | 'negative' | 'transition';
  frameCount: number;
  durationMs: number;
  source: 'live' | 'import' | 'synthetic';
  provenance: 'SYNTHETIC_REFERENCE' | 'USER_CALIBRATION';
  sessionGroup: string;
  deviceLabel: string | null;
  createdAt: string;
}

export interface AgreementView {
  id: string;
  object: PromiseObjectView;
  serviceName: string;
  proposalText: string;
  terms: PromiseAgreementTerms;
  termsHash: string;
  summary: AgreementSummaryLine[];
  status: 'OWNER_APPROVED' | 'PAUSED';
  createdAt: string;
  expiresAt: string;
  eventModel: EventModelSummaryView;
  publicUrl: string;
}

export interface PromiseCatalogItem {
  agreement: AgreementView;
  executionCount: number;
  qualifiedCount: number;
  capturedCount: number;
  lastExecutionAt: string | null;
  latestDemo: boolean | null;
}

export interface PromiseCatalogView {
  generatedAt: string;
  items: PromiseCatalogItem[];
  sandbox: { configured: boolean; env: 'sandbox'; webhookConfigured: boolean };
  limitations: string[];
}

export interface PromiseLabView {
  objects: PromiseObjectView[];
  selected: {
    object: PromiseObjectView;
    demonstrations: EventDemonstrationView[];
    eventModel: EventModelSummaryView | null;
    agreements: AgreementView[];
  } | null;
  sandbox: { configured: boolean; env: 'sandbox'; webhookConfigured: boolean };
  demoMode: boolean;
  detectionPreset: {
    idleLabel: 'IDLE';
    runLabel: 'RUNNING';
    backgroundLabel: 'BACKGROUND';
    interruptedLabel: 'INTERRUPTED';
    temporalCompletion: string;
  };
}

export interface PromiseQuoteView {
  fixedPriceMinor: number;
  maximumChargeMinor: number;
  currency: Currency;
  displayPrice: string;
  displayMaximum: string;
}

export interface PromiseExecutionView {
  id: string;
  agreementId: string;
  agreementHash: string;
  object: PromiseObjectView;
  serviceName: string;
  state: PromiseExecutionState;
  paymentState: string;
  demo: boolean;
  observationMode: 'LIVE' | 'REPLAY';
  terms: PromiseAgreementTerms;
  model: EventModelSummaryView;
  quote: PromiseQuoteView;
  createdAt: string;
  consentedAt: string | null;
  authorizedAt: string | null;
  observationStartedAt: string | null;
  observationStoppedAt: string | null;
  completedAt: string | null;
  authorizationExpiresAt: string | null;
  authorizationExpired: boolean;
  meterClockMs: number;
  observedMs: number;
  runMs: number;
  idleMs: number;
  uncertainMs: number;
  sensorLossMs: number;
  outcome: PromiseOutcome | null;
  eligibleForCapture: boolean;
  evaluation: PromiseEvaluation | null;
  events: PromiseEvent[];
  checks: PromiseCheck[];
  paypal: {
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
  ownership: { owner: boolean; renter: boolean };
  flags: {
    canConsent: boolean;
    canCreateOrder: boolean;
    canAuthorize: boolean;
    canStart: boolean;
    canSubmitObservations: boolean;
    canStop: boolean;
    canCapture: boolean;
    canVoid: boolean;
    canProof: boolean;
    awaitingBuyer: boolean;
    awaitingProvider: boolean;
  };
  limitations: string[];
  sandboxNotice: string;
}

export interface PromiseExecutionListItem {
  id: string;
  agreementId: string;
  objectId: string;
  objectName: string;
  serviceName: string;
  state: PromiseExecutionState;
  paymentState: string;
  demo: boolean;
  outcome: PromiseOutcome | null;
  eligibleForCapture: boolean;
  priceMinor: number;
  currency: Currency;
  runMs: number;
  createdAt: string;
  completedAt: string | null;
}

export interface PromiseProofView {
  id: string;
  executionId: string;
  agreementHash: string;
  createdAt: string;
  document: unknown;
  publicDocument: unknown;
  verification: PhysicalProofVerificationView;
}

export interface PhysicalProofVerificationView {
  valid: boolean;
  signatureValid: boolean;
  agreementHashValid: boolean;
  modelHashValid: boolean;
  observationsHashValid: boolean;
  evidenceRootValid: boolean;
  evaluationMatches: boolean;
  paymentConsistent: boolean;
  checks: Array<{ id: string; label: string; pass: boolean; detail: string }>;
  disclaimer: string;
}

export interface PromiseJudgeView {
  available: boolean;
  generatedAt: string;
  seed: {
    agreementId: string | null;
    objectId: string | null;
    eventModelId: string | null;
    provenance: 'SYNTHETIC_REFERENCE' | 'USER_CALIBRATION' | null;
  };
  latestExecutions: PromiseExecutionListItem[];
  evidence: {
    physicalFieldTrial: 'OPEN_NOT_RUN';
    genuineSandboxCapture: 'OPEN_NOT_RUN' | 'OBSERVED';
    webhookDelivery: 'OPEN_NOT_VERIFIED' | 'OBSERVED';
  };
  limitations: string[];
}
