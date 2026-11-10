import type { Currency } from '../../meter/src/currency.ts';

export const PHYSICAL_AGREEMENT_SCHEMA = 'whirr.physical-agreement.v1';
export const PROMISE_EVALUATION_SCHEMA = 'whirr.promise-evaluation.v1';
export const PROMISE_EVALUATOR_VERSION = 'whirr-temporal-evaluator-v1';

export const REPORTING_STATES = ['IDLE', 'ACTIVE_CONFIDENT', 'UNCERTAIN', 'DISCONNECTED'] as const;
export type ReportingState = (typeof REPORTING_STATES)[number];

export const PROMISE_EVENTS = [
  'IDLE',
  'START',
  'RUNNING',
  'EXPECTED_STOP',
  'INTERRUPTED',
  'SENSOR_LOST',
  'UNCERTAIN',
  'UNKNOWN',
] as const;
export type PromiseEventLabel = (typeof PROMISE_EVENTS)[number];

export const PROMISE_OUTCOMES = [
  'QUALIFIED',
  'INCOMPLETE',
  'UNCERTAIN',
  'INTERRUPTED',
  'SENSOR_LOST',
  'EXPIRED',
  'REJECTED',
] as const;
export type PromiseOutcome = (typeof PROMISE_OUTCOMES)[number];

export const EXECUTION_STATES = [
  'DRAFT',
  'OWNER_APPROVED',
  'BUYER_CONSENT_PENDING',
  'PAYMENT_AUTHORIZATION_PENDING',
  'AUTHORIZED',
  'OBSERVING',
  'OBSERVATION_COMPLETE',
  'ELIGIBLE_FOR_CAPTURE',
  'NEEDS_REVIEW',
  'INELIGIBLE',
  'CAPTURE_REQUESTED',
  'CAPTURE_CONFIRMED',
  'VOID_REQUESTED',
  'VOID_CONFIRMED',
  'EXPIRED',
  'RECONCILIATION_REQUIRED',
] as const;
export type PromiseExecutionState = (typeof EXECUTION_STATES)[number];

export interface PromiseObservation {
  seq: number;
  startMs: number;
  endMs: number;
  state: ReportingState;
  confidence: number;
  qualityFlags: string[];
  /** Fraction of frames whose learned event class matched the reporting state. */
  eventMatch?: number;
}

export interface PromiseAgreementConstraints {
  minRunMs: number;
  maxRunMs: number;
  maxObservationGapMs: number;
  confidenceFloor: number;
  sensorContinuity: true;
  noUncertainInterval: true;
  singleCycle: true;
  requireIdleBaseline: true;
}

export interface PromiseAgreementFinancial {
  currency: Currency;
  fixedPriceMinor: number;
  maximumChargeMinor: number;
  authorizationExpiryMinutes: number;
}

export interface PromiseAgreementModel {
  id: string;
  version: string;
  hash: string;
  status: 'READY' | 'LIMITED';
  datasetHash: string;
  provenance: 'SYNTHETIC_REFERENCE' | 'USER_CALIBRATION';
}

export interface PromiseAgreementTerms {
  schema: typeof PHYSICAL_AGREEMENT_SCHEMA;
  revision: 1;
  serviceName: string;
  objectId: string;
  objectName: string;
  eventModel: PromiseAgreementModel;
  requiredSequence: ['IDLE', 'START', 'RUNNING', 'EXPECTED_STOP'];
  constraints: PromiseAgreementConstraints;
  financial: PromiseAgreementFinancial;
  policies: {
    failure: 'NO_CAPTURE';
    uncertainty: 'NO_CAPTURE';
    sensorLoss: 'NO_CAPTURE';
    humanAcceptance: 'NONE';
  };
  evidence: {
    reportingStates: ReportingState[];
    acousticStopDistinction: false;
    statement: string;
  };
  createdAt: string;
  expiresAt: string;
}

export type CompilationSeverity = 'ERROR' | 'WARNING';

export interface CompilationIssue {
  code: string;
  severity: CompilationSeverity;
  message: string;
}

export interface NaturalLanguageProposal {
  text: string;
  priceMinor: number | null;
  currency: Currency;
  minRunMs: number | null;
  maxRunMs: number | null;
  requiresStop: boolean;
  rejectsEarlyStop: boolean;
  unsupportedPhrases: string[];
}

export interface AgreementCompilationInput {
  text: string;
  serviceName: string;
  objectId: string;
  objectName: string;
  currency: Currency;
  eventModel: PromiseAgreementModel;
  now: string;
  expiresInMinutes?: number;
}

export interface CompiledAgreement {
  terms: PromiseAgreementTerms;
  hash: string;
  proposal: NaturalLanguageProposal;
  issues: CompilationIssue[];
  executable: boolean;
}

export interface PromiseEvent {
  label: PromiseEventLabel;
  atMs: number;
  evidence: 'OBSERVED' | 'INFERRED' | 'REJECTED';
  confidence: number;
  detail: string;
}

export type PromiseCheckStatus = 'PASS' | 'FAIL' | 'UNKNOWN';

export interface PromiseCheck {
  id: string;
  label: string;
  status: PromiseCheckStatus;
  detail: string;
}

export interface PromiseEvaluation {
  schema: typeof PROMISE_EVALUATION_SCHEMA;
  evaluatorVersion: string;
  agreementHash: string;
  modelHash: string;
  outcome: PromiseOutcome;
  eligibleForCapture: boolean;
  priceMinor: number;
  currency: Currency;
  events: PromiseEvent[];
  checks: PromiseCheck[];
  observedMs: number;
  runMs: number;
  idleMs: number;
  uncertainMs: number;
  sensorLossMs: number;
  maxObservationGapMs: number;
  minConfidence: number;
  uncertainties: string[];
  evidenceRoot: string;
  observationsHash: string;
  reason: string;
}

export interface AgreementSummaryLine {
  id: string;
  label: string;
  value: string;
}
