import type {
  DiscoveryCondition,
  DiscoveryConditionSummary,
  DiscoveryGate,
  DiscoveryReportMetrics,
  DiscoveryResult,
  DiscoveryQuality,
} from '../../audio/src/discovery.ts';
import type { Currency } from '../../meter/src/index.ts';

export type DiscoveryReportStatus = 'NOT_RUN' | 'INCOMPLETE' | 'PASS' | 'FAIL';
export type DiscoveryProfileStatus = 'READY' | 'WEAK';

export interface DiscoveryCaptureView {
  schema: 'whirr.capture-claim.v1';
  provenance: 'CLIENT_CLAIMED_LIVE_MICROPHONE';
  claimedAt: string;
  deviceLabel: string | null;
  sampleRate: number | null;
  permission: 'GRANTED';
  frameCount: number | null;
  note: string;
}

export interface DiscoveryProtocolView {
  schema: string;
  minEnrollments: number;
  trainingTakesPerObject: number;
  minTakeFrames: number;
  minMatchFrames: number;
  minScore: number;
  minMargin: number;
  maxMedianLatencyMs: number;
  minTargetTrials: number;
  minTargetTrialsPerObject: number;
  minUnknownTrials: number;
  minReplayTrials: number;
  minDistanceTrials: number;
  minNoiseTrials: number;
  targetAccuracy: number;
  unknownRejection: number;
  falseMatchRate: number;
  replayCrossMatchRate: number;
  distanceAccuracy: number;
  noiseAccuracy: number;
  minUsableRatio: number;
}

export interface DiscoveryEnrollmentSummary {
  objectId: string;
  objectName: string;
  category: string;
  glyph: string;
  profileHash: string;
  status: DiscoveryProfileStatus;
  trainingTakeCount: number;
  trainingFrameCount: number;
  usableFrameCount: number;
  createdAt: string;
}

export interface DiscoveryObjectView {
  id: string;
  name: string;
  category: string;
  glyph: string;
  description: string;
  status: 'ACTIVE' | 'REVOKED';
  enrollment: DiscoveryEnrollmentSummary | null;
  hasTerms: boolean;
  checkoutReady: boolean;
  checkoutReason: string;
}

export interface DiscoveryTermsView {
  id: string;
  version: number;
  objectId: string;
  currency: Currency;
  minorPerMinute: number;
  capMinor: number;
  rounding: 'ROUND_ONCE_AT_END';
  uncertainPolicy: 'EXCLUDE';
  billingPolicy: 'AUTO' | 'OPERATOR_REVIEW';
  feesPolicy: 'NO_ADDITIONAL_FEES';
  modelStatus: 'READY' | 'LIMITED' | 'REJECTED';
  createdAt: string;
  hash: string;
}

export interface DiscoveryCandidateView {
  objectId: string;
  name: string;
  category: string;
  glyph: string;
  score: number;
}

export interface DiscoveryTrialView {
  id: string;
  truthObjectId: string | null;
  truthObjectName: string | null;
  condition: DiscoveryCondition;
  result: DiscoveryResult;
  predictedObjectId: string | null;
  predictedObjectName: string | null;
  score: number | null;
  margin: number | null;
  latencyMs: number;
  quality: { totalFrames: number; usableFrames: number; usableRatio: number };
  capturedAt: string;
}

export interface DiscoveryReportView {
  schema: 'whirr.discovery-report.v1';
  id: string;
  status: DiscoveryReportStatus;
  metrics: DiscoveryReportMetrics;
  confusion: { columns: string[]; rows: string[]; matrix: number[][] };
  conditions: DiscoveryConditionSummary[];
  gates: DiscoveryGate[];
  enrollments: DiscoveryEnrollmentSummary[];
  trials: DiscoveryTrialView[];
  protocol: DiscoveryProtocolView;
  limitations: string[];
  provenance: 'CLIENT_CLAIMED_LIVE_MICROPHONE';
  evidenceHash: string;
  createdAt: string;
}

export interface DiscoveryLabView {
  objects: DiscoveryObjectView[];
  enrollments: DiscoveryEnrollmentSummary[];
  trials: DiscoveryTrialView[];
  report: DiscoveryReportView | null;
  reportStatus: DiscoveryReportStatus;
  protocol: DiscoveryProtocolView;
  limitations: string[];
}

export interface DiscoveryPublicView {
  enrollmentCount: number;
  objects: Array<{ id: string; name: string; category: string; glyph: string }>;
  report: DiscoveryReportView | null;
  reportStatus: DiscoveryReportStatus;
  protocol: DiscoveryProtocolView;
  limitations: string[];
}

export interface DiscoveryMatchView {
  schema: 'whirr.discovery-match.v1';
  result: DiscoveryResult;
  top: { objectId: string; score: number; margin: number } | null;
  candidates: DiscoveryCandidateView[];
  quality: DiscoveryQuality;
  latencyMs: number;
  reason: string;
  evidenceHash: string;
  terms: DiscoveryTermsView | null;
  checkoutUrl: string | null;
  checkoutAvailable: boolean;
  checkoutReason: string;
  limitations: string[];
}

export interface DiscoveryTrialResponse {
  trial: DiscoveryTrialView;
  match: DiscoveryMatchView;
  lab: DiscoveryLabView;
}
