#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Store } from '../apps/api/src/db/index.ts';
import { verifyDocument } from '../packages/verify/src/index.ts';
import type { CaptureClaim, SignedProofBundle } from '../packages/contracts/src/types.ts';

/**
 * Exports a Gate A review pack for one session. It never invents trials and
 * never marks Gate A closed. A reviewer must inspect the capture provenance
 * and the genuine live ON/OFF evidence separately.
 */
async function main(): Promise<void> {
  const sessionId = process.argv[2];
  const store = new Store(path.resolve('data/whirr.db'));
  const session = sessionId
    ? store.get<Record<string, unknown>>('SELECT * FROM sessions WHERE id = ?', sessionId)
    : store.get<Record<string, unknown>>(
        "SELECT * FROM sessions WHERE state IN ('STOPPED','REVIEWED','SETTLED','DEMO_COMPLETED') ORDER BY created_at DESC LIMIT 1",
      );
  if (!session) throw new Error('No stopped/terminal session found. Pass a session id.');
  const id = String(session.id);
  const takeCounts = store.all<{ source: string; count: number; device_label: string | null }>(
    `SELECT source, COUNT(*) AS count, MAX(device_label) AS device_label
     FROM calibration_takes WHERE object_id = ? GROUP BY source`,
    String(session.object_id),
  );
  const model = store.get<{ version: string; model_hash: string; dataset_hash: string; provenance: string; artifact_json: string }>(
    'SELECT version, model_hash, dataset_hash, provenance, artifact_json FROM model_versions WHERE id = ?',
    String(session.model_version_id),
  );
  const passport = store.get<{ document_json: string }>(
    'SELECT document_json FROM passport_versions WHERE object_id = ? ORDER BY version DESC LIMIT 1',
    String(session.object_id),
  );
  const bundleRow = store.get<{ document_json: string; public_document_json: string }>(
    'SELECT document_json, public_document_json FROM proof_bundles WHERE session_id = ?',
    id,
  );
  if (!bundleRow) throw new Error('This session has no proof bundle yet. Open its receipt first to create one.');
  const bundle = JSON.parse(bundleRow.public_document_json) as SignedProofBundle;
  const verification = await verifyDocument(bundle);
  const capture = session.capture_claim_json
    ? (JSON.parse(String(session.capture_claim_json)) as CaptureClaim)
    : null;

  const pack = {
    schema: 'whirr.gate-a-evidence.v1',
    createdAt: new Date().toISOString(),
    gateAStatus: 'OPEN',
    gateAReason:
      'This export packages evidence; it does not certify object presence. Gate A closes only when a reviewer confirms three genuine live ON/OFF trials from a real object and microphone.',
    session: {
      id,
      objectId: session.object_id,
      state: session.state,
      startedAt: session.started_at,
      stoppedAt: session.stopped_at,
      authorizationExpiresAt: session.authorization_expires_at,
      captureClaim: capture,
    },
    calibration: {
      sources: takeCounts,
      model: model
        ? {
            version: model.version,
            hash: model.model_hash,
            datasetHash: model.dataset_hash,
            provenance: model.provenance,
            modelCard: 'docs/model-card.md',
          }
        : null,
    },
    passport: passport ? JSON.parse(passport.document_json) : null,
    intervals: bundle.payload.intervals,
    bundle,
    bundleVerification: {
      valid: verification.valid,
      checks: verification.checks,
      trust: bundle.payload.trust,
      limitations: bundle.payload.limitations,
    },
    requiredForClosure: [
      'Three separate genuine live ON/OFF trials on a physical object.',
      'Capture provenance CLIENT_CLAIMED_LIVE_MICROPHONE for each trial.',
      'Observed classification and any passport mismatches recorded without editing.',
      'A named reviewer and date, in docs/evidence/gate-a.json.',
    ],
  };
  const output = path.resolve('docs/evidence/gate-a-pack.json');
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(pack, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${path.relative(process.cwd(), output)}`);
  console.log(`Bundle verification: ${verification.valid ? 'PASS' : 'FAIL'} (${verification.checks.filter((check) => check.pass).length}/${verification.checks.length} checks)`);
  console.log('Gate A remains OPEN: this pack does not contain three genuine live ON/OFF trials.');
  if (!verification.valid) process.exitCode = 1;
}

void main().catch((error) => {
  console.error(`Gate A pack export failed: ${(error as Error).message}`);
  process.exitCode = 1;
});
