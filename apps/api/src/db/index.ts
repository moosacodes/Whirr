import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { SCHEMA_SQL, SCHEMA_VERSION } from './schema.ts';

export type SqlValue = string | number | bigint | null | Uint8Array;

export class Store {
  readonly db: DatabaseSync;
  private readonly statements = new Map<string, StatementSync>();

  constructor(readonly filename: string) {
    if (filename !== ':memory:') mkdirSync(path.dirname(filename), { recursive: true });
    this.db = new DatabaseSync(filename);
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec('PRAGMA busy_timeout = 5000;');
    this.db.exec(SCHEMA_SQL);
    this.ensureColumn('observed_intervals', 'explanation_json', 'TEXT');
    this.ensureColumn('disputes', 'reason_code', 'TEXT');
    const version = this.get<{ user_version: number }>('PRAGMA user_version');
    if (!version || version.user_version !== SCHEMA_VERSION) {
      this.db.exec(`PRAGMA user_version = ${SCHEMA_VERSION};`);
    }
    this.setMeta('schema_version', String(SCHEMA_VERSION));
  }

  private ensureColumn(table: string, column: string, definition: string): void {
    const existing = this.all<{ name: string }>(`PRAGMA table_info(${table})`);
    if (!existing.some((entry) => entry.name === column)) {
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`);
    }
  }

  private prepare(sql: string): StatementSync {
    const existing = this.statements.get(sql);
    if (existing) return existing;
    const statement = this.db.prepare(sql);
    this.statements.set(sql, statement);
    return statement;
  }

  run(sql: string, ...params: SqlValue[]): { changes: number; lastInsertRowid: number | bigint } {
    const result = this.prepare(sql).run(...params);
    return { changes: Number(result.changes), lastInsertRowid: result.lastInsertRowid };
  }

  get<T>(sql: string, ...params: SqlValue[]): T | undefined {
    return this.prepare(sql).get(...params) as T | undefined;
  }

  all<T>(sql: string, ...params: SqlValue[]): T[] {
    return this.prepare(sql).all(...params) as T[];
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        // ignore rollback failure
      }
      throw error;
    }
  }

  getMeta(key: string): string | null {
    const row = this.get<{ value: string }>('SELECT value FROM app_meta WHERE key = ?', key);
    return row?.value ?? null;
  }

  setMeta(key: string, value: string): void {
    this.run(
      'INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      key,
      value,
    );
  }

  close(): void {
    this.statements.clear();
    this.db.close();
  }
}
