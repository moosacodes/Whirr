#!/usr/bin/env node
import 'dotenv/config';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { pathToFileURL } from 'node:url';
import { loadConfig, type Config } from '../apps/api/src/config.ts';
import { Store } from '../apps/api/src/db/index.ts';
import { PayPalClient } from '../packages/paypal/src/client.ts';
import { minorToDecimalString, type Currency } from '../packages/meter/src/currency.ts';
import { verifyAmbientProofDocument } from '../packages/verify/src/ambient.ts';
import {
  OPERATOR_RELEASE,
  OPERATOR_RUN_SCHEMA,
  check,
  countLiveTakes,
  createOperatorRun,
  demoDurationCheck,
  parseFieldReport,
  parseGateALog,
  parseTermsPrice,
  phaseStatus,
  redactProviderId,
  redactRun,
  sha256Hex,
  summarizeSessions,
  type AmbientSessionRow,
  type GateALogSummary,
  type OperatorArtifact,
  type OperatorCheck,
  type OperatorPhase,
  type OperatorRun,
  type PhaseId,
} from './operator-7-lib.ts';

const ROOT = process.cwd();
const RUN_ROOT = path.join(ROOT, '.whirr', 'operator-7');
const PHASE_ALIASES: Record<string, PhaseId> = {
  preflight: 'preflight',
  appliance: 'appliance',
  '1': 'appliance',
  window: 'window',
  quiet: 'window',
  '2': 'window',
  paypal: 'paypal',
  payment: 'paypal',
  '3': 'paypal',
  webhook: 'webhook',
  '4': 'webhook',
  demo: 'demo',
  submission: 'demo',
  '5': 'demo',
};

interface ObjectToolRow {
  id: string;
  name: string;
  status: string;
  active_model_id: string | null;
  active_terms_id: string | null;
  model_status: string | null;
  provenance: string | null;
  model_hash: string | null;
  model_version: string | null;
}

interface FieldReportRow {
  id: string;
  object_id: string;
  model_id: string;
  status: string;
  report_json: string;
  evidence_hash: string;
  created_at: string;
}

interface AmbientProofRow {
  public_document_json: string;
}

interface WebhookRow {
  event_id: string;
  event_type: string;
  verified: number;
  received_at: string;
  processed_at: string | null;
  result: string | null;
}

interface StatusContext {
  config: Config;
  store: Store | null;
}

function nowIso(): string {
  return new Date().toISOString();
}

function print(line = ''): void {
  process.stdout.write(`${line}\n`);
}

function printChecks(phase: OperatorPhase): void {
  if (phase.checks.length === 0) {
    print('  No checks recorded yet.');
    return;
  }
  for (const entry of phase.checks) {
    const marker = entry.status === 'PASS' ? 'PASS' : entry.status.padEnd(5);
    print(`  ${marker}  ${entry.label}`);
    if (entry.detail) print(`          ${entry.detail}`);
  }
}

function makeRunId(): string {
  return `op7_${new Date().toISOString().replaceAll(/[:.]/g, '-')}`;
}

async function ensureRunDir(runId: string): Promise<string> {
  const dir = path.join(RUN_ROOT, runId);
  await mkdir(path.join(dir, 'artifacts'), { recursive: true });
  return dir;
}

async function saveRun(run: OperatorRun): Promise<void> {
  run.updatedAt = nowIso();
  const dir = await ensureRunDir(run.runId);
  await writeFile(path.join(dir, 'run.json'), `${JSON.stringify(run, null, 2)}\n`, 'utf8');
}

async function readRun(runId?: string): Promise<OperatorRun> {
  const id = runId ?? (await latestRunId());
  if (!id) throw new Error('No operator run exists yet. Start one with `npm run operator:7 -- run`.');
  const file = path.join(RUN_ROOT, id, 'run.json');
  const parsed = JSON.parse(await readFile(file, 'utf8')) as OperatorRun;
  if (parsed.schema !== OPERATOR_RUN_SCHEMA) throw new Error(`Unsupported operator run schema in ${file}.`);
  return parsed;
}

async function latestRunId(): Promise<string | null> {
  const entries = await readdir(RUN_ROOT, { withFileTypes: true }).catch(() => []);
  const ids = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('op7_'))
    .map((entry) => entry.name)
    .sort()
    .reverse();
  return ids[0] ?? null;
}

function safeName(value: string): string {
  return value.replaceAll(/[^a-zA-Z0-9._-]/g, '-');
}

async function copyArtifact(run: OperatorRun, sourcePath: string, kind: OperatorArtifact['kind']): Promise<OperatorArtifact | null> {
  const source = path.resolve(sourcePath);
  if (!existsSync(source)) throw new Error(`Artifact does not exist: ${source}`);
  const body = await readFile(source);
  const hash = sha256Hex(body);
  const existing = run.artifacts.find((artifact) => artifact.sha256 === hash && artifact.kind === kind);
  if (existing) return existing;
  const dir = await ensureRunDir(run.runId);
  const filename = `${Date.now()}-${safeName(path.basename(source))}`;
  const target = path.join(dir, 'artifacts', filename);
  await writeFile(target, body);
  const artifact: OperatorArtifact = {
    name: path.basename(source),
    path: target,
    sha256: hash,
    bytes: body.byteLength,
    kind,
  };
  run.artifacts.push(artifact);
  return artifact;
}

async function storeArtifact(run: OperatorRun, name: string, body: string, kind: OperatorArtifact['kind']): Promise<OperatorArtifact> {
  const hash = sha256Hex(body);
  const existing = run.artifacts.find((artifact) => artifact.sha256 === hash && artifact.kind === kind);
  if (existing) return existing;
  const dir = await ensureRunDir(run.runId);
  const filename = `${Date.now()}-${safeName(name)}`;
  const target = path.join(dir, 'artifacts', filename);
  await writeFile(target, body, 'utf8');
  const artifact: OperatorArtifact = {
    name,
    path: target,
    sha256: hash,
    bytes: Buffer.byteLength(body),
    kind,
  };
  run.artifacts.push(artifact);
  return artifact;
}

function phaseRecord(run: OperatorRun, id: PhaseId): OperatorPhase {
  return run.phases[id];
}

function setPhase(run: OperatorRun, id: PhaseId, checks: OperatorCheck[], data: Record<string, unknown> = {}): OperatorPhase {
  const phase = phaseRecord(run, id);
  phase.checks = checks;
  phase.status = phaseStatus(checks);
  phase.updatedAt = nowIso();
  phase.data = { ...phase.data, ...data };
  return phase;
}


function localUrl(config: Config, pathname: string): string {
  return `${config.primaryPublicOrigin.replace(/\/$/, '')}${pathname}`;
}

function openUrl(url: string): void {
  try {
    if (process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
    } else if (process.platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch {
    print(`Open manually: ${url}`);
  }
}

function ffprobeDuration(file: string): number | null {
  const result = spawnSync(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', file],
    { encoding: 'utf8' },
  );
  if (result.status !== 0 || !result.stdout.trim()) return null;
  const value = Number(result.stdout.trim());
  return Number.isFinite(value) ? value : null;
}

async function hashFile(file: string): Promise<string> {
  return sha256Hex(await readFile(file));
}

async function getJson(url: string): Promise<{ ok: boolean; status: number; body: unknown }> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2_500) });
    const text = await response.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      body = text.slice(0, 200);
    }
    return { ok: response.ok, status: response.status, body };
  } catch (error) {
    return { ok: false, status: 0, body: (error as Error).message };
  }
}

async function context(): Promise<StatusContext> {
  const config = loadConfig();
  const store = existsSync(config.dbPath) ? new Store(config.dbPath) : null;
  return { config, store };
}

function closeContext(ctx: StatusContext): void {
  ctx.store?.close();
}

async function realObjects(store: Store): Promise<ObjectToolRow[]> {
  return store.all<ObjectToolRow>(
    `SELECT o.id, o.name, o.status, o.active_model_id, o.active_terms_id,
            m.status AS model_status, m.provenance, m.model_hash, m.version AS model_version
     FROM objects o
     LEFT JOIN model_versions m ON m.id = o.active_model_id
     WHERE o.status = 'ACTIVE' AND m.provenance = 'USER_CALIBRATION'
     ORDER BY o.created_at DESC`,
  );
}

async function objectEvidence(store: Store, objectId: string): Promise<{
  object: ObjectToolRow | null;
  counts: ReturnType<typeof countLiveTakes>;
  fieldReport: FieldReportRow | null;
  promiseApproved: boolean;
}> {
  const object =
    store.get<ObjectToolRow>(
      `SELECT o.id, o.name, o.status, o.active_model_id, o.active_terms_id,
              m.status AS model_status, m.provenance, m.model_hash, m.version AS model_version
       FROM objects o LEFT JOIN model_versions m ON m.id = o.active_model_id
       WHERE o.id = ?`,
      objectId,
    ) ?? null;
  const takes = store.all<{ label: string; source: string }>(
    'SELECT label, source FROM calibration_takes WHERE object_id = ?',
    objectId,
  );
  const fieldReport =
    store.get<FieldReportRow>(
      'SELECT id, object_id, model_id, status, report_json, evidence_hash, created_at FROM field_test_reports WHERE object_id = ? ORDER BY created_at DESC LIMIT 1',
      objectId,
    ) ?? null;
  const promise = store.get<{ ok: number }>(
    "SELECT 1 AS ok FROM promise_agreements WHERE object_id = ? AND status = 'OWNER_APPROVED' LIMIT 1",
    objectId,
  );
  return { object, counts: countLiveTakes(takes), fieldReport, promiseApproved: Boolean(promise) };
}

async function ambientSessions(store: Store, objectId: string): Promise<AmbientSessionRow[]> {
  return store.all<AmbientSessionRow>(
    `SELECT s.*, p.id AS proof_id
     FROM ambient_sessions s
     LEFT JOIN ambient_proofs p ON p.session_id = s.id
     WHERE s.object_id = ?
     ORDER BY s.created_at DESC`,
    objectId,
  );
}

async function webhookEvents(store: Store): Promise<WebhookRow[]> {
  return store.all<WebhookRow>(
    `SELECT event_id, event_type, verified, received_at, processed_at, result
     FROM paypal_webhook_events
     WHERE verified = 1
     ORDER BY received_at DESC
     LIMIT 20`,
  );
}

async function preflightChecks(ctx: StatusContext): Promise<OperatorCheck[]> {
  const { config, store } = ctx;
  const checks: OperatorCheck[] = [];
  const major = Number(process.versions.node.split('.')[0]);
  checks.push(check('node', 'Node.js 24 or newer', major >= 24 ? 'PASS' : 'FAIL', `Node ${process.versions.node}`));
  checks.push(check('config', 'Configuration loads', 'PASS', `root ${config.rootDir}`));
  checks.push(
    check(
      'database',
      'SQLite database exists and is readable',
      store ? 'PASS' : 'FAIL',
      store ? config.dbPath : `Missing ${config.dbPath}; run npm run setup.`,
    ),
  );
  if (store) {
    const version = store.getMeta('schema_version');
    checks.push(
      check(
        'schema',
        'Database schema is v7',
        version === '7' ? 'PASS' : 'FAIL',
        `schema_version=${version ?? 'missing'}`,
      ),
    );
  }
  const health = await getJson(`http://127.0.0.1:${config.port}/api/health`);
  checks.push(
    check(
      'app',
      'Whirr API is serving on the local port',
      health.ok ? 'PASS' : 'BLOCKED',
      health.ok
        ? `http://127.0.0.1:${config.port}/api/health returned ${health.status}`
        : `Start \`npm run dev\`; health returned ${health.status || 'no response'}.`,
    ),
  );
  const ready = health.ok ? await getJson(`http://127.0.0.1:${config.port}/api/ready`) : null;
  if (ready) {
    checks.push(
      check(
        'ready',
        'Readiness endpoint is healthy',
        ready.ok ? 'PASS' : 'BLOCKED',
        ready.ok ? `database and signer ready; HTTP ${ready.status}` : `Readiness returned ${ready.status}.`,
      ),
    );
  }
  return checks;
}

async function validateAppliance(run: OperatorRun, ctx: StatusContext): Promise<OperatorPhase> {
  const { store } = ctx;
  const checks: OperatorCheck[] = [];
  if (!store) {
    return setPhase(run, 'appliance', [check('store', 'Database is available', 'FAIL', 'No database.')]);
  }
  if (!run.objectId) {
    return setPhase(run, 'appliance', [check('object', 'A real object is selected', 'OPEN', 'Choose or create a non-synthetic object.')]);
  }
  const evidence = await objectEvidence(store, run.objectId);
  const object = evidence.object;
  if (!object) {
    return setPhase(run, 'appliance', [check('object', 'A real object is selected', 'FAIL', `Object ${run.objectId} does not exist.`)]);
  }
  run.objectName = object.name;
  const realModel = object.provenance === 'USER_CALIBRATION';
  checks.push(
    check(
      'object',
      'Selected object is an active, non-synthetic object',
      realModel ? 'PASS' : 'FAIL',
      `${object.name}: ${object.provenance ?? 'no model'}${object.model_status ? ` / ${object.model_status}` : ''}`,
    ),
  );
  checks.push(
    check(
      'model-ready',
      'Active model is READY',
      object.model_status === 'READY' ? 'PASS' : 'OPEN',
      object.model_status ? `model ${object.model_version ?? 'unknown'} is ${object.model_status}` : 'No active model.',
    ),
  );
  const counts = evidence.counts;
  checks.push(
    check(
      'live-takes',
      'At least 5 live idle, 5 active and 5 negative takes exist',
      counts.idle >= 5 && counts.active >= 5 && counts.negative >= 5 ? 'PASS' : 'OPEN',
      `idle ${counts.idle}/5 · active ${counts.active}/5 · negative ${counts.negative}/5`,
    ),
  );
  checks.push(
    check(
      'published-source',
      'Object can appear as a Wish source',
      object.active_terms_id || evidence.promiseApproved ? 'PASS' : 'OPEN',
      object.active_terms_id
        ? 'Published service terms exist.'
        : evidence.promiseApproved
          ? 'An owner-approved Physical Promise exists.'
          : 'Publish pricing or an owner-approved promise after the field report.',
    ),
  );
  const report = evidence.fieldReport;
  const field = report ? parseFieldReport(JSON.parse(report.report_json) as unknown) : null;
  checks.push(
    check(
      'field-report',
      'A FIELD_PASS report exists for the active model',
      field?.acceptedForReview ? 'PASS' : 'OPEN',
      field?.acceptedForReview
        ? `report ${field.reportId}, evidence ${field.evidenceHash?.slice(0, 12)}…`
        : report
          ? `Latest report is ${report.status}; complete the four field trials and regenerate.`
          : 'No field-test report exists.',
    ),
  );
  if (field?.acceptedForReview && report) {
    await storeArtifact(run, `field-report-${report.id}.json`, report.report_json, 'field-report');
  }
  const gateLogs: GateALogSummary[] = [];
  for (const artifact of run.artifacts.filter((entry) => entry.kind === 'gate-a-log')) {
    try {
      gateLogs.push(parseGateALog(JSON.parse(await readFile(artifact.path, 'utf8')) as unknown));
    } catch {
      gateLogs.push({
        acceptedForReview: false,
        objectId: null,
        objectName: null,
        modelHash: null,
        trials: 0,
        completedTrials: 0,
        passedTrials: 0,
        gateAStatus: null,
        captureProvenance: null,
        issues: ['Artifact could not be parsed.'],
      });
    }
  }
  const completedGateATrials = gateLogs.reduce((total, log) => total + log.completedTrials, 0);
  const validGateALogs = gateLogs.filter((log) => log.acceptedForReview).length;
  checks.push(
    check(
      'gate-a-logs',
      'Four client-reported Gate A logs cover at least 12 completed ON/OFF trials',
      validGateALogs >= 4 && completedGateATrials >= 12 ? 'PASS' : 'OPEN',
      `${validGateALogs}/4 valid logs · ${completedGateATrials}/12 completed trials. These remain client-reported and require review.`,
    ),
  );
  const currentModelHash = object.model_hash;
  const logsMatchModel = gateLogs
    .filter((log) => log.acceptedForReview)
    .every((log) => !log.modelHash || !currentModelHash || log.modelHash === currentModelHash);
  checks.push(
    check(
      'gate-a-model',
      'Gate A logs reference the active model hash',
      logsMatchModel ? 'PASS' : 'OPEN',
      logsMatchModel
        ? 'All imported logs with a model hash match the active model.'
        : 'At least one imported log references a different model. Retake the trials or import the correct log.',
    ),
  );
  const phase = setPhase(run, 'appliance', checks, {
    counts,
    fieldReportId: report?.id ?? null,
    fieldReportStatus: report?.status ?? null,
    modelHash: currentModelHash,
    gateALogs: validGateALogs,
    gateATrials: completedGateATrials,
  });
  phase.notes = [
    'Gate A evidence is client-reported live-microphone evidence. It is not signed proof of physical presence.',
    'Field report metrics are server-recomputed from live takes, but the physical actions are user-reported.',
    'The workflow does not close Gate A or Gate B; a named reviewer must inspect the artifacts.',
  ];
  run.objectName = object.name;
  printChecks(phase);
  return phase;
}

async function validateWindow(run: OperatorRun, ctx: StatusContext): Promise<OperatorPhase> {
  const { store } = ctx;
  if (!store) return setPhase(run, 'window', [check('store', 'Database is available', 'FAIL', 'No database.')]);
  if (!run.objectId) return setPhase(run, 'window', [check('object', 'A real object is selected', 'OPEN', 'Complete phase 1 first.')]);
  const rows = await ambientSessions(store, run.objectId);
  const summary = summarizeSessions(rows);
  const checks: OperatorCheck[] = [];
  checks.push(
    check(
      'interrupted',
      'Genuine interrupted live window exists',
      summary.interrupted ? 'PASS' : 'OPEN',
      summary.interrupted
        ? `${summary.interrupted.id}: ${summary.interrupted.outcome}, capture-eligible=${summary.interrupted.eligible_for_capture === 1}`
        : 'Run a live window and allow the enrolled source to resume before the required quiet duration completes.',
    ),
  );
  checks.push(
    check(
      'qualified',
      'Genuine qualifying live window exists',
      summary.qualified ? 'PASS' : 'OPEN',
      summary.qualified
        ? `${summary.qualified.id}: ${summary.qualified.outcome}, demo=${summary.qualified.demo === 1}`
        : 'Run a second live window and keep the enrolled source undetected for the full approved interval.',
    ),
  );
  checks.push(
    check(
      'interrupted-no-capture',
      'Interrupted window is not capture-eligible',
      summary.interrupted && summary.interrupted.eligible_for_capture === 0 && !summary.interrupted.paypal_capture_id
        ? 'PASS'
        : 'OPEN',
      summary.interrupted
        ? `eligible=${summary.interrupted.eligible_for_capture}, capture=${summary.interrupted.paypal_capture_id ? 'present' : 'absent'}`
        : 'No interrupted window yet.',
    ),
  );
  const accepted = Boolean(summary.qualified?.acceptance_json);
  checks.push(
    check(
      'qualified-acceptance',
      'Buyer explicitly accepted the qualifying result',
      accepted ? 'PASS' : 'OPEN',
      accepted ? 'Acceptance is recorded for the qualified session.' : 'Review the qualifying ledger and accept it in the Window.',
    ),
  );
  let proofValid = false;
  let proofDetail = 'No stored proof for the qualifying session.';
  let proofId: string | null = null;
  if (summary.qualified?.proof_id) {
    proofId = summary.qualified.proof_id;
    const proof = store.get<AmbientProofRow>('SELECT public_document_json FROM ambient_proofs WHERE id = ?', proofId);
    if (proof) {
      try {
        const result = await verifyAmbientProofDocument(JSON.parse(proof.public_document_json) as unknown);
        proofValid = result.valid && result.checks.every((entry) => entry.pass);
        proofDetail = `${proofId}: ${result.checks.filter((entry) => entry.pass).length}/${result.checks.length} checks pass; signature=${result.signatureValid}`;
      } catch (error) {
        proofDetail = `Proof could not be parsed: ${(error as Error).message}`;
      }
    }
  }
  checks.push(check('proof', 'Stored qualifying proof verifies locally', proofValid ? 'PASS' : 'OPEN', proofDetail));
  const phase = setPhase(run, 'window', checks, {
    interruptedSessionId: summary.interrupted?.id ?? null,
    qualifiedSessionId: summary.qualified?.id ?? null,
    interruptedOutcome: summary.interrupted?.outcome ?? null,
    qualifiedOutcome: summary.qualified?.outcome ?? null,
    proofId,
  });
  phase.notes = [
    'A demo-labeled session can still be a physical observation, but it must be labeled DEMO_NO_PAYMENT in the public story.',
    'A microphone observation does not prove silence, power-off, machine identity or provider action.',
    'The Workflow does not close Gate C; the physical actions and review must be genuine.',
  ];
  printChecks(phase);
  return phase;
}

async function validatePayPal(run: OperatorRun, ctx: StatusContext): Promise<OperatorPhase> {
  const { config, store } = ctx;
  if (!store) return setPhase(run, 'paypal', [check('store', 'Database is available', 'FAIL', 'No database.')]);
  if (!run.objectId) return setPhase(run, 'paypal', [check('object', 'A real object is selected', 'OPEN', 'Complete phase 1 first.')]);
  const rows = (await ambientSessions(store, run.objectId)).filter((row) => row.demo === 0);
  const summary = summarizeSessions(rows);
  const checks: OperatorCheck[] = [];
  checks.push(
    check(
      'paypal-config',
      'PayPal Sandbox credentials are configured',
      config.paypal.configured ? 'PASS' : 'BLOCKED',
      config.paypal.configured ? 'Server-side credentials present; values were not printed.' : 'Add Sandbox credentials to .env and restart.',
    ),
  );
  const captured = summary.captured;
  const voided = summary.voided;
  checks.push(
    check(
      'capture-session',
      'A non-demo qualifying session has a PayPal capture',
      captured && captured.outcome === 'QUALIFIED' && Boolean(captured.acceptance_json) ? 'PASS' : 'OPEN',
      captured
        ? `${captured.id}: ${captured.payment_state}; outcome=${captured.outcome}; acceptance=${Boolean(captured.acceptance_json)}`
        : 'Complete a qualifying Sandbox session, accept the result and capture it.',
    ),
  );
  checks.push(
    check(
      'void-session',
      'A non-demo failed/interrupted session has a void and no capture',
      voided && voided.outcome !== 'QUALIFIED' ? 'PASS' : 'OPEN',
      voided
        ? `${voided.id}: outcome=${voided.outcome}; void ${redactProviderId(voided.paypal_void_id)}; capture=${voided.paypal_capture_id ? 'present' : 'none'}`
        : 'Run a failed/interrupted session with an authorization, then void it.',
    ),
  );
  const buyerAttested = Boolean(run.phases.paypal.data.buyerApprovalAttested);
  checks.push(
    check(
      'buyer-approval',
      'Buyer approval occurred in the official Sandbox UI',
      buyerAttested ? 'PASS' : 'OPEN',
      buyerAttested
        ? 'Operator attestation recorded. This workflow cannot independently identify the person who clicked approve.'
        : 'Complete the official PayPal Sandbox approval and record that it happened.',
    ),
  );
  if (config.paypal.configured && captured?.paypal_capture_id && captured.paypal_authorization_id) {
    try {
      const client = new PayPalClient({
        baseUrl: config.paypal.baseUrl,
        clientId: config.paypal.clientId,
        clientSecret: config.paypal.clientSecret,
        webhookId: config.paypal.webhookId,
      });
      const capture = await client.getCapture(captured.paypal_capture_id);
      const authorization = await client.getAuthorization(captured.paypal_authorization_id);
      const terms = parseTermsPrice(captured.terms_snapshot_json);
      const expected =
        terms.fixedPriceMinor !== null && terms.currency
          ? minorToDecimalString(terms.fixedPriceMinor, terms.currency as Currency)
          : null;
      const amount = capture.amount?.value ?? null;
      const currency = capture.amount?.currency_code ?? null;
      const providerChecked =
        capture.status === 'COMPLETED' &&
        capture.final_capture === true &&
        amount === expected &&
        currency === terms.currency;
      const providerDetail = `capture ${redactProviderId(capture.id)}=${capture.status} final=${capture.final_capture === true} ${amount ?? '?'} ${currency ?? '?'} · expected ${expected ?? '?'} ${terms.currency ?? '?'} · authorization=${authorization.status}`;
      run.phases.paypal.data.captureProviderStatus = capture.status;
      run.phases.paypal.data.authorizationProviderStatus = authorization.status;
      run.phases.paypal.data.captureAmount = amount;
      run.phases.paypal.data.captureCurrency = currency;
      run.phases.paypal.data.finalCapture = capture.final_capture === true;
      checks.push(
        check(
          'capture-amount',
          'Provider capture is COMPLETED at the exact accepted price',
          providerChecked ? 'PASS' : 'FAIL',
          providerDetail,
        ),
      );
    } catch (error) {
      checks.push(
        check(
          'provider-lookup',
          'Provider lookup for capture',
          'BLOCKED',
          `PayPal lookup failed: ${(error as Error).message}. Do not claim success from local rows alone.`,
        ),
      );
    }
  } else {
    checks.push(check('provider-lookup', 'Provider lookup for capture', 'OPEN', 'No provider lookup was attempted.'));
  }
  if (config.paypal.configured && voided?.paypal_authorization_id) {
    try {
      const client = new PayPalClient({
        baseUrl: config.paypal.baseUrl,
        clientId: config.paypal.clientId,
        clientSecret: config.paypal.clientSecret,
        webhookId: config.paypal.webhookId,
      });
      const authorization = await client.getAuthorization(voided.paypal_authorization_id);
      const voidOk = authorization.status === 'VOIDED' && !voided.paypal_capture_id;
      checks.push(
        check(
          'void-provider',
          'Provider authorization is VOIDED with no capture',
          voidOk ? 'PASS' : 'FAIL',
          `authorization ${redactProviderId(authorization.id)}=${authorization.status}; local capture=${voided.paypal_capture_id ? 'present' : 'none'}`,
        ),
      );
    } catch (error) {
      checks.push(
        check(
          'void-provider',
          'Provider lookup for void authorization',
          'BLOCKED',
          `PayPal lookup failed: ${(error as Error).message}`,
        ),
      );
    }
  } else {
    checks.push(check('void-provider', 'Provider lookup for void authorization', 'OPEN', 'No non-demo voided authorization yet.'));
  }
  const phase = setPhase(run, 'paypal', checks, {
    orderId: captured?.paypal_order_id ?? voided?.paypal_order_id ?? null,
    authorizationId: captured?.paypal_authorization_id ?? voided?.paypal_authorization_id ?? null,
    captureId: captured?.paypal_capture_id ?? null,
    voidId: voided?.paypal_void_id ?? null,
    capturedSessionId: captured?.id ?? null,
    voidedSessionId: voided?.id ?? null,
    checkedAt: nowIso(),
  });
  phase.notes = [
    'Sandbox funds are simulated, not revenue.',
    'Provider lookup confirms a state now; it does not prove buyer identity or that a human reviewed the terms.',
    'The historical 4.x capture is not used by this workflow. The operator run directory records only newly entered evidence.',
    'The workflow does not close Gates E, F or G; independent financial/security review remains required.',
  ];
  printChecks(phase);
  return phase;
}

async function validateWebhook(run: OperatorRun, ctx: StatusContext): Promise<OperatorPhase> {
  const { config, store } = ctx;
  const checks: OperatorCheck[] = [];
  checks.push(
    check(
      'webhook-config',
      'Webhook ID is configured',
      config.paypal.webhookConfigured ? 'PASS' : 'BLOCKED',
      config.paypal.webhookConfigured ? 'PAYPAL_WEBHOOK_ID is present server-side.' : 'Register the webhook and set PAYPAL_WEBHOOK_ID.',
    ),
  );
  const publicUrl = typeof run.phases.webhook.data.publicWebhookUrl === 'string' ? run.phases.webhook.data.publicWebhookUrl : '';
  let publicOk = false;
  try {
    const url = new URL(publicUrl);
    publicOk = url.protocol === 'https:' && url.pathname.endsWith('/api/paypal/webhook');
  } catch {
    // Leave publicOk false; the check below reports the missing URL.
  }
  checks.push(
    check(
      'public-webhook',
      'A public HTTPS webhook URL is recorded',
      publicOk ? 'PASS' : 'OPEN',
      publicOk ? publicUrl : 'Point a temporary HTTPS tunnel at the webhook-only proxy and record https://…/api/paypal/webhook.',
    ),
  );
  const rows = (store ? await webhookEvents(store) : []).filter((row) => row.received_at >= run.createdAt);
  checks.push(
    check(
      'verified-event',
      'A genuinely verified PayPal webhook event exists',
      rows.length > 0 ? 'PASS' : 'OPEN',
      rows.length > 0
        ? `${rows.length} verified event(s); latest ${rows[0]!.event_type} at ${rows[0]!.received_at}`
        : 'No verified event. A loopback replay or hand-crafted payload does not count.',
    ),
  );
  const eventTypes = rows.map((row) => row.event_type);
  checks.push(
    check(
      'event-type',
      'The verified event is a payment/checkout event',
      eventTypes.some((type) => type.startsWith('PAYMENT.') || type.startsWith('CHECKOUT.')) ? 'PASS' : 'OPEN',
      eventTypes.length ? eventTypes.join(', ') : 'No event types to inspect.',
    ),
  );
  const phase = setPhase(run, 'webhook', checks, {
    publicWebhookUrl: publicUrl || null,
    verifiedEventIds: rows.map((row) => row.event_id),
    verifiedEventTypes: eventTypes,
    latestReceivedAt: rows[0]?.received_at ?? null,
  });
  phase.notes = [
    'The webhook-only proxy is loopback HTTP; the tunnel terminates TLS. Do not tunnel the full API.',
    'A verified event only triggers reconciliation; it never initiates a charge.',
    'The workflow does not close Gate H if the event cannot be verified by PayPal.',
  ];
  printChecks(phase);
  return phase;
}

async function validateDemo(run: OperatorRun): Promise<OperatorPhase> {
  const checks: OperatorCheck[] = [];
  const videoPath = typeof run.phases.demo.data.videoPath === 'string' ? run.phases.demo.data.videoPath : '';
  let duration: number | null = null;
  if (videoPath && existsSync(videoPath)) {
    duration = ffprobeDuration(videoPath);
    const size = (await stat(videoPath)).size;
    const hash = await hashFile(videoPath);
    run.phases.demo.data.videoSha256 = hash;
    run.phases.demo.data.videoBytes = size;
    if (!run.artifacts.some((artifact) => artifact.sha256 === hash && artifact.kind === 'video')) {
      run.artifacts.push({ name: path.basename(videoPath), path: videoPath, sha256: hash, bytes: size, kind: 'video' });
    }
    checks.push(check('video-file', 'A local video file exists', 'PASS', `${path.basename(videoPath)} · ${(size / 1024 / 1024).toFixed(1)} MiB`));
  } else {
    checks.push(check('video-file', 'A local video file exists', 'OPEN', 'Record the demo or provide a path in the demo phase.'));
  }
  const durationCheck = demoDurationCheck(duration);
  checks.push(check('video-duration', 'Video is under three minutes', durationCheck.pass ? 'PASS' : 'OPEN', durationCheck.detail));
  const youtube = typeof run.phases.demo.data.youtubeUrl === 'string' ? run.phases.demo.data.youtubeUrl : '';
  let youtubeOk = false;
  try {
    const url = new URL(youtube);
    youtubeOk = url.protocol === 'https:' && (url.hostname === 'youtu.be' || url.hostname.endsWith('youtube.com'));
  } catch {
    // Leave youtubeOk false; the check below reports the missing URL.
  }
  checks.push(check('public-video', 'A public/unlisted YouTube URL is recorded', youtubeOk ? 'PASS' : 'OPEN', youtubeOk ? youtube : 'Upload only after reviewing the final cut.'));
  const devpost = typeof run.phases.demo.data.devpostUrl === 'string' ? run.phases.demo.data.devpostUrl : '';
  let devpostOk = false;
  try {
    const url = new URL(devpost);
    devpostOk = url.protocol === 'https:' && (url.hostname === 'devpost.com' || url.hostname.endsWith('.devpost.com'));
  } catch {
    // Leave devpostOk false; the check below reports the missing URL.
  }
  checks.push(
    check(
      'devpost',
      'A Devpost confirmation URL is recorded',
      devpostOk ? 'PASS' : 'OPEN',
      devpostOk ? devpost : 'A draft is not a submission. Record the confirmation URL only after Devpost accepts it.',
    ),
  );
  const phase = setPhase(run, 'demo', checks, { durationSeconds: duration });
  phase.notes = [
    'The file duration is measured; the truthfulness of the content is not machine-verifiable.',
    'The demo must label synthetic replay, open physical gates and Sandbox status.',
    'Do not show secrets, full buyer details, cookies or unredacted provider payloads.',
  ];
  printChecks(phase);
  return phase;
}

async function validatePhase(run: OperatorRun, id: PhaseId, ctx: StatusContext): Promise<OperatorPhase> {
  if (id === 'preflight') {
    const checks = await preflightChecks(ctx);
    return setPhase(run, 'preflight', checks);
  }
  if (id === 'appliance') return validateAppliance(run, ctx);
  if (id === 'window') return validateWindow(run, ctx);
  if (id === 'paypal') return validatePayPal(run, ctx);
  if (id === 'webhook') return validateWebhook(run, ctx);
  return validateDemo(run);
}

async function preflight(run: OperatorRun, ctx: StatusContext): Promise<OperatorPhase> {
  const phase = await validatePhase(run, 'preflight', ctx);
  await saveRun(run);
  print(`\nPreflight: ${phase.status}`);
  printChecks(phase);
  return phase;
}

function statusLabel(status: string): string {
  return status === 'VERIFIED' ? 'LOCAL EVIDENCE VERIFIED' : status.replaceAll('_', ' ');
}

function printRunSummary(run: OperatorRun): void {
  print(`Run ${run.runId}`);
  print(`  object: ${run.objectName ?? 'not selected'}${run.objectId ? ` (${run.objectId})` : ''}`);
  print(`  release: ${run.release}`);
  print(`  conditions: mic=${run.conditions.microphoneLabel ?? '—'} distance=${run.conditions.distanceCm ?? '—'}cm setting=${run.conditions.applianceSetting ?? '—'}`);
  for (const id of ['preflight', 'appliance', 'window', 'paypal', 'webhook', 'demo'] as const) {
    print(`  ${id.padEnd(10)} ${statusLabel(run.phases[id].status)}`);
  }
  print('  canonical gates: OPEN — this workflow produces review evidence, not certification.');
}

async function status(ctx: StatusContext): Promise<void> {
  const id = await latestRunId();
  if (!id) {
    print('No operator run yet. Start with: npm run operator:7 -- run');
  } else {
    const run = await readRun(id);
    printRunSummary(run);
  }
  const preflightPhase = await preflightChecks(ctx);
  print('\nEnvironment');
  for (const entry of preflightPhase) print(`  ${entry.status.padEnd(7)} ${entry.label}: ${entry.detail}`);
  print(`  ${ctx.config.paypal.configured ? 'PASS' : 'OPEN'}    PayPal Sandbox: ${ctx.config.paypal.configured ? 'credentials configured' : 'not configured'}`);
  print(`  ${ctx.config.paypal.webhookConfigured ? 'PASS' : 'OPEN'}    Webhook verification: ${ctx.config.paypal.webhookConfigured ? 'webhook ID configured' : 'not configured'}`);
  if (!ctx.store) return;
  const objects = await realObjects(ctx.store);
  print('\nReal objects');
  if (objects.length === 0) print('  none — create one at /studio');
  for (const object of objects) {
    print(`  ${object.id}  ${object.name}  model=${object.model_status ?? 'none'}  source=${object.active_terms_id ? 'terms' : 'not published'}`);
  }
  const events = await webhookEvents(ctx.store);
  print(`\nVerified webhooks: ${events.length}`);
  for (const event of events.slice(0, 5)) print(`  ${event.event_type}  ${event.received_at}  ${event.event_id.slice(0, 10)}…`);
}

async function allStatus(run: OperatorRun, ctx: StatusContext): Promise<void> {
  await validatePhase(run, 'preflight', ctx);
  await validatePhase(run, 'appliance', ctx);
  await validatePhase(run, 'window', ctx);
  await validatePhase(run, 'paypal', ctx);
  await validatePhase(run, 'webhook', ctx);
  await validateDemo(run);
  await saveRun(run);
}

function phaseOpenChecks(phase: OperatorPhase): string[] {
  return phase.checks.filter((entry) => entry.status !== 'PASS').map((entry) => `${entry.label}: ${entry.detail}`);
}

async function requireVerified(run: OperatorRun, phase: OperatorPhase): Promise<void> {
  if (phase.status === 'VERIFIED') return;
  await saveRun(run);
  const open = phaseOpenChecks(phase);
  print(`\nStopped: ${phase.status}. The workflow will not advance without the required evidence.`);
  for (const entry of open) print(`  - ${entry}`);
  throw new Error('Phase evidence is incomplete. The run was saved; fix the listed items and rerun.');
}

function objectSelector(config: Config, objects: ObjectToolRow[]): void {
  print(`Operator Studio: ${localUrl(config, '/studio')}`);
  print(`Use the operator key only at ${localUrl(config, '/operator/login')} (read it with npm run key).`);
  if (objects.length) {
    print('Existing real objects:');
    for (const object of objects) print(`  ${object.id}  ${object.name}  ${object.model_status ?? 'needs training'}`);
  } else {
    print('No real USER_CALIBRATION object exists yet. Create one in Studio first.');
  }
}

async function importGateA(run: OperatorRun, file: string): Promise<void> {
  const body = await readFile(file, 'utf8');
  const parsed = parseGateALog(JSON.parse(body) as unknown);
  if (!parsed.acceptedForReview) throw new Error(`Gate A log rejected for review:\n- ${parsed.issues.join('\n- ')}`);
  await copyArtifact(run, file, 'gate-a-log');
  await saveRun(run);
  print(`Imported Gate A log: ${path.basename(file)} · ${parsed.completedTrials} completed trials (Gate A remains OPEN pending review).`);
}

async function importFieldReport(run: OperatorRun, file: string): Promise<void> {
  const body = await readFile(file, 'utf8');
  const parsed = parseFieldReport(JSON.parse(body) as unknown);
  if (!parsed.acceptedForReview) throw new Error(`Field report rejected:\n- ${parsed.issues.join('\n- ')}`);
  await copyArtifact(run, file, 'field-report');
  await saveRun(run);
  print(`Imported field report ${parsed.reportId}; it remains subject to review.`);
}

function reportFor(run: OperatorRun): string {
  const lines: string[] = [];
  lines.push('# Whirr 7.0 operator evidence package');
  lines.push('');
  lines.push('**Status: LOCAL EVIDENCE FOR REVIEW — NOT AN INDEPENDENT CERTIFICATION.**');
  lines.push('');
  lines.push(`- Run: \`${run.runId}\``);
  lines.push(`- Release: \`${run.release}\``);
  lines.push(`- Created: ${run.createdAt}`);
  lines.push(`- Object: ${run.objectName ?? 'not selected'}${run.objectId ? ` (\`${run.objectId}\`)` : ''}`);
  lines.push(`- Microphone: ${run.conditions.microphoneLabel ?? 'not recorded'}`);
  lines.push(`- Distance: ${run.conditions.distanceCm ?? 'not recorded'} cm`);
  lines.push(`- Appliance setting: ${run.conditions.applianceSetting ?? 'not recorded'}`);
  lines.push(`- Background: ${run.conditions.background ?? 'not recorded'}`);
  lines.push('');
  lines.push('## Phase results');
  lines.push('');
  lines.push('| Phase | Local status |');
  lines.push('| --- | --- |');
  for (const id of ['preflight', 'appliance', 'window', 'paypal', 'webhook', 'demo'] as const) {
    lines.push(`| ${id} | ${statusLabel(run.phases[id].status)} |`);
  }
  lines.push('');
  for (const id of ['preflight', 'appliance', 'window', 'paypal', 'webhook', 'demo'] as const) {
    const phase = run.phases[id];
    lines.push(`### ${id}`);
    lines.push('');
    for (const entry of phase.checks) lines.push(`- **${entry.status}** ${entry.label} — ${entry.detail}`);
    if (phase.notes.length) {
      lines.push('');
      for (const note of phase.notes) lines.push(`> ${note}`);
    }
    lines.push('');
  }
  lines.push('## Provider evidence');
  lines.push('');
  const paypal = run.phases.paypal.data;
  lines.push(`- Order: ${redactProviderId(typeof paypal.orderId === 'string' ? paypal.orderId : null) ?? 'none'}`);
  lines.push(`- Authorization: ${redactProviderId(typeof paypal.authorizationId === 'string' ? paypal.authorizationId : null) ?? 'none'}`);
  lines.push(`- Capture: ${redactProviderId(typeof paypal.captureId === 'string' ? paypal.captureId : null) ?? 'none'}`);
  lines.push(`- Void: ${redactProviderId(typeof paypal.voidId === 'string' ? paypal.voidId : null) ?? 'none'}`);
  lines.push('- Full provider identifiers are retained only in the private run directory; public copies use suffixes.');
  lines.push('');
  lines.push('## Artifacts');
  lines.push('');
  for (const artifact of run.artifacts) {
    lines.push(`- ${artifact.kind}: \`${artifact.name}\` — sha256 \`${artifact.sha256}\`, ${artifact.bytes} bytes`);
  }
  lines.push('');
  lines.push('## Canonical gates');
  lines.push('');
  lines.push('These remain **OPEN** until a named independent reviewer inspects the artifacts and updates the canonical evidence files:');
  lines.push('');
  for (const [gate, state] of Object.entries(run.gates)) lines.push(`- ${gate}: ${state}`);
  lines.push('');
  lines.push('## Reviewer sign-off (required)');
  lines.push('');
  lines.push('| Role | Name | Date | Decision |');
  lines.push('| --- | --- | --- | --- |');
  lines.push('| Physical evidence reviewer |  |  |  |');
  lines.push('| Financial/security reviewer |  |  |  |');
  lines.push('| Submission reviewer |  |  |  |');
  lines.push('');
  lines.push('An empty row is an open blocker, not a formality.');
  return `${lines.join('\n')}\n`;
}

async function exportPackage(run: OperatorRun): Promise<string> {
  const dir = path.join(RUN_ROOT, run.runId, 'export');
  await mkdir(path.join(dir, 'artifacts'), { recursive: true });
  const report = reportFor(run);
  await writeFile(path.join(dir, 'operator-report.md'), report, 'utf8');
  await writeFile(path.join(dir, 'run.redacted.json'), `${JSON.stringify(redactRun(run), null, 2)}\n`, 'utf8');
  for (const artifact of run.artifacts) {
    if (artifact.kind === 'video') continue;
    if (!existsSync(artifact.path)) continue;
    await copyFile(artifact.path, path.join(dir, 'artifacts', safeName(artifact.name))).catch(() => undefined);
  }
  const manifest = {
    schema: 'whirr.operator-export.v1',
    generatedAt: nowIso(),
    release: OPERATOR_RELEASE,
    runId: run.runId,
    reportSha256: sha256Hex(report),
    artifacts: run.artifacts.map((artifact) => ({
      name: artifact.name,
      kind: artifact.kind,
      sha256: artifact.sha256,
      bytes: artifact.bytes,
    })),
    gates: run.gates,
    certification: 'NOT_CERTIFIED',
    note: 'This package is review material only. It does not close any canonical gate or prove physical truth.',
  };
  await writeFile(path.join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  await writeFile(path.join(dir, 'README.md'), [
    '# Operator evidence package',
    '',
    'This package is generated from the local operator run. It is deliberately marked `NOT_CERTIFIED`.',
    '',
    '- Read `operator-report.md` first.',
    '- Check `manifest.json` and the artifact hashes.',
    '- Do not copy a PASS label into `docs/evidence/` without a named reviewer and the actual artifacts.',
    '- The private full run remains in `.whirr/operator-7/<runId>/run.json`; share the redacted copy.',
    '',
  ].join('\n'), 'utf8');
  print(`Exported review package: ${dir}`);
  print('No canonical gate file was modified. A named reviewer must still update the evidence record.');
  return dir;
}

async function interactiveRun(ctx: StatusContext, options: Record<string, string | boolean>): Promise<void> {
  const existing = options.new ? null : await latestRunId();
  const run = existing ? await readRun(existing) : createOperatorRun(makeRunId());
  if (!existing) await saveRun(run);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    print('\nWhirr 7.0 guided operator workflow');
    print('This is a real-world evidence session, not a simulation. The workflow pauses for physical actions and buyer approval.');
    print(`Run: ${run.runId}`);
    const pf = await preflight(run, ctx);
    if (pf.status !== 'VERIFIED') {
      print('\nFix the BLOCKED preflight items, then rerun. The run is saved.');
      return;
    }
    const objects = ctx.store ? await realObjects(ctx.store) : [];
    objectSelector(ctx.config, objects);
    if (!run.objectId) {
      const selected = await rl.question('Object id: ');
      run.objectId = selected.trim();
      const object = ctx.store && run.objectId
        ? await objectEvidence(ctx.store, run.objectId)
        : null;
      if (!object?.object) throw new Error('That object was not found.');
      run.objectName = object.object.name;
      await saveRun(run);
    }
    if (!run.safetyAttested) {
      print('\nSafety and authority: use only a safe household appliance, keep it supervised, do not defeat guards, and confirm both participants may change/observe the activity.');
      const safe = (await rl.question('Do you confirm safe authority and supervision? [y/N] ')).trim().toLowerCase();
      if (safe !== 'y') throw new Error('Safety/authority confirmation is required.');
      run.safetyAttested = true;
      await saveRun(run);
    }
    if (!run.conditions.microphoneLabel) {
      run.conditions.microphoneLabel = (await rl.question('Microphone label: ')).trim() || null;
      const distance = Number((await rl.question('Measured microphone distance in cm: ')).trim());
      run.conditions.distanceCm = Number.isFinite(distance) && distance > 0 ? distance : null;
      run.conditions.applianceSetting = (await rl.question('Appliance setting/speed: ')).trim() || null;
      run.conditions.background = (await rl.question('Background conditions: ')).trim() || null;
      await saveRun(run);
    }

    print('\nPhase 1 — real appliance enrollment and validation');
    print(`  ${localUrl(ctx.config, '/studio')}  create/select the object`);
    print(`  ${localUrl(ctx.config, `/studio/objects/${run.objectId}/calibration-lab`)}  live takes, train, field trials, report`);
    print(`  ${localUrl(ctx.config, `/studio/objects/${run.objectId}/gate-a`)}  repeat four times; download each log`);
    print('  Required: 5 live idle, 5 active, 5 negative takes; READY USER_CALIBRATION model; FIELD_PASS report; four Gate A logs.');
    if (options.open) openUrl(localUrl(ctx.config, `/studio/objects/${run.objectId}/calibration-lab`));
    await rl.question('Press Enter when the field report and four Gate A logs are ready. ');
    for (;;) {
      const logPath = (await rl.question('Gate A log path (blank when finished): ')).trim();
      if (!logPath) break;
      await importGateA(run, logPath);
    }
    await requireVerified(run, await validateAppliance(run, ctx));
    if (options.open) openUrl(localUrl(ctx.config, '/ambient/wish'));

    print('\nPhase 2 — genuine interrupted and qualifying Quiet Windows');
    print('Use two separate agreements so each window is a new observation. Keep this session non-synthetic and live.');
    print('Interrupted: run the source, stop it, then restart it before the approved quiet interval completes.');
    print('Qualifying: run the baseline, stop the source, and keep it undetected for the full approved interval; accept the result.');
    print(`  Buyer: ${localUrl(ctx.config, '/ambient/wish')}`);
    print(`  Provider: ${localUrl(ctx.config, '/operator/ambient')}`);
    await rl.question('Press Enter after both windows have been evaluated and the qualifying proof is available. ');
    await requireVerified(run, await validateWindow(run, ctx));

    print('\nPhase 3 — authentic PayPal Sandbox lifecycle');
    print('A human buyer must approve in the official Sandbox UI. Complete one qualified capture and one interrupted void.');
    print(`  ${localUrl(ctx.config, '/ambient/wish')}  buyer flow`);
    print(`  ${localUrl(ctx.config, '/ambient/window')}  order, approval, authorize, window, capture/void`);
    print('Do not use live credentials or the historical 4.x capture.');
    const attested = (await rl.question('Did the human buyer complete the official Sandbox approval? [y/N] ')).trim().toLowerCase();
    run.phases.paypal.data.buyerApprovalAttested = attested === 'y';
    await saveRun(run);
    await requireVerified(run, await validatePayPal(run, ctx));

    print('\nPhase 4 — genuine signed webhook');
    print('Terminal A: npm run proxy:webhook');
    print('Terminal B: cloudflared tunnel --url http://127.0.0.1:8790');
    print('Register https://<tunnel-host>/api/paypal/webhook in the same Sandbox app and set PAYPAL_WEBHOOK_ID.');
    print('Trigger a new Sandbox event. Do not hand-craft a webhook or replay a loopback request.');
    const webhookUrl = (await rl.question('Public webhook URL (https://…/api/paypal/webhook): ')).trim();
    run.phases.webhook.data.publicWebhookUrl = webhookUrl;
    await rl.question('Press Enter after PayPal shows a delivered event in the dashboard. ');
    await requireVerified(run, await validateWebhook(run, ctx));

    print('\nPhase 5 — truthful three-minute demo and submission package');
    const video = (await rl.question('Path to the recorded video: ')).trim();
    run.phases.demo.data.videoPath = video;
    const youtube = (await rl.question('Public/unlisted YouTube URL (blank if not uploaded): ')).trim();
    run.phases.demo.data.youtubeUrl = youtube || null;
    const devpost = (await rl.question('Devpost confirmation URL (blank if not submitted): ')).trim();
    run.phases.demo.data.devpostUrl = devpost || null;
    await saveRun(run);
    const demo = await validateDemo(run);
    printChecks(demo);
    await exportPackage(run);
    if (demo.status !== 'VERIFIED') {
      print('\nSubmission is not complete. The review package was written with the open items preserved; do not call it submitted.');
      return;
    }
    await allStatus(run, ctx);
    await exportPackage(run);
    print('\nDone. The package is review material only; all canonical gates remain OPEN until a named reviewer updates them.');
  } finally {
    rl.close();
  }
}

function usage(): void {
  print('Whirr 7.0 guided operator workflow');
  print('');
  print('  npm run operator:7 -- run [--open]       guided five-phase session (add --new to start fresh)');
  print('  npm run operator:7 -- status            current environment and run');
  print('  npm run operator:7 -- phase <1-5>       verify one phase against real state');
  print('  npm run operator:7 -- verify            verify all phases and write run.json');
  print('  npm run operator:7 -- import-gate-a <file>');
  print('  npm run operator:7 -- import-field-report <file>');
  print('  npm run operator:7 -- export             write the redacted review package');
  print('');
  print('Phases: 1 appliance, 2 Quiet Window, 3 PayPal, 4 webhook, 5 demo.');
  print('No phase passes from a prompt alone; each check reads the database, artifacts or provider.');
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0] ?? 'status';
  const options: Record<string, string | boolean> = {};
  for (const arg of args.slice(1)) {
    if (arg.startsWith('--')) options[arg.slice(2)] = true;
  }
  if (command === 'help' || command === '--help' || command === '-h') {
    usage();
    return;
  }
  const ctx = await context();
  try {
    if (command === 'status') {
      await status(ctx);
      return;
    }
    if (command === 'run') {
      await interactiveRun(ctx, options);
      return;
    }
    const runId = typeof options.run === 'string' ? options.run : undefined;
    const run = await readRun(runId);
    if (command === 'verify') {
      await allStatus(run, ctx);
      printRunSummary(run);
      return;
    }
    if (command === 'phase') {
      const id = PHASE_ALIASES[args[1] ?? ''];
      if (!id) throw new Error('Phase must be 1-5 or appliance/window/paypal/webhook/demo.');
      await validatePhase(run, id, ctx);
      await saveRun(run);
      printRunSummary(run);
      return;
    }
    if (command === 'import-gate-a') {
      if (!args[1]) throw new Error('Usage: npm run operator:7 -- import-gate-a <file>');
      await importGateA(run, args[1]);
      return;
    }
    if (command === 'import-field-report') {
      if (!args[1]) throw new Error('Usage: npm run operator:7 -- import-field-report <file>');
      await importFieldReport(run, args[1]);
      return;
    }
    if (command === 'export') {
      await allStatus(run, ctx);
      await exportPackage(run);
      return;
    }
    usage();
  } finally {
    closeContext(ctx);
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((error) => {
    console.error(`\nOperator workflow stopped: ${(error as Error).message}`);
    process.exitCode = 1;
  });
}
