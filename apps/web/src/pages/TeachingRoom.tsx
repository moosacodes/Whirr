import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '../lib/api.ts';
import {
  analyzeWavBuffer,
  listAudioInputs,
  MicrophoneEngine,
  type AudioInputDevice,
  type CapturedFrame,
} from '../lib/audio.ts';
import { FEATURE_SPEC_VERSION } from '../../../../packages/audio/src/spec.ts';
import type { PromiseLabView } from '../../../../packages/contracts/src/types.ts';
import type { EventDemonstrationView, EventModelDetailView } from '../../../../packages/contracts/src/types.ts';
import type { CompiledAgreement } from '../../../../packages/promise/src/index.ts';
import {
  Button,
  EmptyState,
  Field,
  LinkButton,
  Loading,
  Notice,
  PageHeader,
  Select,
  TextArea,
  TextInput,
  usePageTitle,
} from '../components/ui.tsx';
import { Icon, Waveform } from '../components/visuals.tsx';
import { duration, percent } from '../lib/format.ts';

type DemoLabel = 'idle' | 'active' | 'negative' | 'transition';

const DEMO_COPY: Record<DemoLabel, { title: string; hint: string; capture: string }> = {
  idle: {
    title: 'Idle',
    hint: 'The object is present but not working. Capture room hum and the machine at rest.',
    capture: 'Record idle',
  },
  active: {
    title: 'Running',
    hint: 'The object is doing the work that the promise should recognize.',
    capture: 'Record running',
  },
  negative: {
    title: 'Background',
    hint: 'Another appliance, speech, music or a similar-but-wrong sound that must not advance the promise.',
    capture: 'Record background',
  },
  transition: {
    title: 'Interruption',
    hint: 'Optional transition or interrupted sound. This is negative evidence; completion stays temporal.',
    capture: 'Record interruption',
  },
};

export function TeachingRoom() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [lab, setLab] = useState<PromiseLabView | null>(null);
  const [model, setModel] = useState<EventModelDetailView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [label, setLabel] = useState<DemoLabel>('idle');
  const [seconds, setSeconds] = useState(6);
  const [recording, setRecording] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [level, setLevel] = useState(0);
  const [pending, setPending] = useState<{ frames: CapturedFrame[]; durationMs: number; source: 'live' | 'import' } | null>(null);
  const [devices, setDevices] = useState<AudioInputDevice[]>([]);
  const [deviceId, setDeviceId] = useState('');
  const [busy, setBusy] = useState(false);
  const [serviceName, setServiceName] = useState('One qualified operating cycle');
  const [proposal, setProposal] = useState(
    'Charge $2 for one complete cycle. The machine must run for at least 15 seconds and return to idle. Do not charge if it stops early or the microphone disconnects.',
  );
  const [compiled, setCompiled] = useState<CompiledAgreement | null>(null);
  const [publishedId, setPublishedId] = useState<string | null>(null);
  const engineRef = useRef<MicrophoneEngine | null>(null);
  const framesRef = useRef<CapturedFrame[]>([]);
  const recordingRef = useRef(false);
  const startedAtRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoStopRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  usePageTitle('Teaching Room');

  const objectId = searchParams.get('objectId') ?? lab?.selected?.object.id ?? '';

  const load = useCallback(async (selectedId?: string) => {
    try {
      const query = selectedId ? `?objectId=${encodeURIComponent(selectedId)}` : '';
      const view = await api<PromiseLabView>(`/api/operator/promises/lab${query}`);
      setLab(view);
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(objectId || undefined);
    return () => {
      recordingRef.current = false;
      if (timerRef.current) clearInterval(timerRef.current);
      if (autoStopRef.current) clearTimeout(autoStopRef.current);
      void engineRef.current?.stop();
    };
  }, [load]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadModel = async () => {
    if (!lab?.selected?.eventModel) return;
    setBusy(true);
    try {
      const detail = await api<EventModelDetailView>(`/api/operator/promises/model/${lab.selected.eventModel.id}`);
      setModel(detail);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

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
      setError('That demonstration was too short. Record at least three seconds.');
      return;
    }
    const last = frames[frames.length - 1];
    setPending({ frames, durationMs: Math.round(last?.endMs ?? seconds * 1000), source: 'live' });
  }, [seconds]);

  const startRecording = async () => {
    if (!lab?.selected) return;
    setError(null);
    setNotice(null);
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
          if (recordingRef.current) framesRef.current.push(frame);
        },
        onLevel: setLevel,
        onError: (message) => setError(message),
        onEnded: () => {
          if (recordingRef.current) {
            setError('The microphone disconnected. This demonstration was stopped; nothing was saved.');
            void stopRecording();
          }
        },
      });
      engineRef.current = engine;
      await engine.start(deviceId || undefined);
      setDevices(await listAudioInputs());
      timerRef.current = setInterval(() => {
        const ms = Date.now() - startedAtRef.current;
        setElapsedMs(ms);
        if (ms >= seconds * 1000 + 250) void stopRecording();
      }, 100);
      autoStopRef.current = setTimeout(() => void stopRecording(), seconds * 1000 + 600);
    } catch (err) {
      recordingRef.current = false;
      setRecording(false);
      setError(`${errorMessage(err)} Microphone permission is required for a live demonstration.`);
    }
  };

  const uploadDemo = async () => {
    if (!pending || !lab?.selected) return;
    setBusy(true);
    setError(null);
    try {
      await api<EventDemonstrationView>(`/api/operator/objects/${lab.selected.object.id}/promise-demos`, {
        method: 'POST',
        body: {
          label,
          frames: pending.frames.map((frame) => frame.features),
          frameFlags: pending.frames.map((frame) => frame.flags),
          durationMs: Math.round(pending.durationMs),
          featureSpecVersion: FEATURE_SPEC_VERSION,
          source: pending.source,
          deviceLabel: devices.find((device) => device.deviceId === deviceId)?.label ?? null,
          notes: null,
          sessionGroup: `teach-${Date.now()}`,
        },
      });
      setPending(null);
      setNotice(`Saved a ${DEMO_COPY[label].title.toLowerCase()} demonstration.`);
      await load(lab.selected.object.id);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const importWav = async (file: File) => {
    setError(null);
    setPending(null);
    try {
      const analyzed = await analyzeWavBuffer(await file.arrayBuffer());
      const frames: CapturedFrame[] = analyzed.frames.map((frame) => ({
        endMs: frame.endMs,
        features: frame.features,
        flags: frame.flags,
      }));
      if (frames.length > 4_000) throw new Error('Recording is too long. Import a clip under 128 seconds.');
      setPending({ frames, durationMs: analyzed.durationMs, source: 'import' });
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const train = async () => {
    if (!lab?.selected) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const trained = await api<EventModelDetailView>(`/api/operator/objects/${lab.selected.object.id}/promise-train`, {
        method: 'POST',
        body: {},
      });
      setModel(trained);
      setNotice(
        trained.status === 'READY'
          ? `Model ${trained.version} passed the local validation gate.`
          : `Model ${trained.version} is ${trained.status}. Review the reasons before publishing.`,
      );
      await load(lab.selected.object.id);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const compile = async () => {
    if (!lab?.selected?.eventModel) return;
    setBusy(true);
    setError(null);
    setPublishedId(null);
    try {
      const result = await api<CompiledAgreement>('/api/operator/promises/compile', {
        method: 'POST',
        body: {
          objectId: lab.selected.object.id,
          eventModelId: lab.selected.eventModel.id,
          serviceName,
          text: proposal,
        },
      });
      setCompiled(result);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const publish = async () => {
    if (!compiled || !lab?.selected?.eventModel) return;
    setBusy(true);
    setError(null);
    try {
      const agreement = await api<{ id: string }>('/api/operator/promises/publish', {
        method: 'POST',
        body: {
          objectId: lab.selected.object.id,
          eventModelId: lab.selected.eventModel.id,
          serviceName,
          text: proposal,
          termsHash: compiled.hash,
          terms: compiled.terms,
          approved: true,
        },
      });
      setPublishedId(agreement.id);
      setNotice('The exact compiled terms were published. Buyers now see this immutable revision.');
      await load(lab.selected.object.id);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <div className="page"><div className="container"><Loading label="Opening the Teaching Room…" /></div></div>;
  }

  if (!lab) {
    return <div className="page"><div className="container"><Notice tone="danger">{error ?? 'The Teaching Room is unavailable.'}</Notice></div></div>;
  }

  if (lab.objects.length === 0) {
    return (
      <div className="page">
        <div className="container">
          <EmptyState title="Create an object first" action={<LinkButton to="/studio">Open Studio</LinkButton>}>
            The Teaching Room teaches an existing physical object. Create or seed one, then return here.
          </EmptyState>
        </div>
      </div>
    );
  }

  const selected = lab.selected;
  const demoCounts = selected?.demonstrations.reduce<Record<string, number>>((counts, demo) => {
    counts[demo.label] = (counts[demo.label] ?? 0) + 1;
    return counts;
  }, {}) ?? {};

  return (
    <div className="page promise-page">
      <div className="container stack stack--lg">
        <PageHeader
          eyebrow="The Teaching Room"
          title="Show Whirr what the work sounds like."
          lede="Capture real demonstrations, train a small local event model, then compile the exact conditions that make an observable cycle payable."
          actions={
            <Select
              aria-label="Choose object"
              value={selected?.object.id ?? ''}
              onChange={(event) => {
                setSearchParams({ objectId: event.target.value });
                void load(event.target.value);
              }}
            >
              {lab.objects.map((object) => (
                <option key={object.id} value={object.id}>{object.name}</option>
              ))}
            </Select>
          }
        />

        {error ? <Notice tone="danger">{error}</Notice> : null}
        {notice ? <Notice tone="ok">{notice}</Notice> : null}

        <div className="teach-grid">
          <section className="card stack">
            <div className="row row--between">
              <div>
                <span className="eyebrow">Stage A · Demonstrate</span>
                <h2 className="h2">Teach the acoustic vocabulary.</h2>
              </div>
              <span className="chip">{selected?.demonstrations.length ?? 0} takes</span>
            </div>
            <p className="small muted">
              The model learns IDLE, RUNNING and BACKGROUND. Completion is always a temporal inference from returning
              to idle, never a separately invented completion sound.
            </p>

            <div className="teach-labels" role="tablist" aria-label="Demonstration class">
              {(Object.keys(DEMO_COPY) as DemoLabel[]).map((key) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={label === key}
                  className={`teach-label${label === key ? ' is-selected' : ''}`}
                  onClick={() => setLabel(key)}
                >
                  <strong>{DEMO_COPY[key].title}</strong>
                  <span>{demoCounts[key] ?? 0} takes</span>
                </button>
              ))}
            </div>

            <div className="teach-capture">
              <div>
                <span className="eyebrow">{DEMO_COPY[label].capture}</span>
                <p className="small muted">{DEMO_COPY[label].hint}</p>
              </div>
              <Waveform level={level} live={recording} />
              <div className="row row--between">
                <span className="mono small">
                  {recording ? `${(elapsedMs / 1000).toFixed(1)}s · mic live` : 'MIC CLOSED'}
                </span>
                {recording ? (
                  <Button variant="danger" size="sm" onClick={() => void stopRecording()}>
                    <Icon name="stop" size={15} /> Stop
                  </Button>
                ) : (
                  <Button variant="money" size="sm" onClick={() => void startRecording()} disabled={busy}>
                    <Icon name="mic" size={15} /> {DEMO_COPY[label].capture}
                  </Button>
                )}
              </div>
            </div>

            <div className="teach-controls">
              <Field label="Take length">
                <Select value={seconds} onChange={(event) => setSeconds(Number(event.target.value))}>
                  <option value={4}>4 seconds</option>
                  <option value={6}>6 seconds</option>
                  <option value={8}>8 seconds</option>
                  <option value={10}>10 seconds</option>
                </Select>
              </Field>
              <Field label="Microphone">
                <Select value={deviceId} onChange={(event) => setDeviceId(event.target.value)}>
                  <option value="">Browser default</option>
                  {devices.map((device) => (
                    <option key={device.deviceId} value={device.deviceId}>{device.label}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Import a WAV take">
                <input
                  className="input"
                  type="file"
                  accept="audio/wav,audio/x-wav"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void importWav(file);
                  }}
                />
              </Field>
            </div>

            {pending ? (
              <div className="teach-pending">
                <div>
                  <strong>Ready to save {DEMO_COPY[label].title.toLowerCase()}</strong>
                  <span className="small muted">{duration(pending.durationMs)} · {pending.frames.length} frames · {pending.source}</span>
                </div>
                <div className="row">
                  <Button variant="ghost" size="sm" onClick={() => setPending(null)}>Discard</Button>
                  <Button variant="primary" size="sm" loading={busy} onClick={() => void uploadDemo()}>Save take</Button>
                </div>
              </div>
            ) : null}

            <div className="teach-takes">
              {selected?.demonstrations.slice(0, 12).map((demo) => (
                <div className="teach-take" key={demo.id}>
                  <span className={`chip chip--${demo.label === 'active' ? 'ok' : demo.label === 'negative' ? 'warn' : ''}`}>
                    {demo.label}
                  </span>
                  <span className="mono tiny">{demo.frameCount} frames</span>
                  <span className="tiny muted">{demo.sessionGroup}</span>
                </div>
              ))}
              {selected?.demonstrations.length === 0 ? (
                <p className="small muted">No demonstrations yet. Record at least two takes for each core class.</p>
              ) : null}
            </div>
          </section>

          <section className="card stack">
            <span className="eyebrow">Stage B · Learn</span>
            <div className="row row--between">
              <div>
                <h2 className="h2">What did Whirr learn?</h2>
                <p className="small muted">Leave-one-take-out validation. No frame from the held-out take enters training.</p>
              </div>
              {selected?.eventModel ? (
                <span className={`chip chip--${selected.eventModel.status === 'READY' ? 'ok' : 'warn'}`}>
                  {selected.eventModel.status}
                </span>
              ) : null}
            </div>
            {selected?.eventModel ? (
              <>
                <div className="promise-metrics promise-metrics--dark">
                  <div><span className="mono">{percent(selected.eventModel.metrics.macroRecall)}</span><span className="tiny muted">macro recall</span></div>
                  <div><span className="mono">{percent(selected.eventModel.metrics.frameAccuracy)}</span><span className="tiny muted">frame accuracy</span></div>
                  <div><span className="mono">{percent(selected.eventModel.metrics.unknownRate)}</span><span className="tiny muted">unknown refusal</span></div>
                </div>
                <div className="confusion">
                  <div className="confusion__row confusion__row--head">
                    <span />
                    {selected.eventModel.metrics.confusionLabels.map((event) => <span key={event}>{event}</span>)}
                  </div>
                  {selected.eventModel.metrics.confusion.map((row, index) => (
                    <div className="confusion__row" key={selected.eventModel!.metrics.confusionLabels[index]}>
                      <span>{selected.eventModel!.metrics.confusionLabels[index]}</span>
                      {row.map((value, cell) => <span key={cell}>{value}</span>)}
                    </div>
                  ))}
                </div>
                {selected.eventModel.statusReasons.length > 0 ? (
                  <Notice tone="warn" title="The gate is not satisfied.">
                    {selected.eventModel.statusReasons.join(' ')}
                  </Notice>
                ) : null}
                <div className="row">
                  <Button variant="secondary" size="sm" loading={busy} onClick={() => void train()}>Retrain</Button>
                  <Button variant="ghost" size="sm" loading={busy} onClick={() => void loadModel()}>Inspect full model</Button>
                </div>
                {model ? (
                  <details className="promise-details">
                    <summary>Model artifact and limitations</summary>
                    <pre className="proof-json">{JSON.stringify(model, null, 2).slice(0, 24_000)}</pre>
                  </details>
                ) : null}
              </>
            ) : (
              <div className="step-empty">
                <Icon name="wave" size={28} />
                <p className="small muted">Record demonstrations, then train. The model will stay LIMITED or REJECTED if the classes are not separable.</p>
                <Button variant="secondary" loading={busy} onClick={() => void train()} disabled={(selected?.demonstrations.length ?? 0) === 0}>
                  Train event model
                </Button>
              </div>
            )}
          </section>
        </div>

        <section className="card stack">
          <div className="row row--between">
            <div>
              <span className="eyebrow">Stage C · Define the promise</span>
              <h2 className="h2">Turn language into exact rules.</h2>
            </div>
            <span className="chip chip--warn">narrow grammar, explicit numbers</span>
          </div>
          <div className="promise-compose">
            <Field label="Service name">
              <TextInput value={serviceName} onChange={(event) => setServiceName(event.target.value)} maxLength={80} />
            </Field>
            <Field
              label="Describe what should be paid for"
              hint="Supported: one fixed price in USD, a minimum run duration, one completed cycle, and a no-charge failure policy. Ambiguous or variable terms are rejected."
            >
              <TextArea value={proposal} onChange={(event) => setProposal(event.target.value)} rows={4} maxLength={800} />
            </Field>
            <div className="row">
              <Button variant="primary" loading={busy} onClick={() => void compile()} disabled={!selected?.eventModel || selected.eventModel.status !== 'READY'}>
                Compile exact agreement
              </Button>
              {selected?.eventModel?.status !== 'READY' ? (
                <span className="small muted">A READY event model is required.</span>
              ) : null}
            </div>
          </div>

          {compiled ? (
            <div className="compiled">
              <div className="row row--between">
                <div>
                  <span className="eyebrow">Compiled revision {compiled.terms.revision}</span>
                  <h3 className="h3">{compiled.executable ? 'This agreement is executable.' : 'This agreement is not executable.'}</h3>
                </div>
                <span className={`chip chip--${compiled.executable ? 'ok' : 'danger'}`}>{compiled.executable ? 'READY' : 'REJECTED'}</span>
              </div>
              <div className="compiled__grid">
                {compiled.terms.requiredSequence.join(' → ')} · {(compiled.terms.constraints.minRunMs / 1000).toFixed(1)}s min · ${(compiled.terms.financial.fixedPriceMinor / 100).toFixed(2)} fixed
              </div>
              {compiled.issues.length > 0 ? (
                <ul className="promise-rules promise-rules--warn">
                  {compiled.issues.map((issue) => <li key={`${issue.code}-${issue.message}`}><strong>{issue.severity}:</strong> {issue.message}</li>)}
                </ul>
              ) : null}
              <details className="promise-details">
                <summary>Inspect compiled terms and digest</summary>
                <pre className="proof-json">{JSON.stringify({ hash: compiled.hash, terms: compiled.terms }, null, 2)}</pre>
              </details>
              <div className="row">
                <Button variant="money" loading={busy} disabled={!compiled.executable} onClick={() => void publish()}>
                  Approve and publish exact terms
                </Button>
                {publishedId ? <LinkButton to={`/promise/${publishedId}`} variant="secondary">Open published promise</LinkButton> : null}
              </div>
            </div>
          ) : null}
        </section>

        {selected?.agreements.length ? (
          <section className="stack">
            <span className="eyebrow">Published from this object</span>
            <div className="promise-catalog">
              {selected.agreements.map((agreement) => (
                <Link key={agreement.id} to={`/promise/${agreement.id}`} className="promise-card">
                  <span className="eyebrow">{agreement.serviceName}</span>
                  <strong>{agreement.object.name}</strong>
                  <span className="small muted">{agreement.terms.requiredSequence.join(' → ')}</span>
                  <span className="mono">{agreement.termsHash.slice(0, 18)}…</span>
                </Link>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
