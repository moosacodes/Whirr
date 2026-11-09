import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, errorMessage } from '../lib/api.ts';
import {
  listAudioInputs,
  MicrophoneEngine,
  type AudioInputDevice,
  type CapturedFrame,
} from '../lib/audio.ts';
import { predictFrame, type ModelArtifact } from '../../../../packages/audio/src/classifier.ts';
import { MeterStream, type MeterInterval } from '../../../../packages/audio/src/hysteresis.ts';
import { FRAME_MS, FEATURE_SPEC_VERSION } from '../../../../packages/audio/src/spec.ts';
import {
  FIELD_PROTOCOL,
  canonicalCycleTimeline,
  canonicalSingleTrialTimeline,
  type FieldTimelineSegment,
  type FieldTrialKind,
} from '../../../../packages/audio/src/field-eval.ts';
import type {
  FieldTestReport,
  FieldTestStateView,
  FieldTrialView,
  OwnerObjectView,
  TakeLabel,
} from '../../../../packages/contracts/src/types.ts';
import type { MeterState } from '../../../../packages/meter/src/intervals.ts';
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
import { METER_COPY, dateTime, duration, percent } from '../lib/format.ts';

type CaptureGroup = 'TAKE' | 'TRIAL';
type CaptureStatus = 'REQUESTING' | 'RECORDING';

interface CaptureSpec {
  group: CaptureGroup;
  key: string;
  title: string;
  durationMs: number;
  takeLabel?: TakeLabel;
  trialKind?: FieldTrialKind;
}

interface PhaseCopy {
  headline: string;
  detail: string;
  tone: 'on' | 'off' | 'neutral';
}

interface LiveInference {
  state: MeterState;
  pActive: number;
  excludedMs: number;
}

interface ArtifactResponse {
  artifact: ModelArtifact;
  modelVersion: string;
  modelHash: string;
}

const TRIAL_COPY: Record<
  FieldTrialKind,
  { title: string; instruction: string; button: string; durationMs: number }
> = {
  THREE_CYCLE: {
    title: 'Guided three-cycle ON/OFF',
    instruction:
      'Follow the prompts: three ON phases and three OFF phases, 31 seconds in total. Keep the object where it normally runs.',
    button: 'Record three-cycle trial',
    durationMs: FIELD_PROTOCOL.cycleTotalMs + 400,
  },
  NOISE: {
    title: 'Background noise only',
    instruction: 'Leave the appliance off for 12 seconds and let the room make its normal noise.',
    button: 'Record noise trial',
    durationMs: FIELD_PROTOCOL.noiseMs + 400,
  },
  DISTANCE: {
    title: 'Object running at distance',
    instruction: 'Run the appliance at least 2 metres from the microphone for 12 seconds.',
    button: 'Record distance trial',
    durationMs: FIELD_PROTOCOL.distanceMs + 400,
  },
  REPLAY: {
    title: 'Replay of a recording',
    instruction:
      'Play a phone recording of this appliance about 1 metre from the microphone for 12 seconds. Whirr should not bill it.',
    button: 'Record replay trial',
    durationMs: FIELD_PROTOCOL.replayMs + 400,
  },
};

const TAKE_SPECS: Array<{
  key: string;
  label: TakeLabel;
  title: string;
  instruction: string;
  target: number;
  durationMs: number;
}> = [
  {
    key: 'take:idle',
    label: 'idle',
    title: 'Idle',
    instruction: 'Appliance plugged in but switched off; include the room’s ordinary hum.',
    target: 2,
    durationMs: 6_000,
  },
  {
    key: 'take:active',
    label: 'active',
    title: 'Operating',
    instruction: 'Appliance switched on and doing its normal job.',
    target: 2,
    durationMs: 8_000,
  },
  {
    key: 'take:negative',
    label: 'negative',
    title: 'Background',
    instruction: 'Another appliance, a voice, music or room noise — not this object running.',
    target: 1,
    durationMs: 6_000,
  },
];

function phaseFor(spec: CaptureSpec, elapsedMs: number): PhaseCopy {
  if (spec.trialKind === 'THREE_CYCLE') {
    const segments = canonicalCycleTimeline(FIELD_PROTOCOL.cycleTotalMs);
    const index = segments.findIndex((segment) => elapsedMs >= segment.startMs && elapsedMs < segment.endMs);
    const segment = index >= 0 ? segments[index]! : segments[segments.length - 1]!;
    const operatingBefore = segments
      .slice(0, index >= 0 ? index + 1 : segments.length)
      .filter((entry) => entry.truth === 'OPERATING').length;
    const nextOn = segments.find((entry) => entry.startMs > elapsedMs && entry.truth === 'OPERATING');
    if (segment.truth === 'OPERATING') {
      return {
        headline: `Cycle ${operatingBefore} of 3 — switch ON now`,
        detail: 'Keep it running until the prompt changes.',
        tone: 'on',
      };
    }
    return {
      headline: nextOn ? `Cycle ${operatingBefore + 1} — switch OFF` : 'Leave the object OFF',
      detail: nextOn ? 'Switch it off and wait for the next prompt.' : 'The three cycles are complete. Hold still until capture ends.',
      tone: 'off',
    };
  }
  if (spec.trialKind === 'NOISE') {
    return { headline: 'Leave the object OFF', detail: 'Let the room make its normal background noise.', tone: 'off' };
  }
  if (spec.trialKind === 'DISTANCE') {
    return { headline: 'Object ON, at least 2 m away', detail: 'Keep the microphone where it normally sits.', tone: 'on' };
  }
  if (spec.trialKind === 'REPLAY') {
    return {
      headline: 'Play the recording now',
      detail: 'Hold the phone speaker about 1 m from the microphone. The meter should stay quiet.',
      tone: 'neutral',
    };
  }
  return { headline: spec.title, detail: 'Follow the prompt and keep the capture steady.', tone: 'neutral' };
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

function signalNormalise(value: number): number {
  return Math.max(0, Math.min(1, (value + 8) / 8));
}

function SignalTrace({ levels, live, label }: { levels: number[]; live: boolean; label: string }) {
  const width = 640;
  const height = 96;
  const points = levels
    .map((value, index) => {
      const x = levels.length > 1 ? (index / (levels.length - 1)) * width : width / 2;
      const y = height / 2 - (signalNormalise(value) - 0.5) * (height - 16);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <div className={`lab-signal${live ? ' is-live' : ''}`}>
      <div className="lab-signal__head">
        <span className="lab-signal__state">
          <span className={`live-dot${live ? ' is-live' : ''}`} aria-hidden="true" />
          {live ? 'LIVE INPUT' : 'MIC CLOSED'}
        </span>
        <span className="tiny mono muted">{live ? `${levels.length} frames` : 'no signal'}</span>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={
          live
            ? `Actual microphone signal trace over ${levels.length} captured frames. ${label}`
            : 'Microphone closed. No signal is being captured.'
        }
      >
        <line className="lab-signal__axis" x1="0" y1={height / 2} x2={width} y2={height / 2} />
        {live && points ? <polyline className="lab-signal__trace" points={points} /> : null}
        {!live ? <line className="lab-signal__closed" x1="0" y1={height / 2} x2={width} y2={height / 2} /> : null}
      </svg>
      <p className="tiny muted" style={{ margin: 0 }}>
        {live
          ? 'This trace is drawn from the frames the browser actually captured. Raw audio is never uploaded.'
          : 'No audio is being captured. Every recording opens the microphone explicitly and closes it when the capture ends.'}
      </p>
    </div>
  );
}

function StatusChip({ status }: { status: FieldTestStateView['status'] }) {
  const tone =
    status === 'FIELD_PASS' ? 'ok' : status === 'FIELD_FAIL' ? 'danger' : status === 'NOT_ELIGIBLE' ? 'warn' : '';
  const label =
    status === 'FIELD_PASS'
      ? 'Field test passed'
      : status === 'FIELD_FAIL'
        ? 'Field test failed'
        : status === 'INCOMPLETE'
          ? 'Field test incomplete'
          : status === 'NOT_ELIGIBLE'
            ? 'Synthetic — not eligible'
            : 'Field test not run';
  return <span className={`chip${tone ? ` chip--${tone}` : ''}`}>{label}</span>;
}

function GateList({ gates }: { gates: FieldTestStateView['gates'] }) {
  if (gates.length === 0) {
    return <p className="small muted">Gates appear after the model is trained and the first trial is recorded.</p>;
  }
  return (
    <div className="gate-list">
      {gates.map((entry) => (
        <div className="gate-row" key={entry.id}>
          <div className="gate-row__copy">
            <strong className="small">{entry.label}</strong>
            <span className="tiny muted">{entry.detail}</span>
          </div>
          <span className="gate-row__threshold tiny mono muted">{entry.threshold}</span>
          <span className="gate-row__observed tiny mono">{entry.observed}</span>
          <span
            className={`chip ${
              entry.status === 'PASS' ? 'chip--ok' : entry.status === 'FAIL' ? 'chip--danger' : 'chip--warn'
            }`}
          >
            {entry.status}
          </span>
        </div>
      ))}
    </div>
  );
}

function TrialMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="panel" style={{ padding: '0.6rem 0.7rem' }}>
      <span className="stat__label">{label}</span>
      <div className="mono small" style={{ marginTop: 3 }}>{value}</div>
    </div>
  );
}

function TrialCard({
  kind,
  state,
  disabled,
  busy,
  onStart,
  onDiscard,
}: {
  kind: FieldTrialKind;
  state: FieldTestStateView;
  disabled: boolean;
  busy: boolean;
  onStart: (kind: FieldTrialKind) => void;
  onDiscard: (trial: FieldTrialView) => void;
}) {
  const copy = TRIAL_COPY[kind];
  const trial = state.trials.find((entry) => entry.kind === kind);
  return (
    <article className={`card stack lab-trial${trial?.status === 'FAIL' ? ' lab-trial--failed' : ''}`}>
      <div className="row row--between" style={{ alignItems: 'flex-start' }}>
        <div>
          <span className="eyebrow">Field trial</span>
          <h3 className="h3">{copy.title}</h3>
        </div>
        <span
          className={`chip ${
            trial ? (trial.status === 'PASS' ? 'chip--ok' : 'chip--danger') : ''
          }`}
        >
          {trial ? trial.status : 'NOT RECORDED'}
        </span>
      </div>
      <p className="small muted" style={{ margin: 0 }}>{copy.instruction}</p>
      {kind === 'THREE_CYCLE' ? (
        <div className="lab-cycles" aria-hidden="true">
          {[1, 2, 3].map((cycle) => (
            <span key={cycle} className="lab-cycle">
              <span className="lab-cycle__number">{cycle}</span>
              <span className="lab-cycle__off">OFF 4s</span>
              <span className="lab-cycle__on">ON 5s</span>
            </span>
          ))}
        </div>
      ) : null}
      {trial ? (
        <div className="grid-2" style={{ gap: '0.5rem' }}>
          {kind === 'THREE_CYCLE' ? (
            <>
              <TrialMetric label="Precision" value={percent(trial.metrics.precision, 2)} />
              <TrialMetric label="Recall" value={percent(trial.metrics.recall, 2)} />
              <TrialMetric label="False billable" value={duration(trial.metrics.falseBilledMs)} />
              <TrialMetric label="Billing error" value={duration(trial.metrics.billingErrorMs)} />
            </>
          ) : (
            <>
              <TrialMetric
                label={kind === 'DISTANCE' ? 'Billable ratio' : 'False-billable ratio'}
                value={percent(kind === 'DISTANCE' ? trial.metrics.activeRatio : trial.metrics.falseBillableRatio, 2)}
              />
              <TrialMetric label="Billed" value={duration(trial.metrics.billedMs)} />
            </>
          )}
        </div>
      ) : null}
      {trial ? (
        <p className="tiny muted" style={{ margin: 0 }}>
          Attempt {trial.attempt} · {dateTime(trial.capturedAt)} · {duration(trial.durationMs)} ·{' '}
          {trial.recording.deviceRef ? `device ${trial.recording.deviceRef}` : 'default input'}
        </p>
      ) : null}
      <div className="row">
        <Button
          variant={trial ? 'secondary' : 'primary'}
          size="sm"
          onClick={() => onStart(kind)}
          disabled={disabled || busy}
          title={disabled ? 'Train a READY model from live recordings first.' : undefined}
        >
          <Icon name="mic" size={15} /> {trial ? `Retake ${copy.title.toLowerCase()}` : copy.button}
        </Button>
        {trial ? (
          <Button variant="ghost" size="sm" onClick={() => onDiscard(trial)} disabled={busy}>
            Discard attempt
          </Button>
        ) : null}
      </div>
    </article>
  );
}

export function CalibrationLab() {
  const { objectId = '' } = useParams();
  const [view, setView] = useState<OwnerObjectView | null>(null);
  const [artifact, setArtifact] = useState<ModelArtifact | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [devices, setDevices] = useState<AudioInputDevice[]>([]);
  const [deviceId, setDeviceId] = useState('');
  const [capture, setCapture] = useState<{ spec: CaptureSpec; status: CaptureStatus } | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [levels, setLevels] = useState<number[]>([]);
  const [phase, setPhase] = useState<PhaseCopy | null>(null);
  const [live, setLive] = useState<LiveInference | null>(null);
  const [uploading, setUploading] = useState(false);
  const [training, setTraining] = useState(false);
  const [reporting, setReporting] = useState(false);

  const engineRef = useRef<MicrophoneEngine | null>(null);
  const framesRef = useRef<CapturedFrame[]>([]);
  const levelsRef = useRef<number[]>([]);
  const timelineRef = useRef<FieldTimelineSegment[]>([]);
  const captureRef = useRef<{ spec: CaptureSpec; status: CaptureStatus } | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoStopRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const meterRef = useRef<MeterStream | null>(null);
  const intervalsRef = useRef<MeterInterval[]>([]);
  const latestPredictionRef = useRef(0);
  const artifactRef = useRef<ModelArtifact | null>(null);
  const finishRef = useRef<() => Promise<void>>(async () => undefined);

  usePageTitle(view ? `${view.object.name} calibration lab` : 'Real-World Calibration Lab');

  const load = useCallback(async () => {
    try {
      const owner = await api<OwnerObjectView>(`/api/operator/objects/${objectId}`);
      setView(owner);
      if (owner.activeModel) {
        const response = await api<ArtifactResponse>(`/api/operator/objects/${objectId}/model-artifact`);
        setArtifact(response.artifact);
        artifactRef.current = response.artifact;
      } else {
        setArtifact(null);
        artifactRef.current = null;
      }
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [objectId]);

  const clearTimers = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (autoStopRef.current) clearTimeout(autoStopRef.current);
    timerRef.current = null;
    autoStopRef.current = null;
  };

  const abortCapture = useCallback(async (message = 'Capture discarded. No audio, take or trial result was recorded.') => {
    captureRef.current = null;
    clearTimers();
    const engine = engineRef.current;
    engineRef.current = null;
    if (engine) await engine.stop();
    setCapture(null);
    setElapsedMs(0);
    setLevels([]);
    setPhase(null);
    setLive(null);
    meterRef.current = null;
    intervalsRef.current = [];
    setNotice(message);
  }, []);

  const finishCapture = useCallback(async () => {
    const current = captureRef.current;
    if (!current || current.status !== 'RECORDING') return;
    captureRef.current = null;
    setCapture(null);
    clearTimers();
    const engine = engineRef.current;
    engineRef.current = null;
    const deviceLabel = engine?.deviceLabel ?? null;
    const sampleRate = engine?.sampleRate ?? null;
    const capturedAt = new Date().toISOString();
    if (engine) await engine.stop();
    setLevels([]);
    setPhase(null);
    setLive(null);
    const frames = framesRef.current;
    if (frames.length < 200) {
      setError('The capture delivered too few frames to evaluate. Check the microphone, keep the tab visible and try again. Nothing was recorded.');
      return;
    }
    const durationMs = Math.max(1, Math.round(frames[frames.length - 1]!.endMs));
    setUploading(true);
    try {
      if (current.spec.group === 'TAKE') {
        if (!current.spec.takeLabel) return;
        await api(`/api/operator/objects/${objectId}/takes`, {
          method: 'POST',
          body: {
            label: current.spec.takeLabel,
            frames: frames.map((frame) => frame.features),
            frameFlags: frames.map((frame) => frame.flags),
            durationMs: Math.max(500, Math.min(120_000, durationMs)),
            source: 'live',
            deviceLabel,
            notes: 'Real-World Calibration Lab · live microphone',
            featureSpecVersion: FEATURE_SPEC_VERSION,
            role: 'TRAINING',
          },
        });
        setNotice(
          `${current.spec.title} recorded from the live microphone and saved as an acoustic take. Raw audio was not uploaded.`,
        );
        await load();
        return;
      }
      if (!current.spec.trialKind) return;
      if (!sampleRate) {
        setError('The browser did not report the microphone sample rate. The trial was discarded rather than guessing metadata.');
        return;
      }
      const timeline = timelineRef.current.map((segment) => ({ ...segment }));
      if (timeline.length === 0) {
        setError('No protocol timeline was available. The trial was discarded.');
        return;
      }
      timeline[timeline.length - 1]!.endMs = durationMs;
      const response = await api<{ trial: FieldTrialView; fieldTest: FieldTestStateView }>(
        `/api/operator/objects/${objectId}/field-trials`,
        {
          method: 'POST',
          body: {
            kind: current.spec.trialKind,
            frames: frames.map((frame) => frame.features),
            frameFlags: frames.map((frame) => frame.flags),
            timeline,
            durationMs,
            sampleRate: Math.round(sampleRate),
            capturedAt,
            deviceLabel,
          },
        },
      );
      setView((previous) => (previous ? { ...previous, fieldTest: response.fieldTest } : previous));
      const failed = response.trial.status === 'FAIL';
      setNotice(
        failed
          ? `${TRIAL_COPY[current.spec.trialKind].title} was recorded honestly and FAILED its pre-declared threshold. The failure is kept in the evidence.`
          : `${TRIAL_COPY[current.spec.trialKind].title} recorded and evaluated. The server recomputed the metrics from the captured features.`,
      );
      if (failed) setError(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setUploading(false);
      meterRef.current = null;
      intervalsRef.current = [];
    }
  }, [load, objectId]);

  useEffect(() => {
    finishRef.current = finishCapture;
  }, [finishCapture]);

  const startCapture = useCallback(async (spec: CaptureSpec) => {
    if (captureRef.current) return;
    setError(null);
    setNotice(null);
    framesRef.current = [];
    levelsRef.current = [];
    intervalsRef.current = [];
    latestPredictionRef.current = 0;
    const initialPhase = phaseFor(spec, 0);
    setPhase(initialPhase);
    setElapsedMs(0);
    setLevels([]);
    setLive(null);
    timelineRef.current =
      spec.trialKind === 'THREE_CYCLE'
        ? canonicalCycleTimeline(FIELD_PROTOCOL.cycleTotalMs)
        : spec.trialKind
          ? canonicalSingleTrialTimeline(spec.trialKind, spec.durationMs - 400)
          : [];
    meterRef.current = spec.trialKind && artifactRef.current ? new MeterStream(artifactRef.current.policy) : null;
    const requesting = { spec, status: 'REQUESTING' as const };
    captureRef.current = requesting;
    setCapture(requesting);
    const engine = new MicrophoneEngine({
      onFrame: (frame) => {
        const current = captureRef.current;
        if (!current || current.status !== 'RECORDING') return;
        framesRef.current.push(frame);
        levelsRef.current.push(frame.features[0] ?? -8);
        const meter = meterRef.current;
        const model = artifactRef.current;
        if (meter && model) {
          const prediction = predictFrame(
            model,
            frame.features,
            frame.flags,
            Math.max(0, frame.endMs - FRAME_MS),
            frame.endMs,
          );
          latestPredictionRef.current = prediction.pActive;
          intervalsRef.current.push(...meter.push(prediction));
        }
      },
      onError: (message) => setError(message),
      onEnded: () => {
        if (captureRef.current) {
          setError('The microphone disconnected. The capture was discarded; no trial result was recorded.');
          void abortCapture('Microphone disconnected. Capture discarded.');
        }
      },
    });
    engineRef.current = engine;
    try {
      await engine.start(deviceId || undefined);
      if (!captureRef.current) {
        await engine.stop();
        return;
      }
      const recording = { spec, status: 'RECORDING' as const };
      captureRef.current = recording;
      setCapture(recording);
      timerRef.current = setInterval(() => {
        const frames = framesRef.current;
        const elapsed = frames.length ? frames[frames.length - 1]!.endMs : 0;
        setElapsedMs(elapsed);
        setLevels(levelsRef.current.slice(-96));
        setPhase(phaseFor(spec, elapsed));
        const meter = meterRef.current;
        if (meter) {
          const excluded = intervalsRef.current
            .filter((interval) => interval.state !== 'ACTIVE_CONFIDENT')
            .reduce((total, interval) => total + Math.max(0, interval.endMs - interval.startMs), 0);
          setLive({
            state: meter.currentState,
            pActive: latestPredictionRef.current,
            excludedMs: excluded,
          });
        }
      }, 100);
      autoStopRef.current = setTimeout(() => void finishRef.current(), spec.durationMs + 500);
      setDevices(await listAudioInputs().catch(() => []));
    } catch (err) {
      captureRef.current = null;
      setCapture(null);
      setPhase(null);
      engineRef.current = null;
      await engine.stop();
      setError(
        `${errorMessage(err)} Microphone permission is required for the Real-World Calibration Lab. No recording was made.`,
      );
    }
  }, [abortCapture, deviceId]);

  useEffect(() => {
    void load();
    void listAudioInputs().then(setDevices).catch(() => undefined);
    return () => {
      clearTimers();
      captureRef.current = null;
      void engineRef.current?.stop();
    };
  }, [load]);

  const trainModel = async () => {
    setTraining(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api<{ activated: boolean; model: { status: string; version: string } }>(
        `/api/operator/objects/${objectId}/train`,
        { method: 'POST' },
      );
      await load();
      if (!result.activated) {
        setError(
          `The model was rejected by the safety gate and left inactive (${result.model.version}). The lab will not lower the threshold; improve the live takes and retrain.`,
        );
      } else {
        setNotice(
          `Model ${result.model.version} trained from your live takes. Retraining starts a new field test; earlier trials no longer count.`,
        );
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setTraining(false);
    }
  };

  const generateReport = async () => {
    setReporting(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api<{ report: FieldTestReport; fieldTest: FieldTestStateView }>(
        `/api/operator/objects/${objectId}/field-report`,
        { method: 'POST' },
      );
      setView((previous) => (previous ? { ...previous, fieldTest: result.fieldTest } : previous));
      setNotice(
        result.report.status === 'FIELD_PASS'
          ? 'Field-test report generated. Every gate passed; the report is inspectable and the model can be published.'
          : 'Field-test report generated as FIELD_FAIL. The failed gates are preserved; the model remains blocked.',
      );
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setReporting(false);
    }
  };

  const discardTrial = async (trial: FieldTrialView) => {
    if (!window.confirm(`Discard this ${TRIAL_COPY[trial.kind].title} attempt? The evidence will be removed and the report invalidated.`)) {
      return;
    }
    setError(null);
    setNotice(null);
    try {
      const result = await api<{ fieldTest: FieldTestStateView }>(
        `/api/operator/objects/${objectId}/field-trials/${trial.recordingId}`,
        { method: 'DELETE' },
      );
      setView((previous) => (previous ? { ...previous, fieldTest: result.fieldTest } : previous));
      setNotice('Field trial discarded. The previous report, if any, was invalidated.');
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  if (loading) return <Loading label="Preparing the Real-World Calibration Lab…" />;
  if (!view) {
    return (
      <div className="page container page--narrow">
        <Notice tone="danger">{error ?? 'Object not found.'}</Notice>
      </div>
    );
  }

  const fieldTest = view.fieldTest;
  const synthetic = fieldTest.status === 'NOT_ELIGIBLE' || fieldTest.model?.provenance === 'SYNTHETIC_REFERENCE';
  const liveTakes = view.takes.filter((take) => take.role === 'TRAINING' && take.source === 'live');
  const liveCounts = {
    idle: liveTakes.filter((take) => take.label === 'idle').length,
    active: liveTakes.filter((take) => take.label === 'active').length,
    negative: liveTakes.filter((take) => take.label === 'negative').length,
  };
  const importedTraining = view.takes.filter((take) => take.role === 'TRAINING' && take.source !== 'live').length;
  const canTrain =
    !synthetic &&
    liveCounts.idle >= 2 &&
    liveCounts.active >= 2 &&
    liveCounts.negative >= 1 &&
    !capture &&
    !uploading &&
    !training;
  const modelReady =
    fieldTest.model?.provenance === 'USER_CALIBRATION' && fieldTest.model.status === 'READY' && Boolean(artifact);
  const busy = Boolean(capture) || uploading || training || reporting;
  const allTrials = fieldTest.trials.length === 4;
  const openGates = fieldTest.gates.filter((entry) => entry.status === 'OPEN');
  const canGenerateReport = allTrials && openGates.length === 0 && !busy;
  const report = fieldTest.report;
  const currentSpec = capture?.spec ?? null;
  const statusLabel = capture?.status === 'REQUESTING' ? 'Waiting for permission' : 'Recording';

  return (
    <div className="page container page--wide">
      <PageHeader
        eyebrow="Real-World Calibration Lab"
        breadcrumbs={
          <>
            <Link to="/studio">Studio</Link> <span aria-hidden="true">/</span>{' '}
            <Link to={`/studio/objects/${objectId}`}>{view.object.name}</Link> <span aria-hidden="true">/</span>{' '}
            <span>Field calibration</span>
          </>
        }
        title="Prove it on a real object."
        lede="Record this appliance from the computer’s actual microphone, train a device-specific model, then test it with guided ON/OFF cycles plus separate noise, distance and replay trials. Every metric is recomputed from held-out captures."
        actions={
          <>
            <LinkButton to={`/studio/objects/${objectId}`} variant="secondary">
              Capture lab
            </LinkButton>
            <LinkButton to={`/studio/objects/${objectId}/model`} variant="secondary">
              Model review
            </LinkButton>
          </>
        }
      />

      <section className="card stack">
        <div className="row row--between" style={{ alignItems: 'flex-start' }}>
          <div className="row" style={{ alignItems: 'flex-start' }}>
            <ObjectGlyph glyph={view.object.glyph} size={54} tone="accent" />
            <div>
              <h2 className="h3">{view.object.name}</h2>
              <span className="tiny muted">
                {fieldTest.model
                  ? `model ${fieldTest.model.version} · ${fieldTest.model.status} · ${fieldTest.model.provenance.replaceAll('_', ' ').toLowerCase()}`
                  : 'not trained yet'}
              </span>
            </div>
          </div>
          <div className="lab-status-strip">
            <StatusChip status={fieldTest.status} />
            <span className="chip">live microphone only</span>
            <span className="chip">no payment action</span>
            <span className="chip">{fieldTest.trials.length}/4 field trials</span>
          </div>
        </div>
        <Notice tone="info" title="What this lab can and cannot prove.">
          The browser extracts acoustic features locally; raw audio never leaves this device. The local server re-runs the
          frozen model on the uploaded features and calculates precision, recall, false-billable time and billing error on
          recordings that were never used for training. This is client-reported live-microphone evidence, not a proof of
          physical presence, and it does not make the meter replay-proof. No PayPal order, authorization or capture is
          created here.
        </Notice>
        <p className="small" style={{ margin: 0 }}>
          <strong>Next step:</strong> {fieldTest.nextStep}
        </p>
      </section>

      {error ? <div style={{ marginTop: '1rem' }}><Notice tone="danger">{error}</Notice></div> : null}
      {notice ? <div style={{ marginTop: '1rem' }}><Notice tone="ok">{notice}</Notice></div> : null}

      {synthetic ? (
        <section className="card stack" style={{ marginTop: '1.25rem' }}>
          <div className="row row--between">
            <div>
              <span className="eyebrow">Synthetic reference</span>
              <h2 className="h2" style={{ fontSize: '1.9rem' }}>This object is the Judge Mode demo.</h2>
            </div>
            <span className="chip chip--warn">FIELD VALIDATION DOES NOT APPLY</span>
          </div>
          <Notice tone="warn" title="Keep synthetic and real evidence separate.">
            The reference fan is trained on procedurally generated fixtures. It remains a separate, reproducible
            demonstration of the pipeline. It cannot earn a real-object field report, and this lab will not accept its
            trials. Create a new object, record it with your own microphone, and run this protocol on that object.
          </Notice>
          <div className="row">
            <LinkButton to="/judge" variant="secondary">Open Judge Mode</LinkButton>
            <LinkButton to="/studio" variant="primary">Create or choose a real object <Icon name="arrow" size={16} /></LinkButton>
          </div>
        </section>
      ) : (
        <section className="card stack" style={{ marginTop: '1.25rem' }}>
          <div className="row row--between" style={{ alignItems: 'flex-start' }}>
            <div>
              <span className="eyebrow">Step 1 · live enrollment</span>
              <h2 className="h2" style={{ fontSize: '2rem' }}>Teach it the ordinary sounds.</h2>
              <p className="small muted" style={{ margin: '0.25rem 0 0' }}>
                Each button opens the microphone for one short take, then closes it. Record this exact object where it
                normally runs.
              </p>
            </div>
            <div className="row">
              {importedTraining > 0 ? <span className="chip chip--danger">{importedTraining} non-live training take(s)</span> : null}
              <span className="chip">{liveTakes.length} live takes</span>
            </div>
          </div>

          {importedTraining > 0 ? (
            <Notice tone="warn" title="Remove non-live training takes before field validation.">
              Field reports require a model trained only from live microphone captures. Imported or synthetic takes are
              visible in the Capture Lab and must be removed (or assigned to validation) before this model can pass the
              live-calibration gate.
            </Notice>
          ) : null}

          <div className="lab-take-grid">
            {TAKE_SPECS.map((spec) => {
              const count = liveCounts[spec.label as 'idle' | 'active' | 'negative'];
              const recordingThis = currentSpec?.key === spec.key;
              return (
                <div key={spec.key} className="panel stack" style={{ gap: '0.55rem' }}>
                  <div className="row row--between">
                    <strong>{spec.title}</strong>
                    <span className={`chip ${count >= spec.target ? 'chip--ok' : ''}`}>
                      {count}/{spec.target}
                    </span>
                  </div>
                  <p className="tiny muted" style={{ margin: 0 }}>{spec.instruction}</p>
                  <span className="tiny mono muted">{(spec.durationMs / 1000).toFixed(0)} s</span>
                  <Button
                    size="sm"
                    variant={recordingThis ? 'danger' : count >= spec.target ? 'ghost' : 'secondary'}
                    onClick={() =>
                      void startCapture({
                        group: 'TAKE',
                        key: spec.key,
                        title: `${spec.title} take`,
                        durationMs: spec.durationMs,
                        takeLabel: spec.label,
                      })
                    }
                    disabled={Boolean(capture) || uploading || recordingThis}
                  >
                    <Icon name="mic" size={15} />
                    {recordingThis ? 'Recording…' : count >= spec.target ? `Record another ${spec.title.toLowerCase()}` : `Record ${spec.title.toLowerCase()}`}
                  </Button>
                </div>
              );
            })}
          </div>

          <div className="row row--between">
            <div className="stack" style={{ gap: '0.2rem' }}>
              <span className="tiny muted">
                Training needs at least 2 live idle takes, 2 live operating takes and 1 live background take. Validation
                takes are never used to fit the model.
              </span>
              {fieldTest.model ? (
                <span className="tiny muted">
                  Current model: {fieldTest.model.version} · {fieldTest.model.status} · trained{' '}
                  {dateTime(fieldTest.model.createdAt)}
                </span>
              ) : null}
            </div>
            <Button onClick={() => void trainModel()} loading={training} disabled={!canTrain}>
              {fieldTest.model ? 'Retrain from live takes' : 'Train device-specific model'} <Icon name="arrow" size={16} />
            </Button>
          </div>
          {!canTrain ? (
            <p className="tiny muted" style={{ margin: 0 }}>
              Finish the live take counts above to enable training. Training is local and deterministic; it does not call a
              cloud model or make a payment.
            </p>
          ) : null}
        </section>
      )}

      <div className="sidebar-layout" style={{ marginTop: '1.5rem' }}>
        <div className="stack-lg">
          <section className="card stack" id="lab-signal">
            <div className="row row--between" style={{ alignItems: 'flex-start' }}>
              <div>
                <span className="eyebrow">Step 2 · live signal</span>
                <h2 className="h2" style={{ fontSize: '2rem' }}>Listen, then close.</h2>
              </div>
              <span className={`chip ${capture?.status === 'RECORDING' ? 'chip--danger' : ''}`}>
                {capture ? statusLabel : 'MIC CLOSED'}
              </span>
            </div>
            <Field label="Audio input" hint="Use the microphone that will actually meter this object during rental." htmlFor="lab-device">
              <Select
                id="lab-device"
                value={deviceId}
                onChange={(event) => setDeviceId(event.target.value)}
                disabled={Boolean(capture)}
              >
                <option value="">System default</option>
                {devices.map((device) => (
                  <option key={device.deviceId} value={device.deviceId}>{device.label}</option>
                ))}
              </Select>
            </Field>

            <SignalTrace
              levels={capture?.status === 'RECORDING' ? levels : []}
              live={capture?.status === 'RECORDING'}
              label={phase?.headline ?? ''}
            />

            {currentSpec ? (
              <div className="lab-phase">
                <div className="row row--between">
                  <span className={`chip ${phase?.tone === 'on' ? 'chip--accent' : phase?.tone === 'off' ? '' : 'chip--warn'}`}>
                    {currentSpec.title}
                  </span>
                  <span className="mono small">
                    {duration(elapsedMs)} / {duration(currentSpec.durationMs)}
                  </span>
                </div>
                <h3 className="h3" style={{ margin: 0 }} aria-live="polite">{phase?.headline ?? 'Preparing…'}</h3>
                <p className="small muted" style={{ margin: 0 }}>{phase?.detail ?? ''}</p>
                <div className="cap-bar" style={{ marginTop: 0 }}>
                  <div className="cap-bar__track">
                    <div
                      className="cap-bar__fill"
                      style={{ width: `${Math.min(100, (elapsedMs / currentSpec.durationMs) * 100)}%` }}
                    />
                  </div>
                </div>
                {live ? (
                  <div className="row" style={{ flexWrap: 'wrap' }}>
                    <span className="chip">{METER_COPY[live.state].label}</span>
                    <span className="chip">p(active) {percent(live.pActive, 1)}</span>
                    <span className="chip chip--warn">excluded {duration(live.excludedMs)}</span>
                    <span className="tiny muted">Uncertain or silent time is never billable.</span>
                  </div>
                ) : (
                  <p className="tiny muted" style={{ margin: 0 }}>
                    Live classification appears after a model is trained. Enrollment takes still extract the same frozen
                    acoustic features.
                  </p>
                )}
                <Button variant="danger" onClick={() => void abortCapture()} block>
                  <Icon name="stop" size={16} /> Stop and discard this capture
                </Button>
              </div>
            ) : (
              <p className="small muted" style={{ margin: 0 }}>
                Nothing is recording. Choose a take or a field trial; the browser will ask for microphone permission and
                the trace will only move while the microphone is genuinely open.
              </p>
            )}
          </section>

          <section className="stack">
            <div className="row row--between">
              <div>
                <span className="eyebrow">Step 3 · held-out field trials</span>
                <h2 className="h2" style={{ fontSize: '2rem' }}>Then try to fool it.</h2>
              </div>
              <span className="chip">{fieldTest.trials.filter((trial) => trial.status === 'PASS').length}/4 passed</span>
            </div>
            <div className="lab-trial-grid">
              {(Object.keys(TRIAL_COPY) as FieldTrialKind[]).map((kind) => (
                <TrialCard
                  key={kind}
                  kind={kind}
                  state={fieldTest}
                  disabled={!modelReady || synthetic}
                  busy={busy}
                  onStart={(trialKind) => {
                    const copy = TRIAL_COPY[trialKind];
                    void startCapture({
                      group: 'TRIAL',
                      key: `trial:${trialKind}`,
                      title: copy.title,
                      durationMs: copy.durationMs,
                      trialKind,
                    });
                    window.setTimeout(() => document.getElementById('lab-signal')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
                  }}
                  onDiscard={(trial) => void discardTrial(trial)}
                />
              ))}
            </div>
            {!modelReady ? (
              <Notice tone="warn" title="A READY, live-calibrated model is required for trials.">
                Record the live takes and train first. The lab will not run field trials against the synthetic reference
                model or a rejected model.
              </Notice>
            ) : null}
          </section>

          <section className="card stack">
            <div className="row row--between" style={{ alignItems: 'flex-start' }}>
              <div>
                <span className="eyebrow">Step 4 · inspectable report</span>
                <h2 className="h2" style={{ fontSize: '2rem' }}>The measured outcome.</h2>
              </div>
              <StatusChip status={fieldTest.status} />
            </div>
            <p className="small muted" style={{ margin: 0 }}>
              The report is generated only after all four trials exist. It contains the model version and hash, anonymised
              recording metadata, the protocol, every gate, the computed metrics and the limitations. A failing gate is
              preserved as a failure.
            </p>
            <div className="row">
              <Button onClick={() => void generateReport()} loading={reporting} disabled={!canGenerateReport}>
                {report ? 'Regenerate field-test report' : 'Generate field-test report'}
              </Button>
              {report ? (
                <>
                  <Link className="btn btn--secondary btn--sm" to={`/field-report/${report.id}`}>
                    <Icon name="external" size={15} /> Inspect public report
                  </Link>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => downloadJson(report, `whirr-field-test-${view.object.id}.json`)}
                  >
                    <Icon name="download" size={15} /> Download JSON
                  </Button>
                </>
              ) : null}
            </div>
            {!allTrials ? (
              <p className="tiny muted" style={{ margin: 0 }}>
                {4 - fieldTest.trials.length} trial(s) remaining. A partial report is not generated.
              </p>
            ) : openGates.length > 0 ? (
              <p className="tiny muted" style={{ margin: 0 }}>
                Open gates must be resolved before a report can be stored: {openGates.map((entry) => entry.id).join(', ')}.
              </p>
            ) : null}

            {report ? (
              <div className="stack">
                <Notice tone={report.status === 'FIELD_PASS' ? 'ok' : 'danger'} title={report.status === 'FIELD_PASS' ? 'Field test passed.' : 'Field test failed.'}>
                  {report.outcomeDetail}
                </Notice>
                <div className="grid-2" style={{ gap: '0.6rem' }}>
                  <TrialMetric label="Precision" value={percent(report.metrics.precision, 2)} />
                  <TrialMetric label="Recall" value={percent(report.metrics.recall, 2)} />
                  <TrialMetric label="False-billable time" value={`${duration(report.metrics.falseBillableMs)} · ${percent(report.metrics.falseBillableRatio, 2)}`} />
                  <TrialMetric label="Billing error" value={`${duration(report.metrics.billingErrorMs)} · ${percent(report.metrics.billingErrorRatio, 2)}`} />
                  <TrialMetric label="Noise false-billable" value={percent(report.metrics.noiseFalseBillableRatio, 2)} />
                  <TrialMetric label="Distance active" value={percent(report.metrics.distanceActiveRatio, 2)} />
                  <TrialMetric label="Replay active" value={percent(report.metrics.replayActiveRatio, 2)} />
                  <TrialMetric label="Recorded" value={duration(report.metrics.totalRecordedMs)} />
                </div>
                {report.status === 'FIELD_PASS' ? (
                  view.terms ? (
                    <div className="row">
                      <LinkButton to={`/s/${view.object.id}`} variant="primary">Open the Listening Room card</LinkButton>
                      <LinkButton to={`/studio/objects/${view.object.id}/card`} variant="secondary">Service card studio</LinkButton>
                    </div>
                  ) : (
                    <div className="row">
                      <LinkButton to={`/studio/objects/${view.object.id}/pricing`} variant="primary">Publish terms to go live</LinkButton>
                    </div>
                  )
                ) : (
                  <Notice tone="danger" title="Blocked from pricing and Listening Room sessions.">
                    The field report is a failure. Retake only the failed trial, or improve the live calibration and retrain.
                    No safety threshold is relaxed to turn this into a pass.
                  </Notice>
                )}
                <details className="diagnostics-drawer">
                  <summary className="small"><Icon name="shield" size={15} /> Evidence, methodology and limitations</summary>
                  <div className="stack" style={{ marginTop: '0.75rem' }}>
                    <p className="tiny mono break" style={{ margin: 0 }}>evidence hash {report.evidenceHash}</p>
                    <p className="tiny mono break" style={{ margin: 0 }}>model {report.model.version} · {report.model.hash}</p>
                    <ul className="small muted" style={{ margin: 0 }}>
                      {report.methodology.map((line) => <li key={line}>{line}</li>)}
                    </ul>
                    <ul className="small muted" style={{ margin: 0 }}>
                      {report.limitations.map((line) => <li key={line}>{line}</li>)}
                    </ul>
                  </div>
                </details>
              </div>
            ) : null}
          </section>
        </div>

        <aside className="stack">
          <section className="card stack">
            <div className="row row--between">
              <h2 className="h3">Protocol</h2>
              <span className="chip chip--warn">physical steps required</span>
            </div>
            <dl className="kv">
              <dt>Enrollment</dt><dd>2 idle · 2 operating · 1 background, live only</dd>
              <dt>Cycle trial</dt><dd>31 s · 3 × (4 s off, 5 s on) + 4 s off</dd>
              <dt>Noise</dt><dd>12 s · object off</dd>
              <dt>Distance</dt><dd>12 s · object on at ≥2 m</dd>
              <dt>Replay</dt><dd>12 s · phone playback, should not bill</dd>
            </dl>
            <p className="tiny muted" style={{ margin: 0 }}>
              The human-required part is physical: switch the appliance on and off at the prompts, move it 2 m away, and play
              a recording of it. The software cannot perform those actions for you.
            </p>
          </section>

          <section className="card stack">
            <div className="row row--between">
              <h2 className="h3">Safety gates</h2>
              <span className="chip">{fieldTest.gates.filter((entry) => entry.status === 'PASS').length}/{fieldTest.gates.length || 12} pass</span>
            </div>
            <GateList gates={fieldTest.gates} />
          </section>

          <section className="card stack">
            <h2 className="h3">Limitations</h2>
            <ul className="small muted" style={{ margin: 0, paddingLeft: '1rem' }}>
              {fieldTest.limitations.map((line) => <li key={line}>{line}</li>)}
            </ul>
          </section>

          {artifact?.soundprint ? (
            <section className="card stack">
              <h2 className="h3">Enrolled identity</h2>
              <p className="small muted" style={{ margin: 0 }}>
                This model is {artifact.soundprint.status === 'ENROLLED' ? 'enrolled' : 'limited'} at{' '}
                {percent(artifact.soundprint.matchThreshold, 2)} similarity. The soundprint is a calibration-fit consistency
                check, not an anti-spoof guarantee.
              </p>
              <Link className="btn btn--ghost btn--sm" to={`/passport/${view.object.id}`}>Open acoustic passport</Link>
            </section>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
