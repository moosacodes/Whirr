import type { Currency, PaymentState, SessionState } from '../../../../packages/contracts/src/types.ts';
import type { ModelArtifact, ModelProvenance, ModelStatus } from '../../../../packages/audio/src/classifier.ts';
import type { DiscoveryCondition, DiscoveryResult } from '../../../../packages/audio/src/discovery.ts';
import type { PromiseExecutionState, PromiseOutcome } from '../../../../packages/promise/src/types.ts';
import type {
  AmbientAgreementStatus,
  AmbientOfferStatus,
  AmbientOutcome,
  AmbientSessionState,
  SourceState,
} from '../../../../packages/ambient-engine/src/types.ts';

export interface UserRow {
  id: string;
  role: 'operator' | 'renter';
  display_name: string | null;
  created_at: string;
}

export interface ObjectRow {
  id: string;
  owner_id: string;
  name: string;
  category: string;
  glyph: string;
  description: string;
  photo_data_url: string | null;
  status: 'ACTIVE' | 'REVOKED';
  created_at: string;
  revoked_at: string | null;
  active_model_id: string | null;
  active_terms_id: string | null;
}

export interface TakeRow {
  id: string;
  object_id: string;
  label: 'idle' | 'active' | 'negative' | 'transition';
  frames_json: string;
  frame_flags_json: string;
  frame_count: number;
  duration_ms: number;
  feature_spec_version: string;
  source: 'live' | 'import' | 'synthetic';
  device_label: string | null;
  notes: string | null;
  dataset_hash: string;
  quality_json: string;
  created_at: string;
}

export interface ModelRow {
  id: string;
  object_id: string;
  version: string;
  artifact_json: string;
  model_hash: string;
  status: ModelStatus;
  dataset_hash: string;
  metrics_json: string;
  provenance: ModelProvenance;
  created_at: string;
  superseded_at: string | null;
}

export interface TermsRow {
  id: string;
  object_id: string;
  version: number;
  terms_json: string;
  terms_hash: string;
  currency: Currency;
  minor_per_minute: number;
  cap_minor: number;
  rounding: string;
  uncertain_policy: string;
  billing_policy: string;
  model_status: ModelStatus;
  created_at: string;
  superseded_at: string | null;
}

export interface SessionRow {
  id: string;
  object_id: string;
  owner_id: string;
  renter_id: string;
  terms_id: string;
  terms_hash: string;
  model_version_id: string;
  model_hash: string;
  model_status: ModelStatus;
  currency: Currency;
  minor_per_minute: number;
  cap_minor: number;
  state: SessionState;
  payment_state: PaymentState;
  review_mode: 'AUTO' | 'OPERATOR_REQUIRED';
  sensor_mode: 'LIVE' | 'REPLAY';
  created_at: string;
  consented_at: string | null;
  started_at: string | null;
  stopped_at: string | null;
  paused_at: string | null;
  paused_total_ms: number;
  last_client_seq: number;
  last_interval_end_ms: number;
  observed_ms: number;
  billable_ms: number;
  excluded_ms: number;
  idle_ms: number;
  disconnected_ms: number;
  base_quote_minor: number;
  credit_minor: number;
  quote_minor: number;
  quote_hash: string | null;
  reviewed_at: string | null;
  reviewed_quote_hash: string | null;
  operator_approved_at: string | null;
  finalized_at: string | null;
  paypal_order_id: string | null;
  paypal_approve_url: string | null;
  paypal_authorization_id: string | null;
  paypal_capture_id: string | null;
  paypal_refund_id: string | null;
  provider_status: string | null;
  provider_reconciled_at: string | null;
  authorization_expires_at: string | null;
  capture_claim_json: string | null;
  captured_minor: number | null;
  evidence_hash: string | null;
  failure_reason: string | null;
}

export interface IntervalRow {
  id: string;
  session_id: string;
  seq: number;
  start_ms: number;
  end_ms: number;
  state: 'ACTIVE_CONFIDENT' | 'IDLE' | 'UNCERTAIN' | 'DISCONNECTED';
  model_version: string;
  confidence: number;
  quality_flags_json: string;
  explanation_json: string | null;
  evidence_hash: string;
  received_at: string;
}

export interface ConsentRow {
  session_id: string;
  renter_id: string;
  terms_hash: string;
  model_hash: string;
  terms_snapshot_json: string;
  accepted_at: string;
  ip_hash: string;
  user_agent_hash: string;
}

export interface DisputeRow {
  id: string;
  session_id: string;
  renter_id: string;
  interval_ids_json: string;
  reason: string;
  reason_code: string | null;
  status: 'OPEN' | 'RESOLVED' | 'REJECTED';
  resolution: string | null;
  credit_minor: number;
  created_at: string;
  resolved_at: string | null;
}

export interface PaymentOperationRow {
  id: string;
  session_id: string;
  operation_type: 'CREATE_ORDER' | 'AUTHORIZE' | 'CAPTURE' | 'VOID' | 'REFUND';
  request_id: string;
  state: string;
  amount_minor: number | null;
  currency: string | null;
  request_hash: string;
  provider_ref: string | null;
  response_json: string | null;
  attempts: number;
  created_at: string;
  updated_at: string;
}

export interface WebhookEventRow {
  id: string;
  event_id: string;
  event_type: string;
  transmission_id: string | null;
  payload_sha256: string;
  verified: number;
  received_at: string;
  processed_at: string | null;
  result: string | null;
  raw_json: string;
}

export interface FieldTrialRow {
  id: string;
  object_id: string;
  model_id: string;
  trial_kind: 'THREE_CYCLE' | 'NOISE' | 'DISTANCE' | 'REPLAY';
  frames_json: string;
  frame_flags_json: string;
  timeline_json: string;
  capture_json: string;
  quality_json: string;
  attempt: number;
  created_at: string;
}

export interface FieldReportRow {
  id: string;
  object_id: string;
  model_id: string;
  status: 'FIELD_PASS' | 'FIELD_FAIL';
  report_json: string;
  evidence_hash: string;
  created_at: string;
}

export interface PayPalResourceRow {
  id: string;
  session_id: string | null;
  kind: string;
  provider_id: string;
  status: string;
  amount_minor: number | null;
  currency: string | null;
  raw_json: string;
  created_at: string;
  updated_at: string;
}

export interface DiscoveryEnrollmentRow {
  id: string;
  object_id: string;
  profile_json: string;
  profile_hash: string;
  status: 'READY' | 'WEAK';
  created_at: string;
}

export interface DiscoveryTrialRow {
  id: string;
  object_id: string | null;
  truth_object_id: string | null;
  condition: DiscoveryCondition;
  result: DiscoveryResult;
  predicted_object_id: string | null;
  score: number | null;
  margin: number | null;
  latency_ms: number;
  quality_json: string;
  capture_json: string;
  evidence_hash: string;
  created_at: string;
}

export interface DiscoveryReportRow {
  id: string;
  status: 'NOT_RUN' | 'INCOMPLETE' | 'PASS' | 'FAIL';
  report_json: string;
  evidence_hash: string;
  created_at: string;
}

export function parseArtifact(row: ModelRow): ModelArtifact {
  return JSON.parse(row.artifact_json) as ModelArtifact;
}

export function parseTerms(row: TermsRow) {
  return JSON.parse(row.terms_json) as import('../../../../packages/contracts/src/types.ts').PriceTerms;
}

export interface EventDemonstrationRow {
  id: string;
  object_id: string;
  label: 'idle' | 'active' | 'negative' | 'transition';
  frames_json: string;
  frame_flags_json: string;
  frame_count: number;
  duration_ms: number;
  feature_spec_version: string;
  source: 'live' | 'import' | 'synthetic';
  provenance: 'SYNTHETIC_REFERENCE' | 'USER_CALIBRATION';
  session_group: string;
  device_label: string | null;
  notes: string | null;
  dataset_hash: string;
  captured_at: string;
  created_at: string;
}

export interface EventModelRow {
  id: string;
  object_id: string;
  version: string;
  artifact_json: string;
  model_hash: string;
  status: 'READY' | 'LIMITED' | 'REJECTED';
  dataset_hash: string;
  metrics_json: string;
  provenance: 'SYNTHETIC_REFERENCE' | 'USER_CALIBRATION';
  created_at: string;
  superseded_at: string | null;
}

export interface PromiseAgreementRow {
  id: string;
  object_id: string;
  owner_id: string;
  event_model_id: string;
  event_model_hash: string;
  service_name: string;
  proposal_text: string;
  terms_json: string;
  terms_hash: string;
  status: 'OWNER_APPROVED' | 'PAUSED';
  created_at: string;
  expires_at: string;
}

export interface PromiseExecutionRow {
  id: string;
  agreement_id: string;
  agreement_hash: string;
  object_id: string;
  owner_id: string;
  renter_id: string;
  state: PromiseExecutionState;
  payment_state: string;
  demo: number;
  observation_mode: 'LIVE' | 'REPLAY';
  terms_snapshot_json: string;
  created_at: string;
  consented_at: string | null;
  authorized_at: string | null;
  observation_started_at: string | null;
  observation_stopped_at: string | null;
  completed_at: string | null;
  authorization_expires_at: string | null;
  last_client_seq: number;
  last_observed_ms: number;
  observed_ms: number;
  run_ms: number;
  idle_ms: number;
  uncertain_ms: number;
  sensor_loss_ms: number;
  outcome: PromiseOutcome | null;
  eligible_for_capture: number;
  evaluation_json: string | null;
  evaluation_hash: string | null;
  evidence_root: string | null;
  paypal_order_id: string | null;
  paypal_approve_url: string | null;
  paypal_authorization_id: string | null;
  paypal_capture_id: string | null;
  paypal_void_id: string | null;
  provider_status: string | null;
  provider_reconciled_at: string | null;
  captured_minor: number | null;
  human_acceptance_json: string | null;
  failure_reason: string | null;
}

export interface PromiseObservationRow {
  id: string;
  execution_id: string;
  seq: number;
  start_ms: number;
  end_ms: number;
  state: 'ACTIVE_CONFIDENT' | 'IDLE' | 'UNCERTAIN' | 'DISCONNECTED';
  confidence: number;
  event_match: number | null;
  quality_flags_json: string;
  received_at: string;
}

export interface PromisePaymentOperationRow {
  id: string;
  execution_id: string;
  operation_type: 'CREATE_ORDER' | 'AUTHORIZE' | 'CAPTURE' | 'VOID';
  request_id: string;
  state: string;
  amount_minor: number | null;
  currency: string | null;
  request_hash: string;
  provider_ref: string | null;
  response_json: string | null;
  attempts: number;
  created_at: string;
  updated_at: string;
}

export interface PromiseProofRow {
  id: string;
  execution_id: string;
  payload_hash: string;
  document_json: string;
  public_document_json: string;
  created_at: string;
}

export interface AmbientAgreementRow {
  id: string;
  buyer_id: string;
  provider_id: string;
  object_id: string;
  event_model_id: string;
  status: AmbientAgreementStatus;
  current_revision: number;
  terms_json: string;
  terms_hash: string;
  offer_expires_at: string;
  created_at: string;
  updated_at: string;
  buyer_accepted_at: string | null;
  provider_accepted_at: string | null;
  rejected_at: string | null;
  rejected_by: string | null;
}

export interface AmbientOfferRow {
  id: string;
  agreement_id: string;
  revision: number;
  terms_json: string;
  terms_hash: string;
  proposed_by: 'BUYER' | 'PROVIDER';
  price_minor: number;
  duration_ms: number;
  status: AmbientOfferStatus;
  note: string | null;
  created_at: string;
  decided_at: string | null;
}

export interface AmbientSessionRow {
  id: string;
  agreement_id: string;
  agreement_revision: number;
  agreement_hash: string;
  object_id: string;
  buyer_id: string;
  provider_id: string;
  terms_snapshot_json: string;
  state: AmbientSessionState;
  payment_state: string;
  demo: number;
  observation_mode: 'LIVE' | 'REPLAY';
  created_at: string;
  accepted_at: string;
  authorized_at: string | null;
  observation_started_at: string | null;
  observation_stopped_at: string | null;
  authorization_expires_at: string | null;
  paypal_order_id: string | null;
  paypal_approve_url: string | null;
  paypal_authorization_id: string | null;
  paypal_capture_id: string | null;
  paypal_void_id: string | null;
  provider_status: string | null;
  provider_reconciled_at: string | null;
  captured_minor: number | null;
  outcome: AmbientOutcome | null;
  eligible_for_capture: number;
  evaluation_json: string | null;
  evaluation_hash: string | null;
  evidence_root: string | null;
  acceptance_json: string | null;
  failure_reason: string | null;
  last_client_seq: number;
  last_observed_ms: number;
}

export interface AmbientObservationRow {
  id: string;
  session_id: string;
  seq: number;
  start_ms: number;
  end_ms: number;
  source_state: SourceState;
  confidence: number;
  event_match: number | null;
  quality_flags_json: string;
  received_at: string;
}

export interface AmbientPaymentOperationRow {
  id: string;
  session_id: string;
  operation_type: 'CREATE_ORDER' | 'AUTHORIZE' | 'CAPTURE' | 'VOID';
  request_id: string;
  state: string;
  amount_minor: number | null;
  currency: string | null;
  request_hash: string;
  provider_ref: string | null;
  response_json: string | null;
  attempts: number;
  created_at: string;
  updated_at: string;
}

export interface AmbientProofRow {
  id: string;
  session_id: string;
  payload_hash: string;
  document_json: string;
  public_document_json: string;
  created_at: string;
}

export interface FieldTrialRow {
  id: string;
  object_id: string;
  model_id: string;
  trial_kind: 'THREE_CYCLE' | 'NOISE' | 'DISTANCE' | 'REPLAY';
  frames_json: string;
  frame_flags_json: string;
  timeline_json: string;
  capture_json: string;
  quality_json: string;
  attempt: number;
  created_at: string;
}
