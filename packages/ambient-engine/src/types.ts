import type { Currency } from '../../meter/src/currency.ts';

export const AMBIENT_CONDITION_SCHEMA = 'whirr.ambient-condition.v1';
export const COOPERATION_AGREEMENT_SCHEMA = 'whirr.cooperation-agreement.v1';
export const AMBIENT_EVALUATION_SCHEMA = 'whirr.ambient-evaluation.v1';
export const AMBIENT_EVALUATOR_VERSION = 'whirr-ambient-evaluator-v1';

/**
 * The observation vocabulary is deliberately small. A source is either
 * confidently detected, confidently not detected, uncertain, or unavailable.
 * "INACTIVE" never means "silent room" or "powered off"; it means the validated
 * model did not detect the bound source under the declared conditions.
 */
export const SOURCE_STATES = ['ACTIVE', 'INACTIVE', 'UNKNOWN', 'DISCONNECTED'] as const;
export type SourceState = (typeof SOURCE_STATES)[number];

export const AMBIENT_OUTCOMES = [
  'QUALIFIED',
  'NO_BASELINE',
  'INTERRUPTED',
  'SENSOR_LOSS',
  'INSUFFICIENT_EVIDENCE',
  'EXPIRED',
  'REJECTED',
] as const;
export type AmbientOutcome = (typeof AMBIENT_OUTCOMES)[number];

export const AMBIENT_AGREEMENT_STATUSES = [
  'DRAFT',
  'OFFERED',
  'COUNTERED',
  'PROVIDER_ACCEPTED',
  'ACCEPTED',
  'REJECTED',
  'WITHDRAWN',
  'EXPIRED',
] as const;
export type AmbientAgreementStatus = (typeof AMBIENT_AGREEMENT_STATUSES)[number];

export const AMBIENT_OFFER_STATUSES = [
  'OFFERED',
  'COUNTERED',
  'ACCEPTED',
  'REJECTED',
  'WITHDRAWN',
  'EXPIRED',
  'SUPERSEDED',
] as const;
export type AmbientOfferStatus = (typeof AMBIENT_OFFER_STATUSES)[number];

export const AMBIENT_SESSION_STATES = [
  'PAYMENT_PENDING',
  'AUTHORIZED',
  'OBSERVING',
  'QUALIFIED_AWAITING_ACCEPTANCE',
  'READY_FOR_CAPTURE',
  'CAPTURE_REQUESTED',
  'CAPTURED',
  'VOID_REQUESTED',
  'VOID_CONFIRMED',
  'NOT_QUALIFIED',
  'BUYER_REJECTED',
  'EXPIRED',
  'RECONCILIATION_REQUIRED',
  'DEMO_COMPLETE',
] as const;
export type AmbientSessionState = (typeof AMBIENT_SESSION_STATES)[number];

export interface AmbientTarget {
  objectId: string;
  objectName: string;
  glyph: string;
}

export interface AmbientModelRef {
  id: string;
  version: string;
  hash: string;
  status: 'READY' | 'LIMITED';
  datasetHash: string;
  provenance: 'SYNTHETIC_REFERENCE' | 'USER_CALIBRATION';
}

export interface AmbientInterpretation {
  schema: typeof AMBIENT_CONDITION_SCHEMA;
  title: string;
  requestedText: string;
  desiredCondition: string;
  observableCondition: string;
  proxyDisclosure: string;
  target: AmbientTarget;
  supported: boolean;
  unsupportedClaims: string[];
  assumptions: string[];
  limitations: string[];
}

export interface AmbientStartWindow {
  notBefore: string;
  notAfter: string;
}

export interface AmbientCondition {
  type: 'ENROLLED_SOURCE_INACTIVE';
  requiredBaselineActiveMs: number;
  requiredInactiveMs: number;
  confidenceFloor: number;
  maxObservationGapMs: number;
  observationMode: 'BROWSER_MICROPHONE';
  sensorContinuity: 'REQUIRED';
  baselinePolicy: 'REQUIRE_ACTIVE_BASELINE';
  interruptionPolicy: 'RESET_QUALIFYING_WINDOW';
  uncertaintyPolicy: 'RESET_QUALIFYING_WINDOW';
  startWindow: AmbientStartWindow;
}

export interface AmbientFinancialTerms {
  currency: Currency;
  fixedPriceMinor: number;
  maximumChargeMinor: number;
  authorizationExpiryMinutes: number;
}

export interface AmbientPolicies {
  automaticCapture: false;
  failedCondition: 'NO_CAPTURE';
  uncertainEvidence: 'NO_CAPTURE';
  sensorLoss: 'NO_CAPTURE';
  humanAcceptance: 'BUYER_REQUIRED';
  failedAgreement: 'VOID_AUTHORIZATION';
}

export interface AmbientAgreementTerms {
  schema: typeof COOPERATION_AGREEMENT_SCHEMA;
  revision: number;
  agreementId: string;
  serviceName: string;
  parties: {
    buyerRef: string;
    providerRef: string;
  };
  target: AmbientTarget;
  eventModel: AmbientModelRef;
  condition: AmbientCondition;
  financial: AmbientFinancialTerms;
  policies: AmbientPolicies;
  interpretation: AmbientInterpretation;
  evidence: {
    storesRawAudio: false;
    storesFeatureSummaries: false;
    storesIntervalStates: true;
    statement: string;
  };
  createdAt: string;
  expiresAt: string;
}

export interface AmbientObservation {
  seq: number;
  startMs: number;
  endMs: number;
  sourceState: SourceState;
  confidence: number;
  qualityFlags: string[];
  /** Fraction of frames agreeing with the reported source state. */
  eventMatch?: number;
}

export type AmbientEventType =
  | 'BASELINE_ACTIVE'
  | 'BASELINE_MET'
  | 'INACTIVE_STARTED'
  | 'INTERRUPTION'
  | 'UNCERTAIN'
  | 'SENSOR_LOSS'
  | 'WINDOW_QUALIFIED'
  | 'SESSION_ENDED';

export interface AmbientEvent {
  type: AmbientEventType;
  atMs: number;
  evidence: 'OBSERVED' | 'INFERRED' | 'REJECTED';
  confidence: number;
  detail: string;
}

export type AmbientCheckStatus = 'PASS' | 'FAIL' | 'UNKNOWN';

export interface AmbientCheck {
  id: string;
  label: string;
  status: AmbientCheckStatus;
  detail: string;
}

export interface AmbientEvaluation {
  schema: typeof AMBIENT_EVALUATION_SCHEMA;
  evaluatorVersion: string;
  agreementHash: string;
  modelHash: string;
  outcome: AmbientOutcome;
  eligibleForCapture: boolean;
  priceMinor: number;
  currency: Currency;
  requiredInactiveMs: number;
  requiredBaselineActiveMs: number;
  baselineActiveMs: number;
  activeMs: number;
  inactiveMs: number;
  unknownMs: number;
  sensorLossMs: number;
  longestInactiveMs: number;
  qualifyingStartMs: number | null;
  qualifyingEndMs: number | null;
  interruptions: number;
  maxGapMs: number;
  observationsHash: string;
  evidenceRoot: string;
  events: AmbientEvent[];
  checks: AmbientCheck[];
  uncertainties: string[];
  reason: string;
  evaluatedAt: string;
}

export type CompilationSeverity = 'ERROR' | 'WARNING';

export interface AmbientCompilationIssue {
  code: string;
  severity: CompilationSeverity;
  message: string;
}

export interface CompiledAmbientAgreement {
  terms: AmbientAgreementTerms;
  hash: string;
  interpretation: AmbientInterpretation;
  issues: AmbientCompilationIssue[];
  executable: boolean;
}

export interface AmbientEvaluationInput {
  terms: AmbientAgreementTerms;
  agreementHash: string;
  observations: AmbientObservation[];
  /** The model currently attached to the object, when the caller can check it. */
  currentModelHash?: string;
  /** Evaluation time. It lets the verifier prove the agreement had not expired. */
  now?: string;
}
