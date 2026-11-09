import { canonicalJson, hashCanonical, sha256Hex } from './hash.ts';
import { ids } from './ids.ts';
import type { Store } from '../db/index.ts';

export interface AuditInput {
  actorType: 'operator' | 'renter' | 'system';
  actorId: string;
  action: string;
  subjectType: string;
  subjectId: string;
  metadata?: Record<string, unknown>;
}

export function appendAudit(store: Store, input: AuditInput, now = new Date()): { id: string; hash: string } {
  const last = store.get<{ hash: string }>('SELECT hash FROM audit_events ORDER BY seq DESC LIMIT 1');
  const prevHash = last?.hash ?? 'GENESIS';
  const id = ids.audit();
  const createdAt = now.toISOString();
  const metadataJson = JSON.stringify(input.metadata ?? {});
  const hash = hashCanonical({
    id,
    prevHash,
    actorType: input.actorType,
    actorId: input.actorId,
    action: input.action,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    metadata: input.metadata ?? {},
    createdAt,
  });
  store.run(
    `INSERT INTO audit_events (id, prev_hash, hash, actor_type, actor_id, action, subject_type, subject_id, metadata_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    prevHash,
    hash,
    input.actorType,
    input.actorId,
    input.action,
    input.subjectType,
    input.subjectId,
    metadataJson,
    createdAt,
  );
  return { id, hash };
}

export function verifyAuditChain(store: Store): { valid: boolean; events: number; brokenAt: string | null } {
  const rows = store.all<{
    id: string;
    prev_hash: string;
    hash: string;
    actor_type: string;
    actor_id: string;
    action: string;
    subject_type: string;
    subject_id: string;
    metadata_json: string;
    created_at: string;
  }>('SELECT * FROM audit_events ORDER BY seq ASC');
  let prev = 'GENESIS';
  for (const row of rows) {
    let metadata: unknown;
    try {
      metadata = JSON.parse(row.metadata_json) as unknown;
    } catch {
      return { valid: false, events: rows.length, brokenAt: row.id };
    }
    let expected: string;
    try {
      expected = hashCanonical({
        id: row.id,
        prevHash: prev,
        actorType: row.actor_type,
        actorId: row.actor_id,
        action: row.action,
        subjectType: row.subject_type,
        subjectId: row.subject_id,
        metadata,
        createdAt: row.created_at,
      });
    } catch {
      return { valid: false, events: rows.length, brokenAt: row.id };
    }
    if (row.prev_hash !== prev || row.hash !== expected) {
      return { valid: false, events: rows.length, brokenAt: row.id };
    }
    prev = row.hash;
  }
  return { valid: true, events: rows.length, brokenAt: null };
}

export function auditFingerprint(store: Store): string {
  const last = store.get<{ hash: string }>('SELECT hash FROM audit_events ORDER BY seq DESC LIMIT 1');
  return last?.hash ?? sha256Hex('empty-audit-chain');
}

export function metadataForAudit(value: Record<string, unknown>): Record<string, unknown> {
  // Defensive copy with JSON round-trip so only serialisable data is stored.
  return JSON.parse(canonicalJson(value)) as Record<string, unknown>;
}
