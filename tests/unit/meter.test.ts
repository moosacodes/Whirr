import { describe, expect, it } from 'vitest';
import {
  DEFAULT_POLICY,
  type FramePrediction,
} from '../../packages/audio/src/classifier.ts';
import type { QualityFlag } from '../../packages/audio/src/spec.ts';
import { MeterStream, segmentPredictions } from '../../packages/audio/src/hysteresis.ts';
import { summariseIntervals } from '../../packages/meter/src/intervals.ts';

const POLICY = { ...DEFAULT_POLICY, activeThreshold: 0.7, activeMargin: 0.1, smoothing: 0.45, onFrames: 3, offFrames: 3 };

function prediction(
  index: number,
  pActive: number,
  flags: QualityFlag[] = [],
  frameMs = 100,
): FramePrediction {
  return {
    startMs: index * frameMs,
    endMs: (index + 1) * frameMs,
    pIdle: 1 - pActive,
    pActive,
    pOther: 0,
    flags,
  };
}

function run(steps: Array<{ count: number; pActive: number; flags?: QualityFlag[] }>): FramePrediction[] {
  const frames: FramePrediction[] = [];
  let index = 0;
  for (const step of steps) {
    for (let i = 0; i < step.count; i += 1) {
      frames.push(prediction(index, step.pActive, step.flags ?? []));
      index += 1;
    }
  }
  return frames;
}

describe('meter hysteresis', () => {
  it('does not enter ACTIVE until the configured consecutive strong frames', () => {
    const meter = new MeterStream(POLICY);
    meter.reset(0);
    const first = meter.push(prediction(0, 1));
    const second = meter.push(prediction(1, 1));
    expect(first).toHaveLength(0);
    expect(second).toHaveLength(0);
    expect(meter.currentState).toBe('UNCERTAIN');
    meter.push(prediction(2, 1));
    expect(meter.currentState).toBe('ACTIVE_CONFIDENT');
  });

  it('requires the off-frame count before leaving ACTIVE', () => {
    const meter = new MeterStream(POLICY);
    meter.reset(0);
    for (let i = 0; i < 3; i += 1) meter.push(prediction(i, 1));
    expect(meter.currentState).toBe('ACTIVE_CONFIDENT');
    meter.push(prediction(3, 0));
    meter.push(prediction(4, 0));
    expect(meter.currentState).not.toBe('ACTIVE_CONFIDENT');
    expect(meter.currentState).toBe('UNCERTAIN');
    meter.push(prediction(5, 0));
    expect(meter.currentState).toBe('IDLE');
  });

  it('never bills a clipped frame and splits the active interval', () => {
    const frames = run([
      { count: 4, pActive: 1 },
      { count: 2, pActive: 1, flags: ['CLIPPED'] },
      { count: 4, pActive: 1 },
    ]);
    const intervals = segmentPredictions(frames, POLICY);
    const summary = summariseIntervals(intervals);
    expect(summary.billableMs).toBeGreaterThan(0);
    expect(summary.uncertainMs).toBeGreaterThan(0);
    expect(summary.billableMs).toBeLessThan(frames.length * 100);
    expect(intervals.some((interval) => interval.state === 'UNCERTAIN')).toBe(true);
  });

  it('forces a DISCONNECTED interval instead of guessing through a gap', () => {
    const meter = new MeterStream(POLICY);
    meter.reset(0);
    for (let i = 0; i < 4; i += 1) meter.push(prediction(i, 1));
    const closed = meter.disconnect(700, 'DEVICE_LOST');
    expect(closed.some((interval) => interval.state === 'ACTIVE_CONFIDENT')).toBe(true);
    expect(meter.currentState).toBe('DISCONNECTED');
    const rest = meter.flush(1200);
    expect(rest).toHaveLength(1);
    expect(rest[0]!.state).toBe('DISCONNECTED');
    expect(summariseIntervals(rest).billableMs).toBe(0);
  });

  it('unions overlapping active intervals so they cannot double bill', () => {
    const summary = summariseIntervals([
      { startMs: 0, endMs: 1000, state: 'ACTIVE_CONFIDENT' },
      { startMs: 500, endMs: 1500, state: 'ACTIVE_CONFIDENT' },
    ]);
    expect(summary.billableMs).toBe(1500);
    expect(summary.overlaps).toBe(true);
  });
});
