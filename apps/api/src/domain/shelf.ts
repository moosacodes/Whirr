import type { AppContext } from '../context.ts';
import type { ObjectRow, UserRow } from './rows.ts';
import type { ShelfItem, ShelfView } from '../../../../packages/contracts/src/types.ts';
import { activeModel, activeTerms, modelSummary, serviceObjectView } from './objects.ts';
import { passportForObject } from './passport.ts';
import { holdViewFor } from './holds.ts';
import { errors } from '../lib/errors.ts';

export async function listShelf(ctx: AppContext): Promise<ShelfView> {
  const objects = ctx.store.all<ObjectRow>(
    'SELECT * FROM objects WHERE status = ? ORDER BY created_at DESC LIMIT 60',
    'ACTIVE',
  );
  const items: ShelfItem[] = [];
  for (const object of objects) {
    const model = activeModel(ctx, object);
    const terms = activeTerms(ctx, object);
    if (!model || !terms) continue;
    const listed = ctx.store.get<{ listed: number }>('SELECT listed FROM shelf_listings WHERE object_id = ?', object.id);
    if (listed?.listed === 0) continue;
    const owner = ctx.store.get<UserRow>('SELECT * FROM users WHERE id = ?', object.owner_id);
    let passportVersion: number | null = null;
    let drift = {
      status: 'NO_DATA' as const,
      reason: 'No passport has been generated yet.',
      sessions: 0,
      mismatchRatio: 0,
      uncertainRatio: 0,
      calibrationAgeDays: null as number | null,
    };
    try {
      const bundle = await passportForObject(ctx, object);
      passportVersion = bundle.envelope.payload.passportVersion;
      drift = bundle.drift as typeof drift;
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      // A shelf listing without a signature is still useful, but it must never
      // be presented as a signed passport.
    }
    const activeSession = Boolean(
      ctx.store.get<{ id: string }>(
        "SELECT id FROM sessions WHERE object_id = ? AND state IN ('READY','ACTIVE','PAUSED') LIMIT 1",
        object.id,
      ),
    );
    const ageDays = Math.max(0, Math.floor((ctx.now().getTime() - Date.parse(model.created_at)) / 86_400_000));
    items.push({
      object: serviceObjectView(object, owner ?? null),
      terms: terms ? { ...JSON.parse(terms.terms_json), id: terms.id, hash: terms.terms_hash } : null,
      model: modelSummary(model),
      calibrationAgeDays: ageDays,
      drift,
      passportVersion,
      signed: passportVersion !== null,
      activeSession,
      hold: holdViewFor(ctx, object.id),
    });
  }
  return { generatedAt: ctx.now().toISOString(), items };
}

export function requireShelfObject(ctx: AppContext, objectId: string): ObjectRow {
  const object = ctx.store.get<ObjectRow>('SELECT * FROM objects WHERE id = ?', objectId);
  if (!object || object.status !== 'ACTIVE') throw errors.notFound('This object is not on the shelf.');
  return object;
}
