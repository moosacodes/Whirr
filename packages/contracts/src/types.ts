import type { Currency, MeterState } from '../../meter/src/index.ts';
import type { Soundprint } from '../../audio/src/soundprint.ts';
import type { SignedEnvelope } from '../../protocol/src/index.ts';

export type { Currency, MeterState };

export const TAKE_LABELS = ['idle', 'active', 'negative', 'transition'] as const;
export type TakeLabel = (typeof TAKE_LABELS)[number];

export const OBJECT_CATEGORIES = [
  'fan',
  'hair_dryer',
  'toothbrush',
  'power_tool',
  'kitchen_appliance',
  'other',
] as const;
export type ObjectCategory = (typeof OBJECT_CATEGORIES)[number];

export const OBJECT_GLYPHS = ['fan', 'dryer', 'brush', 'drill', 'blender', 'lamp', 'kettle', 'other'] as const;
export type ObjectGlyph = (typeof OBJECT_GLYPHS)[number];

export const SESSION_STATES = [
  'CREATED',
  'CONSENTED',
  'PAYMENT_PENDING',
  'READY',
  'ACTIVE',
  'PAUSED',
  'STOPPED',
  'REVIEWED',
  'SETTLEMENT_PENDING',
  'SETTLED',
  'NO_CHARGE',
  'DEMO_COMPLETED',
  'FAILED',
  'ABANDONED',
] as const;
export type SessionState = (typeof SESSION_STATES)[number];

export const PAYMENT_STATES = [
  'NONE',
  'ORDER_CREATED',
  'BUYER_APPROVED',
  'AUTHORIZED',
  'CAPTURE_REQUESTED',
  'CAPTURE_PENDING',
  'CAPTURE_COMPLETED',
  'CAPTURE_DENIED',
  'VOID_REQUESTED',
  'VOIDED',
  'REFUND_REQUESTED',
  'REFUNDED',
  'DEMO_MODE',
  'UNRESOLVED',
] as const;
export type PaymentState = (typeof PAYMENT_STATES)[number];

export type ModelStatus = 'READY' | 'LIMITED' | 'REJECTED';
export type ModelProvenance = 'SYNTHETIC_REFERENCE' | 'USER_CALIBRATION';
export type RoundingMode = 'ROUND_ONCE_AT_END';
export type UncertainPolicy = 'EXCLUDE';
export type BillingPolicy = 'AUTO' | 'OPERATOR_REVIEW';

export interface PriceTerms {
  version: number;
  objectId: string;
  currency: Currency;
  minorPerMinute: number;
  capMinor: number;
  rounding: RoundingMode;
  uncertainPolicy: UncertainPolicy;
  billingPolicy: BillingPolicy;
  feesPolicy: 'NO_ADDITIONAL_FEES';
  modelStatus: ModelStatus;
  createdAt: string;
  /** Optional courtesy credit, capped as a fraction of the consented cap. */
  fairnessReserveMinor?: number;
}

export const TAKE_ROLES = ['TRAINING', 'VALIDATION'] as const;
export type TakeRole = (typeof TAKE_ROLES)[number];
export type DriftStatus = 'FRESH' | 'DRIFT_SUSPECTED' | 'OVERDUE' | 'NO_DATA';
export type PreflightStatus = 'READY' | 'NOISY' | 'UNSTABLE' | 'NO_SIGNAL';
export type StructuredDisputeCode =
  | 'WRONG_OBJECT'
  | 'NOT_RUNNING'
  | 'TOO_NOISY'
  | 'WRONG_INTERVAL'
  | 'OTHER';

export interface IntervalExplanation {
  schema: 'whirr.explanation.v1';
  passportScore: number | null;
  topFeatures: Array<{ name: string; value: number; contribution: number }>;
  summary: string;
}

export interface ValidationReport {
  schema: 'whirr.validation.v1';
  status: 'HELD_OUT_PASS' | 'HELD_OUT_REVIEW' | 'HELD_OUT_FAIL' | 'NOT_RUN';
  method: 'VALIDATION_TAKES';
  takeCount: number;
  activeTakeCount: number;
  negativeTakeCount: number;
  billableMs: number;
  precision: number;
  recall: number;
  falseBillableRatio: number;
  perTake: Array<{
    takeId: string;
    label: string;
    durationMs: number;
    billableMs: number;
    expectedActive: boolean;
  }>;
  notes: string[];
  createdAt: string;
}

export interface DriftView {
  status: DriftStatus;
  reason: string;
  sessions: number;
  mismatchRatio: number;
  uncertainRatio: number;
  calibrationAgeDays: number | null;
}

export interface PassportStamp {
  id: string;
  kind: 'calibration' | 'terms' | 'sessions' | 'dispute' | 'passport';
  label: string;
  detail: string;
  at: string | null;
  hash: string | null;
}

export interface PassportPayload {
  schema: 'whirr.passport.v2';
  passportVersion: number;
  object: {
    id: string;
    name: string;
    category: string;
    glyph: string;
    description: string;
    ownerLabel: string;
    status: 'ACTIVE' | 'REVOKED';
    createdAt: string;
  };
  model: {
    version: string;
    hash: string;
    status: ModelStatus;
    provenance: ModelProvenance;
    precision: number;
    recall: number;
    falseBillableRatio: number;
    takeCount: number;
    featureSpecVersion: string;
    datasetHash: string;
    trainedAt: string;
    soundprint: Soundprint | null;
    validation: ValidationReport | null;
  };
  terms: (PriceTerms & { hash: string }) | null;
  calibration: { ageDays: number | null; takeCount: number; validation: ValidationReport | null };
  drift: DriftView;
  stamps: PassportStamp[];
  previousPassportHash: string | null;
  createdAt: string;
  limitations: string[];
  attestation: string;
}

export type SignedPassport = SignedEnvelope<PassportPayload>;

export interface ReceiptProofPayload {
  schema: 'whirr.receipt-proof.v2';
  proofId: string;
  receiptId: string;
  sessionId: string;
  createdAt: string;
  object: { id: string; name: string; category: string };
  receiptHash: string;
  sessionEvidenceHash: string | null;
  model: { version: string; hash: string; status: ModelStatus; provenance: ModelProvenance };
  terms: { hash: string; currency: Currency; minorPerMinute: number; capMinor: number };
  pricing: {
    currency: Currency;
    minorPerMinute: number;
    capMinor: number;
    baseQuoteMinor: number;
    creditMinor: number;
    quoteMinor: number;
    billableMs: number;
    formula: string;
  };
  payment: { mode: 'PAYPAL_SANDBOX' | 'DEMO_NO_PAYMENT' | 'PENDING'; state: PaymentState; capturedMinor: number | null; refundMinor: number | null };
  passport: { status: 'ENROLLED' | 'WEAK' | 'NOT_ENROLLED'; gateEnabled: boolean; mismatchMs: number };
  intervals: { count: number; billableMs: number; uncertainMs: number; idleMs: number; disconnectedMs: number };
  review: { quoteHash: string; acceptedAt: string | null; reviewMode: 'AUTO' | 'OPERATOR_REQUIRED' };
  limitations: string[];
  attestation: string;
}

export type SignedReceiptProof = SignedEnvelope<ReceiptProofPayload>;

export interface PreflightSummary {
  status: PreflightStatus;
  frameCount: number;
  durationMs: number;
  noiseFloorLogRms: number | null;
  levelVariance: number;
  clippedRatio: number;
  silentRatio: number;
  flags: string[];
  detail: string;
}

export interface PreflightView extends PreflightSummary {
  sessionId: string;
  createdAt: string;
}

export interface SensorReport {
  schema: 'whirr.sensor-report.v1';
  sessionId: string;
  observedMs: number;
  billableMs: number;
  mismatchMs: number;
  mismatchRatio: number;
  uncertainMs: number;
  uncertainRatio: number;
  createdAt: string;
  note: string;
}

export interface HoldView {
  id: string;
  objectId: string;
  createdAt: string;
  expiresAt: string;
}

export interface ShelfItem {
  object: ServiceObjectView;
  terms: (PriceTerms & { id: string; hash: string }) | null;
  model: ModelSummary | null;
  calibrationAgeDays: number | null;
  drift: DriftView;
  passportVersion: number | null;
  signed: boolean;
  activeSession: boolean;
  hold: HoldView | null;
}

export interface ShelfView {
  generatedAt: string;
  items: ShelfItem[];
}

export interface ModelMetricsSummary {
  status: ModelStatus;
  precision: number;
  recall: number;
  falseBillableRatio: number;
  threshold: number;
  takeCount: number;
  frameCount: number;
  trainedAt: string;
  provenance: ModelProvenance;
  method: string;
}

export interface ModelSummary {
  id: string;
  version: string;
  hash: string;
  status: ModelStatus;
  metrics: ModelMetricsSummary;
  limitations: string[];
  takeaways: string[];
  datasetHash: string;
  createdAt: string;
  soundprint: Soundprint | null;
}

export interface ServiceObjectView {
  id: string;
  name: string;
  category: string;
  glyph: string;
  description: string;
  photoDataUrl: string | null;
  ownerLabel: string;
  status: 'ACTIVE' | 'REVOKED';
  createdAt: string;
}

export interface ServiceView {
  object: ServiceObjectView;
  terms: PriceTerms;
  termsHash: string;
  model: ModelSummary | null;
  activeSession: boolean;
  sandbox: { configured: boolean; env: 'sandbox'; webhookConfigured: boolean };
  example: {
    fifteenSecondsMinor: number;
    thirtyFiveSecondsMinor: number;
    fiveMinutesMinor: number;
  };
  limitations: string[];
  privacy: string[];
}

export interface PassportView {
  object: ServiceObjectView;
  model: ModelSummary;
  soundprint: Soundprint | null;
  terms: (PriceTerms & { id: string; hash: string }) | null;
  sessionCount: number;
  lastSessionAt: string | null;
  shareUrl: string;
  signedPassport: SignedPassport | null;
  passportHistory: Array<{ version: number; createdAt: string; payloadHash: string; keyId: string }>;
  drift: DriftView;
  validation: ValidationReport | null;
  stamps: PassportStamp[];
}

export interface IntervalView {
  id: string;
  seq: number;
  startMs: number;
  endMs: number;
  state: MeterState;
  modelVersion: string;
  confidence: number;
  qualityFlags: string[];
  evidenceHash: string;
  explanation?: IntervalExplanation;
}

export interface DisputeView {
  id: string;
  sessionId: string;
  intervalIds: string[];
  reason: string;
  reasonCode: StructuredDisputeCode | null;
  status: 'OPEN' | 'RESOLVED' | 'REJECTED';
  resolution: string | null;
  creditMinor: number;
  createdAt: string;
  resolvedAt: string | null;
}

export interface QuoteView {
  billableMs: number;
  baseQuoteMinor: number;
  creditMinor: number;
  quoteMinor: number;
  capMinor: number;
  currency: Currency;
  quoteHash: string;
  formula: string;
}

export interface SessionView {
  id: string;
  objectId: string;
  objectName: string;
  objectGlyph: string;
  objectPhotoDataUrl: string | null;
  ownerLabel: string;
  state: SessionState;
  paymentState: PaymentState;
  reviewMode: 'AUTO' | 'OPERATOR_REQUIRED';
  terms: PriceTerms;
  termsHash: string;
  model: {
    id: string;
    version: string;
    hash: string;
    status: ModelStatus;
    metrics: ModelMetricsSummary;
    soundprint: Soundprint | null;
  };
  consentRequired: boolean;
  consentedAt: string | null;
  createdAt: string;
  startedAt: string | null;
  stoppedAt: string | null;
  reviewedAt: string | null;
  operatorApprovedAt: string | null;
  reviewedQuoteHash: string | null;
  meterClockMs: number;
  billableMs: number;
  excludedMs: number;
  observedMs: number;
  idleMs: number;
  disconnectedMs: number;
  quote: QuoteView;
  approvedCapMinor: number;
  paypal: {
    orderId: string | null;
    authorizationId: string | null;
    captureId: string | null;
    providerStatus: string | null;
    approveUrl: string | null;
  };
  sandbox: { configured: boolean; env: 'sandbox' };
  intervals: IntervalView[];
  disputes: DisputeView[];
  evidenceHash: string | null;
  sensorMode: 'LIVE' | 'REPLAY';
  flags: {
    canConsent: boolean;
    canCreateOrder: boolean;
    canDemoStart: boolean;
    canStart: boolean;
    canPause: boolean;
    canResume: boolean;
    canStop: boolean;
    canAcceptReview: boolean;
    canCapture: boolean;
    canVoid: boolean;
    canApproveReview: boolean;
    awaitingOperator: boolean;
  };
  preflight: PreflightView | null;
  fairnessReserveMinor: number;
  fairnessCreditAppliedMinor: number;
  canUseFairnessReserve: boolean;
  limitations: string[];
  sandboxNotice: string;
  sessionToken: string;
}

export interface ReceiptTimelineEntry {
  startMs: number;
  endMs: number;
  state: MeterState;
  confidence: number;
  qualityFlags: string[];
  explanation?: IntervalExplanation;
}

export interface ReceiptVerification {
  checkedAt: string;
  quoteMatches: boolean;
  capRespected: boolean;
  evidenceMatches: boolean;
  receiptHashMatches: boolean;
  intervalsConsistent: boolean;
  passportConsistent: boolean;
  providerAmountMatches: boolean | null;
  auditChainValid: boolean;
  recomputedQuoteMinor: number;
}

export interface EvidenceReceipt {
  schema: 'whirr.receipt.v1';
  receiptId: string;
  sessionId: string;
  object: { id: string; name: string; category: string; ownerLabel: string };
  createdAt: string;
  renterRef: string;
  terms: PriceTerms;
  termsHash: string;
  model: {
    version: string;
    hash: string;
    status: ModelStatus;
    provenance: ModelProvenance;
    precision: number;
    recall: number;
    falseBillableRatio: number;
    takeCount: number;
    soundprint?: {
      status: 'ENROLLED' | 'WEAK';
      gateEnabled: boolean;
      matchThreshold: number;
      activeMedianSimilarity: number;
      nonActiveP95Similarity: number;
      activeBlockRatio: number;
      nonActivePassRatio: number;
    } | null;
  };
  consent: { acceptedAt: string | null; termsHash: string; modelHash: string };
  passport: {
    status: 'ENROLLED' | 'WEAK' | 'NOT_ENROLLED';
    gateEnabled: boolean;
    matchThreshold: number;
    mismatchIntervals: number;
    mismatchMs: number;
  };
  timeline: ReceiptTimelineEntry[];
  totals: {
    observedMs: number;
    billableMs: number;
    uncertainMs: number;
    idleMs: number;
    disconnectedMs: number;
  };
  pricing: {
    currency: Currency;
    minorPerMinute: number;
    capMinor: number;
    baseQuoteMinor: number;
    creditMinor: number;
    quoteMinor: number;
    rounding: RoundingMode;
    formula: string;
  };
  payment: {
    state: PaymentState;
    mode: 'PAYPAL_SANDBOX' | 'DEMO_NO_PAYMENT' | 'PENDING';
    orderId: string | null;
    authorizationId: string | null;
    captureId: string | null;
    refundId: string | null;
    refundMinor: number | null;
    providerStatus: string | null;
    providerReconciledAt: string | null;
    capturedMinor: number | null;
  };
  disputes: DisputeView[];
  review: {
    quoteHash: string;
    acceptedAt: string | null;
    operatorApprovedAt: string | null;
    reviewMode: 'AUTO' | 'OPERATOR_REQUIRED';
  };
  limitations: string[];
  evidenceSha256: string;
  sessionEvidenceSha256: string | null;
  finalized: boolean;
  verification?: ReceiptVerification;
}

export interface SessionListItem {
  id: string;
  objectId: string;
  objectName: string;
  renterRef: string;
  state: SessionState;
  paymentState: PaymentState;
  createdAt: string;
  stoppedAt: string | null;
  billableMs: number;
  quoteMinor: number;
  currency: Currency;
  captureId: string | null;
  reviewMode: 'AUTO' | 'OPERATOR_REQUIRED';
  disputeCount: number;
}

export interface CalibrationTakeView {
  id: string;
  label: TakeLabel;
  frameCount: number;
  durationMs: number;
  source: 'live' | 'import' | 'synthetic';
  deviceLabel: string | null;
  notes: string | null;
  createdAt: string;
  role: TakeRole;
  quality: {
    clippedRatio: number;
    silentRatio: number;
    lowLevelRatio: number;
    usableFrames: number;
  };
}

export interface CalibrationPreview {
  status: 'NOT_ENOUGH_DATA' | 'SEPARABLE' | 'TOO_SIMILAR';
  detail: string;
  activeTakes: number;
  nonActiveTakes: number;
  soundprint: Soundprint | null;
}

export interface OwnerObjectView {
  object: ServiceObjectView;
  activeModel: ModelSummary | null;
  terms: (PriceTerms & { id: string; hash: string }) | null;
  takes: CalibrationTakeView[];
  takeCounts: Record<TakeLabel, number>;
  validationTakeCount: number;
  sessionCount: number;
  lastSessionAt: string | null;
  calibrationAgeDays: number | null;
  shareUrl: string;
  activeSessions: number;
  validationReport: ValidationReport | null;
  calibrationPreview: CalibrationPreview;
  drift: DriftView;
  shelfListed: boolean;
}

export interface ObjectsResponse {
  objects: OwnerObjectView[];
  operator: { id: string; displayName: string };
  paypal: { configured: boolean; env: 'sandbox'; webhookConfigured: boolean };
  demoMode: boolean;
}

export interface OperatorOverview {
  objects: OwnerObjectView[];
  sessions: SessionListItem[];
  disputes: DisputeView[];
  paypal: { configured: boolean; env: 'sandbox'; webhookConfigured: boolean };
  webhooks: Array<{
    id: string;
    eventId: string;
    eventType: string;
    verified: boolean;
    receivedAt: string;
    processedAt: string | null;
    result: string | null;
  }>;
  audit: Array<{ id: string; action: string; createdAt: string; hash: string }>;
  selfCheck: JudgeCheck[];
}

export interface JudgeCheck {
  id: string;
  label: string;
  status: 'PASS' | 'OPEN' | 'FAIL';
  detail: string;
}

export interface JudgeStatus {
  generatedAt: string;
  checks: JudgeCheck[];
  reference: {
    available: boolean;
    modelVersion: string | null;
    modelHash: string | null;
    modelStatus: ModelStatus | null;
    provenance: ModelProvenance | null;
    modelUrl: string;
    fixture: string | null;
    fixtureUrl: string;
    fixtureDurationMs: number | null;
    fixtureLabel: string;
  };
  demoObjectId: string | null;
  paypal: { configured: boolean; env: 'sandbox'; webhookConfigured: boolean };
  stats: {
    objects: number;
    sessions: number;
    settledSessions: number;
    verifiedWebhookEvents: number;
  };
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface AuthSessionView {
  operator: boolean;
  operatorId: string | null;
  displayName: string | null;
  renterRef: string | null;
  paypal: { configured: boolean; env: 'sandbox'; webhookConfigured: boolean };
  demoMode: boolean;
}
