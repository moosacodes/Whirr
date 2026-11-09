import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, describe, expect, it } from 'vitest';
import { Store } from '../../apps/api/src/db/index.ts';
import { SCHEMA_VERSION } from '../../apps/api/src/db/schema.ts';

const dir = mkdtempSync(path.join(tmpdir(), 'whirr-migrate-'));

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('schema migration', () => {
  it('adds v3 columns and tables to a v1 database without losing rows', () => {
    const file = path.join(dir, 'v1.db');
    const old = new DatabaseSync(file);
    old.exec(`
      CREATE TABLE observed_intervals (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        start_ms INTEGER NOT NULL
      );
      CREATE TABLE disputes (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL
      );
      INSERT INTO observed_intervals (id, session_id, start_ms) VALUES ('old_interval', 'old_session', 0);
      INSERT INTO disputes (id, session_id) VALUES ('old_dispute', 'old_session');
      PRAGMA user_version = 1;
    `);
    old.close();

    const store = new Store(file);
    const intervalColumns = store.all<{ name: string }>('PRAGMA table_info(observed_intervals)').map((column) => column.name);
    const disputeColumns = store.all<{ name: string }>('PRAGMA table_info(disputes)').map((column) => column.name);
    expect(intervalColumns).toContain('explanation_json');
    expect(disputeColumns).toContain('reason_code');
    expect(store.get<{ id: string }>("SELECT id FROM observed_intervals WHERE id = 'old_interval'")?.id).toBe('old_interval');
    expect(store.get<{ id: string }>("SELECT id FROM disputes WHERE id = 'old_dispute'")?.id).toBe('old_dispute');
    expect(store.get<{ user_version: number }>('PRAGMA user_version')?.user_version).toBe(SCHEMA_VERSION);
    expect(store.getMeta('schema_version')).toBe(String(SCHEMA_VERSION));
    expect(store.get<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'passport_versions'")?.name).toBe('passport_versions');
    expect(store.get<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'object_holds'")?.name).toBe('object_holds');
    const sessionColumns = store.all<{ name: string }>('PRAGMA table_info(sessions)').map((column) => column.name);
    expect(sessionColumns).toContain('authorization_expires_at');
    expect(sessionColumns).toContain('capture_claim_json');
    expect(store.get<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'proof_bundles'")?.name).toBe('proof_bundles');
    store.close();
  });
});