import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, errorMessage } from '../lib/api.ts';
import {
  analyzeWavBuffer,
  listAudioInputs,
  MicrophoneEngine,
  type AudioInputDevice,
  type CapturedFrame,
} from '../lib/audio.ts';
import { FEATURE_SPEC_VERSION } from '../../../../packages/audio/src/spec.ts';
import type {
  CalibrationTakeView,
  OwnerObjectView,
  TakeLabel,
  TakeRole,
} from '../../../../packages/contracts/src/types.ts';
import {
  Button,
  Field,
  Loading,
  Notice,
  PageHeader,
  Select,
  TextInput,
  usePageTitle,
} from '../components/ui.tsx';
import { Icon, ObjectGlyph, SoundprintBars, Waveform } from '../components/visuals.tsx';
import { duration } from '../lib/format.ts';

const LABEL_COPY: Record<TakeLabel, { title: string; hint: string; tone: string }> = {
  active: {
    title: 'Object running',
    hint: 'The object is switched on and doing its normal job. This is what becomes billable time.',
    tone: 'chip--accent',
  },
  idle: {
    title: 'Object idle',
    hint: 'Plugged in or present, but not running. Includes room hum and ordinary background noise.',
    tone: '',
  },
  negative: {
    title: 'Different sound',
    hint: 'Another appliance, a voice, music or a similar-but-not-this machine. Helps avoid false bills.',
    tone: 'chip--warn',
  },
  transition: {
    title: 'Switching on/off',
    hint: 'Optional: the ramp from idle to running or back. Teaches the classifier about boundaries.',
    tone: '',
  },
};

interface PendingTake {
  label: TakeLabel;
  frames: CapturedFrame[];
  durationMs: number;
  source: 'live' | 'import';
  deviceLabel: string | null;
}

export function Teach() {
  const { objectId = '' } = useParams();
  const navigate = useNavigate();
  const [view, setView] = useState<OwnerObjectView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [label, setLabel] = useState<TakeLabel>('active');
  const [role, setRole] = useState<TakeRole>('TRAINING');
  const [seconds, setSeconds] = useState(12);
  const [recording, setRecording] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [level, setLevel] = useState(0);
  const [pending, setPending] = useState<PendingTake | null>(null);
  const [uploading, setUploading] = useState(false);
  const [training, setTraining] = useState(false);
  const [devices, setDevices] = useState<AudioInputDevice[]>([]);
  const [deviceId, setDeviceId] = useState('');
  const [notes, setNotes] = useState('');

  const engineRef = useRef<MicrophoneEngine | null>(null);
  const framesRef = useRef<CapturedFrame[]>([]);
  const startedAtRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoStopRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recordingRef = useRef(false);

  usePageTitle(view ? `${view.object.name} capture lab` : 'Capture lab');

  const load = useCallback(async () => {
    try {
      setView(await api<OwnerObjectView>(`/api/operator/objects/${objectId}`));
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [objectId]);

  useEffect(() => {
    void load();
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (autoStopRef.current) clearTimeout(autoStopRef.current);
      recordingRef.current = false;
      void engineRef.current?.stop();
    };
  }, [load]);

  const stopRecording = useCallback(async () => {
    if (!recordingRef.current) return;
    recordingRef.current = false;
    setRecording(false);
    if (timerRef.current) clearInterval(timerRef.current);
    if (autoStopRef.current) clearTimeout(autoStopRef.current);
    timerRef.current = null;
    autoStopRef.current = null;
    const engine = engineRef.current;
    engineRef.current = null;
    if (engine) await engine.stop();
    const frames = framesRef.current;
    if (frames.length < 30) {
      setError('That take was too short. Record at least three seconds.');
      return;
    }
    const last = frames[frames.length - 1];
    setPending({
      label,
      frames,
      durationMs: Math.round(last?.endMs ?? seconds * 1000),
      source: 'live',
      deviceLabel: devices.find((device) => device.deviceId === deviceId)?.label ?? null,
    });
  }, [deviceId, devices, label, seconds]);

  const startRecording = async () => {
    setError(null);
    setPending(null);
    framesRef.current = [];
    setElapsedMs(0);
    setLevel(0);
    recordingRef.current = true;
    startedAtRef.current = Date.now();
    setRecording(true);
    try {
      const engine = new MicrophoneEngine({
        onFrame: (frame) => {
          if (!recordingRef.current) return;
          framesRef.current.push(frame);
        },
        onLevel: setLevel,
        onError: (message) => setError(message),
        onEnded: () => {
          if (recordingRef.current) {
            setError('The microphone was disconnected; this take was stopped.');
            void stopRecording();
          }
        },
      });
      engineRef.current = engine;
      await engine.start(deviceId || undefined);
      try {
        setDevices(await listAudioInputs());
      } catch {
        // Device labels require permission; failure is non-fatal.
      }
      timerRef.current = setInterval(() => {
        const ms = Date.now() - startedAtRef.current;
        setElapsedMs(ms);
        if (ms >= seconds * 1000 + 250) void stopRecording();
      }, 100);
      autoStopRef.current = setTimeout(() => void stopRecording(), seconds * 1000 + 600);
    } catch (err) {
      recordingRef.current = false;
      setRecording(false);
      setError(
        `${errorMessage(err)} Microphone permission is required for live capture; you can import a WAV instead.`,
      );
    }
  };

  const uploadPending = async () => {
    if (!pending) return;
    setUploading(true);
    setError(null);
    try {
      await api<{ take: CalibrationTakeView }>(`/api/operator/objects/${objectId}/takes`, {
        method: 'POST',
        body: {
          label: pending.label,
          frames: pending.frames.map((frame) => frame.features),
          frameFlags: pending.frames.map((frame) => frame.flags),
          durationMs: Math.max(500, Math.min(120_000, Math.round(pending.durationMs))),
          source: pending.source,
          deviceLabel: pending.deviceLabel,
          notes: notes.trim() || null,
          featureSpecVersion: FEATURE_SPEC_VERSION,
          role,
        },
      });
      setPending(null);
      setNotes('');
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setUploading(false);
    }
  };

  const importWav = async (file: File) => {
    setError(null);
    setPending(null);
    try {
      if (file.size > 64 * 1024 * 1024) throw new Error('WAV file is too large (maximum 64 MB).');
      const analyzed = await analyzeWavBuffer(await file.arrayBuffer());
      const frames: CapturedFrame[] = analyzed.frames.map((frame) => ({
        endMs: frame.endMs,
        features: frame.features,
        flags: frame.flags,
      }));
      if (frames.length > 3_000) throw new Error('Recording is longer than 96 seconds; import a shorter clip.');
      setPending({
        label,
        frames,
        durationMs: Math.min(120_000, analyzed.durationMs),
        source: 'import',
        deviceLabel: `Imported WAV · ${Math.round(analyzed.sourceSampleRate / 1000)} kHz`,
      });
      setElapsedMs(analyzed.durationMs);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const train = async () => {
    setTraining(true);
    setError(null);
    try {
      const result = await api<{ activated: boolean; model: { status: string; version: string } }>(
        `/api/operator/objects/${objectId}/train`,
        { method: 'POST' },
      );
      if (!result.activated) {
        setError(
          `The model was rejected by the safety gate and left inactive${result.model ? ` (${result.model.version})` : ''}. Review why and retrain.`,
        );
        await load();
        return;
      }
      navigate(`/studio/objects/${objectId}/model`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setTraining(false);
    }
  };

  const changeRole = async (takeId: string, nextRole: TakeRole) => {
    try {
      await api(`/api/operator/objects/${objectId}/takes/${takeId}/role`, {
        method: 'PUT',
        body: { role: nextRole },
      });
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const removeTake = async (takeId: string) => {
    if (!window.confirm('Delete this calibration take? This cannot be undone.')) return;
    try {
      await api(`/api/operator/objects/${objectId}/takes/${takeId}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const purge = async () => {
    if (!window.confirm('Delete all calibration takes for this object? The trained model stays until retrained.')) return;
    try {
      await api(`/api/operator/objects/${objectId}/purge-calibration`, { method: 'POST' });
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  if (loading) return <Loading label="Opening capture lab…" />;
  if (!view) {
    return (
      <div className="page container page--narrow">
        <Notice tone="danger">{error ?? 'Object not found.'}</Notice>
      </div>
    );
  }

  const counts = view.takeCounts;
  const canTrain = counts.idle >= 2 && counts.active >= 2 && counts.negative >= 2;
  const coreTakesDone = Math.min(2, counts.idle) + Math.min(2, counts.active) + Math.min(2, counts.negative);
  const progress = Math.min(100, (elapsedMs / (seconds * 1000)) * 100);
  const pendingQuality = pending
    ? {
        clipped: pending.frames.filter((frame) => frame.flags.includes('CLIPPED')).length / pending.frames.length,
        silent: pending.frames.filter((frame) => frame.flags.includes('SILENT') || frame.flags.includes('LOW_LEVEL')).length / pending.frames.length,
        levels: pending.frames.map((frame) => frame.features[0] ?? -8),
      }
    : null;
  const pendingVariance = pendingQuality
    ? pendingQuality.levels.reduce((sum, value) => sum + (value - pendingQuality.levels.reduce((a, b) => a + b, 0) / pendingQuality.levels.length) ** 2, 0) / pendingQuality.levels.length
    : 0;

  return (
    <div className="page container page--wide">
      <PageHeader
        eyebrow="Capture lab"
        breadcrumbs={
          <>
            <Link to="/studio">Studio</Link> <span aria-hidden="true">/</span> <span>{view.object.name}</span>
          </>
        }
        title={
          <span className="row" style={{ gap: '0.8rem' }}>
            <ObjectGlyph glyph={view.object.glyph} size={54} tone="accent" /> {view.object.name}
          </span>
        }
        lede="Record short, labelled takes of this exact object. Features are extracted in your browser; the raw audio never leaves this device."
        actions={
          <Link className="btn btn--secondary" to={`/studio/objects/${objectId}/model`}>
            Model review
          </Link>
        }
      />

      {error ? (
        <div style={{ marginBottom: '1rem' }}>
          <Notice tone="danger">{error}</Notice>
        </div>
      ) : null}

      <div className="sidebar-layout">
        <div className="stack-lg">
          <section className="card stack">
            <div className="row row--between">
              <div>
                <h2 className="h3">New take</h2>
                <p className="small muted">One label per take. Keep the phone or laptop where it will sit during rental.</p>
              </div>
              <span className="chip">
                <Icon name="mic" size={13} /> on-device features
              </span>
            </div>

            <div className="grid-2">
              <Field label="Label" hint={LABEL_COPY[label].hint} htmlFor="take-label">
                <Select
                  id="take-label"
                  value={label}
                  onChange={(event) => setLabel(event.target.value as TakeLabel)}
                  disabled={recording}
                >
                  {(Object.keys(LABEL_COPY) as TakeLabel[]).map((value) => (
                    <option key={value} value={value}>
                      {LABEL_COPY[value].title}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={`Length — ${seconds}s`} hint="12–15 seconds is usually enough. Maximum 30." htmlFor="take-length">
                <input
                  id="take-length"
                  className="range"
                  type="range"
                  min={5}
                  max={30}
                  step={1}
                  value={seconds}
                  onChange={(event) => setSeconds(Number(event.target.value))}
                  disabled={recording}
                />
              </Field>
            </div>

            <Field label="Take role" hint="Held-out validation takes are never used to fit the model they evaluate.">
              <div className="row">
                <Select value={role} onChange={(event) => setRole(event.target.value as TakeRole)} disabled={recording}>
                  <option value="TRAINING">Training take</option>
                  <option value="VALIDATION">Held-out validation take</option>
                </Select>
                {role === 'VALIDATION' ? <span className="chip chip--warn">excluded from training</span> : null}
              </div>
            </Field>

            <div className="grid-2">
              <Field label="Audio input" hint="Choose the device that will hear the object during rental." htmlFor="input-device">
                <Select id="input-device" value={deviceId} onChange={(event) => setDeviceId(event.target.value)} disabled={recording}>
                  <option value="">System default</option>
                  {devices.map((device) => (
                    <option key={device.deviceId} value={device.deviceId}>
                      {device.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Notes (optional)" hint="e.g. speed setting, placement, room." htmlFor="take-notes">
                <TextInput
                  id="take-notes"
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  maxLength={400}
                  placeholder="Speed 2, 1m from the desk"
                  disabled={recording}
                />
              </Field>
            </div>

            <div className="panel stack" style={{ gap: '0.7rem' }}>
              <div className="row row--between">
                <span className={`state state--${recording ? 'active_confident' : 'idle'}`}>
                  <span className="state__dot" aria-hidden="true" />
                  {recording ? 'Recording' : 'Microphone idle'}
                </span>
                <span className="mono small">{duration(elapsedMs)} / {seconds}.0s</span>
              </div>
              <Waveform level={level} live={recording} />
              <div className="cap-bar" style={{ marginTop: 0 }}>
                <div className="cap-bar__track">
                  <div className="cap-bar__fill" style={{ width: `${recording ? progress : 0}%` }} />
                </div>
              </div>
              <div className="row">
                {recording ? (
                  <Button variant="danger" onClick={() => void stopRecording()}>
                    <Icon name="stop" size={16} /> Stop now
                  </Button>
                ) : (
                  <Button onClick={() => void startRecording()} variant="money">
                    <Icon name="mic" size={16} /> Record {LABEL_COPY[label].title.toLowerCase()}
                  </Button>
                )}
                <label className="btn btn--ghost btn--sm" style={{ cursor: 'pointer' }}>
                  <Icon name="download" size={15} /> Import WAV
                  <input
                    type="file"
                    accept="audio/wav,audio/x-wav,audio/wave,.wav"
                    hidden
                    disabled={recording}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void importWav(file);
                      event.target.value = '';
                    }}
                  />
                </label>
              </div>
              <p className="tiny muted">
                Live mode requests a clean microphone feed with echo cancellation, noise suppression and automatic gain
                control disabled, so the acoustic features stay stable.
              </p>
            </div>

            {pending ? (
              <div className="panel panel--accent stack">
                <div className="row row--between">
                  <strong>Ready to upload</strong>
                  <span className={`chip ${LABEL_COPY[pending.label].tone}`}>{LABEL_COPY[pending.label].title}</span>
                </div>
                <div className="small">
                  {pending.frames.length} frames · {duration(pending.durationMs)} · {pending.source === 'import' ? 'imported WAV' : 'live microphone'}
                </div>
                {pendingQuality ? (
                  <div className="grid-3" style={{ gap: '0.5rem' }}>
                    <div className="panel">
                      <span className="stat__label">Clipping</span>
                      <div className="small mono">{(pendingQuality.clipped * 100).toFixed(1)}%</div>
                    </div>
                    <div className="panel">
                      <span className="stat__label">Silence</span>
                      <div className="small mono">{(pendingQuality.silent * 100).toFixed(1)}%</div>
                    </div>
                    <div className="panel">
                      <span className="stat__label">Level variance</span>
                      <div className="small mono">{pendingVariance.toFixed(3)}</div>
                    </div>
                  </div>
                ) : null}
                {pendingQuality && (pendingQuality.clipped > 0.15 || pendingQuality.silent > 0.35 || pendingVariance > 0.08) ? (
                  <Notice tone="warn" title="This take may not teach the meter much.">
                    Clipping, silence or an unstable level may make the take hard to learn from. Reposition the microphone and
                    record another take. A weak take is worse than none.
                  </Notice>
                ) : null}
                <div className="row">
                  <Button onClick={() => void uploadPending()} loading={uploading}>
                    Upload features
                  </Button>
                  <Button variant="ghost" onClick={() => setPending(null)} disabled={uploading}>
                    Discard
                  </Button>
                </div>
                <p className="tiny muted">
                  Only {pending.frames.length} × 21 floating-point features are sent, never the audio waveform.
                </p>
              </div>
            ) : null}
          </section>

          <section className="card stack">
            <div className="row row--between">
              <h2 className="h3">Calibration takes</h2>
              <span className="tiny muted">{view.takes.length} / 24</span>
            </div>
            {view.takes.length === 0 ? (
              <p className="small muted">No takes yet. Record at least two idle, two running and two different-sound takes.</p>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Label</th>
                      <th>Role</th>
                      <th>Length</th>
                      <th>Frames</th>
                      <th>Quality</th>
                      <th>Captured</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {view.takes.map((take) => (
                      <tr key={take.id}>
                        <td>
                          <span className={`chip ${LABEL_COPY[take.label].tone}`}>{LABEL_COPY[take.label].title}</span>
                          {take.deviceLabel ? <div className="tiny muted">{take.deviceLabel}</div> : null}
                        </td>
                        <td>
                          <Select
                            value={take.role}
                            onChange={(event) => void changeRole(take.id, event.target.value as TakeRole)}
                            style={{ minWidth: 128 }}
                          >
                            <option value="TRAINING">Training</option>
                            <option value="VALIDATION">Validation</option>
                          </Select>
                        </td>
                        <td className="mono">{duration(take.durationMs)}</td>
                        <td className="mono">{take.frameCount}</td>
                        <td className="tiny">
                          clipped {(take.quality.clippedRatio * 100).toFixed(0)}% · silent{' '}
                          {(take.quality.silentRatio * 100).toFixed(0)}%
                        </td>
                        <td className="tiny muted">{new Date(take.createdAt).toLocaleDateString()}</td>
                        <td>
                          <Button variant="ghost" size="sm" onClick={() => void removeTake(take.id)}>
                            Delete
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {view.takes.length > 0 ? (
              <Button variant="ghost" size="sm" onClick={() => void purge()}>
                Purge all calibration data
              </Button>
            ) : null}
          </section>
        </div>

        <aside className="stack">
          <section className="card stack">
            <div className="row row--between">
              <h2 className="h3">Six-take sitting</h2>
              <span className={`chip ${coreTakesDone === 6 ? 'chip--ok' : ''}`}>{coreTakesDone} / 6 core</span>
            </div>
            <div className="progress-steps">
              <span className={counts.idle >= 2 ? 'is-done' : 'is-current'}>2 idle</span>
              <span className={counts.active >= 2 ? 'is-done' : ''}>2 running</span>
              <span className={counts.negative >= 2 ? 'is-done' : ''}>2 different-sound</span>
            </div>
            <p className="tiny muted">
              Transition and held-out validation takes are optional extras. They are not counted in the six core takes.
            </p>
          </section>

          <section className="card stack">
            <div className="row row--between">
              <h2 className="h3">Separability preview</h2>
              <span className={`chip ${view.calibrationPreview.status === 'SEPARABLE' ? 'chip--ok' : view.calibrationPreview.status === 'TOO_SIMILAR' ? 'chip--warn' : ''}`}>
                {view.calibrationPreview.status === 'SEPARABLE' ? 'separable' : view.calibrationPreview.status === 'TOO_SIMILAR' ? 'too similar' : 'not enough data'}
              </span>
            </div>
            {view.calibrationPreview.soundprint ? (
              <SoundprintBars soundprint={view.calibrationPreview.soundprint} height={110} />
            ) : null}
            <p className="small muted">{view.calibrationPreview.detail}</p>
            <p className="tiny muted">
              {view.calibrationPreview.activeTakes} active · {view.calibrationPreview.nonActiveTakes} non-active training takes.
              This is a calibration-fit passport preview, not held-out accuracy, identity proof or anti-spoof.
            </p>
            {view.calibrationPreview.status === 'TOO_SIMILAR' ? (
              <Notice tone="warn" title="These takes sound too similar.">
                More takes of the same sound will not help. Add contrast: record the room with the object off, a different
                speed or condition, and a genuinely different appliance as the negative take.
              </Notice>
            ) : null}
          </section>

          <section className="card stack">
            <h2 className="h3">Training readiness</h2>
            <div className="stack" style={{ gap: '0.5rem' }}>
              {(
                [
                  ['idle', 2, 'Idle / room sound'],
                  ['active', 2, 'Object running'],
                  ['negative', 2, 'Different sound'],
                ] as Array<[TakeLabel, number, string]>
              ).map(([key, need, title]) => (
                <div key={key} className="row row--between">
                  <span className="small">{title}</span>
                  <span className={`chip ${counts[key] >= need ? 'chip--ok' : 'chip--warn'}`}>
                    {counts[key]} / {need}
                  </span>
                </div>
              ))}
              {counts.transition > 0 ? (
                <div className="row row--between">
                  <span className="small">Transitions</span>
                  <span className="chip">{counts.transition}</span>
                </div>
              ) : null}
              <div className="row row--between">
                <span className="small">Held-out validation takes</span>
                <span className={`chip ${view.validationTakeCount > 0 ? 'chip--ok' : ''}`}>{view.validationTakeCount}</span>
              </div>
            </div>
            <hr className="divider" />
            <p className="tiny muted">
              Training is a real multinomial logistic regression with leave-one-take-out validation. A model must reach
              95% precision and ≤2% false billable time to bill automatically; otherwise it is LIMITED or REJECTED.
            </p>
            <Button onClick={() => void train()} loading={training} disabled={!canTrain} block>
              Train model
            </Button>
            {!canTrain ? <p className="tiny muted">Add more labelled takes to unlock training.</p> : null}
          </section>

          <section className="card card--soft stack">
            <h2 className="h3">What the classifier sees</h2>
            <p className="small muted">
              Each 32&nbsp;ms frame becomes 21 numbers: log mel-band energies, spectral flux, flatness, ZCR, rolloff,
              centroid and spread, plus clipping and silence flags.
            </p>
            <div className="row">
              <span className="chip chip--accent">low-frequency energy</span>
              <span className="chip">harmonicity</span>
              <span className="chip">flux</span>
            </div>
            <p className="tiny muted">
              No raw audio, no speech transcript and no recording is stored. The meter cannot recognise words.
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}
