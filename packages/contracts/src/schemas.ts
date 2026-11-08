import { z } from 'zod';
import { FEATURE_COUNT, FEATURE_SPEC_VERSION, QUALITY_FLAGS } from '../../audio/src/spec.ts';
import { SUPPORTED_CURRENCIES } from '../../meter/src/currency.ts';
import { METER_STATES } from '../../meter/src/intervals.ts';
import { OBJECT_CATEGORIES, OBJECT_GLYPHS, TAKE_LABELS, TAKE_ROLES } from './types.ts';

const finiteNumber = z.number().finite();
const hash64 = z.string().regex(/^[a-f0-9]{64}$/, 'Expected a 64-character lowercase hex hash');

export const featureVectorSchema = z.array(finiteNumber).length(FEATURE_COUNT);
export const qualityFlagSchema = z.enum(QUALITY_FLAGS as unknown as [string, ...string[]]);

export const objectCreateSchema = z.object({
  name: z.string().trim().min(2).max(60),
  category: z.enum(OBJECT_CATEGORIES as unknown as [string, ...string[]]),
  glyph: z.enum(OBJECT_GLYPHS as unknown as [string, ...string[]]),
  description: z.string().trim().max(280).default(''),
  photoDataUrl: z
    .string()
    .max(350_000)
    .regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/, 'Photo must be a small PNG, JPEG or WebP data URL')
    .nullable()
    .optional(),
});

export const objectRevokeSchema = z.object({
  revoked: z.boolean(),
});

export const takeUploadSchema = z
  .object({
    label: z.enum(TAKE_LABELS as unknown as [string, ...string[]]),
    frames: z.array(featureVectorSchema).min(1).max(3_000),
    frameFlags: z.array(z.array(qualityFlagSchema).max(8)).max(3_000).optional(),
    durationMs: z.number().int().min(500).max(120_000),
    source: z.enum(['live', 'import']),
    deviceLabel: z.string().trim().max(120).nullable().optional(),
    notes: z.string().trim().max(400).nullable().optional(),
    featureSpecVersion: z.literal(FEATURE_SPEC_VERSION),
    role: z.enum(TAKE_ROLES as unknown as [string, ...string[]]).default('TRAINING'),
  })
  .superRefine((value, ctx) => {
    if (value.frameFlags && value.frameFlags.length !== value.frames.length) {
      ctx.addIssue({
        code: 'custom',
        message: 'frameFlags length must equal frames length',
        path: ['frameFlags'],
      });
    }
  });

export const termsPublishSchema = z
  .object({
    currency: z.enum(SUPPORTED_CURRENCIES as unknown as [string, ...string[]]),
    minorPerMinute: z.number().int().min(1).max(100_000),
    capMinor: z.number().int().min(1).max(10_000_000),
    fairnessReserveMinor: z.number().int().min(0).max(1_000_000).default(0),
    acknowledgeSandbox: z.literal(true),
  })
  .superRefine((value, ctx) => {
    if (value.capMinor < value.minorPerMinute) {
      ctx.addIssue({
        code: 'custom',
        message: 'Cap must be at least the price of one billable minute',
        path: ['capMinor'],
      });
    }
    if (value.fairnessReserveMinor > Math.floor(value.capMinor * 0.1)) {
      ctx.addIssue({
        code: 'custom',
        message: 'The fairness reserve may not exceed 10% of the cap',
        path: ['fairnessReserveMinor'],
      });
    }
  });

export const sessionCreateSchema = z.object({
  objectId: z.string().min(8).max(80),
});

export const consentSchema = z.object({
  termsHash: hash64,
  accepted: z.literal(true),
  displayName: z.string().trim().max(60).optional(),
});

export const intervalItemSchema = z.object({
  startMs: z.number().int().min(0).max(30 * 24 * 60 * 60 * 1000),
  endMs: z.number().int().min(1).max(30 * 24 * 60 * 60 * 1000),
  state: z.enum(METER_STATES as unknown as [string, ...string[]]),
  confidence: z.number().finite().min(0).max(1).optional(),
  qualityFlags: z.array(qualityFlagSchema).max(8).optional(),
  modelVersion: z.string().min(1).max(80),
  explanation: z
    .object({
      schema: z.literal('whirr.explanation.v1'),
      passportScore: z.number().finite().min(0).max(1).nullable(),
      topFeatures: z
        .array(
          z.object({
            name: z.string().max(80),
            value: z.number().finite(),
            contribution: z.number().finite(),
          }),
        )
        .max(3),
      summary: z.string().max(240),
    })
    .optional(),
});

export const intervalBatchSchema = z.object({
  token: z.string().min(20).max(4_000),
  clientSeq: z.number().int().min(1).max(1_000_000),
  intervals: z.array(intervalItemSchema).min(1).max(200),
});

export const pauseSchema = z.object({
  reason: z.enum(['USER_PAUSE', 'TAB_HIDDEN', 'DEVICE_LOST', 'SENSOR_ERROR']),
});

export const disputeSchema = z.object({
  intervalIds: z.array(z.string().min(4).max(80)).min(1).max(50),
  reason: z.string().trim().min(10).max(600),
  reasonCode: z
    .enum(['WRONG_OBJECT', 'NOT_RUNNING', 'TOO_NOISY', 'WRONG_INTERVAL', 'OTHER'])
    .default('OTHER'),
});

export const disputeResolveSchema = z.object({
  status: z.enum(['RESOLVED', 'REJECTED']),
  creditMinor: z.number().int().min(0).max(10_000_000).default(0),
  resolution: z.string().trim().min(3).max(600),
});

export const reviewAcceptSchema = z.object({
  quoteHash: hash64,
  accepted: z.literal(true),
});

export const refundSchema = z.object({
  amountMinor: z.number().int().min(1).max(10_000_000).optional(),
});

export const operatorCreditSchema = z.object({
  creditMinor: z.number().int().min(1).max(10_000_000),
  reason: z.string().trim().min(5).max(600),
});

export const operatorLoginSchema = z.object({
  key: z.string().min(16).max(256),
});

export const paypalReturnSchema = z.object({
  token: z.string().min(4).max(80).optional(),
  payerId: z.string().max(80).optional(),
});

export type ObjectCreateInput = z.infer<typeof objectCreateSchema>;
export type TakeUploadInput = z.infer<typeof takeUploadSchema>;
export type TermsPublishInput = z.infer<typeof termsPublishSchema>;
export type IntervalBatchInput = z.infer<typeof intervalBatchSchema>;
export type ConsentInput = z.infer<typeof consentSchema>;
export type DisputeInput = z.infer<typeof disputeSchema>;
export type ReviewAcceptInput = z.infer<typeof reviewAcceptSchema>;

export const takeRoleUpdateSchema = z.object({
  role: z.enum(TAKE_ROLES as unknown as [string, ...string[]]),
});

export const preflightSchema = z.object({
  status: z.enum(['READY', 'NOISY', 'UNSTABLE', 'NO_SIGNAL']),
  frameCount: z.number().int().min(0).max(3_000),
  durationMs: z.number().int().min(0).max(30_000),
  noiseFloorLogRms: z.number().finite().nullable(),
  levelVariance: z.number().finite().min(0),
  clippedRatio: z.number().finite().min(0).max(1),
  silentRatio: z.number().finite().min(0).max(1),
  flags: z.array(qualityFlagSchema).max(12),
  detail: z.string().trim().min(3).max(300),
});

export const shelfListingSchema = z.object({
  listed: z.boolean(),
});

export const fairnessReserveSchema = z.object({});
