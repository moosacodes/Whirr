import type { AppContext } from '../context.ts';
import type { HoldView } from '../../../../packages/contracts/src/types.ts';
import type { ObjectRow, UserRow } from './rows.ts';
import { errors } from '../lib/errors.ts';
import { newId } from '../lib/ids.ts';
import { appendAudit } from '../lib/audit.ts';

const HOLD_TTL_MS = 10 * 60 * 1000;

interface HoldRow {
  id: string;
  object_id: string;
  renter_id: string;
  created_at: string;
  expires_at: string;
  consumed_session_id: string | null;
}

function holdView(row: HoldRow): HoldView {
  return { id: row.id, objectId: row.object_id, createdAt: row.created_at, expiresAt: row.expires_at };
}

function clearExpired(ctx: AppContext, objectId?: string): void {
  const now = ctx.now().toISOString();
  if (objectId) {
    ctx.store.run('DELETE FROM object_holds WHERE object_id = ? AND expires_at <= ?', objectId, now);
  } else {
    ctx.store.run('DELETE FROM object_holds WHERE expires_at <= ?', now);
  }
}

export function activeHoldFor(ctx: AppContext, objectId: string): HoldRow | null {
  clearExpired(ctx, objectId);
  return (
    ctx.store.get<HoldRow>(
      'SELECT * FROM object_holds WHERE object_id = ? AND consumed_session_id IS NULL ORDER BY created_at ASC LIMIT 1',
      objectId,
    ) ?? null
  );
}

export function holdViewFor(ctx: AppContext, objectId: string): HoldView | null {
  const row = activeHoldFor(ctx, objectId);
  return row ? holdView(row) : null;
}

export function createHold(ctx: AppContext, renter: UserRow, object: ObjectRow): HoldView {
  if (object.status !== 'ACTIVE') throw errors.notFound('This object is not available.');
  const activeSession = ctx.store.get<{ id: string }>(
    "SELECT id FROM sessions WHERE object_id = ? AND state IN ('READY','ACTIVE','PAUSED') LIMIT 1",
    object.id,
  );
  if (activeSession) throw errors.conflict('OBJECT_IN_USE', 'This object already has an active session.');
  clearExpired(ctx, object.id);
  const other = ctx.store.get<HoldRow>(
    'SELECT * FROM object_holds WHERE object_id = ? AND renter_id <> ? AND consumed_session_id IS NULL LIMIT 1',
    object.id,
    renter.id,
  );
  if (other) throw errors.conflict('OBJECT_HELD', 'Another renter is holding this object. Try again in a few minutes.');
  const existing = ctx.store.get<HoldRow>(
    'SELECT * FROM object_holds WHERE object_id = ? AND renter_id = ?',
    object.id,
    renter.id,
  );
  const now = ctx.now();
  const expiresAt = new Date(now.getTime() + HOLD_TTL_MS).toISOString();
  if (existing) {
    ctx.store.run(
      'UPDATE object_holds SET expires_at = ?, created_at = ?, consumed_session_id = NULL WHERE id = ?',
      expiresAt,
      now.toISOString(),
      existing.id,
    );
    return { id: existing.id, objectId: object.id, createdAt: now.toISOString(), expiresAt };
  }
  const id = newId('hld');
  ctx.store.run(
    'INSERT INTO object_holds (id, object_id, renter_id, created_at, expires_at, consumed_session_id) VALUES (?, ?, ?, ?, ?, NULL)',
    id,
    object.id,
    renter.id,
    now.toISOString(),
    expiresAt,
  );
  appendAudit(ctx.store, {
    actorType: 'renter',
    actorId: renter.id,
    action: 'shelf.hold_created',
    subjectType: 'object',
    subjectId: object.id,
    metadata: { holdId: id, expiresAt },
  }, ctx.now());
  return { id, objectId: object.id, createdAt: now.toISOString(), expiresAt };
}

export function releaseHold(ctx: AppContext, renter: UserRow, object: ObjectRow): void {
  ctx.store.run(
    'DELETE FROM object_holds WHERE object_id = ? AND renter_id = ? AND consumed_session_id IS NULL',
    object.id,
    renter.id,
  );
  appendAudit(ctx.store, {
    actorType: 'renter',
    actorId: renter.id,
    action: 'shelf.hold_released',
    subjectType: 'object',
    subjectId: object.id,
    metadata: {},
  }, ctx.now());
}

/** Refuse a new session when another renter holds the object. */
export function assertHoldAvailable(ctx: AppContext, renterId: string, objectId: string): HoldRow | null {
  const hold = activeHoldFor(ctx, objectId);
  if (!hold) return null;
  if (hold.renter_id !== renterId) {
    throw errors.conflict('OBJECT_HELD', 'Another renter is holding this object. Try again when the hold expires.');
  }
  return hold;
}

export function consumeHold(ctx: AppContext, hold: HoldRow | null, sessionId: string): void {
  if (!hold) return;
  ctx.store.run(
    'UPDATE object_holds SET consumed_session_id = ? WHERE id = ?',
    sessionId,
    hold.id,
  );
}
