export const METER_STATES = ['ACTIVE_CONFIDENT', 'IDLE', 'UNCERTAIN', 'DISCONNECTED'] as const;
export type MeterState = (typeof METER_STATES)[number];

export const MAX_INTERVAL_MS = 10 * 60 * 1000;
export const MAX_INTERVALS_PER_SESSION = 5_000;

export interface RawInterval {
  id?: string;
  startMs: number;
  endMs: number;
  state: MeterState;
  confidence?: number;
  qualityFlags?: string[];
  modelVersion?: string;
}

export interface TimelineSummary {
  billableMs: number;
  idleMs: number;
  uncertainMs: number;
  disconnectedMs: number;
  observedMs: number;
  byState: Record<MeterState, number>;
  overlaps: boolean;
  invalid: number;
  gapCount: number;
  mergedBillable: Array<{ startMs: number; endMs: number }>;
}

export function isMeterState(value: unknown): value is MeterState {
  return typeof value === 'string' && (METER_STATES as readonly string[]).includes(value);
}

/** Returns a human-readable problem, or null when the interval is acceptable. */
export function validateInterval(
  interval: unknown,
  opts: { maxEndMs?: number; lastEndMs?: number; maxDurationMs?: number } = {},
): string | null {
  if (!interval || typeof interval !== 'object') return 'Interval must be an object';
  const value = interval as Partial<RawInterval>;
  if (!Number.isSafeInteger(value.startMs) || !Number.isSafeInteger(value.endMs)) {
    return 'startMs and endMs must be safe integers';
  }
  if ((value.startMs as number) < 0) return 'startMs must be non-negative';
  if ((value.endMs as number) <= (value.startMs as number)) return 'endMs must be after startMs';
  if (!isMeterState(value.state)) return 'Unknown meter state';
  const duration = (value.endMs as number) - (value.startMs as number);
  if (duration > (opts.maxDurationMs ?? MAX_INTERVAL_MS)) return 'Interval exceeds the maximum duration';
  if (opts.maxEndMs !== undefined && (value.endMs as number) > opts.maxEndMs) {
    return 'Interval ends after the authoritative session clock';
  }
  if (opts.lastEndMs !== undefined && (value.startMs as number) < opts.lastEndMs) {
    return 'Interval overlaps or precedes previously accepted evidence';
  }
  if (value.confidence !== undefined) {
    if (typeof value.confidence !== 'number' || !Number.isFinite(value.confidence)) {
      return 'confidence must be a finite number';
    }
    if (value.confidence < 0 || value.confidence > 1) return 'confidence must be within 0..1';
  }
  if (value.qualityFlags !== undefined) {
    if (!Array.isArray(value.qualityFlags) || value.qualityFlags.length > 8) {
      return 'qualityFlags must be an array of at most 8 strings';
    }
    if (!value.qualityFlags.every((flag) => typeof flag === 'string' && flag.length <= 40)) {
      return 'qualityFlags must contain short strings';
    }
  }
  if (value.modelVersion !== undefined && typeof value.modelVersion !== 'string') {
    return 'modelVersion must be a string';
  }
  return null;
}

export function mergeSegments(
  segments: Array<{ startMs: number; endMs: number }>,
): Array<{ startMs: number; endMs: number }> {
  if (segments.length === 0) return [];
  const sorted = [...segments].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  const merged: Array<{ startMs: number; endMs: number }> = [];
  for (const segment of sorted) {
    const last = merged[merged.length - 1];
    if (!last || segment.startMs > last.endMs) {
      merged.push({ startMs: segment.startMs, endMs: segment.endMs });
    } else if (segment.endMs > last.endMs) {
      last.endMs = segment.endMs;
    }
  }
  return merged;
}

export function totalMs(segments: Array<{ startMs: number; endMs: number }>): number {
  return segments.reduce((sum, s) => sum + (s.endMs - s.startMs), 0);
}

/**
 * Authoritative timeline arithmetic. Overlapping intervals are never double
 * billed: each state's coverage is unioned before summing. Invalid intervals
 * are counted and excluded.
 */
export function summariseIntervals(intervals: RawInterval[]): TimelineSummary {
  const byState: Record<MeterState, Array<{ startMs: number; endMs: number }>> = {
    ACTIVE_CONFIDENT: [],
    IDLE: [],
    UNCERTAIN: [],
    DISCONNECTED: [],
  };
  let invalid = 0;
  const all: Array<{ startMs: number; endMs: number }> = [];

  for (const interval of intervals) {
    if (validateInterval(interval, { maxDurationMs: 24 * 60 * 60 * 1000 }) !== null) {
      invalid += 1;
      continue;
    }
    const segment = { startMs: interval.startMs, endMs: interval.endMs };
    byState[interval.state].push(segment);
    all.push(segment);
  }

  const merged: Record<MeterState, Array<{ startMs: number; endMs: number }>> = {
    ACTIVE_CONFIDENT: mergeSegments(byState.ACTIVE_CONFIDENT),
    IDLE: mergeSegments(byState.IDLE),
    UNCERTAIN: mergeSegments(byState.UNCERTAIN),
    DISCONNECTED: mergeSegments(byState.DISCONNECTED),
  };
  const mergedAll = mergeSegments(all);

  // Overlap detection: any two input intervals of different states intersect.
  const sorted = [...all].sort((a, b) => a.startMs - b.startMs);
  let overlaps = false;
  let furthestEnd = -1;
  for (const segment of sorted) {
    if (segment.startMs < furthestEnd) {
      overlaps = true;
      break;
    }
    furthestEnd = Math.max(furthestEnd, segment.endMs);
  }
  // Same-state duplicates also count as overlapping evidence.
  if (!overlaps) {
    for (const state of METER_STATES) {
      const stateSegments = [...byState[state]].sort((a, b) => a.startMs - b.startMs);
      let end = -1;
      for (const segment of stateSegments) {
        if (segment.startMs < end) {
          overlaps = true;
          break;
        }
        end = Math.max(end, segment.endMs);
      }
      if (overlaps) break;
    }
  }

  return {
    billableMs: totalMs(merged.ACTIVE_CONFIDENT),
    idleMs: totalMs(merged.IDLE),
    uncertainMs: totalMs(merged.UNCERTAIN),
    disconnectedMs: totalMs(merged.DISCONNECTED),
    observedMs: totalMs(mergedAll),
    byState: {
      ACTIVE_CONFIDENT: totalMs(merged.ACTIVE_CONFIDENT),
      IDLE: totalMs(merged.IDLE),
      UNCERTAIN: totalMs(merged.UNCERTAIN),
      DISCONNECTED: totalMs(merged.DISCONNECTED),
    },
    overlaps,
    invalid,
    gapCount: Math.max(0, mergedAll.length - 1),
    mergedBillable: merged.ACTIVE_CONFIDENT,
  };
}

/** Splits active intervals into the exact segments used for billing display. */
export function billableSegments(intervals: RawInterval[]): Array<{ startMs: number; endMs: number }> {
  return mergeSegments(
    intervals.filter((i) => i.state === 'ACTIVE_CONFIDENT').map(({ startMs, endMs }) => ({ startMs, endMs })),
  );
}
