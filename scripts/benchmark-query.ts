import { copyFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { Store } from '../apps/api/src/db/index.ts';

const ITERATIONS = 2_000;
const ROWS = 1_000;

interface QueryResult {
  label: string;
  sql: string;
  param: string;
  iterations: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
  plan: string[];
}

function percentile(values: number[], fraction: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)] ?? 0;
}

function summarise(
  store: Store,
  label: string,
  sql: string,
  param: string,
  planSql: string,
): QueryResult {
  for (let index = 0; index < 50; index += 1) store.get(sql, param);
  const timings: number[] = [];
  for (let index = 0; index < ITERATIONS; index += 1) {
    const start = performance.now();
    store.get(sql, param);
    timings.push(performance.now() - start);
  }
  return {
    label,
    sql,
    param,
    iterations: ITERATIONS,
    p50Ms: percentile(timings, 0.5),
    p95Ms: percentile(timings, 0.95),
    maxMs: Math.max(...timings),
    plan: store.all<{ detail: string }>(`EXPLAIN QUERY PLAN ${planSql}`, param).map((row) => row.detail),
  };
}

function main(): void {
  const source = path.resolve('data/whirr.db');
  if (!existsSync(source)) throw new Error('Run `npm run setup` before benchmarking queries.');
  const dir = mkdtempSync(path.join(os.tmpdir(), 'whirr-query-bench-'));
  const file = path.join(dir, 'whirr.db');
  for (const suffix of ['', '-wal', '-shm']) {
    const from = `${source}${suffix}`;
    if (existsSync(from)) copyFileSync(from, `${file}${suffix}`);
  }

  const store = new Store(file);
  try {
    const agreement = store.get<{
      id: string;
      current_revision: number;
      terms_hash: string;
      terms_json: string;
      object_id: string;
      buyer_id: string;
      provider_id: string;
    }>(
      'SELECT id, current_revision, terms_hash, terms_json, object_id, buyer_id, provider_id FROM ambient_agreements WHERE id = ? LIMIT 1',
      'amb_reference_window',
    );
    if (!agreement) throw new Error('The seeded ambient reference agreement is missing.');

    const now = new Date().toISOString();
    store.transaction(() => {
      for (let index = 0; index < ROWS; index += 1) {
        const sessionId = `ase_perf_${index}`;
        const captureId = `CAPTURE-PERF-${index}`;
        store.run(
          `INSERT INTO ambient_sessions
            (id, agreement_id, agreement_revision, agreement_hash, object_id, buyer_id, provider_id,
             terms_snapshot_json, state, payment_state, demo, observation_mode, created_at, accepted_at,
             paypal_capture_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'CAPTURED', 'CAPTURED', 0, 'LIVE', ?, ?, ?)`,
          sessionId,
          agreement.id,
          agreement.current_revision,
          agreement.terms_hash,
          agreement.object_id,
          agreement.buyer_id,
          agreement.provider_id,
          agreement.terms_json,
          new Date(Date.now() + index).toISOString(),
          now,
          captureId,
        );
        store.run(
          `INSERT INTO ambient_payment_operations
            (id, session_id, operation_type, request_id, state, amount_minor, currency, request_hash, provider_ref, attempts, created_at, updated_at)
           VALUES (?, ?, 'CAPTURE', ?, 'COMPLETED', 200, 'USD', ?, ?, 1, ?, ?)`,
          `apo_perf_${index}`,
          sessionId,
          `req_perf_${index}`,
          `hash_perf_${index}`,
          captureId,
          now,
          now,
        );
      }
    });

    const queries = [
      summarise(
        store,
        'latest session for agreement',
        'SELECT id FROM ambient_sessions WHERE agreement_id = ? ORDER BY created_at DESC LIMIT 1',
        agreement.id,
        'SELECT id FROM ambient_sessions WHERE agreement_id = ? ORDER BY created_at DESC LIMIT 1',
      ),
      summarise(
        store,
        'session by provider capture id',
        'SELECT id FROM ambient_sessions WHERE paypal_capture_id = ? LIMIT 1',
        'CAPTURE-PERF-500',
        'SELECT id FROM ambient_sessions WHERE paypal_capture_id = ? LIMIT 1',
      ),
      summarise(
        store,
        'payment operation by provider ref',
        'SELECT session_id FROM ambient_payment_operations WHERE provider_ref = ? LIMIT 1',
        'CAPTURE-PERF-500',
        'SELECT session_id FROM ambient_payment_operations WHERE provider_ref = ? LIMIT 1',
      ),
    ];

    const result = {
      schema: 'whirr.query-performance.v1',
      generatedAt: new Date().toISOString(),
      environment: {
        node: process.version,
        platform: `${process.platform}-${process.arch}`,
        cpu: os.cpus()[0]?.model ?? 'unknown',
        cpus: os.cpus().length,
      },
      dataset: { ambientSessions: ROWS, paymentOperations: ROWS },
      queries,
      notes: [
        'This measures prepared SQLite statements on a disposable copy of the local seeded database.',
        'It does not measure HTTP, browser audio processing, concurrent clients, or production scale.',
      ],
    };
    const output = path.resolve('docs/performance-query.json');
    writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    console.log(`Wrote ${path.relative(process.cwd(), output)}`);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

main();
