import { z } from 'zod';
import { FEATURE_COUNT, FEATURE_SPEC_VERSION, QUALITY_FLAGS } from '../../audio/src/spec.ts';
import { SUPPORTED_CURRENCIES } from '../../meter/src/currency.ts';
import { PROMISE_EVENTS, REPORTING_STATES } from '../../promise/src/types.ts';
import { TAKE_LABELS } from './types.ts';

const hash64 = z.string().regex(/^[a-f0-9]{64}$/, 'Expected a 64-character lowercase hex hash');
const featureVectorSchema = z.array(z.number().finite()).length(FEATURE_COUNT);

export const promiseDemoUploadSchema = z
  .object({
    label: z.enum(TAKE_LABELS as unknown as [string, ...string[]]),
    frames: z.array(featureVectorSchema).min(1).max(4_000),
    frameFlags: z.array(z.array(z.enum(QUALITY_FLAGS as unknown as [string, ...string[]])).max(8)).max(4_000).optional(),
    durationMs: z.number().int().min(1_000).max(180_000),
    featureSpecVersion: z.literal(FEATURE_SPEC_VERSION),
    source: z.enum(['live', 'import']),
    deviceLabel: z.string().trim().max(120).nullable().optional(),
    notes: z.string().trim().max(400).nullable().optional(),
    sessionGroup: z.string().trim().min(1).max(120),
  })
  .superRefine((value, ctx) => {
    if (value.frameFlags && value.frameFlags.length !== value.frames.length) {
      ctx.addIssue({ code: 'custom', message: 'frameFlags must match frames', path: ['frameFlags'] });
    }
  });

export const eventTrainSchema = z.object({
  objectId: z.string().min(8).max(80),
  version: z.string().trim().min(1).max(60).optional(),
});

export const promiseCompileSchema = z.object({
  objectId: z.string().min(8).max(80),
  eventModelId: z.string().min(8).max(80),
  serviceName: z.string().trim().min(2).max(80),
  text: z.string().trim().min(10).max(800),
});

export const promisePublishSchema = promiseCompileSchema.extend({
  termsHash: hash64,
  approved: z.literal(true),
  /** The exact browser-reviewed draft. The server recompiles at its original clock and compares hashes. */
  terms: z.unknown().optional(),
});

export const promiseExecutionCreateSchema = z.object({
  termsHash: hash64,
  accepted: z.literal(true),
  demo: z.boolean().default(false),
  observationMode: z.enum(['LIVE', 'REPLAY']).default('LIVE'),
});

export const promiseObservationItemSchema = z.object({
  seq: z.number().int().min(1).max(50_000),
  startMs: z.number().int().min(0).max(30 * 24 * 60 * 60 * 1000),
  endMs: z.number().int().min(1).max(30 * 24 * 60 * 60 * 1000),
  state: z.enum(REPORTING_STATES as unknown as [string, ...string[]]),
  confidence: z.number().finite().min(0).max(1),
  qualityFlags: z.array(z.enum(QUALITY_FLAGS as unknown as [string, ...string[]])).max(8).default([]),
  eventMatch: z.number().finite().min(0).max(1).optional(),
});

export const promiseObservationBatchSchema = z.object({
  clientSeq: z.number().int().min(1).max(1_000_000),
  intervals: z.array(promiseObservationItemSchema).min(1).max(200),
});

export const promiseStopSchema = z.object({
  reason: z.enum(['COMPLETED', 'INTERRUPTED', 'SENSOR_LOST', 'USER_STOP']).optional(),
});

export const promiseEventSchema = z.enum(PROMISE_EVENTS as unknown as [string, ...string[]]);

export type PromiseDemoUploadInput = z.infer<typeof promiseDemoUploadSchema>;
export type PromiseCompileInput = z.infer<typeof promiseCompileSchema>;
export type PromisePublishInput = z.infer<typeof promisePublishSchema>;
export type PromiseExecutionCreateInput = z.infer<typeof promiseExecutionCreateSchema>;
export type PromiseObservationBatchInput = z.infer<typeof promiseObservationBatchSchema>;
