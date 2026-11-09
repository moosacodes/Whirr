import type {
  FieldRecordingQuality,
  FieldTimelineSegment,
  FieldTrialKind,
  FieldTrialMetrics,
} from '../../audio/src/field-eval.ts';

export type { FieldRecordingQuality, FieldTimelineSegment, FieldTrialKind, FieldTrialMetrics };

export type FieldTestStatus = 'NOT_ELIGIBLE' | 'NOT_RUN' | 'INCOMPLETE' | 'FIELD_PASS' | 'FIELD_FAIL';
export type FieldTrialStatus = 'PASS' | 'FAIL';

export interface FieldGateView {
  id: string;
  label: string;
  threshold: string;
  observed: string;
  status: 'PASS' | 'FAIL' | 'OPEN';
  detail: string;
}

export interface FieldTrialView {
  kind: FieldTrialKind;
  recordingId: string;
  attempt: number;
  status: FieldTrialStatus;
  capturedAt: string;
  durationMs: number;
  sampleRate: number;
  timeline: FieldTimelineSegment[];
  intervals: Array<{
    startMs: number;
    endMs: number;
    state: 'ACTIVE_CONFIDENT' | 'IDLE' | 'UNCERTAIN' | 'DISCONNECTED';
    confidence: number;
  }>;
  recording: {
    provenance: 'CLIENT_CLAIMED_LIVE_MICROPHONE';
    deviceRef: string | null;
    capturedAt: string;
    durationMs: number;
    frameCount: number;
    sampleRate: number;
    quality: FieldRecordingQuality;
    note: string;
  };
  metrics: FieldTrialMetrics;
  notes: string[];
}

export interface FieldTestReport {
  schema: 'whirr.field-test.v1';
  id: string;
  object: { id: string; name: string; category: string; glyph: string };
  model: {
    id: string;
    version: string;
    hash: string;
    status: 'READY' | 'LIMITED' | 'REJECTED';
    provenance: 'USER_CALIBRATION';
    datasetHash: string;
    createdAt: string;
  };
  status: 'FIELD_PASS' | 'FIELD_FAIL';
  outcomeDetail: string;
  metrics: {
    trialCount: number;
    cycles: number;
    precision: number;
    recall: number;
    falseBillableMs: number;
    falseBillableRatio: number;
    overbillingRatio: number;
    billingErrorMs: number;
    billingErrorRatio: number;
    noiseFalseBillableRatio: number;
    distanceActiveRatio: number;
    replayActiveRatio: number;
    totalRecordedMs: number;
    uncertainMs: number;
  };
  gates: FieldGateView[];
  trials: FieldTrialView[];
  recordingSet: {
    recordings: number;
    totalDurationMs: number;
    liveMicrophoneClaims: number;
    rawAudioUploaded: false;
    anonymisedDeviceRefs: string[];
  };
  methodology: string[];
  limitations: string[];
  evidenceHash: string;
  attestation: string;
  createdAt: string;
}

export interface FieldTrainingSummary {
  idle: number;
  active: number;
  negative: number;
  other: number;
  nonLive: number;
  datasetHashMatches: boolean;
}

export interface FieldTestStateView {
  objectId: string;
  model: {
    id: string;
    version: string;
    hash: string;
    status: 'READY' | 'LIMITED' | 'REJECTED';
    provenance: 'SYNTHETIC_REFERENCE' | 'USER_CALIBRATION';
    datasetHash: string;
    createdAt: string;
  } | null;
  protocol: {
    schema: string;
    cycles: number;
    cycleTotalMs: number;
    noiseMs: number;
    distanceMs: number;
    replayMs: number;
    gates: {
      precision: number;
      recall: number;
      falseBillableRatio: number;
      overbillingRatio: number;
      billingErrorRatio: number;
      noiseFalseBillableRatio: number;
      distanceActiveRatio: number;
      replayActiveRatio: number;
    };
  };
  status: FieldTestStatus;
  trials: FieldTrialView[];
  gates: FieldGateView[];
  reportId: string | null;
  report: FieldTestReport | null;
  liveTraining: FieldTrainingSummary;
  limitations: string[];
  nextStep: string;
}

export interface FieldValidationSummary {
  required: boolean;
  status: 'NOT_REQUIRED' | 'NOT_RUN' | 'INCOMPLETE' | 'FIELD_PASS' | 'FIELD_FAIL';
  reportId: string | null;
  reportUrl: string | null;
  detail: string;
}
