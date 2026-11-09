import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, errorMessage } from '../lib/api.ts';
import { listAudioInputs, MicrophoneEngine, type AudioInputDevice, type CapturedFrame } from '../lib/audio.ts';
import { predictFrame, type ModelArtifact } from '../../../../packages/audio/src/classifier.ts';
import { MeterStream, type MeterInterval } from '../../../../packages/audio/src/hysteresis.ts';
import { FRAME_MS } from '../../../../packages/audio/src/spec.ts';
import type { OwnerObjectView } from '../../../../packages/contracts/src/types.ts';
import {
  Button,
  Field,
  LinkButton,
  Loading,
  Notice,
  PageHeader,
  Select,
  usePageTitle,
} from '../components/ui.tsx';
import { Icon, ObjectGlyph } from '../components/visuals.tsx';
import { dateTime, duration, percent } from '../lib/format.ts';

const TRIAL_COUNT = 3;
const PHASE_MS = 6_000;
const ON_PASS_RATIO = 0.5;
const OFF_MAX_FALSE_BILLABLE_RATIO = 0.05;

type Phase = 'ON' | 'OFF';

interface SegmentMetrics {
  durationMs: number;
  activeMs: number;
  idleMs: number;
  uncertainMs: number;
  activeRatio: number;
  falseBillableRatio: number;
  meanActiveProbability: number;
  meanSoundprintScore: number | null;
  soundprintMismatchFrames: number;
  clippedFrames: number;
  intervals: MeterInterval[];
}

interface Segment {
  phase: Phase;
  startedAt: string;
  endedAt: string;
  deviceLabel: string | null;
  sampleRate: number | null;
  frameCount: number;
  metrics: SegmentMetrics;
  outcome: 'PASS' | 'FAIL';
  failureCodes: string[];
}

interface TrialDraft {
  onAttempts: Segment[];
  offAttempts: Segment[];
}

interface ArtifactResponse {
  artifact: ModelArtifact;
  modelVersion: string;
  modelHash: string;
}

function emptyTrials(): TrialDraft[] {
  return Array.from({ length: TRIAL_COUNT }, () => ({ onAttempts: [], offAttempts: [] }));
}

function measure(frames: CapturedFrame[], model: ModelArtifact, phase: Phase): { metrics: SegmentMetrics; outcome: Segment['outcome']; failureCodes: string[] } {
  const meter = new MeterStream(model.policy);
  meter.reset(0);
  const intervals: MeterInterval[] = [];
  let activeProbabilitySum = 0;
  let soundprintSum = 0;
  let soundprintCount = 0;
  let soundprintMismatchFrames = 0;
  let clippedFrames = 0;
  let last = 0;
  for (const frame of frames) {
    last = Math.max(last, frame.endMs);
    const prediction = predictFrame(model, frame.features, frame.flags, Math.max(0, frame.endMs - FRAME_MS), frame.endMs);
    activeProbabilitySum += prediction.pActive;
    if (typeof prediction.soundprintScore === 'number') {
      soundprintSum += prediction.soundprintScore;
      soundprintCount += 1;
    }
    if (prediction.soundprintMismatch) soundprintMismatchFrames += 1;
    if (prediction.flags.includes('CLIPPED')) clippedFrames += 1;
    intervals.push(...meter.push(prediction));
  }
  intervals.push(...meter.flush(last));
  const durationMs = Math.max(1, last);
  const stateMs = { ACTIVE_CONFIDENT: 0, IDLE: 0, UNCERTAIN: 0, DISCONNECTED: 0 };
  for (const interval of intervals) stateMs[interval.state] += Math.max(0, interval.endMs - interval.startMs);
  const activeMs = stateMs.ACTIVE_CONFIDENT;
  const metrics: SegmentMetrics = {
    durationMs,
    activeMs,
    idleMs: stateMs.IDLE,
    uncertainMs: stateMs.UNCERTAIN + stateMs.DISCONNECTED,
    activeRatio: activeMs / durationMs,
    falseBillableRatio: activeMs / durationMs,
    meanActiveProbability: frames.length ? activeProbabilitySum / frames.length : 0,
    meanSoundprintScore: soundprintCount ? soundprintSum / soundprintCount : null,
    soundprintMismatchFrames,
    clippedFrames,
    intervals,
  };
  const failureCodes: string[] = [];
  if (durationMs < 3_000) failureCodes.push('SEGMENT_TOO_SHORT');
  if (phase === 'ON') {
    if (metrics.activeRatio < ON_PASS_RATIO) failureCodes.push('ACTIVE_RATIO_BELOW_EXPECTATION');
    if (soundprintMismatchFrames / Math.max(1, frames.length) > 0.2) failureCodes.push('SOUNDPRINT_MISMATCH');
  } else {
    if (metrics.falseBillableRatio > OFF_MAX_FALSE_BILLABLE_RATIO) failureCodes.push('FALSE_BILLABLE_TIME');
  }
  if (clippedFrames / Math.max(1, frames.length) > 0.2) failureCodes.push('CLIPPING');
  return { metrics, outcome: failureCodes.length === 0 ? 'PASS' : 'FAIL', failureCodes };
}

function downloadJson(value: unknown, filename: string): void {
  const blob = new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function GateA() {
  const { objectId = '' } = useParams();
  const [view, setView] = useState<OwnerObjectView | null>(null);
  const [artifact, setArtifact] = useState<ArtifactResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [devices, setDevices] = useState<AudioInputDevice[]>([]);
  const [deviceId, setDeviceId] = useState('');
  const [trialIndex, setTrialIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>('ON');
  const [recording, setRecording] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [trials, setTrials] = useState<TrialDraft[]>(emptyTrials);
  const [lastSampleRate, setLastSampleRate] = useState<number | null>(null);
  const [deviceWarning, setDeviceWarning] = useState<string | null>(null);

  const engineRef = useRef<MicrophoneEngine | null>(null);
  const framesRef = useRef<CapturedFrame[]>([]);
  const recordingRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const trialIndexRef = useRef(0);
  const phaseRef = useRef<Phase>('ON');
  const modelRef = useRef<ModelArtifact | null>(null);
  const startedAtRef = useRef('');

  usePageTitle(view ? `${view.object.name} Gate A trials` : 'Gate A trials');

  const load = useCallback(async () => {
    try {
      const owner = await api<OwnerObjectView>(`/api/operator/objects/${objectId}`);
      setView(owner);
      if (owner.activeModel) {
        const response = await api<ArtifactResponse>(`/api/operator/objects/${objectId}/model-artifact`);
        setArtifact(response);
        modelRef.current = response.artifact;
      }
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [objectId]);

  useEffect(() => {
    void load();
    void listAudioInputs().then(setDevices).catch(() => undefined);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
      recordingRef.current = false;
      void engineRef.current?.stop();
    };
  }, [load]);

  const finishCapture = useCallback(async () => {
    if (!recordingRef.current) return;
    recordingRef.current = false;
    setRecording(false);
    if (timerRef.current) clearInterval(timerRef.current);
    if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
    timerRef.current = null;
    stopTimerRef.current = null;
    const engine = engineRef.current;
    engineRef.current = null;
    const deviceLabel = engine?.deviceLabel ?? null;
    const sampleRate = engine?.sampleRate ?? null;
    const endedAt = new Date().toISOString();
    if (engine) await engine.stop();
    const frames = framesRef.current;
    const model = modelRef.current;
    if (!model) return;
    if (frames.length < 30) {
      setError('The capture was too short or the microphone delivered no frames. No trial result was recorded.');
      return;
    }
    const measured = measure(frames, model, phaseRef.current);
    const segment: Segment = {
      phase: phaseRef.current,
      startedAt: startedAtRef.current,
      endedAt,
      deviceLabel: deviceLabel ?? devices.find((device) => device.deviceId === deviceId)?.label ?? null,
      sampleRate: sampleRate ?? lastSampleRate,
      frameCount: frames.length,
      metrics: measured.metrics,
      outcome: measured.outcome,
      failureCodes: measured.failureCodes,
    };
    setTrials((previous) => {
      const next = previous.map((trial) => ({ ...trial, onAttempts: [...trial.onAttempts], offAttempts: [...trial.offAttempts] }));
      const target = next[trialIndexRef.current]!;
      if (phaseRef.current === 'ON') target.onAttempts.push(segment);
      else target.offAttempts.push(segment);
      return next;
    });
    if (phaseRef.current === 'ON') {
      phaseRef.current = 'OFF';
      setPhase('OFF');
    }
  }, [deviceId, devices, lastSampleRate]);

  const startCapture = async () => {
    const model = modelRef.current;
    if (!model || recordingRef.current) return;
    setError(null);
    setDeviceWarning(null);
    framesRef.current = [];
    setElapsedMs(0);
    recordingRef.current = true;
    startedAtRef.current = new Date().toISOString();
    setRecording(true);
    try {
      const engine = new MicrophoneEngine({
        onFrame: (frame) => {
          if (recordingRef.current) framesRef.current.push(frame);
        },
        onError: (message) => setDeviceWarning(message),
        onEnded: () => {
          if (recordingRef.current) {
            setDeviceWarning('The microphone disconnected. This attempt is being closed as a failed capture.');
            void finishCapture();
          }
        },
      });
      engineRef.current = engine;
      await engine.start(deviceId || undefined);
      setLastSampleRate(engine.sampleRate);
      setDevices(await listAudioInputs().catch(() => []));
      timerRef.current = setInterval(() => {
        setElapsedMs((value) => Math.min(PHASE_MS, value + 100));
      }, 100);
      stopTimerRef.current = setTimeout(() => void finishCapture(), PHASE_MS);
    } catch (err) {
      recordingRef.current = false;
      setRecording(false);
      if (timerRef.current) clearInterval(timerRef.current);
      if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
      setError(`${errorMessage(err)} Microphone permission is required. Gate A cannot use imported or synthetic audio.`);
    }
  };

  if (loading) return <Loading label="Preparing Gate A trials…" />;
  if (!view) return <div className="page container page--narrow"><Notice tone="danger">{error ?? 'Object not found.'}</Notice></div>;

  const currentTrial = trials[trialIndex]!;
  const onSegment = currentTrial.onAttempts.at(-1) ?? null;
  const offSegment = currentTrial.offAttempts.at(-1) ?? null;
  const trialFinished = Boolean(onSegment && offSegment);
  const completedTrials = trials.filter((trial) => trial.onAttempts.length > 0 && trial.offAttempts.length > 0).length;
  const passedTrials = trials.filter((trial) => {
    const on = trial.onAttempts.at(-1);
    const off = trial.offAttempts.at(-1);
    return on?.outcome === 'PASS' && off?.outcome === 'PASS';
  }).length;
  const ready = Boolean(artifact?.artifact);

  const exportPack = () => {
    const pack = {
      schema: 'whirr.gate-a-trial-log.v1',
      generatedAt: new Date().toISOString(),
      gateAStatus: 'OPEN_PENDING_REVIEW',
      statement:
        'This is a client-reported live trial log. It is not a signed proof that a physical object was present. Gate A closes only after a named reviewer confirms genuine real-object evidence in docs/evidence/gate-a.json.',
      object: { id: view.object.id, name: view.object.name, category: view.object.category },
      model: artifact
        ? { version: artifact.modelVersion, hash: artifact.modelHash, status: artifact.artifact.status, provenance: artifact.artifact.provenance }
        : null,
      captureProvenance: 'CLIENT_CLAIMED_LIVE_MICROPHONE',
      environment: {
        userAgent: navigator.userAgent,
        deviceLabel: devices.find((device) => device.deviceId === deviceId)?.label ?? null,
        lastSampleRate,
      },
      protocol: {
        phaseMs: PHASE_MS,
        onPassRatio: ON_PASS_RATIO,
        offMaxFalseBillableRatio: OFF_MAX_FALSE_BILLABLE_RATIO,
        note: 'Metrics are generated by the local model, classifier and hysteresis. No raw audio or feature vectors are included.',
      },
      trials: trials.map((trial, index) => ({
        trial: index + 1,
        onAttempts: trial.onAttempts,
        offAttempts: trial.offAttempts,
        finalOutcome: (() => {
          const on = trial.onAttempts.at(-1);
          const off = trial.offAttempts.at(-1);
          if (!on || !off) return 'INCOMPLETE';
          return on.outcome === 'PASS' && off.outcome === 'PASS' ? 'PASS' : 'FAIL';
        })(),
      })),
      summary: { completedTrials, passedTrials, requiredTrials: TRIAL_COUNT },
      reviewerChecklist: [
        'Confirm all three trials were performed on the same physical object with a live microphone.',
        'Compare the ON and OFF measurements and inspect every recorded failure code.',
        'Do not replace this log with synthetic fixture data or an imported WAV.',
        'Record the reviewer name, date and verdict before closing Gate A in docs/evidence/gate-a.json.',
      ],
    };
    downloadJson(pack, `whirr-gate-a-${view.object.id}-${new Date().toISOString().slice(0, 10)}.json`);
  };

  return (
    <div className="page container page--wide">
      <PageHeader
        eyebrow="Real-object evidence"
        breadcrumbs={
          <>
            <Link to={`/studio/objects/${objectId}/model`}>{view.object.name} model</Link> <span aria-hidden="true">/</span> <span>Gate A trials</span>
          </>
        }
        title="Three live ON/OFF trials."
        lede="Run this with the physical object in front of you and a live microphone. The browser reports what the model actually classified; it does not edit failures or substitute a fixture."
        actions={
          <LinkButton to={`/studio/objects/${objectId}/model`} variant="secondary">
            Back to model
          </LinkButton>
        }
      />

      {error ? <Notice tone="danger">{error}</Notice> : null}
      {deviceWarning ? <Notice tone="warn">{deviceWarning}</Notice> : null}

      {!ready ? (
        <Notice tone="warn" title="An active model is required.">
          Calibrate and train this object first. Gate A tests the model that would actually be used for billing.
        </Notice>
      ) : (
        <>
          <section className="card stack">
            <div className="row row--between">
              <div className="row">
                <ObjectGlyph glyph={view.object.glyph} size={50} tone="accent" />
                <div>
                  <h2 className="h3">{view.object.name}</h2>
                  <span className="tiny muted">model {artifact?.modelVersion} · {artifact?.artifact.status} · {artifact?.artifact.provenance.replaceAll('_', ' ').toLowerCase()}</span>
                </div>
              </div>
              <div className="row">
                <span className="chip chip--warn">live microphone only</span>
                <span className="chip">{completedTrials}/{TRIAL_COUNT} trials recorded</span>
                <span className={`chip ${passedTrials === TRIAL_COUNT ? 'chip--ok' : 'chip--warn'}`}>{passedTrials}/{TRIAL_COUNT} passed</span>
              </div>
            </div>
            <Notice tone="info">
              Put the object where it normally runs. Each ON and OFF capture lasts {PHASE_MS / 1000} seconds. You can retry a
              failed phase; every attempt is kept in the export. Gate A remains <strong>OPEN</strong> until a human reviewer
              confirms genuine real-object evidence.
            </Notice>
            <Field label="Microphone" hint="Use the microphone that will actually meter the object.">
              <Select value={deviceId} onChange={(event) => setDeviceId(event.target.value)} disabled={recording}>
                <option value="">Default input</option>
                {devices.map((device) => <option key={device.deviceId} value={device.deviceId}>{device.label}</option>)}
              </Select>
            </Field>
          </section>

          <div className="sidebar-layout">
            <section className="card stack">
              <div className="row row--between">
                <div>
                  <span className="eyebrow">Trial {trialIndex + 1} of {TRIAL_COUNT}</span>
                  <h2 className="h2" style={{ fontSize: '2rem' }}>
                    {phase === 'ON' ? 'Switch the object ON.' : 'Switch the object OFF.'}
                  </h2>
                </div>
                <span className={`chip ${recording ? 'chip--danger' : phase === 'ON' ? 'chip--accent' : ''}`}>
                  {recording ? `${(PHASE_MS / 1000 - elapsedMs / 1000).toFixed(1)}s remaining` : phase === 'ON' ? 'expected: running' : 'expected: quiet'}
                </span>
              </div>
              <p className="small muted">
                {phase === 'ON'
                  ? `Expected: at least ${percent(ON_PASS_RATIO, 0)} of this capture should be ACTIVE_CONFIDENT. Leave the object running for the whole capture.`
                  : `Expected: at most ${percent(OFF_MAX_FALSE_BILLABLE_RATIO, 0)} of this capture should be ACTIVE_CONFIDENT. The object must be switched off before you start.`}
              </p>
              <div className="meter" style={{ minHeight: 44 }} aria-live="polite">
                <span className="mono">{(elapsedMs / 1000).toFixed(1)}s / {PHASE_MS / 1000}s</span>
                <div className="meter__track"><div className="meter__fill" style={{ width: `${Math.min(100, (elapsedMs / PHASE_MS) * 100)}%` }} /></div>
              </div>
              {recording ? (
                <Button variant="danger" onClick={() => void finishCapture()} block size="lg">Stop this capture early</Button>
              ) : (
                <>
                  <Button onClick={() => void startCapture()} variant={phase === 'ON' ? 'primary' : 'secondary'} block size="lg" disabled={!ready}>
                    <Icon name="mic" size={17} /> Start {phase} capture
                  </Button>
                  {phase === 'OFF' && onSegment?.outcome === 'FAIL' && !offSegment ? (
                    <Button
                      variant="ghost"
                      block
                      onClick={() => {
                        phaseRef.current = 'ON';
                        setPhase('ON');
                      }}
                    >
                      Retry the failed ON capture
                    </Button>
                  ) : null}
                </>
              )}
              <p className="tiny muted">
                The browser sends no audio. Only the state intervals and summary measurements in the export leave the page; raw
                audio and feature vectors stay in memory and are discarded.
              </p>
            </section>

            <aside className="stack">
              <section className="card stack">
                <div className="row row--between"><h2 className="h3">Actual measurements</h2><span className="chip">{phase}</span></div>
                {phase === 'ON' && !onSegment ? <p className="small muted">No ON capture recorded yet.</p> : null}
                {phase === 'OFF' && !offSegment ? <p className="small muted">No OFF capture recorded yet.</p> : null}
                {(phase === 'ON' ? onSegment : offSegment) ? <SegmentResult segment={(phase === 'ON' ? onSegment : offSegment)!} /> : null}
              </section>

              <section className="card stack">
                <h2 className="h3">Trial progress</h2>
                {trials.map((trial, index) => {
                  const on = trial.onAttempts.at(-1);
                  const off = trial.offAttempts.at(-1);
                  const outcome = !on || !off ? 'WAITING' : on.outcome === 'PASS' && off.outcome === 'PASS' ? 'PASS' : 'FAIL';
                  return (
                    <div key={index} className="row row--between panel" style={{ padding: '0.6rem 0.75rem' }}>
                      <span className="small">Trial {index + 1}</span>
                      <span className={`chip ${outcome === 'PASS' ? 'chip--ok' : outcome === 'FAIL' ? 'chip--danger' : ''}`}>
                        {outcome} · {trial.onAttempts.length + trial.offAttempts.length} captures
                      </span>
                    </div>
                  );
                })}
                {trialFinished ? (
                  trialIndex < TRIAL_COUNT - 1 ? (
                    <Button
                      onClick={() => {
                        const next = trialIndex + 1;
                        setTrialIndex(next);
                        trialIndexRef.current = next;
                        phaseRef.current = 'ON';
                        setPhase('ON');
                      }}
                      block
                    >
                      Start trial {trialIndex + 2} <Icon name="arrow" size={16} />
                    </Button>
                  ) : (
                    <Button onClick={exportPack} variant="primary" block>
                      <Icon name="download" size={16} /> Download trial log
                    </Button>
                  )
                ) : null}
                {offSegment?.outcome === 'FAIL' ? (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      phaseRef.current = 'OFF';
                      setPhase('OFF');
                    }}
                    block
                  >
                    Retry the failed OFF capture
                  </Button>
                ) : null}
              </section>
            </aside>
          </div>
        </>
      )}
    </div>
  );
}

function SegmentResult({ segment }: { segment: Segment }) {
  const { metrics } = segment;
  return (
    <div className="stack" style={{ gap: '0.55rem' }}>
      <div className="row row--between">
        <span className={`chip ${segment.outcome === 'PASS' ? 'chip--ok' : 'chip--danger'}`}>{segment.outcome}</span>
        <span className="tiny muted">{dateTime(segment.endedAt)}</span>
      </div>
      <dl className="kv">
        <dt>Captured</dt><dd>{duration(metrics.durationMs)}</dd>
        <dt>Active / billable</dt><dd>{duration(metrics.activeMs)} · {percent(metrics.activeRatio, 1)}</dd>
        <dt>Idle</dt><dd>{duration(metrics.idleMs)}</dd>
        <dt>Uncertain</dt><dd>{duration(metrics.uncertainMs)}</dd>
        <dt>Mean p(active)</dt><dd>{percent(metrics.meanActiveProbability, 1)}</dd>
        <dt>Passport score</dt><dd>{metrics.meanSoundprintScore === null ? 'not enrolled' : percent(metrics.meanSoundprintScore, 1)}</dd>
        <dt>Mismatch frames</dt><dd>{metrics.soundprintMismatchFrames}</dd>
        <dt>Frames</dt><dd>{segment.frameCount} · {segment.sampleRate ? `${Math.round(segment.sampleRate / 1000)} kHz` : 'unknown rate'}</dd>
        <dt>Device</dt><dd className="break">{segment.deviceLabel ?? 'default input'}</dd>
      </dl>
      {segment.failureCodes.length > 0 ? (
        <Notice tone="warn" title="Recorded failure codes">
          {segment.failureCodes.join(', ')}. Retry the phase or keep this failure in the export.
        </Notice>
      ) : null}
    </div>
  );
}