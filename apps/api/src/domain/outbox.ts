import type { AppContext } from '../context.ts';
import { newId } from '../lib/ids.ts';

export function enqueueOutbox(
  ctx: AppContext,
  topic: string,
  payload: Record<string, unknown>,
  delayMs = 0,
): string {
  const id = newId('out');
  const now = ctx.now();
  ctx.store.run(
    `INSERT INTO outbox (id, topic, payload_json, attempts, next_attempt_at, processed_at, last_error, created_at)
     VALUES (?, ?, ?, 0, ?, NULL, NULL, ?)`,
    id,
    topic,
    JSON.stringify(payload),
    new Date(now.getTime() + delayMs).toISOString(),
    now.toISOString(),
  );
  return id;
}
