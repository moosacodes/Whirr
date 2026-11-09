import type { AppContext } from '../context.ts';
import type { TakeRow } from './rows.ts';
import type { CalibrationPreview } from '../../../../packages/contracts/src/types.ts';
import { buildSoundprint } from '../../../../packages/audio/src/soundprint.ts';
import { DISQUALIFYING_FLAGS } from '../../../../packages/audio/src/spec.ts';

/**
 * A pre-training view of the enrolled spectral profile. This uses calibration
 * frames only: it can warn that idle and active takes are too similar, but it
 * is not held-out validation and does not predict field accuracy.
 */
export function calibrationPreviewFor(ctx: AppContext, objectId: string): CalibrationPreview {
  const roles = new Set(
    ctx.store
      .all<{ take_id: string }>("SELECT take_id FROM take_roles WHERE role = 'VALIDATION'")
      .map((row) => row.take_id),
  );
  const takes = ctx.store.all<TakeRow>(
    'SELECT * FROM calibration_takes WHERE object_id = ? ORDER BY created_at ASC',
    objectId,
  ).filter((take) => !roles.has(take.id));
  const activeFrames: number[][] = [];
  const nonActiveFrames: number[][] = [];
  let activeTakes = 0;
  let nonActiveTakes = 0;
  for (const take of takes) {
    const frames = JSON.parse(take.frames_json) as number[][];
    const flags = JSON.parse(take.frame_flags_json) as string[][];
    const usable = frames.filter((_, index) =>
      (flags[index] ?? []).every((flag) => !(DISQUALIFYING_FLAGS as readonly string[]).includes(flag)),
    );
    if (usable.length < 30) continue;
    const step = Math.max(1, Math.floor(usable.length / 800));
    const sampled = usable.filter((_, index) => index % step === 0);
    if (take.label === 'active') {
      activeTakes += 1;
      activeFrames.push(...sampled);
    } else {
      nonActiveTakes += 1;
      nonActiveFrames.push(...sampled);
    }
  }
  const soundprint = buildSoundprint(activeFrames, nonActiveFrames, activeTakes);
  if (!soundprint) {
    return {
      status: 'NOT_ENOUGH_DATA',
      detail: 'Record at least two active takes and two idle/different-sound takes with 30 usable frames each to preview the passport.',
      activeTakes,
      nonActiveTakes,
      soundprint: null,
    };
  }
  if (!soundprint.gateEnabled) {
    return {
      status: 'TOO_SIMILAR',
      detail: `These takes sound too similar: active and non-active profiles separate by only ${(soundprint.separation * 100).toFixed(1)} points. The passport would be WEAK and disabled. Record a clearer idle room, a different running condition, or a contrasting sound.`,
      activeTakes,
      nonActiveTakes,
      soundprint,
    };
  }
  return {
    status: 'SEPARABLE',
    detail: `The active profile separates from idle/different-sound by ${(soundprint.separation * 100).toFixed(1)} points at calibration fit. This preview is not held-out validation.`,
    activeTakes,
    nonActiveTakes,
    soundprint,
  };
}