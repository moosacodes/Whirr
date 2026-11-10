import { z } from 'zod';
import { SUPPORTED_CURRENCIES } from '../../meter/src/currency.ts';
import { SOURCE_STATES } from '../../ambient-engine/src/types.ts';

const hash64 = z.string().regex(/^[a-f0-9]{64}$/, 'Expected a 64-character lowercase hex hash');

export const ambientWishSchema = z.object({
  objectId: z.string().min(8).max(80),
  text: z.string().trim().min(10).max(800),
  durationSeconds: z.number().int().min(10).max(120).default(30),
  fixedPriceMinor: z.number().int().min(1).max(10_000).default(200),
  currency: z.enum(SUPPORTED_CURRENCIES as unknown as [string, ...string[]]).default('USD'),
});

export const ambientOfferSchema = z.object({
  termsHash: hash64,
  approved: z.literal(true),
});

export const ambientRespondSchema = z.object({
  action: z.enum(['ACCEPT', 'COUNTER', 'REJECT']),
  termsHash: hash64,
  priceMinor: z.number().int().min(1).max(10_000).optional(),
  durationSeconds: z.number().int().min(10).max(120).optional(),
  note: z.string().trim().max(400).nullable().optional(),
});

export const ambientBuyerDecisionSchema = z.object({
  action: z.enum(['ACCEPT', 'REJECT']),
  termsHash: hash64,
});

export const ambientSessionCreateSchema = z.object({
  demo: z.boolean().default(false),
  observationMode: z.enum(['LIVE', 'REPLAY']).default('LIVE'),
});

export const ambientObservationItemSchema = z.object({
  seq: z.number().int().min(1).max(50_000),
  startMs: z.number().int().min(0).max(15 * 60_000),
  endMs: z.number().int().min(1).max(15 * 60_000),
  sourceState: z.enum(SOURCE_STATES as unknown as [string, ...string[]]),
  confidence: z.number().finite().min(0).max(1),
  qualityFlags: z.array(z.string().trim().min(1).max(64)).max(8).default([]),
  eventMatch: z.number().finite().min(0).max(1).optional(),
});

export const ambientObservationBatchSchema = z.object({
  clientSeq: z.number().int().min(1).max(1_000_000),
  intervals: z.array(ambientObservationItemSchema).min(1).max(200),
});

export const ambientStopSchema = z.object({
  reason: z.enum(['COMPLETED', 'WINDOW_QUALIFIED', 'INTERRUPTED', 'SENSOR_LOST', 'USER_STOP']).optional(),
});

export const ambientAcceptanceSchema = z.object({
  accepted: z.boolean(),
  termsHash: hash64,
  note: z.string().trim().max(400).nullable().optional(),
});

export const ambientCaptureSchema = z.object({
  confirmed: z.literal(true),
  termsHash: hash64,
});

export const ambientVoidSchema = z.object({
  reason: z.string().trim().max(240).optional(),
});

export type AmbientWishInput = z.infer<typeof ambientWishSchema>;
export type AmbientOfferInput = z.infer<typeof ambientOfferSchema>;
export type AmbientRespondInput = z.infer<typeof ambientRespondSchema>;
export type AmbientBuyerDecisionInput = z.infer<typeof ambientBuyerDecisionSchema>;
export type AmbientSessionCreateInput = z.infer<typeof ambientSessionCreateSchema>;
export type AmbientObservationBatchInput = z.infer<typeof ambientObservationBatchSchema>;
export type AmbientAcceptanceInput = z.infer<typeof ambientAcceptanceSchema>;
