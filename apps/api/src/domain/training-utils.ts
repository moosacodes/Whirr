import { hashCanonical } from '../lib/hash.ts';
import { FEATURE_SPEC_VERSION } from '../../../../packages/audio/src/spec.ts';

export const FRAME_SPEC_VERSION_CHECK = FEATURE_SPEC_VERSION;

export function takeContentHash(input: {
  label: string;
  frames: number[][];
  frameFlags: string[][];
  durationMs: number;
  featureSpecVersion: string;
}): string {
  return hashCanonical({
    schema: 'whirr.take.v1',
    label: input.label,
    frames: input.frames,
    frameFlags: input.frameFlags,
    durationMs: input.durationMs,
    featureSpecVersion: input.featureSpecVersion,
  });
}
