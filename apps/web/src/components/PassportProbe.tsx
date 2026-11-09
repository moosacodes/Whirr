import { useEffect, useRef, useState } from 'react';
import type { Soundprint } from '../../../../packages/audio/src/soundprint.ts';
import { soundprintScore } from '../../../../packages/audio/src/soundprint.ts';
import { Button, Notice } from './ui.tsx';
import { Icon, Waveform } from './visuals.tsx';
import { MicrophoneEngine, type CapturedFrame } from '../lib/audio.ts';
import { percent } from '../lib/format.ts';

const WINDOW_FRAMES = 18;
const MIN_FRAMES = 10;
const QUIET_FLAGS = new Set(['SILENT', 'LOW_LEVEL', 'CLIPPED']);

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

type ProbeStatus = 'idle' | 'starting' | 'listening';

export function PassportProbe({
  soundprint,
  objectName,
}: {
  soundprint: Soundprint | null;
  objectName: string;
}) {
  const engineRef = useRef<MicrophoneEngine | null>(null);
  const startGuardRef = useRef<AbortController | null>(null);
  const startTimerRef = useRef<number | null>(null);
  const [status, setStatus] = useState<ProbeStatus>('idle');
  const [scores, setScores] = useState<number[]>([]);
  const [level, setLevel] = useState(0);
  const [quiet, setQuiet] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(
    () => () => {
      startGuardRef.current?.abort();
      startGuardRef.current = null;
      if (startTimerRef.current !== null) window.clearTimeout(startTimerRef.current);
      startTimerRef.current = null;
      void engineRef.current?.stop();
      engineRef.current = null;
    },
    [],
  );

  if (!soundprint) return null;

  const score = scores.length ? median(scores) : null;
  const threshold = soundprint.gateEnabled ? soundprint.matchThreshold : 0.5;
  const ready = scores.length >= MIN_FRAMES;
  const matches = ready && (score ?? 0) >= threshold;
  const verdict = !status.startsWith('listening')
    ? { label: 'Microphone off', tone: 'muted' }
    : quiet
      ? { label: 'Too quiet to judge', tone: 'warn' }
      : !ready
        ? { label: 'Reading the room…', tone: 'info' }
        : matches
          ? { label: 'Matches this passport', tone: 'ok' }
          : { label: 'Outside this passport', tone: 'danger' };

  const start = async () => {
    if (status !== 'idle') return;
    setStatus('starting');
    setError(null);
    setScores([]);
    setQuiet(false);
    const engine = new MicrophoneEngine({
      onFrame: (frame: CapturedFrame) => {
        if (frame.flags.some((flag) => QUIET_FLAGS.has(flag))) {
          setQuiet(true);
          return;
        }
        setQuiet(false);
        setScores((previous) => [...previous.slice(-(WINDOW_FRAMES - 1)), soundprintScore(soundprint, frame.features)]);
      },
      onLevel: setLevel,
      onError: (message) => setError(message),
      onEnded: () => {
        engineRef.current = null;
        setStatus('idle');
        setError('The microphone disconnected. The probe stopped; nothing was uploaded or billed.');
      },
    });
    engineRef.current = engine;
    const controller = new AbortController();
    startGuardRef.current = controller;
    startTimerRef.current = window.setTimeout(() => {
      if (startGuardRef.current !== controller) return;
      startGuardRef.current = null;
      controller.abort();
      setStatus('idle');
      setError(
        'No microphone permission arrived after 20 seconds. The probe stopped; nothing was uploaded or billed.',
      );
    }, 20_000);
    try {
      await engine.start(undefined, controller.signal);
      if (controller.signal.aborted) {
        await engine.stop();
        return;
      }
      setStatus('listening');
    } catch (err) {
      engineRef.current = null;
      setStatus('idle');
      if (controller.signal.aborted) {
        await engine.stop();
        return;
      }
      setError(
        `${(err as Error).message} The probe needs only a microphone permission on this page; no session is created.`,
      );
      await engine.stop();
    } finally {
      if (startTimerRef.current !== null) window.clearTimeout(startTimerRef.current);
      startTimerRef.current = null;
      if (startGuardRef.current === controller) startGuardRef.current = null;
    }
  };

  const stop = async () => {
    const engine = engineRef.current;
    engineRef.current = null;
    startGuardRef.current?.abort();
    startGuardRef.current = null;
    if (startTimerRef.current !== null) window.clearTimeout(startTimerRef.current);
    startTimerRef.current = null;
    setStatus('idle');
    setScores([]);
    setLevel(0);
    setQuiet(false);
    if (engine) await engine.stop();
  };

  return (
    <section className="card passport-probe">
      <div className="row row--between" style={{ alignItems: 'flex-start' }}>
        <div className="stack" style={{ gap: '0.3rem' }}>
          <span className="eyebrow">Try the passport</span>
          <h2 className="h2" style={{ fontSize: 'clamp(1.7rem, 3vw, 2.5rem)' }}>
            Does it sound like {objectName}?
          </h2>
          <p className="small muted" style={{ maxWidth: '62ch', margin: 0 }}>
            Open the microphone and listen for a moment. This compares the room’s band shape with the enrolled active
            profile in this tab. It creates no session, uploads no audio and charges nothing.
          </p>
        </div>
        <span className={`chip ${soundprint.gateEnabled ? 'chip--ok' : 'chip--warn'}`}>
          <span className="chip__dot" /> {soundprint.gateEnabled ? 'local-only probe' : 'comparison only'}
        </span>
      </div>

      <div className="passport-probe__stage">
        <div className="passport-probe__readout">
          <span className="stat__label">Live spectral similarity</span>
          <strong>{score === null ? '—' : percent(score)}</strong>
          <span className={`passport-probe__verdict passport-probe__verdict--${verdict.tone}`} aria-live="polite">
            {verdict.label}
          </span>
        </div>
        <div className="passport-probe__gauge">
          <div className="passport-probe__track" aria-hidden="true">
            <span
              className={`passport-probe__fill${matches ? ' is-match' : ''}${score !== null && !matches ? ' is-outside' : ''}`}
              style={{ width: `${Math.min(100, Math.max(0, (score ?? 0) * 100))}%` }}
            />
            <span className="passport-probe__marker" style={{ left: `${threshold * 100}%` }} />
          </div>
          <div className="passport-probe__scale">
            <span>0%</span>
            <span>passport threshold {percent(threshold)}</span>
            <span>100%</span>
          </div>
        </div>
      </div>

      <Waveform level={level} live={status === 'listening'} />

      <div className="row row--between" style={{ alignItems: 'center' }}>
        <div className="row">
          {status === 'idle' ? (
            <Button onClick={() => void start()} variant="primary">
              <Icon name="mic" size={17} /> Start local probe
            </Button>
          ) : (
            <Button onClick={() => void stop()} variant="secondary">
              <Icon name="stop" size={16} /> {status === 'starting' ? 'Cancel' : 'Stop probe'}
            </Button>
          )}
          <span className="tiny muted">
            {status === 'listening'
              ? 'Listening · raw audio never leaves this tab'
              : status === 'starting'
                ? 'Waiting for microphone permission (up to 20 seconds)…'
                : 'Press once to opt in. The browser will ask for permission.'}
          </span>
        </div>
        <span className="tiny mono muted">
          {ready ? `${scores.length} recent frames` : 'needs a stable sound'}
        </span>
      </div>

      {error ? <Notice tone="warn">{error}</Notice> : null}

      <p className="tiny muted" style={{ margin: 0 }}>
        This is an enrollment-fit comparison, not object identification. A similar machine or a recording can still
        match. A low score is a reason to stop billing, not a reason to accuse anyone.
      </p>
    </section>
  );
}
