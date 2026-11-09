import type { Currency, PaymentState, SessionState } from '../../../../packages/contracts/src/types.ts';
import type { ModelArtifact, ModelProvenance, ModelStatus } from '../../../../packages/audio/src/classifier.ts';

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

export function parseArtifact(row: ModelRow): ModelArtifact {
  return JSON.parse(row.artifact_json) as ModelArtifact;
}

export function parseTerms(row: TermsRow) {
  return JSON.parse(row.terms_json) as import('../../../../packages/contracts/src/types.ts').PriceTerms;
}
