import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '../lib/api.ts';
import type {
  EventModelDetailView,
  PromiseExecutionView,
  PromiseProofView,
} from '../../../../packages/contracts/src/types.ts';
import { MicrophoneEngine } from '../lib/audio.ts';
import { PromiseObservationCollector, type PromiseLiveSnapshot } from '../lib/promise-audio.ts';
import {
  Button,
  LinkButton,
  Loading,
  Notice,
  PageHeader,
  SandboxBanner,
  Stat,
  usePageTitle,
} from '../components/ui.tsx';
import { Icon, Waveform } from '../components/visuals.tsx';
import { duration, money, percent } from '../lib/format.ts';

const EMPTY_SNAPSHOT: PromiseLiveSnapshot = {
  elapsedMs: 0,
  state: 'CLOSED',
  confidence: 0,
  event: null,
  eventMatch: 0,
  runMs: 0,
  idleMs: 0,
  uncertainMs: 0,
  sensorLossMs: 0,
  started: false,
  completed: false,
  currentRunStartMs: null,
  currentRunMs: 0,
};

const STAGES = ['IDLE', 'START', 'RUNNING', 'EXPECTED_STOP'] as const;

export function PromiseRun() {
  const { executionId = '' } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [execution, setExecution] = useState<PromiseExecutionView | null>(null);
  const [model, setModel] = useState<EventModelDetailView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<PromiseLiveSnapshot>(EMPTY_SNAPSHOT);
  const [level, setLevel] = useState(0);
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [, setProof] = useState<PromiseProofView | null>(null);
  const collectorRef = useRef<PromiseObservationCollector | null>(null);
  const engineRef = useRef<MicrophoneEngine | null>(null);
  const runningRef = useRef(false);
  const clientSeqRef = useRef(0);
  const uploadingRef = useRef(false);
  const lastUploadRef = useRef(0);
  const stoppingRef = useRef(false);
  const completedRef = useRef(false);
  usePageTitle(execution?.serviceName ?? 'Physical promise execution');

  const load = useCallback(async () => {
    try {
      const view = await api<PromiseExecutionView>(`/api/promises/executions/${executionId}`);
      setExecution(view);
      setSnapshot((current) => ({
        ...current,
        elapsedMs: view.meterClockMs,
        runMs: view.runMs,
        idleMs: view.idleMs,
        uncertainMs: view.uncertainMs,
        sensorLossMs: view.sensorLossMs,
      }));
      setError(null);
      return view;
    } catch (err) {
      setError(errorMessage(err));
      return null;
    } finally {
      setLoading(false);
    }
  }, [executionId]);

  useEffect(() => {
    void load();
    return () => {
      runningRef.current = false;
      void engineRef.current?.stop();
      collectorRef.current?.disconnect();
    };
  }, [load]);

  const uploadPending = useCallback(async (force = false) => {
    const collector = collectorRef.current;
    if (!collector || uploadingRef.current) return;
    if (!force && Date.now() - lastUploadRef.current < 1_600) return;
    const intervals = collector.drain();
    if (intervals.length === 0) return;
    uploadingRef.current = true;
    lastUploadRef.current = Date.now();
    clientSeqRef.current += 1;
    try {
      const view = await api<PromiseExecutionView>(`/api/promises/executions/${executionId}/observations`, {
        method: 'POST',
        body: { clientSeq: clientSeqRef.current, intervals },
      });
      setExecution(view);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      uploadingRef.current = false;
    }
  }, [executionId]);

  const stopLive = useCallback(async () => {
    if (stoppingRef.current) return;
    stoppingRef.current = true;
    runningRef.current = false;
    setRunning(false);
    const collector = collectorRef.current;
    const engine = engineRef.current;
    engineRef.current = null;
    if (collector) {
      collector.finish(collector.snapshot.elapsedMs);
      await uploadPending(true);
    }
    if (engine) await engine.stop();
    try {
      const view = await api<PromiseExecutionView>(`/api/promises/executions/${executionId}/stop`, {
        method: 'POST',
        body: { reason: collector?.snapshot.completed ? 'COMPLETED' : 'USER_STOP' },
      });
      setExecution(view);
      setNotice(view.eligibleForCapture ? 'The contract qualified. No payment has been captured yet.' : 'Observation complete. The contract did not qualify for capture.');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      stoppingRef.current = false;
      collectorRef.current = null;
    }
  }, [executionId, uploadPending]);

  const startLive = async () => {
    if (!execution) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const modelDetail = model ?? (await api<EventModelDetailView>(`/api/promises/${execution.agreementId}/model`));
      setModel(modelDetail);
      const collector = new PromiseObservationCollector({
        artifact: modelDetail.artifact,
        minRunMs: execution.terms.constraints.minRunMs,
        onTick: (next) => {
          setSnapshot(next);
          if (next.completed && !completedRef.current && runningRef.current) {
            completedRef.current = true;
            setNotice('Expected stop observed. Closing the observation automatically.');
            void uploadPending(true);
            setTimeout(() => void stopLive(), 700);
          } else if (Date.now() - lastUploadRef.current > 1_800) {
            void uploadPending();
          }
        },
      });
      collectorRef.current = collector;
      collector.open();
      const engine = new MicrophoneEngine({
        onFrame: (frame) => collectorRef.current?.pushFrame(frame),
        onLevel: setLevel,
        onError: (message) => setError(message),
        onEnded: () => {
          if (!runningRef.current) return;
          runningRef.current = false;
          setRunning(false);
          const current = collectorRef.current;
          current?.disconnect('MICROPHONE_ENDED');
          setError('The microphone disconnected. The attempt is not eligible for automatic capture.');
          void uploadPending(true).finally(() => void stopLive());
        },
      });
      engineRef.current = engine;
      await engine.start();
      runningRef.current = true;
      setRunning(true);
      const started = await api<PromiseExecutionView>(`/api/promises/executions/${executionId}/start`, {
        method: 'POST',
        body: {},
      });
      setExecution(started);
    } catch (err) {
      runningRef.current = false;
      setRunning(false);
      setError(`${errorMessage(err)} The microphone is opened only after you press start.`);
      await engineRef.current?.stop();
      engineRef.current = null;
    } finally {
      setBusy(false);
    }
  };

  const order = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ orderId: string; approveUrl: string | null }>(`/api/promises/executions/${executionId}/order`, {
        method: 'POST',
        body: {},
      });
      if (!result.approveUrl) throw new Error('PayPal did not return a Sandbox approval link.');
      window.location.assign(result.approveUrl);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const authorize = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const view = await api<PromiseExecutionView>(`/api/promises/executions/${executionId}/authorize`, {
        method: 'POST',
        body: {},
      });
      setExecution(view);
      setNotice('PayPal authorization created. The microphone can now be opened.');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }, [executionId]);

  useEffect(() => {
    if (searchParams.get('paypal') === 'return' && execution?.paymentState === 'ORDER_CREATED') {
      void authorize();
    }
  }, [searchParams, execution?.paymentState, authorize]);

  const capture = async () => {
    setBusy(true);
    setError(null);
    try {
      const view = await api<PromiseExecutionView>(`/api/promises/executions/${executionId}/capture`, {
        method: 'POST',
        body: {},
      });
      setExecution(view);
      setNotice('PayPal returned a confirmed capture. The proof records the provider result.');
    } catch (err) {
      setError(errorMessage(err));
      await load();
    } finally {
      setBusy(false);
    }
  };

  const voidAuthorization = async () => {
    setBusy(true);
    setError(null);
    try {
      const view = await api<PromiseExecutionView>(`/api/promises/executions/${executionId}/void`, {
        method: 'POST',
        body: {},
      });
      setExecution(view);
      setNotice('The PayPal authorization was voided. No capture was made.');
    } catch (err) {
      setError(errorMessage(err));
      await load();
    } finally {
      setBusy(false);
    }
  };

  const openProof = async () => {
    setBusy(true);
    setError(null);
    try {
      const value = await api<PromiseProofView>(`/api/promises/executions/${executionId}/proof`);
      setProof(value);
      navigate(`/promise/proof/${value.id}`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <div className="page"><div className="container"><Loading label="Loading the observable agreement…" /></div></div>;
  }
  if (!execution) {
    return <div className="page"><div className="container"><Notice tone="danger">{error ?? 'Promise execution not found.'}</Notice></div></div>;
  }

  const stageStatus = (stage: (typeof STAGES)[number]): string => {
    if (stage === 'IDLE') return snapshot.elapsedMs > 0 || execution.observationStartedAt ? 'is-complete' : 'is-current';
    if (stage === 'START') return snapshot.started ? 'is-complete' : snapshot.state === 'CLOSED' ? '' : 'is-current';
    if (stage === 'RUNNING') {
      if (snapshot.completed) return 'is-complete';
      if (snapshot.currentRunMs > 0) return 'is-current';
      return '';
    }
    if (snapshot.completed || execution.outcome === 'QUALIFIED') return 'is-complete';
    if (execution.outcome) return 'is-rejected';
    return '';
  };

  const liveState = running ? snapshot.state : 'CLOSED';
  const fixed = money(execution.quote.fixedPriceMinor, execution.quote.currency);
  const providerState = execution.paypal.captureId
    ? `Captured ${money(execution.paypal.capturedMinor ?? 0, execution.quote.currency)}`
    : execution.paymentState;

  return (
    <div className="page promise-page">
      <div className="container stack stack--lg">
        <PageHeader
          eyebrow={`${execution.demo ? 'DEMO OBSERVATION' : 'PAYPAL SANDBOX'} · ${execution.serviceName}`}
          title={execution.object.name}
          lede="The agreement is live. Watch the required sequence advance only when the microphone produces confident evidence."
          breadcrumbs={<><Link to="/promise">Promises</Link> <span aria-hidden="true">/</span> {execution.serviceName}</>}
          actions={
            <span className={`chip chip--${running ? 'ok' : 'warn'}`}>
              <span className="chip__dot" aria-hidden="true" /> {running ? 'LIVE MICROPHONE' : 'MIC CLOSED'}
            </span>
          }
        />

        {error ? <Notice tone="danger">{error}</Notice> : null}
        {notice ? <Notice tone="ok">{notice}</Notice> : null}
        {execution.demo ? (
          <Notice tone="warn" title="Synthetic / demo observation path.">
            This execution cannot create a PayPal order or capture. It demonstrates contract evaluation only.
          </Notice>
        ) : (
          <SandboxBanner configured={true} />
        )}

        <div className="run-grid">
          <section className="card run-instrument">
            <div className="run-instrument__head">
              <div>
                <span className="eyebrow">Stage E · Observe</span>
                <h2 className="h2">Required sequence</h2>
              </div>
              <span className="mono small">{fixed} fixed</span>
            </div>

            <div className="run-stages" aria-label="Physical promise stages">
              {STAGES.map((stage, index) => (
                <div className={`run-stage ${stageStatus(stage)}`} key={stage}>
                  <span className="run-stage__index mono">{String(index + 1).padStart(2, '0')}</span>
                  <strong>{stage.replaceAll('_', ' ')}</strong>
                  <span className="run-stage__bar" aria-hidden="true" />
                </div>
              ))}
            </div>

            <div className="run-wave">
              <div className="run-wave__head">
                <span className="eyebrow">Microphone</span>
                <span className="mono small">{running ? 'LIVE' : 'CLOSED'}</span>
              </div>
              <Waveform level={level} live={running} />
              <div className="run-readout">
                <span><i className={`status-dot ${running ? 'status-dot--ok' : ''}`} /> {liveState === 'CLOSED' ? 'MIC CLOSED' : liveState.replaceAll('_', ' ')}</span>
                <span className="mono">conf {percent(snapshot.confidence, 0)}</span>
                <span className="mono">{duration(snapshot.currentRunMs)} run</span>
                <span className="mono">{snapshot.event ?? 'no event'}</span>
              </div>
            </div>

            <div className="run-stats">
              <Stat label="Run" value={duration(snapshot.runMs)} />
              <Stat label="Idle" value={duration(snapshot.idleMs)} />
              <Stat label="Uncertain" value={duration(snapshot.uncertainMs)} tone={snapshot.uncertainMs > 0 ? 'accent' : undefined} />
              <Stat label="Sensor loss" value={duration(snapshot.sensorLossMs)} tone={snapshot.sensorLossMs > 0 ? 'accent' : undefined} />
            </div>

            <div className="run-controls">
              {execution.state === 'AUTHORIZED' && execution.flags.canStart ? (
                <Button variant="money" size="lg" loading={busy} onClick={() => void startLive()}>
                  <Icon name="mic" size={17} /> Open microphone and begin
                </Button>
              ) : null}
              {execution.flags.canCreateOrder ? (
                <Button variant="money" size="lg" loading={busy} onClick={() => void order()}>
                  Approve ceiling in PayPal Sandbox
                </Button>
              ) : null}
              {execution.flags.canAuthorize ? (
                <Button variant="primary" size="lg" loading={busy} onClick={() => void authorize()}>
                  Confirm PayPal authorization
                </Button>
              ) : null}
              {execution.state === 'OBSERVING' ? (
                <Button variant="danger" size="lg" onClick={() => void stopLive()}>
                  <Icon name="stop" size={16} /> Stop and evaluate
                </Button>
              ) : null}
              {execution.flags.canCapture ? (
                <Button variant="money" size="lg" loading={busy} onClick={() => void capture()}>
                  Capture {fixed} in PayPal Sandbox
                </Button>
              ) : null}
              {execution.flags.canVoid ? (
                <Button variant="secondary" size="lg" loading={busy} onClick={() => void voidAuthorization()}>
                  Void authorization
                </Button>
              ) : null}
              {execution.flags.canProof ? (
                <Button variant="secondary" size="lg" loading={busy} onClick={() => void openProof()}>
                  Create portable proof
                </Button>
              ) : null}
            </div>

            <p className="tiny muted">
              The microphone is released when the observation closes. No raw audio is uploaded. A closed microphone
              never advances a stage. {execution.demo ? 'Demo observations cannot capture.' : 'The provider result is authoritative for settlement.'}
            </p>
          </section>

          <aside className="stack">
            <section className="card stack">
              <span className="eyebrow">The agreement</span>
              <div className="run-terms">
                <div><span>Price</span><strong>{fixed}</strong></div>
                <div><span>Minimum run</span><strong>{(execution.terms.constraints.minRunMs / 1000).toFixed(1)}s</strong></div>
                <div><span>Maximum run</span><strong>{(execution.terms.constraints.maxRunMs / 1000).toFixed(1)}s</strong></div>
                <div><span>Uncertainty</span><strong>No capture</strong></div>
                <div><span>Sensor loss</span><strong>No capture</strong></div>
                <div><span>Payment</span><strong>{providerState}</strong></div>
              </div>
              {execution.authorizationExpiresAt ? (
                <p className="tiny muted">Authorization expires {new Date(execution.authorizationExpiresAt).toLocaleString()}.</p>
              ) : null}
            </section>

            <section className="card stack">
              <span className="eyebrow">Resolve</span>
              <h2 className="h3">What did the evidence say?</h2>
              {execution.outcome ? (
                <>
                  <div className={`outcome outcome--${execution.outcome === 'QUALIFIED' ? 'ok' : 'warn'}`}>
                    <span className="mono">{execution.outcome}</span>
                    <strong>{execution.eligibleForCapture ? 'Eligible for capture' : 'No automatic capture'}</strong>
                    <p className="small">{execution.evaluation?.reason}</p>
                  </div>
                  <div className="run-checks">
                    {execution.checks.map((check) => (
                      <div className={`run-check run-check--${check.status.toLowerCase()}`} key={check.id}>
                        <span aria-hidden="true">{check.status === 'PASS' ? '✓' : check.status === 'FAIL' ? '×' : '?'}</span>
                        <div><strong>{check.label}</strong><span className="tiny">{check.detail}</span></div>
                      </div>
                    ))}
                  </div>
                  {execution.proofId ? (
                    <LinkButton to={`/promise/proof/${execution.proofId}`} variant="secondary">
                      Open portable proof
                    </LinkButton>
                  ) : null}
                </>
              ) : (
                <p className="small muted">No resolution yet. Stop the observation to evaluate the exact approved sequence.</p>
              )}
            </section>

            <section className="card stack">
              <span className="eyebrow">Evidence boundary</span>
              <p className="small muted">
                A qualified result means the approved acoustic and temporal conditions passed. It does not prove the
                machine completed a correct physical job, nor that the microphone owner behaved honestly.
              </p>
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
}
