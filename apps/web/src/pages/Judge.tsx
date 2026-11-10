import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../lib/api.ts';
import type { JudgeStatus } from '../../../../packages/contracts/src/types.ts';
import {
  assertModelArtifact,
  predictFrame,
  type ModelArtifact,
} from '../../../../packages/audio/src/classifier.ts';
import { MeterStream, type MeterInterval } from '../../../../packages/audio/src/hysteresis.ts';
import { FRAME_MS } from '../../../../packages/audio/src/spec.ts';
import { fetchWav, MicrophoneEngine } from '../lib/audio.ts';
import { quoteBreakdown } from '../../../../packages/meter/src/pricing.ts';
import type { MeterState } from '../../../../packages/meter/src/intervals.ts';
import {
  Button,
  LinkButton,
  Loading,
  Notice,
  PageHeader,
  Stat,
  usePageTitle,
} from '../components/ui.tsx';
import {
  Icon,
  MeterStateBadge,
  ObjectGlyph,
  Timeline,
  TimelineLegend,
  Waveform,
} from '../components/visuals.tsx';
import { METER_COPY, duration, money } from '../lib/format.ts';

async function loadModel(url: string): Promise<ModelArtifact> {
  const response = await fetch(url, { credentials: 'same-origin' });
  if (!response.ok) throw new Error(`Reference model is not available (${response.status}). Run npm run setup.`);
  const value = (await response.json()) as unknown;
  assertModelArtifact(value);
  return value;
}

function billFor(billableMs: number) {
  return quoteBreakdown(20, billableMs, 500, 0, 'USD');
}

function LocalClassifier({ modelUrl, available }: { modelUrl: string; available: boolean }) {
  const [model, setModel] = useState<ModelArtifact | null>(null);
  const [running, setRunning] = useState(false);
  const [state, setState] = useState<MeterState>('DISCONNECTED');
  const [level, setLevel] = useState(0);
  const [billable, setBillable] = useState(0);
  const [intervals, setIntervals] = useState<MeterInterval[]>([]);
  const [error, setError] = useState<string | null>(null);
  const engineRef = useRef<MicrophoneEngine | null>(null);
  const meterRef = useRef<MeterStream | null>(null);
  const billedRef = useRef(0);
  const lastRef = useRef(0);
  const runningRef = useRef(false);

  useEffect(
    () => () => {
      runningRef.current = false;
      void engineRef.current?.stop();
    },
    [],
  );

  const start = async () => {
    setError(null);
    try {
      const artifact = model ?? (await loadModel(modelUrl));
      setModel(artifact);
      setIntervals([]);
      setBillable(0);
      billedRef.current = 0;
      lastRef.current = 0;
      const meter = new MeterStream(artifact.policy);
      meter.reset(0);
      meterRef.current = meter;
      const engine = new MicrophoneEngine({
        onFrame: (frame) => {
          if (!runningRef.current) return;
          const end = frame.endMs;
          lastRef.current = end;
          const prediction = predictFrame(artifact, frame.features, frame.flags, Math.max(0, end - FRAME_MS), end);
          const closed = meter.push(prediction);
          for (const interval of closed) {
            if (interval.state === 'ACTIVE_CONFIDENT') billedRef.current += interval.endMs - interval.startMs;
            setIntervals((previous) => [...previous.slice(-300), interval]);
          }
          const open = meter.currentState === 'ACTIVE_CONFIDENT' ? Math.max(0, end - meter.currentStartMs) : 0;
          setBillable(billedRef.current + open);
          setState(meter.currentState);
        },
        onLevel: setLevel,
        onError: (message) => setError(message),
        onEnded: () => {
          setRunning(false);
          runningRef.current = false;
          setState('DISCONNECTED');
        },
      });
      engineRef.current = engine;
      runningRef.current = true;
      await engine.start();
      setRunning(true);
    } catch (err) {
      runningRef.current = false;
      setRunning(false);
      setError(errorMessage(err));
      await engineRef.current?.stop();
    }
  };

  const stop = async () => {
    runningRef.current = false;
    setRunning(false);
    const meter = meterRef.current;
    if (meter) {
      const closed = meter.flush(lastRef.current);
      for (const interval of closed) {
        if (interval.state === 'ACTIVE_CONFIDENT') billedRef.current += interval.endMs - interval.startMs;
      }
      setBillable(billedRef.current);
    }
    await engineRef.current?.stop();
    engineRef.current = null;
    setState('DISCONNECTED');
  };

  return (
    <section className="card stack">
      <div className="row row--between">
        <div>
          <h2 className="h3">Live local classifier</h2>
          <p className="small muted">Bring the object near this device and press start. Inference runs in this tab.</p>
        </div>
        <span className="chip chip--warn">demonstration · no billing</span>
      </div>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <div className="panel stack" style={{ gap: '0.7rem' }}>
        <div className="row row--between">
          <MeterStateBadge state={running ? state : 'DISCONNECTED'} />
          <span className="mono small">{duration(billable)} would be billable</span>
        </div>
        <Waveform level={level} live={running} />
        <div className="row row--between">
          <span className="tiny muted">
            {running ? METER_COPY[state].detail : 'Microphone is closed. Nothing is uploaded.'}
          </span>
          {running ? (
            <Button variant="danger" size="sm" onClick={() => void stop()}>
              <Icon name="stop" size={15} /> Stop
            </Button>
          ) : (
            <Button variant="money" size="sm" onClick={() => void start()} disabled={!available}>
              <Icon name="mic" size={15} /> Start live demo
            </Button>
          )}
        </div>
      </div>
      {intervals.length > 0 ? (
        <>
          <Timeline
            intervals={intervals}
            totalMs={Math.max(lastRef.current, 1000)}
            height={40}
            label="Live local classifier state timeline; no server billing"
          />
          <TimelineLegend />
        </>
      ) : null}
      <p className="tiny muted">
        This demo has no cap, no consent and no payment. It proves the browser pipeline, not the provider flow.
      </p>
    </section>
  );
}

interface ReplayResult {
  intervals: MeterInterval[];
  billableMs: number;
  durationMs: number;
  model: ModelArtifact;
}

function Replay({ status }: { status: JudgeStatus }) {
  const [result, setResult] = useState<ReplayResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const [model, recording] = await Promise.all([
        loadModel(status.reference.modelUrl),
        fetchWav(status.reference.fixtureUrl),
      ]);
      const meter = new MeterStream(model.policy);
      meter.reset(0);
      const intervals: MeterInterval[] = [];
      let billed = 0;
      let last = 0;
      for (const frame of recording.frames) {
        const end = frame.endMs;
        last = end;
        const prediction = predictFrame(model, frame.features, frame.flags, Math.max(0, end - FRAME_MS), end);
        const closed = meter.push(prediction);
        for (const interval of closed) {
          if (interval.state === 'ACTIVE_CONFIDENT') billed += interval.endMs - interval.startMs;
          intervals.push(interval);
        }
      }
      for (const interval of meter.flush(last)) {
        if (interval.state === 'ACTIVE_CONFIDENT') billed += interval.endMs - interval.startMs;
        intervals.push(interval);
      }
      setResult({ intervals, billableMs: billed, durationMs: recording.durationMs, model });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const quote = result ? billFor(result.billableMs) : null;

  return (
    <section className="card stack">
      <div className="row row--between">
        <div>
          <h2 className="h3">Synthetic fixture replay</h2>
          <p className="small muted">
            {status.reference.fixtureLabel} · {status.reference.fixtureDurationMs ? duration(status.reference.fixtureDurationMs) : '—'}
          </p>
        </div>
        <span className="chip chip--danger">synthetic · not live evidence</span>
      </div>
      <p className="small muted">
        The fixture is procedurally generated audio: 5s idle, 15s running, 10s idle, 20s running, 5s idle. Replay runs
        the exact feature extractor and hysteresis used live, but it proves the pipeline, not field accuracy.
      </p>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <div className="row">
        <Button onClick={() => void run()} loading={busy} disabled={!status.reference.available}>
          Run deterministic replay
        </Button>
        {result ? (
          <>
            <span className="chip">
              {result.intervals.length} intervals
            </span>
            <span className="chip chip--ok">
              {duration(result.billableMs)} billable
            </span>
            <span className="chip chip--accent">
              {money(quote?.finalMinor ?? 0, 'USD')} simulated
            </span>
          </>
        ) : null}
      </div>
      {result ? (
        <>
          <Timeline
            intervals={result.intervals}
            totalMs={Math.max(result.durationMs, 1000)}
            height={48}
            label="Replay timeline: the fixture's deterministic meter states"
          />
          <TimelineLegend />
          <div className="panel">
            <code className="mono tiny break">{quote?.formula}</code>
          </div>
          <p className="tiny muted">
            At the PRD demo rate of $0.20/min and a $5.00 cap, 35s of confident activity rounds once to{' '}
            {money(quote?.finalMinor ?? 0, 'USD')}. The actual result above comes from the classifier, not from the
            expected script.
          </p>
        </>
      ) : null}
    </section>
  );
}

export function Judge() {
  usePageTitle('Judge mode');
  const [status, setStatus] = useState<JudgeStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<JudgeStatus>('/api/judge/status')
      .then(setStatus)
      .catch((err) => setError(errorMessage(err)));
  }, []);

  if (!status) {
    return error ? (
      <div className="page container page--narrow">
        <Notice tone="danger">{error}</Notice>
      </div>
    ) : (
      <Loading label="Collecting real gates…" />
    );
  }

  const pass = status.checks.filter((check) => check.status === 'PASS').length;
  const open = status.checks.filter((check) => check.status === 'OPEN').length;
  const fail = status.checks.filter((check) => check.status === 'FAIL').length;

  return (
    <div className="page container page--wide">
      <PageHeader
        eyebrow="Judge mode"
        title="Proof, with the gaps left visible."
        lede="These gates are computed from the database, the filesystem and the provider configuration right now. A missing credential, recording or webhook is shown as OPEN, never painted green."
        actions={
          <>
            <LinkButton to="/ambient/judge" variant="money">Whirr 7.0 Ambient</LinkButton>
            <LinkButton to="/promise" variant="primary">Whirr 6.0 physical promises</LinkButton>
            <LinkButton to="/invisible-checkout" variant="secondary">Whirr 5.0 experiment</LinkButton>
            <LinkButton to="/verify" variant="secondary">Open offline verifier</LinkButton>
            <LinkButton to={status.demoObjectId ? `/s/${status.demoObjectId}` : '/studio'} variant="primary">
              Run the full loop <Icon name="arrow" size={16} />
            </LinkButton>
          </>
        }
      />

      <div className="grid-4" style={{ marginBottom: '1.5rem' }}>
        <Stat label="Passing gates" value={pass} tone="accent" />
        <Stat label="Open gates" value={open} />
        <Stat label="Failing gates" value={fail} />
        <Stat label="Sessions" value={status.stats.sessions} />
      </div>

      <div className="sidebar-layout">
        <div className="stack">
          <section className="card stack">
            <div className="row row--between">
              <div className="stack" style={{ gap: '0.25rem' }}>
                <span className="eyebrow">Judge gauntlet</span>
                <h2 className="h3">Six stations. Six honest boundaries.</h2>
              </div>
              <span className="chip chip--accent">interactive demo path</span>
            </div>
            <div className="step-grid">
              {[
                ['01', 'Calibrate', 'The object has a measured soundprint and held-out takes.', 'It does not prove the object is unique or that the room will never change.'],
                ['02', 'Preflight', 'The microphone has signal, stable level and no severe clipping.', 'It does not detect playback or know what the microphone will hear later.'],
                ['03', 'Consent', 'The renter saw the exact terms hash and hard cap before sensing.', 'It is not informed consent for every possible acoustic condition.'],
                ['04', 'Live meter', 'Each second is classified from features, with free uncertainty.', 'It cannot prove physical presence or prevent a similar machine.'],
                ['05', 'Dispute', 'A structured reason and interval selection can reduce the bill.', 'It cannot adjudicate conflicting accounts of the physical world.'],
                ['06', 'Offline verify', 'The signed bytes and embedded key verify without the server.', 'It is not a third-party timestamp or a trusted identity.'],
              ].map(([number, title, proves, not]) => (
                <article key={number} className="step">
                  <span className="eyebrow">{number}</span>
                  <h3 className="h3">{title}</h3>
                  <p className="small muted"><strong style={{ color: 'var(--ink)' }}>Proves:</strong> {proves}</p>
                  <p className="tiny muted"><strong>Does not prove:</strong> {not}</p>
                </article>
              ))}
            </div>
            <p className="tiny muted">
              Full protocol and verification notes: <span className="mono">docs/acoustic-protocol.md</span> and{' '}
              <span className="mono">docs/proof-verification.md</span>. Every synthetic artifact stays labelled synthetic.
            </p>
          </section>

          <section className="card stack">
            <div className="row row--between">
              <h2 className="h3">Readiness gates</h2>
              <span className="chip">{status.checks.length}</span>
            </div>
            <div className="stack" style={{ gap: '0.5rem' }}>
              {status.checks.map((check) => (
                <div
                  key={check.id}
                  className="panel"
                  style={{
                    borderLeft: `3px solid ${check.status === 'PASS' ? 'var(--ok)' : check.status === 'FAIL' ? 'var(--danger)' : 'var(--warn)'}`,
                  }}
                >
                  <div className="row row--between">
                    <strong className="small">{check.label}</strong>
                    <span className={`chip ${check.status === 'PASS' ? 'chip--ok' : check.status === 'FAIL' ? 'chip--danger' : 'chip--warn'}`}>
                      {check.status}
                    </span>
                  </div>
                  <p className="tiny muted" style={{ marginTop: 4 }}>{check.detail}</p>
                </div>
              ))}
            </div>
            <p className="tiny muted">
              This page deliberately exposes every open gate. The repository's <span className="mono">docs/go-no-go.md</span>{' '}
              is the canonical list; a green gate here never overrides a missing external deliverable.
            </p>
          </section>

          <LocalClassifier modelUrl={status.reference.modelUrl} available={status.reference.available} />
          <Replay status={status} />

          <section className="card stack">
            <h2 className="h3">Reference artifact</h2>
            {status.reference.available ? (
              <>
                <div className="row">
                  <span className="chip chip--ok">available</span>
                  <span className="chip">{status.reference.modelVersion}</span>
                  <span className="chip">{status.reference.provenance === 'SYNTHETIC_REFERENCE' ? 'synthetic' : 'calibrated'}</span>
                </div>
                <dl className="kv">
                  <dt>Model hash</dt>
                  <dd className="mono tiny break">{status.reference.modelHash}</dd>
                  <dt>Fixture</dt>
                  <dd className="mono tiny break">{status.reference.fixture}</dd>
                  <dt>Fixture length</dt>
                  <dd>{status.reference.fixtureDurationMs ? duration(status.reference.fixtureDurationMs) : '—'}</dd>
                  <dt>Label</dt>
                  <dd>{status.reference.fixtureLabel}</dd>
                </dl>
                <p className="small muted">
                  This model is trained on synthetic takes produced by code in this repository. Its metrics are real
                  measurements of that synthetic dataset and are <strong>not</strong> evidence of accuracy on a physical
                  fan. A user-calibrated model is required for that claim.
                </p>
              </>
            ) : (
              <Notice tone="warn" title="Reference artifact missing.">
                Run <span className="mono">npm run setup</span> to generate the synthetic fan fixture, train the
                reference model and seed the database.
              </Notice>
            )}
          </section>
        </div>

        <aside className="stack">
          <section className="card card--dark stack">
            <span className="eyebrow" style={{ color: 'rgba(245,238,228,.55)' }}>Whirr 7.0</span>
            <h2 className="h3">Buy a condition, not a product.</h2>
            <p className="small" style={{ color: 'rgba(245,238,228,.7)' }}>
              Ambient lets a buyer request an observable pause, a provider voluntarily accept, and a deterministic
              evaluator decide whether the agreed continuous window actually occurred.{' '}
            </p>
            <LinkButton to="/ambient/judge" variant="secondary">Open Ambient judge mode</LinkButton>
            <p className="tiny" style={{ color: 'rgba(245,238,228,.45)' }}>
              Seeded histories are synthetic and labelled. Genuine Sandbox capture stays open until a human completes it.
            </p>
          </section>

          <section className="card card--dark stack">
            <span className="eyebrow" style={{ color: 'rgba(245,238,228,.55)' }}>The claim</span>
            <h2 className="h2">An ordinary object can be a metered service.</h2>
            <p className="small" style={{ color: 'rgba(245,238,228,.7)' }}>
              Whirr measures use from sound, excludes ambiguity, caps the damage, and exposes every step to the renter
              and the judge. It does not secure the object or pretend acoustic evidence is a lock.
            </p>
            <div className="row">
              <span className="chip chip--dark">{status.paypal.configured ? 'PayPal Sandbox connected' : 'Demo metering'}</span>
              <span className="chip chip--dark">{status.stats.verifiedWebhookEvents} verified webhooks</span>
            </div>
          </section>

          <section className="card stack">
            <h2 className="h3">The four states</h2>
            {(['ACTIVE_CONFIDENT', 'IDLE', 'UNCERTAIN', 'DISCONNECTED'] as MeterState[]).map((state) => (
              <div key={state} className="row" style={{ alignItems: 'flex-start' }}>
                <MeterStateBadge state={state} />
                <span className="tiny muted" style={{ flex: 1 }}>{METER_COPY[state].detail}</span>
              </div>
            ))}
            <p className="tiny muted">
              Thresholds and hysteresis are frozen in the model artifact, so a receipt can be re-verified later.
            </p>
          </section>

          <section className="card card--soft stack">
            <h2 className="h3">Full loop</h2>
            <p className="small muted">
              {status.demoObjectId
                ? 'The seeded reference service is ready. Open it as a renter to test consent, authorization, sensing and settlement end to end.'
                : 'Seed the reference service with npm run setup, then open its card.'}
            </p>
            {status.demoObjectId ? (
              <LinkButton to={`/s/${status.demoObjectId}`} variant="primary" block>
                Open reference service <Icon name="external" size={15} />
              </LinkButton>
            ) : (
              <code className="mono tiny">npm run setup</code>
            )}
            <Link to="/demo/offline" className="link tiny">Offline fixture replay →</Link>
          </section>

          <section className="card stack">
            <h2 className="h3">What is not proven here</h2>
            <ul className="checklist checklist--x">
              <li><Icon name="alert" size={14} /> <span className="tiny">Accuracy on a physical object (the reference is synthetic).</span></li>
              <li><Icon name="alert" size={14} /> <span className="tiny">A live PayPal capture without Sandbox credentials.</span></li>
              <li><Icon name="alert" size={14} /> <span className="tiny">A public webhook delivery without a tunnel and webhook ID.</span></li>
              <li><Icon name="alert" size={14} /> <span className="tiny">Physical security: the meter can be fooled by playback.</span></li>
              <li><Icon name="alert" size={14} /> <span className="tiny">5.0 discovery: no two-object physical enrollment, no held-out report, and no identity claim.</span></li>
            </ul>
          </section>
        </aside>
      </div>
    </div>
  );
}
