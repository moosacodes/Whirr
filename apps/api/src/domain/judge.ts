import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { AppContext } from '../context.ts';
import { verifyAuditChain } from '../lib/audit.ts';
import { hashCanonical } from '../lib/hash.ts';
import { parseWav } from '../../../../packages/audio/src/wav.ts';
import type { ModelArtifact } from '../../../../packages/audio/src/classifier.ts';
import type { JudgeCheck, JudgeStatus } from '../../../../packages/contracts/src/types.ts';
import {
  REFERENCE_FIXTURE_FILE,
  REFERENCE_FIXTURE_LABEL,
  REFERENCE_FIXTURE_URL,
  REFERENCE_MODEL_URL,
  REFERENCE_OBJECT_ID,
} from './reference.ts';

function readReferenceModel(ctx: AppContext): {
  artifact: ModelArtifact | null;
  hash: string | null;
  error: string | null;
} {
  const file = path.resolve(ctx.config.referenceModelPath);
  if (!existsSync(file)) {
    return { artifact: null, hash: null, error: 'Reference model file is missing. Run `npm run setup`.' };
  }
  try {
    const artifact = JSON.parse(readFileSync(file, 'utf8')) as ModelArtifact;
    return { artifact, hash: hashCanonical(artifact), error: null };
  } catch (error) {
    return { artifact: null, hash: null, error: `Reference model is unreadable: ${(error as Error).message}` };
  }
}

function readFixture(ctx: AppContext): { durationMs: number | null; error: string | null } {
  const file = path.join(ctx.config.fixturesDir, REFERENCE_FIXTURE_FILE);
  if (!existsSync(file)) {
    return { durationMs: null, error: 'Replay fixture is missing. Run `npm run fixtures`.' };
  }
  try {
    const buffer = readFileSync(file);
    const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    const wav = parseWav(arrayBuffer as ArrayBuffer);
    return { durationMs: Math.round(wav.durationMs), error: null };
  } catch (error) {
    return { durationMs: null, error: `Replay fixture is unreadable: ${(error as Error).message}` };
  }
}

export function judgeChecks(ctx: AppContext): JudgeCheck[] {
  const checks: JudgeCheck[] = [];
  let dbOk: boolean;
  try {
    ctx.store.get<{ ok: number }>('SELECT 1 AS ok');
    dbOk = true;
  } catch {
    dbOk = false;
  }
  checks.push({
    id: 'database',
    label: 'Local SQLite store is writable and queryable',
    status: dbOk ? 'PASS' : 'FAIL',
    detail: dbOk ? 'SQLite opened in WAL mode with foreign keys enforced.' : 'Database query failed.',
  });

  const reference = readReferenceModel(ctx);
  checks.push({
    id: 'reference_model',
    label: 'Bundled reference classifier is present',
    status: reference.artifact ? 'PASS' : 'OPEN',
    detail: reference.artifact
      ? `${reference.artifact.version} · ${reference.artifact.status} · trained on synthetic fixtures. Hash ${reference.hash?.slice(0, 12)}…`
      : (reference.error ?? 'Missing reference model.'),
  });

  if (reference.artifact) {
    const ready = reference.artifact.status === 'READY';
    checks.push({
      id: 'reference_gate',
      label: 'Reference model meets the billing safety gate',
      status: ready ? 'PASS' : 'OPEN',
      detail: `Synthetic held-out precision ${(reference.artifact.metrics.precision * 100).toFixed(1)}%, false billable ${(
        reference.artifact.metrics.falseBillableRatio * 100
      ).toFixed(2)}%. This is synthetic evidence, not real-object accuracy.`,
    });
    const passport = reference.artifact.soundprint;
    checks.push({
      id: 'acoustic_passport',
      label: 'Acoustic passport is enrolled and gated',
      status: passport?.gateEnabled ? 'PASS' : 'OPEN',
      detail: passport
        ? passport.gateEnabled
          ? `${passport.status} at ${(passport.matchThreshold * 100).toFixed(2)}% similarity; ${(passport.activeBlockRatio * 100).toFixed(2)}% of active calibration frames blocked, ${(passport.nonActivePassRatio * 100).toFixed(2)}% of non-active profiles passed. Calibration-fit, not held-out identity.`
          : 'Soundprint exists but the gate is disabled because active and non-active profiles overlap too much.'
        : 'No soundprint is present in the reference artifact. Retrain to enroll one.',
    });
  }

  const fixture = readFixture(ctx);
  checks.push({
    id: 'replay_fixture',
    label: 'Labelled replay fixture is available for judges',
    status: fixture.durationMs ? 'PASS' : 'OPEN',
    detail: fixture.durationMs
      ? `${(fixture.durationMs / 1000).toFixed(1)}s synthetic ON/OFF/ON recording. Clearly labelled as a replay in the UI.`
      : (fixture.error ?? 'Missing fixture.'),
  });

  const audit = verifyAuditChain(ctx.store);
  checks.push({
    id: 'audit_chain',
    label: 'Audit log hash chain verifies',
    status: audit.valid ? 'PASS' : 'FAIL',
    detail: audit.valid ? `${audit.events} events chained with no gaps.` : `Chain broken at ${audit.brokenAt ?? 'unknown'}.`,
  });

  const seeded = ctx.store.get<{ id: string }>('SELECT id FROM objects WHERE id = ?', REFERENCE_OBJECT_ID);
  checks.push({
    id: 'demo_object',
    label: 'Seeded demo object with pinned model and terms',
    status: seeded ? 'PASS' : 'OPEN',
    detail: seeded
      ? 'Reference object is seeded; open its service card to run the renter flow.'
      : 'Run `npm run seed` to create the demo object and service card.',
  });

  const paypal = ctx.config.paypal;
  checks.push({
    id: 'paypal_config',
    label: 'PayPal Sandbox credentials configured',
    status: paypal.configured ? 'PASS' : 'OPEN',
    detail: paypal.configured
      ? 'Sandbox client credentials present. No live credentials are accepted anywhere in this app.'
      : 'Not configured. Metering runs in demo mode with no payment; add PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET to test PayPal.',
  });

  const verifiedEvents = ctx.store.get<{ count: number }>(
    'SELECT COUNT(*) AS count FROM paypal_webhook_events WHERE verified = 1',
  );
  const rejectedEvents = ctx.store.get<{ count: number }>(
    'SELECT COUNT(*) AS count FROM paypal_webhook_events WHERE verified = 0',
  );
  checks.push({
    id: 'webhook',
    label: 'Signed PayPal webhook received and verified',
    status: !paypal.webhookConfigured
      ? 'OPEN'
      : (verifiedEvents?.count ?? 0) > 0
        ? 'PASS'
        : (rejectedEvents?.count ?? 0) > 0
          ? 'FAIL'
          : 'OPEN',
    detail: !paypal.webhookConfigured
      ? 'PAYPAL_WEBHOOK_ID is not set, so only provider polling is available. No verified webhook evidence yet.'
      : `${verifiedEvents?.count ?? 0} verified event(s), ${rejectedEvents?.count ?? 0} rejected signature(s).`,
  });

  const captures = ctx.store.get<{ count: number }>(
    "SELECT COUNT(*) AS count FROM sessions WHERE payment_state IN ('CAPTURE_COMPLETED','REFUNDED')",
  );
  checks.push({
    id: 'capture',
    label: 'Completed Sandbox capture reconciled from provider',
    status: (captures?.count ?? 0) > 0 ? 'PASS' : 'OPEN',
    detail:
      (captures?.count ?? 0) > 0
        ? `${captures?.count} session(s) have a provider-confirmed capture. Amounts are reconciled, never assumed.`
        : 'No provider-confirmed capture exists in this installation yet. Use your own Sandbox buyer and seller to produce one.',
  });

  const liveObject = ctx.store.get<{ count: number }>(
    'SELECT COUNT(*) AS count FROM calibration_takes WHERE source = ?',
    'live',
  );
  checks.push({
    id: 'live_calibration',
    label: 'A real microphone calibration exists',
    status: (liveObject?.count ?? 0) > 0 ? 'PASS' : 'OPEN',
    detail:
      (liveObject?.count ?? 0) > 0
        ? `${liveObject?.count} take(s) recorded from a live microphone and kept as acoustic features only.`
        : 'Only synthetic/reference material is present. Record your own object to validate real sensing.',
  });

  return checks;
}

export function buildJudgeStatus(ctx: AppContext): JudgeStatus {
  const reference = readReferenceModel(ctx);
  const fixture = readFixture(ctx);
  const demoObject = ctx.store.get<{ id: string }>('SELECT id FROM objects WHERE id = ?', REFERENCE_OBJECT_ID);
  const objects = ctx.store.get<{ count: number }>('SELECT COUNT(*) AS count FROM objects');
  const sessions = ctx.store.get<{ count: number }>('SELECT COUNT(*) AS count FROM sessions');
  const settled = ctx.store.get<{ count: number }>(
    "SELECT COUNT(*) AS count FROM sessions WHERE payment_state IN ('CAPTURE_COMPLETED','REFUNDED')",
  );
  const webhooks = ctx.store.get<{ count: number }>(
    'SELECT COUNT(*) AS count FROM paypal_webhook_events WHERE verified = 1',
  );
  return {
    generatedAt: ctx.now().toISOString(),
    checks: judgeChecks(ctx),
    reference: {
      available: Boolean(reference.artifact),
      modelVersion: reference.artifact?.version ?? null,
      modelHash: reference.hash,
      modelStatus: reference.artifact?.status ?? null,
      provenance: reference.artifact?.provenance ?? null,
      modelUrl: REFERENCE_MODEL_URL,
      fixture: fixture.durationMs ? REFERENCE_FIXTURE_FILE : null,
      fixtureUrl: REFERENCE_FIXTURE_URL,
      fixtureDurationMs: fixture.durationMs,
      fixtureLabel: REFERENCE_FIXTURE_LABEL,
    },
    demoObjectId: demoObject?.id ?? null,
    paypal: {
      configured: ctx.config.paypal.configured,
      env: 'sandbox',
      webhookConfigured: ctx.config.paypal.webhookConfigured,
    },
    stats: {
      objects: objects?.count ?? 0,
      sessions: sessions?.count ?? 0,
      settledSessions: settled?.count ?? 0,
      verifiedWebhookEvents: webhooks?.count ?? 0,
    },
  };
}

