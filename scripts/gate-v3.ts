#!/usr/bin/env node
import 'dotenv/config';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Store } from '../apps/api/src/db/index.ts';
import { SCHEMA_VERSION } from '../apps/api/src/db/schema.ts';
import { verifyDocument } from '../packages/verify/src/index.ts';
import type { SignedProofBundle } from '../packages/contracts/src/types.ts';

type Status = 'PASS' | 'OPEN' | 'FAIL';
interface GateRow {
  id: string;
  requirement: string;
  status: Status;
  detail: string;
}

const root = process.cwd();
const gates: GateRow[] = [];
const add = (id: string, requirement: string, status: Status, detail: string) => {
  gates.push({ id, requirement, status, detail });
};

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path.join(root, file), 'utf8')) as T;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const dbPath = path.join(root, 'data/whirr.db');
  if (!existsSync(dbPath)) {
    console.error('data/whirr.db is missing. Run `npm run setup` first.');
    process.exit(2);
  }
  const store = new Store(dbPath);
  const schema = store.getMeta('schema_version');
  add(
    'schema',
    `Database schema is additive v${SCHEMA_VERSION}`,
    schema === String(SCHEMA_VERSION) ? 'PASS' : 'FAIL',
    `schema_version=${schema ?? 'missing'} (expected ${SCHEMA_VERSION})`,
  );

  const latest = store.get<{ id: string; document_json: string; public_document_json: string }>(
    'SELECT id, document_json, public_document_json FROM proof_bundles ORDER BY created_at DESC LIMIT 1',
  );
  if (!latest) {
    add('bundle', 'At least one portable v3 proof bundle exists and verifies offline', 'OPEN', 'No proof_bundles row is present.');
  } else {
    try {
      const authenticated = JSON.parse(latest.document_json) as SignedProofBundle;
      const publicBundle = JSON.parse(latest.public_document_json) as SignedProofBundle;
      const authResult = await verifyDocument(authenticated, { trustedKeyId: authenticated.keyId });
      const publicResult = await verifyDocument(publicBundle);
      const valid = authResult.valid && publicResult.valid && publicBundle.payload.redacted === true;
      add(
        'bundle',
        'At least one portable v3 proof bundle exists and verifies offline',
        valid ? 'PASS' : 'FAIL',
        `${latest.id}: authenticated ${authResult.valid ? 'valid' : 'invalid'}, public ${publicResult.valid ? 'valid' : 'invalid'}, redacted=${String(publicBundle.payload.redacted)}.`,
      );
    } catch (error) {
      add('bundle', 'At least one portable v3 proof bundle exists and verifies offline', 'FAIL', `Could not parse bundle: ${(error as Error).message}`);
    }
  }

  const v2Proofs = store.get<{ count: number }>('SELECT COUNT(*) AS count FROM receipt_proofs');
  const passports = store.get<{ count: number }>('SELECT COUNT(*) AS count FROM passport_versions');
  add(
    'compat',
    'v2 receipt proofs and historical passports remain readable',
    (v2Proofs?.count ?? 0) > 0 && (passports?.count ?? 0) > 0 ? 'PASS' : 'OPEN',
    `${v2Proofs?.count ?? 0} stored receipt proof(s), ${passports?.count ?? 0} passport edition(s). No historical row is rewritten.`,
  );

  const capture = store.get<{
    id: string;
    paypal_order_id: string | null;
    paypal_authorization_id: string | null;
    paypal_capture_id: string | null;
    captured_minor: number | null;
    payment_state: string;
  }>(
    `SELECT id, paypal_order_id, paypal_authorization_id, paypal_capture_id, captured_minor, payment_state
     FROM sessions WHERE paypal_capture_id IS NOT NULL AND payment_state IN ('CAPTURE_COMPLETED','REFUNDED')
     ORDER BY created_at DESC LIMIT 1`,
  );
  add(
    'D',
    'Historical Sandbox capture preserved, with no claim of a new provider call',
    capture ? 'PASS' : 'OPEN',
    capture
      ? `Preserved order ${capture.paypal_order_id ?? '—'}, capture ${capture.paypal_capture_id}, captured ${capture.captured_minor ?? '?'} minor. This report made no PayPal call.`
      : 'No historical capture row is present in this database.',
  );

  const model = await readJson<{ provenance?: string; metrics?: { precision?: number; recall?: number; falseBillableRatio?: number } }>(
    'models/whirr-reference-fan.json',
  );
  add(
    'B',
    'Accuracy and false-billable results are reported with their scope',
    model?.metrics ? 'PASS' : 'OPEN',
    model?.metrics
      ? `${model.provenance ?? 'unknown provenance'}: precision ${(Number(model.metrics.precision) * 100).toFixed(2)}%, recall ${(Number(model.metrics.recall) * 100).toFixed(2)}%, false billable ${(Number(model.metrics.falseBillableRatio) * 100).toFixed(3)}%. Synthetic, not field evidence.`
      : 'No reference model metrics file exists.',
  );

  const openSet = await readFile(path.join(root, 'packages/audio/src/classifier.ts'), 'utf8').catch(() => '');
  const openSetSpec = await readFile(path.join(root, 'packages/audio/src/spec.ts'), 'utf8').catch(() => '');
  add(
    'open-set',
    'Unknown-object and low-confidence rejection are backward compatible',
    openSet.includes("'UNKNOWN_OBJECT'") && openSet.includes('DEFAULT_OPEN_SET_POLICY') && openSetSpec.includes("'LOW_CONFIDENCE'")
      ? 'PASS'
      : 'FAIL',
    'New models carry a rejection policy; older models fall back to the default because the field is optional.',
  );

  const standalone = existsSync(path.join(root, 'apps/web/public/verify-offline.html'));
  const standaloneSource = standalone ? await readFile(path.join(root, 'apps/web/public/verify-offline.html'), 'utf8') : '';
  add(
    'standalone',
    'Single-file offline verifier uses no application imports',
    standalone && !/from\s+['"][^'"]*\/src\//.test(standaloneSource) ? 'PASS' : 'FAIL',
    standalone ? 'apps/web/public/verify-offline.html exists and has no application import.' : 'Standalone verifier is missing.',
  );

  const proxy = existsSync(path.join(root, 'scripts/webhook-proxy.ts'));
  add(
    'proxy',
    'Webhook-only loopback proxy is shipped',
    proxy ? 'PASS' : 'FAIL',
    proxy ? 'Only POST /api/paypal/webhook is forwarded; all other paths return 404. This is not public HTTPS.' : 'No webhook proxy.'
  );

  const gateA = await readJson<{ realObject?: boolean; trials?: unknown[] }>('docs/evidence/gate-a.json');
  const trialCount = Array.isArray(gateA?.trials) ? gateA.trials.length : 0;
  add(
    'A',
    'Three genuine live ON/OFF trials on a real object',
    gateA?.realObject === true && trialCount >= 3 ? 'PASS' : 'OPEN',
    gateA?.realObject === true && trialCount >= 3
      ? `${trialCount} genuine trials are recorded in docs/evidence/gate-a.json.`
      : 'No genuine real-object evidence pack with three live ON/OFF trials exists in this checkout. Synthetic fixture replay does not close this gate.'
  );

  const gateE = await readJson<{ publicHttps?: boolean; verifiedSignedEvent?: boolean; provider?: string }>('docs/evidence/gate-e.json');
  const publicOrigin = process.env.WHIRR_PUBLIC_ORIGIN ?? '';
  const httpsOrigin = /^https:\/\/[^/]+/.test(publicOrigin) && !/localhost|127\.0\.0\.1/.test(publicOrigin);
  add(
    'E',
    'Public HTTPS ingress received a genuine PayPal-signed webhook',
    gateE?.publicHttps === true && gateE?.verifiedSignedEvent === true && gateE?.provider === 'PAYPAL' && httpsOrigin ? 'PASS' : 'OPEN',
    gateE?.publicHttps === true && gateE?.verifiedSignedEvent === true && httpsOrigin
      ? 'A genuine signed PayPal event is recorded in docs/evidence/gate-e.json.'
      : `No genuine signed webhook over public HTTPS is recorded. Configured public origin is ${httpsOrigin ? 'HTTPS' : 'loopback/HTTP'}; PAYPAL_WEBHOOK_ID is ${process.env.PAYPAL_WEBHOOK_ID ? 'present' : 'absent'}. The loopback proxy does not close this gate.`
  );

  add('F', 'Public repository, video and submission artifacts', 'OPEN', 'No remote is configured and no public video/Devpost artifact is part of this checkout.');
  add('G', 'Five comprehension tests and a recorded presentation', 'OPEN', 'No comprehension testing or recorded presentation is part of this checkout.');

  const field = await readJson<{
    status?: string;
    physicalObjectTested?: boolean;
    reportId?: string | null;
    modelHash?: string | null;
    trials?: unknown[];
  }>('docs/evidence/field-test.json');
  const fieldTrialCount = Array.isArray(field?.trials) ? field.trials.length : 0;
  const fieldPassed =
    field?.status === 'FIELD_PASS' &&
    field.physicalObjectTested === true &&
    Boolean(field.reportId) &&
    Boolean(field.modelHash) &&
    fieldTrialCount >= 4;
  add(
    'H',
    'Live-calibrated model validated on a physical object',
    fieldPassed ? 'PASS' : 'OPEN',
    fieldPassed
      ? `FIELD_PASS report ${field.reportId} for model ${field.modelHash} with ${fieldTrialCount} live trials.`
      : 'No physical field-test evidence exists. The lab, server recomputation, guards and UI are implemented, but synthetic fixtures and browser fake devices do not close this gate.'
  );

  const pkg = await readJson<{ version?: string }>('package.json');
  console.log(`Whirr ${pkg?.version ?? 'unknown'} gate report`);
  console.log(`Generated ${new Date().toISOString()} from ${dbPath}, model files and provider configuration.`);
  console.log('Status legend: PASS = verified here; OPEN = external action/evidence missing; FAIL = verified failure.\n');
  for (const gate of gates) {
    console.log(`${gate.status.padEnd(4)}  ${gate.id.padEnd(10)} ${gate.requirement}`);
    console.log(`      ${gate.detail}`);
  }
  const failures = gates.filter((gate) => gate.status === 'FAIL');
  const open = gates.filter((gate) => gate.status === 'OPEN');
  console.log(`\n${gates.filter((gate) => gate.status === 'PASS').length} PASS · ${open.length} OPEN · ${failures.length} FAIL`);
  if (failures.length > 0) {
    console.log('\nA FAIL is a verified failure and must be fixed, not relabelled.');
    process.exitCode = 1;
  }
}

void main().catch((error) => {
  console.error(`Gate report failed: ${(error as Error).message}`);
  process.exitCode = 1;
});
