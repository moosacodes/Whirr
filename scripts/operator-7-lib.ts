import { createHash } from 'node:crypto';

export const OPERATOR_RUN_SCHEMA = 'whirr.operator-run.v1';
export const OPERATOR_RELEASE = '7.0.0-rc.1';

export const PHASE_IDS = ['preflight', 'appliance', 'window', 'paypal', 'webhook', 'demo'] as const;
export type PhaseId = (typeof PHASE_IDS)[number];
export type PhaseStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'EVIDENCE_FOUND' | 'VERIFIED' | 'BLOCKED' | 'FAILED';
export type CheckStatus = 'PASS' | 'OPEN' | 'FAIL' | 'BLOCKED';

export interface OperatorCheck {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
}

export interface OperatorPhase {
  status: PhaseStatus;
  updatedAt: string;
  checks: OperatorCheck[];
  notes: string[];
  data: Record<string, unknown>;
}

export interface OperatorArtifact {
  name: string;
  path: string;
  sha256: string;
  bytes: number;
  kind: 'gate-a-log' | 'field-report' | 'video' | 'other';
}

export interface OperatorRun {
  schema: typeof OPERATOR_RUN_SCHEMA;
  runId: string;
  createdAt: string;
  updatedAt: string;
  release: typeof OPERATOR_RELEASE;
  operatorName: string | null;
  objectId: string | null;
  objectName: string | null;
  safetyAttested: boolean;
  conditions: {
    microphoneLabel: string | null;
    distanceCm: number | null;
    applianceSetting: string | null;
    background: string | null;
  };
  phases: Record<PhaseId, OperatorPhase>;
  artifacts: OperatorArtifact[];
  gates: Record<string, 'OPEN'>;
  notes: string[];
}

export interface LiveTakeRow {
  label: string;
  source: string;
}

export interface AmbientSessionRow {
  id: string;
  agreement_id: string;
  object_id: string;
  demo: number;
  observation_mode: string;
  state: string;
  payment_state: string;
  outcome: string | null;
  eligible_for_capture: number;
  paypal_order_id: string | null;
  paypal_authorization_id: string | null;
  paypal_capture_id: string | null;
  paypal_void_id: string | null;
  captured_minor: number | null;
  provider_status: string | null;
  terms_snapshot_json: string;
  acceptance_json: string | null;
  evidence_root: string | null;
  created_at: string;
  proof_id?: string | null;
}

export interface GateALogSummary {
  acceptedForReview: boolean;
  objectId: string | null;
  objectName: string | null;
  modelHash: string | null;
  trials: number;
  completedTrials: number;
  passedTrials: number;
  gateAStatus: string | null;
  captureProvenance: string | null;
  issues: string[];
}

export interface FieldReportSummary {
  acceptedForReview: boolean;
  reportId: string | null;
  status: string | null;
  modelHash: string | null;
  evidenceHash: string | null;
  issues: string[];
}

export interface SessionEvidenceSummary {
  interrupted: AmbientSessionRow | null;
  qualified: AmbientSessionRow | null;
  captured: AmbientSessionRow | null;
  voided: AmbientSessionRow | null;
  liveSessions: number;
  issues: string[];
}

export function sha256Hex(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

export function emptyPhase(now = new Date().toISOString()): OperatorPhase {
  return { status: 'NOT_STARTED', updatedAt: now, checks: [], notes: [], data: {} };
}

export function createOperatorRun(runId: string, now = new Date().toISOString()): OperatorRun {
  return {
    schema: OPERATOR_RUN_SCHEMA,
    runId,
    createdAt: now,
    updatedAt: now,
    release: OPERATOR_RELEASE,
    operatorName: null,
    objectId: null,
    objectName: null,
    safetyAttested: false,
    conditions: {
      microphoneLabel: null,
      distanceCm: null,
      applianceSetting: null,
      background: null,
    },
    phases: Object.fromEntries(PHASE_IDS.map((id) => [id, emptyPhase(now)])) as Record<PhaseId, OperatorPhase>,
    artifacts: [],
    gates: {
      A_real_source_enrollment: 'OPEN',
      B_source_observability: 'OPEN',
      C_physical_window_evaluation: 'OPEN',
      E_correct_paypal_authorization: 'OPEN',
      F_financial_failure_safety: 'OPEN',
      G_financial_success: 'OPEN',
      H_genuine_webhook: 'OPEN',
      J_product_comprehension: 'OPEN',
      K_public_submission: 'OPEN',
    },
    notes: [],
  };
}

export function countLiveTakes(rows: LiveTakeRow[]): { idle: number; active: number; negative: number } {
  const live = rows.filter((row) => row.source === 'live');
  return {
    idle: live.filter((row) => row.label === 'idle').length,
    active: live.filter((row) => row.label === 'active').length,
    negative: live.filter((row) => row.label === 'negative').length,
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function parseGateALog(value: unknown): GateALogSummary {
  const root = record(value);
  const object = record(root?.object);
  const model = record(root?.model);
  const trials = arrayValue(root?.trials);
  const issues: string[] = [];
  if (!root) issues.push('The file is not a JSON object.');
  if (root?.schema !== 'whirr.gate-a-trial-log.v1') issues.push('Expected schema whirr.gate-a-trial-log.v1.');
  if (root?.captureProvenance !== 'CLIENT_CLAIMED_LIVE_MICROPHONE') {
    issues.push('The log does not declare CLIENT_CLAIMED_LIVE_MICROPHONE provenance.');
  }
  if (trials.length < 3) issues.push('At least three trials are required in one Gate A log.');
  let completedTrials = 0;
  let passedTrials = 0;
  for (const entry of trials) {
    const trial = record(entry);
    const on = arrayValue(trial?.onAttempts).at(-1);
    const off = arrayValue(trial?.offAttempts).at(-1);
    const onRecord = record(on);
    const offRecord = record(off);
    if (onRecord && offRecord) completedTrials += 1;
    if (onRecord?.outcome === 'PASS' && offRecord?.outcome === 'PASS') passedTrials += 1;
  }
  if (completedTrials < 3) issues.push('Fewer than three trials have both ON and OFF attempts.');
  return {
    acceptedForReview: issues.length === 0,
    objectId: stringValue(object?.id),
    objectName: stringValue(object?.name),
    modelHash: stringValue(model?.hash),
    trials: trials.length,
    completedTrials,
    passedTrials,
    gateAStatus: stringValue(root?.gateAStatus),
    captureProvenance: stringValue(root?.captureProvenance),
    issues,
  };
}

export function parseFieldReport(value: unknown): FieldReportSummary {
  const root = record(value);
  const model = record(root?.model);
  const issues: string[] = [];
  if (!root) issues.push('The file is not a JSON object.');
  if (root?.status !== 'FIELD_PASS') issues.push('The field report is not FIELD_PASS.');
  if (!stringValue(root?.id)) issues.push('The field report has no report id.');
  if (!stringValue(model?.hash)) issues.push('The field report has no model hash.');
  if (!stringValue(root?.evidenceHash)) issues.push('The field report has no evidence hash.');
  return {
    acceptedForReview: issues.length === 0,
    reportId: stringValue(root?.id),
    status: stringValue(root?.status),
    modelHash: stringValue(model?.hash),
    evidenceHash: stringValue(root?.evidenceHash),
    issues,
  };
}

export function parseTermsPrice(termsJson: string): { fixedPriceMinor: number | null; currency: string | null } {
  try {
    const terms = record(JSON.parse(termsJson));
    const financial = record(terms?.financial);
    return {
      fixedPriceMinor: numberValue(financial?.fixedPriceMinor),
      currency: stringValue(financial?.currency),
    };
  } catch {
    return { fixedPriceMinor: null, currency: null };
  }
}

export function summarizeSessions(rows: AmbientSessionRow[]): SessionEvidenceSummary {
  const live = rows.filter((row) => row.observation_mode === 'LIVE');
  const interrupted = live.find((row) => row.outcome === 'INTERRUPTED') ?? null;
  const qualified = live.find((row) => row.outcome === 'QUALIFIED') ?? null;
  const captured = live.find((row) => row.demo === 0 && Boolean(row.paypal_capture_id)) ?? null;
  const voided = live.find((row) => row.demo === 0 && Boolean(row.paypal_void_id) && !row.paypal_capture_id) ?? null;
  const issues: string[] = [];
  if (!interrupted) issues.push('No live session with outcome INTERRUPTED.');
  if (!qualified) issues.push('No live session with outcome QUALIFIED.');
  if (interrupted && interrupted.eligible_for_capture !== 0) issues.push('The interrupted session is capture-eligible.');
  if (interrupted && interrupted.paypal_capture_id) issues.push('The interrupted session has a capture id.');
  if (qualified && !qualified.acceptance_json) issues.push('The qualified session has no buyer acceptance.');
  return { interrupted, qualified, captured, voided, liveSessions: live.length, issues };
}

export function redactProviderId(value: string | null): string | null {
  if (!value) return null;
  if (value.length <= 8) return value;
  return `…${value.slice(-8)}`;
}

export function demoDurationCheck(seconds: number | null): { pass: boolean; detail: string } {
  if (seconds === null || !Number.isFinite(seconds) || seconds <= 0) {
    return { pass: false, detail: 'No readable video duration was found.' };
  }
  if (seconds > 180) {
    return { pass: false, detail: `The video is ${seconds.toFixed(1)}s; the limit is 180s.` };
  }
  return { pass: true, detail: `The video is ${seconds.toFixed(1)}s, within the 180s limit.` };
}

export function check(id: string, label: string, status: CheckStatus, detail: string): OperatorCheck {
  return { id, label, status, detail };
}

export function phaseStatus(checks: OperatorCheck[]): PhaseStatus {
  if (checks.some((entry) => entry.status === 'FAIL')) return 'FAILED';
  if (checks.some((entry) => entry.status === 'BLOCKED')) return 'BLOCKED';
  if (checks.length > 0 && checks.every((entry) => entry.status === 'PASS')) return 'VERIFIED';
  if (checks.some((entry) => entry.status === 'PASS')) return 'EVIDENCE_FOUND';
  return 'IN_PROGRESS';
}

export function redactRun(run: OperatorRun): OperatorRun {
  const copy = JSON.parse(JSON.stringify(run)) as OperatorRun;
  for (const phase of Object.values(copy.phases)) {
    for (const key of ['orderId', 'authorizationId', 'captureId', 'voidId']) {
      const value = phase.data[key];
      if (typeof value === 'string') phase.data[key] = redactProviderId(value);
    }
  }
  return copy;
}
