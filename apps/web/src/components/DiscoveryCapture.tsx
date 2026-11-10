import { useCallback, useEffect, useRef, useState } from 'react';
import type { DiscoveryCaptureView } from '../../../../packages/contracts/src/types.ts';
import { MicrophoneEngine, type CapturedFrame } from '../lib/audio.ts';
import { FRAME_MS } from '../../../../packages/audio/src/spec.ts';
import { Button } from './ui.tsx';
import { Icon } from './visuals.tsx';

export interface DiscoveryCaptureSample {
  frames: number[][];
  frameFlags: string[][];
  durationMs: number;
  sampleRate: number;
  capturedAt: string;
  deviceLabel: string | null;
  capture: DiscoveryCaptureView;
}

type CaptureState = 'IDLE' | 'REQUESTING' | 'RECORDING' | 'PROCESSING';

function signalNormalise(value: number): number {
  return Math.max(0, Math.min(1, (value + 8) / 8));
}

function Trace({ levels, live }: { levels: number[]; live: boolean }) {
  const width = 640;
  const height = 92;
  const points = levels
    .map((value, index) => {
      const x = levels.length > 1 ? (index / (levels.length - 1)) * width : width / 2;
      const y = height / 2 - (signalNormalise(value) - 0.5) * (height - 12);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <div className={`discover-trace${live ? ' is-live' : ''}`}>
      <div className="discover-trace__head">
        <span className="mono tiny">
          <span className={`live-dot${live ? ' is-live' : ''}`} aria-hidden="true" />{' '}
          {live ? 'MIC OPEN · LIVE INPUT' : 'MIC CLOSED'}
        </span>
        <span className="mono tiny muted">{live ? `${levels.length} frames` : 'no signal'}</span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={live ? 'Actual live microphone trace' : 'Microphone closed'}>
        <line className="discover-trace__axis" x1="0" y1={height / 2} x2={width} y2={height / 2} />
        {live && points ? <polyline className="discover-trace__line" points={points} /> : null}
        {!live ? <line className="discover-trace__closed" x1="0" y1={height / 2} x2={width} y2={height / 2} /> : null}
      </svg>
      <p className="tiny muted" style={{ margin: 0 }}>
        {live
          ? 'This trace is the browser’s actual capture. Only frozen feature frames are sent; raw audio stays on this device.'
          : 'No audio is being captured. The microphone opens only when you press record.'}
      </p>
    </div>
  );
}

export function DiscoveryCapture({
  title,
  instruction,
  buttonLabel = 'Open microphone and listen',
  durationMs = 6_000,
  onCapture,
  disabled = false,
  compact = false,
}: {
  title: string;
  instruction: string;
  buttonLabel?: string;
  durationMs?: number;
  onCapture: (sample: DiscoveryCaptureSample) => Promise<void> | void;
  disabled?: boolean;
  compact?: boolean;
}) {
  const [status, setStatus] = useState<CaptureState>('IDLE');
  const [elapsedMs, setElapsedMs] = useState(0);
  const [levels, setLevels] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const engineRef = useRef<MicrophoneEngine | null>(null);
  const framesRef = useRef<CapturedFrame[]>([]);
  const levelsRef = useRef<number[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAtRef = useRef(0);
  const finishingRef = useRef(false);
  const mountedRef = useRef(true);
  const captureIdRef = useRef(0);

  const teardown = useCallback(async () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    const engine = engineRef.current;
    engineRef.current = null;
    if (engine) await engine.stop();
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      captureIdRef.current += 1;
      void teardown();
    };
  }, [teardown]);

  const finish = useCallback(async () => {
    if (finishingRef.current) return;
    finishingRef.current = true;
    const id = captureIdRef.current;
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    const engine = engineRef.current;
    engineRef.current = null;
    const deviceLabel = engine?.deviceLabel ?? null;
    const sampleRate = engine?.sampleRate ?? 0;
    if (engine) await engine.stop();
    const frames = framesRef.current;
    if (!mountedRef.current || id !== captureIdRef.current) {
      finishingRef.current = false;
      return;
    }
    setLevels([]);
    if (frames.length < 30 || sampleRate < 8_000) {
      setStatus('IDLE');
      setError('The capture was too short or the microphone did not provide usable frames. Try again.');
      finishingRef.current = false;
      return;
    }
    const first = frames[0]!;
    const last = frames[frames.length - 1]!;
    const duration = Math.max(2_000, Math.round(last.endMs - first.endMs + FRAME_MS));
    const capturedAt = new Date(startedAtRef.current || Date.now()).toISOString();
    const frameFlags = frames.map((frame) => [...frame.flags]);
    const sample: DiscoveryCaptureSample = {
      frames: frames.map((frame) => frame.features),
      frameFlags,
      durationMs: Math.min(30_000, duration),
      sampleRate,
      capturedAt,
      deviceLabel,
      capture: {
        schema: 'whirr.capture-claim.v1',
        provenance: 'CLIENT_CLAIMED_LIVE_MICROPHONE',
        claimedAt: capturedAt,
        deviceLabel,
        sampleRate,
        permission: 'GRANTED',
        frameCount: frames.length,
        note: 'Live browser microphone capture; raw audio was not uploaded or stored.',
      },
    };
    setStatus('PROCESSING');
    setError(null);
    setNotice(null);
    try {
      await onCapture(sample);
      if (mountedRef.current) {
        setNotice(`Captured ${frames.length} frames (${(duration / 1000).toFixed(1)} s).`);
        setStatus('IDLE');
      }
    } catch (caught) {
      if (mountedRef.current) {
        setStatus('IDLE');
        setError(caught instanceof Error ? caught.message : 'The capture could not be processed.');
      }
    } finally {
      finishingRef.current = false;
    }
  }, [onCapture]);

  const finishRef = useRef(finish);
  finishRef.current = finish;

  const start = async () => {
    if (disabled || status !== 'IDLE') return;
    setError(null);
    setNotice(null);
    setStatus('REQUESTING');
    framesRef.current = [];
    levelsRef.current = [];
    setLevels([]);
    setElapsedMs(0);
    captureIdRef.current += 1;
    const id = captureIdRef.current;
    const engine = new MicrophoneEngine({
      onFrame: (frame) => {
        framesRef.current.push(frame);
        levelsRef.current.push(frame.features[0] ?? -8);
        if (framesRef.current.length % 3 === 0 && mountedRef.current) {
          setLevels(levelsRef.current.slice(-120));
        }
      },
      onError: (message) => {
        if (mountedRef.current) setError(message);
      },
      onEnded: () => {
        if (mountedRef.current && !finishingRef.current) void finishRef.current();
      },
    });
    engineRef.current = engine;
    try {
      await engine.start();
      if (!mountedRef.current || id !== captureIdRef.current) {
        await engine.stop();
        return;
      }
      startedAtRef.current = Date.now();
      setStatus('RECORDING');
      timerRef.current = setInterval(() => {
        const elapsed = Date.now() - startedAtRef.current;
        if (mountedRef.current) setElapsedMs(Math.min(durationMs, elapsed));
        if (elapsed >= durationMs) void finishRef.current();
      }, 100);
    } catch (caught) {
      engineRef.current = null;
      await engine.stop();
      if (mountedRef.current) {
        setStatus('IDLE');
        setError(caught instanceof Error ? caught.message : 'Microphone capture could not start.');
      }
    }
  };

  const live = status === 'RECORDING';
  const progress = Math.min(1, elapsedMs / durationMs);
  const remaining = Math.max(0, Math.ceil((durationMs - elapsedMs) / 1000));

  return (
    <div className={`discover-capture${compact ? ' discover-capture--compact' : ''}`}>
      <div className="row row--between" style={{ alignItems: 'flex-start' }}>
        <div className="stack" style={{ gap: '0.2rem' }}>
          <span className="eyebrow">Guided live capture</span>
          <h3 className="h3">{title}</h3>
        </div>
        <span className={`chip${live ? ' chip--ok' : ''}`}>
          <span className={`live-dot${live ? ' is-live' : ''}`} aria-hidden="true" /> {live ? 'Listening' : 'Mic closed'}
        </span>
      </div>
      <p className="small muted">{instruction}</p>
      <Trace levels={live ? levels : []} live={live} />
      <div className="discover-progress" aria-hidden="true">
        <span style={{ width: `${progress * 100}%` }} />
      </div>
      <div className="row row--between">
        <span className="mono tiny muted">
          {live ? `${remaining}s remaining · ${framesRef.current.length} frames` : `${(durationMs / 1000).toFixed(0)} second take`}
        </span>
        <Button
          type="button"
          variant={live ? 'danger' : 'primary'}
          onClick={() => (live ? void finish() : void start())}
          loading={status === 'REQUESTING' || status === 'PROCESSING'}
          disabled={disabled || status === 'PROCESSING' || status === 'REQUESTING'}
        >
          <Icon name={live ? 'stop' : 'mic'} size={16} />
          {live ? 'Stop & use this take' : buttonLabel}
        </Button>
      </div>
      {notice ? <p className="tiny" style={{ color: 'var(--ok)', margin: 0 }}>{notice}</p> : null}
      {error ? <p className="tiny" role="alert" style={{ color: 'var(--danger)', margin: 0 }}>{error}</p> : null}
    </div>
  );
}
