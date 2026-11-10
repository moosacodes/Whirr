import { describe, expect, it } from 'vitest';
import {
  countLiveTakes,
  createOperatorRun,
  demoDurationCheck,
  parseFieldReport,
  parseGateALog,
  phaseStatus,
  redactProviderId,
  redactRun,
  summarizeSessions,
  type AmbientSessionRow,
} from '../../scripts/operator-7-lib.ts';

function session(overrides: Partial<AmbientSessionRow> = {}): AmbientSessionRow {
  return {
    id: 'ase_test',
    agreement_id: 'amb_test',
    object_id: 'obj_real_fan',
    demo: 1,
    observation_mode: 'LIVE',
    state: 'QUALIFIED_AWAITING_ACCEPTANCE',
    payment_state: 'DEMO_MODE',
    outcome: 'QUALIFIED',
    eligible_for_capture: 1,
    paypal_order_id: null,
    paypal_authorization_id: null,
    paypal_capture_id: null,
    paypal_void_id: null,
    captured_minor: null,
    provider_status: null,
    terms_snapshot_json: JSON.stringify({ financial: { fixedPriceMinor: 200, currency: 'USD' } }),
    acceptance_json: JSON.stringify({ accepted: true }),
    evidence_root: 'a'.repeat(64),
    created_at: '2026-11-10T10:00:00.000Z',
    proof_id: 'apr_test',
    ...overrides,
  };
}

function gateLog(overrides: Record<string, unknown> = {}): unknown {
  const trial = {
    onAttempts: [{ outcome: 'PASS' }],
    offAttempts: [{ outcome: 'PASS' }],
  };
  return {
    schema: 'whirr.gate-a-trial-log.v1',
    gateAStatus: 'OPEN_PENDING_REVIEW',
    captureProvenance: 'CLIENT_CLAIMED_LIVE_MICROPHONE',
    object: { id: 'obj_real_fan', name: 'Real fan' },
    model: { hash: 'b'.repeat(64) },
    trials: [trial, trial, trial],
    ...overrides,
  };
}

describe('operator 7.0 evidence helpers', () => {
  it('counts only live enrollment takes', () => {
    expect(
      countLiveTakes([
        { label: 'idle', source: 'live' },
        { label: 'idle', source: 'live' },
        { label: 'active', source: 'live' },
        { label: 'active', source: 'synthetic' },
        { label: 'negative', source: 'import' },
      ]),
    ).toEqual({ idle: 2, active: 1, negative: 0 });
  });

  it('accepts a well-formed client-reported Gate A log for review without closing the gate', () => {
    const parsed = parseGateALog(gateLog());
    expect(parsed.acceptedForReview).toBe(true);
    expect(parsed.completedTrials).toBe(3);
    expect(parsed.passedTrials).toBe(3);
    expect(parsed.gateAStatus).toBe('OPEN_PENDING_REVIEW');
  });

  it('rejects a Gate A log without live provenance or three completed trials', () => {
    const parsed = parseGateALog(gateLog({ captureProvenance: 'SYNTHETIC', trials: [] }));
    expect(parsed.acceptedForReview).toBe(false);
    expect(parsed.issues.join(' ')).toContain('CLIENT_CLAIMED_LIVE_MICROPHONE');
    expect(parsed.issues.join(' ')).toContain('three trials');
  });

  it('requires a FIELD_PASS report with a model and evidence hash', () => {
    expect(
      parseFieldReport({
        id: 'ftr_test',
        status: 'FIELD_PASS',
        model: { hash: 'c'.repeat(64) },
        evidenceHash: 'd'.repeat(64),
      }).acceptedForReview,
    ).toBe(true);
    const failed = parseFieldReport({ id: 'ftr_test', status: 'FIELD_FAIL', model: {}, evidenceHash: null });
    expect(failed.acceptedForReview).toBe(false);
    expect(failed.issues.join(' ')).toContain('not FIELD_PASS');
  });

  it('identifies interrupted, qualified, captured and voided live sessions', () => {
    const summary = summarizeSessions([
      session({
        id: 'ase_interrupted',
        outcome: 'INTERRUPTED',
        eligible_for_capture: 0,
        acceptance_json: null,
        demo: 0,
        paypal_authorization_id: 'AUTH-123',
        paypal_void_id: 'VOID-123',
        payment_state: 'VOIDED',
      }),
      session({ id: 'ase_qualified', demo: 0, paypal_capture_id: 'CAPTURE-123', payment_state: 'CAPTURE_COMPLETED' }),
    ]);
    expect(summary.interrupted?.id).toBe('ase_interrupted');
    expect(summary.qualified?.id).toBe('ase_qualified');
    expect(summary.captured?.id).toBe('ase_qualified');
    expect(summary.voided?.id).toBe('ase_interrupted');
    expect(summary.liveSessions).toBe(2);
    expect(summary.issues).toEqual([]);
  });

  it('flags an interrupted session that is incorrectly capture-eligible', () => {
    const summary = summarizeSessions([session({ outcome: 'INTERRUPTED', eligible_for_capture: 1 })]);
    expect(summary.issues.join(' ')).toContain('capture-eligible');
  });

  it('checks the three-minute demo limit honestly', () => {
    expect(demoDurationCheck(179.9).pass).toBe(true);
    expect(demoDurationCheck(180).pass).toBe(true);
    expect(demoDurationCheck(180.1).pass).toBe(false);
    expect(demoDurationCheck(null).pass).toBe(false);
  });

  it('redacts provider identifiers and keeps the local run explicit', () => {
    expect(redactProviderId('77T95682L88230118')).toBe('…88230118');
    expect(redactProviderId(null)).toBeNull();
    const run = createOperatorRun('op7_test', '2026-11-10T10:00:00.000Z');
    run.phases.paypal.data.captureId = '7YY23328DP2020327';
    expect(redactRun(run).phases.paypal.data.captureId).toBe('…P2020327');
  });

  it('marks all-pass phases verified but leaves canonical gates open', () => {
    const run = createOperatorRun('op7_test');
    expect(phaseStatus([{ id: 'x', label: 'x', status: 'PASS', detail: '' }])).toBe('VERIFIED');
    expect(Object.values(run.gates).every((value) => value === 'OPEN')).toBe(true);
  });
});
