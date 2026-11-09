import type { FastifyReply, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import type { AppContext } from '../context.ts';
import type { UserRow } from '../domain/rows.ts';
import { errors } from './errors.ts';
import { hmacRef, shortRef } from './hash.ts';

export const OPERATOR_COOKIE = 'whirr_op';
export const RENTER_COOKIE = 'whirr_renter';
const OPERATOR_USER_ID = 'usr_operator';

export function ensureOperatorUser(ctx: AppContext): UserRow {
  const existing = ctx.store.get<UserRow>('SELECT * FROM users WHERE role = ? ORDER BY created_at LIMIT 1', 'operator');
  if (existing) return existing;
  const now = ctx.now().toISOString();
  ctx.store.run(
    'INSERT INTO users (id, role, display_name, created_at) VALUES (?, ?, ?, ?)',
    OPERATOR_USER_ID,
    'operator',
    'Whirr operator',
    now,
  );
  const created = ctx.store.get<UserRow>('SELECT * FROM users WHERE id = ?', OPERATOR_USER_ID);
  if (!created) throw new Error('Failed to create the operator account');
  return created;
}

function readCookie(req: FastifyRequest, name: string): string | null {
  const raw = req.cookies?.[name];
  if (!raw) return null;
  const unsigned = req.unsignCookie(raw);
  if (!unsigned.valid || !unsigned.value) return null;
  return unsigned.value;
}

export function getUserById(ctx: AppContext, id: string | null): UserRow | null {
  if (!id) return null;
  return ctx.store.get<UserRow>('SELECT * FROM users WHERE id = ?', id) ?? null;
}

export function getOperator(ctx: AppContext, req: FastifyRequest): UserRow | null {
  const id = readCookie(req, OPERATOR_COOKIE);
  const user = getUserById(ctx, id);
  return user && user.role === 'operator' ? user : null;
}

export function requireOperator(ctx: AppContext, req: FastifyRequest): UserRow {
  const operator = getOperator(ctx, req);
  if (!operator) throw errors.unauthorized('Operator access required');
  return operator;
}

export function getRenter(ctx: AppContext, req: FastifyRequest): UserRow | null {
  const id = readCookie(req, RENTER_COOKIE);
  const user = getUserById(ctx, id);
  return user && user.role === 'renter' ? user : null;
}

export function setOperatorCookie(ctx: AppContext, reply: FastifyReply, userId: string): void {
  reply.setCookie(OPERATOR_COOKIE, userId, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: ctx.config.cookieSecure,
    signed: true,
    maxAge: 60 * 60 * 24 * 30,
  });
}

export function clearOperatorCookie(ctx: AppContext, reply: FastifyReply): void {
  reply.clearCookie(OPERATOR_COOKIE, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: ctx.config.cookieSecure,
    signed: true,
  });
}

export function ensureRenter(ctx: AppContext, req: FastifyRequest, reply: FastifyReply, displayName?: string): UserRow {
  const existing = getRenter(ctx, req);
  if (existing) {
    if (displayName && displayName !== existing.display_name) {
      ctx.store.run('UPDATE users SET display_name = ? WHERE id = ?', displayName.slice(0, 60), existing.id);
    }
    return existing;
  }
  const id = `usr_rnr_${randomUUID().replace(/-/g, '')}`;
  const createdAt = ctx.now().toISOString();
  const name = displayName?.trim() || `Renter ${shortRef('r', id).slice(2, 8)}`;
  ctx.store.run(
    'INSERT INTO users (id, role, display_name, created_at) VALUES (?, ?, ?, ?)',
    id,
    'renter',
    name.slice(0, 60),
    createdAt,
  );
  reply.setCookie(RENTER_COOKIE, id, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: ctx.config.cookieSecure,
    signed: true,
    maxAge: 60 * 60 * 24 * 30,
  });
  const created = getUserById(ctx, id);
  if (!created) throw new Error('Failed to create renter identity');
  return created;
}

export function renterRef(id: string): string {
  return shortRef('rnr', id);
}

export function requestIpHash(req: FastifyRequest, secret: string): string {
  const ip = req.ip || 'unknown';
  return hmacRef(secret, 'ip', ip);
}

export function requestAgentHash(req: FastifyRequest, secret: string): string {
  return hmacRef(secret, 'ua', String(req.headers['user-agent'] ?? 'unknown'));
}
