import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type {
  AmbientModelSummaryView,
  AmbientSessionView,
} from '../../../../packages/contracts/src/types.ts';
import type { AmbientOutcome } from '../../../../packages/ambient-engine/src/types.ts';
import type { EventModelArtifact } from '../../../../packages/audio/src/event-model.ts';
import { ApiError, api, errorMessage } from '../lib/api.ts';
import { MicrophoneEngine } from '../lib/audio.ts';
import { loadAmbientSession } from '../lib/ambient-session.ts';
import { AmbientObservationCollector, type AmbientLiveSnapshot } from '../lib/ambient-audio.ts';
import {
  Button,
  LinkButton,
  Loading,
  Notice,
  PageHeader,
  Stat,
  usePageTitle,
} from '../components/ui.tsx';
import { Icon, ObjectGlyph, Waveform } from '../components/visuals.tsx';
import { duration, money, percent } from '../lib/format.ts';

interface AmbientModelDetail extends AmbientModelSummaryView {
  artifact: EventModelArtifact;
}

const EMPTY_LIVE: AmbientLiveSnapshot = {
  elapsedMs: 0,
  state: 'CLOSED',
  confidence: 0,
  event: null,
  eventMatch: 0,
  baselineActiveMs: 0,
  inactiveMs: 0,
  unknownMs: 0,
  sensorLossMs: 0,
  currentInactiveMs: 0,
  longestInactiveMs: 0,
  targetInactiveMs: 30_000,
  progress: 0,
  started: false,
  qualified: false,
};

const FINAL_STATES = new Set([
  'CAPTURED',
  'VOID_CONFIRMED',
  'NOT_QUALIFIED',
  'BUYER_REJECTED',
  'EXPIRED',
  'DEMO_COMPLETE',
  'RECONCILIATION_REQUIRED',
]);

async function asBuyer<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      await api('/api/auth/renter', { method: 'POST' });
      return call();
    }
    throw error;
  }
}

function sourceLabel(state: string): string {
  if (state === 'ACTIVE') return 'source detected';
  if (state === 'INACTIVE') return 'source not detected';
  if (state === 'UNKNOWN') return 'evidence uncertain';
  if (state === 'DISCONNECTED') return 'sensing lost';
  return 'microphone closed';
}

function formatOutcome(outcome: AmbientOutcome | null | undefined): string {
  return outcome ? outcome.replaceAll('_', ' ') : 'OBSERVING';
}

interface ReplayStats {
  baselineActiveMs: number;
  inactiveMs: number;
  unknownMs: number;
  sensorLossMs: number;
  currentInactiveMs: number;
  longestInactiveMs: number;
  interruptions: number;
  qualified: boolean;
}

function replayStats(
  observations: AmbientSessionView['observations'],
  elapsedMs: number,
  requiredBaseline: number,
  requiredInactive: number,
): ReplayStats {
  let baselineActiveMs = 0;
  let inactiveMs = 0;
  let unknownMs = 0;
  let sensorLossMs = 0;
  let currentInactiveMs = 0;
  let longestInactiveMs = 0;
  let interruptions = 0;
  let baselineMet = false;
  let qualified = false;
  for (const observation of observations) {
    if (observation.startMs >= elapsedMs) break;
    const end = Math.min(observation.endMs, elapsedMs);
    const span = Math.max(0, end - observation.startMs);
    if (span <= 0) continue;
    if (observation.sourceState === 'ACTIVE') {
      baselineActiveMs += span;
      if (baselineActiveMs >= requiredBaseline) baselineMet = true;
      if (baselineMet) {
        if (currentInactiveMs > 0) interruptions += 1;
        currentInactiveMs = 0;
      }
    } else if (observation.sourceState === 'INACTIVE') {
      if (!baselineMet) continue;
      inactiveMs += span;
      currentInactiveMs += span;
      longestInactiveMs = Math.max(longestInactiveMs, currentInactiveMs);
      if (currentInactiveMs >= requiredInactive) qualified = true;
    } else if (observation.sourceState === 'UNKNOWN') {
      unknownMs += span;
      currentInactiveMs = 0;
    } else {
      sensorLossMs += span;
      currentInactiveMs = 0;
    }
  }
  return {
    baselineActiveMs,
    inactiveMs,
    unknownMs,
    sensorLossMs,
    currentInactiveMs,
    longestInactiveMs,
    interruptions,
    qualified,
  };
}

export function AmbientWindow() {
  const { sessionId = '' } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [session, setSession] = useState<AmbientSessionView | null>(null);
  const [model, setModel] = useState<AmbientModelDetail | null>(null);
  const [live, setLive] = useState<AmbientLiveSnapshot>(EMPTY_LIVE);
  const [level, setLevel] = useState(0);
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [replayElapsed, setReplayElapsed] = useState(0);
  const [playing, setPlaying] = useState(true);
  const collectorRef = useRef<AmbientObservationCollector | null>(null);
  const engineRef = useRef<MicrophoneEngine | null>(null);
  const runningRef = useRef(false);
  const uploadRef = useRef(false);
  const lastUploadRef = useRef(0);
  const clientSeqRef = useRef(0);
  const stoppingRef = useRef(false);
  const autoAuthorizeRef = useRef(false);
  usePageTitle(session?.serviceName ?? 'The Window');

  const load = useCallback(async () => {
    try {
      const value = await loadAmbientSession(sessionId, searchParams.get('replay') === '1');
      setSession(value);
      setError(null);
      return value;
    } catch (err) {
      setError(errorMessage(err));
      return null;
    }
  }, [sessionId, searchParams]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!session) return;
    setReplayElapsed(0);
    setPlaying(true);
  }, [session?.id]);

  useEffect(
    () => () => {
      runningRef.current = false;
      void engineRef.current?.stop();
      collectorRef.current?.disconnect();
    },
    [],
  );

  const isReplay = Boolean(
    session && (session.observationMode === 'REPLAY' || searchParams.get('replay') === '1'),
  );
  const observations = session?.observations ?? [];
  const totalMs = observations.at(-1)?.endMs ?? 0;
  const finalVisible = Boolean(session?.evaluation && (!isReplay || replayElapsed >= totalMs));

  useEffect(() => {
    if (!isReplay || !playing || totalMs <= 0) return;
    const timer = window.setInterval(() => {
      setReplayElapsed((current) => {
        const next = Math.min(totalMs, current + 180);
        if (next >= totalMs) setPlaying(false);
        return next;
      });
    }, 90);
    return () => window.clearInterval(timer);
  }, [isReplay, playing, totalMs]);

  const derived = useMemo(() => {
    if (!session) return null;
    const requiredBaseline = session.terms.condition.requiredBaselineActiveMs;
    const requiredInactive = session.terms.condition.requiredInactiveMs;
    const stats = replayStats(observations, isReplay ? replayElapsed : live.elapsedMs, requiredBaseline, requiredInactive);
    const currentObservation =
      observations.find((entry) => entry.startMs <= (isReplay ? replayElapsed : live.elapsedMs) && entry.endMs > (isReplay ? replayElapsed : live.elapsedMs)) ??
      (isReplay ? observations.at(-1) : undefined);
    const state = isReplay
      ? currentObservation?.sourceState ?? 'CLOSED'
      : live.state;
    const currentInactiveMs = isReplay ? stats.currentInactiveMs : live.currentInactiveMs;
    const longestInactiveMs = isReplay ? stats.longestInactiveMs : live.longestInactiveMs;
    const qualified = finalVisible
      ? session.evaluation?.outcome === 'QUALIFIED'
      : isReplay
        ? stats.qualified
        : live.qualified;
    const progress = finalVisible
      ? session.evaluation?.outcome === 'QUALIFIED'
        ? 1
        : Math.min(1, (session.evaluation?.longestInactiveMs ?? 0) / requiredInactive)
      : Math.min(1, currentInactiveMs / requiredInactive);
    const elapsedMs = isReplay ? replayElapsed : live.elapsedMs;
    const baselineActiveMs = finalVisible && session.evaluation ? session.evaluation.baselineActiveMs : isReplay ? stats.baselineActiveMs : live.baselineActiveMs;
    const inactiveMs = finalVisible && session.evaluation ? session.evaluation.inactiveMs : isReplay ? stats.inactiveMs : live.inactiveMs;
    const unknownMs = finalVisible && session.evaluation ? session.evaluation.unknownMs : isReplay ? stats.unknownMs : live.unknownMs;
    const sensorLossMs = finalVisible && session.evaluation ? session.evaluation.sensorLossMs : isReplay ? stats.sensorLossMs : live.sensorLossMs;
    return {
      state,
      currentInactiveMs,
      longestInactiveMs,
      qualified,
      progress,
      elapsedMs,
      baselineActiveMs,
      inactiveMs,
      unknownMs,
      sensorLossMs,
      outcome: finalVisible ? session.evaluation?.outcome ?? null : null,
    };
  }, [session, observations, isReplay, replayElapsed, live, finalVisible]);

  const uploadPending = useCallback(
    async (force = false) => {
      const collector = collectorRef.current;
      if (!collector || uploadRef.current) return;
      if (!force && Date.now() - lastUploadRef.current < 1_600) return;
      const intervals = collector.drain();
      if (intervals.length === 0) return;
      uploadRef.current = true;
      lastUploadRef.current = Date.now();
      clientSeqRef.current += 1;
      try {
        const value = await api<AmbientSessionView>(`/api/ambient/sessions/${sessionId}/observations`, {
          method: 'POST',
          body: { clientSeq: clientSeqRef.current, intervals },
        });
        setSession(value);
      } catch (err) {
        setError(`${errorMessage(err)} No capture can occur while observations are rejected.`);
      } finally {
        uploadRef.current = false;
      }
    },
    [sessionId],
  );

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
      const value = await api<AmbientSessionView>(`/api/ambient/sessions/${sessionId}/stop`, {
        method: 'POST',
        body: { reason: collector?.snapshot.qualified ? 'WINDOW_QUALIFIED' : 'USER_STOP' },
      });
      setSession(value);
      setNotice(
        value.state === 'QUALIFIED_AWAITING_ACCEPTANCE'
          ? 'The deterministic evaluator qualified the window. Review the result and complete buyer acceptance; no capture has happened.'
          : 'The window closed. The evaluator did not qualify it for capture.',
      );
    } catch (err) {
      setError(errorMessage(err));
      await load();
    } finally {
      stoppingRef.current = false;
    }
  }, [sessionId, uploadPending, load]);

  const handleMicEnded = useCallback(async () => {
    runningRef.current = false;
    setRunning(false);
    const collector = collectorRef.current;
    if (collector) {
      collector.disconnect();
      await uploadPending(true);
    }
    await engineRef.current?.stop();
    engineRef.current = null;
    try {
      const value = await api<AmbientSessionView>(`/api/ambient/sessions/${sessionId}/stop`, {
        method: 'POST',
        body: { reason: 'SENSOR_LOST' },
      });
      setSession(value);
      setError('The microphone ended. The ledger records a disconnected interval; no automatic capture can follow.');
    } catch (err) {
      setError(`${errorMessage(err)} The microphone is closed and no payment was captured.`);
    }
  }, [sessionId, uploadPending]);

  const startLive = async () => {
    if (!session) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const detail = model ?? (await api<AmbientModelDetail>(`/api/ambient/agreements/${session.agreementId}/model`));
      setModel(detail);
      const collector = new AmbientObservationCollector({
        artifact: detail.artifact,
        requiredBaselineActiveMs: session.terms.condition.requiredBaselineActiveMs,
        requiredInactiveMs: session.terms.condition.requiredInactiveMs,
        confidenceFloor: session.terms.condition.confidenceFloor,
        onTick: (value) => {
          setLive(value);
          if (value.qualified) setNotice('The local target duration is reached. Stop the window so the deterministic evaluator can decide.');
        },
      });
      collectorRef.current = collector;
      collector.open();
      setLive(collector.snapshot);
      const engine = new MicrophoneEngine({
        onFrame: (frame) => {
          collectorRef.current?.pushFrame(frame);
          if (Date.now() - lastUploadRef.current > 1_800) void uploadPending();
        },
        onLevel: setLevel,
        onError: (message) => setError(message),
        onEnded: () => void handleMicEnded(),
      });
      engineRef.current = engine;
      await engine.start();
      runningRef.current = true;
      setRunning(true);
      const started = await api<AmbientSessionView>(`/api/ambient/sessions/${sessionId}/start`, {
        method: 'POST',
        body: {},
      });
      setSession(started);
      setNotice('The microphone is open. Only interval states and confidence are uploaded — no raw audio.');
    } catch (err) {
      runningRef.current = false;
      setRunning(false);
      setError(`${errorMessage(err)} The microphone is closed; no payment was captured.`);
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
      const value = await asBuyer(() =>
        api<{ orderId: string; approveUrl: string | null; session: AmbientSessionView }>(
          `/api/ambient/sessions/${sessionId}/order`,
          { method: 'POST', body: {} },
        ),
      );
      setSession(value.session);
      if (!value.approveUrl) throw new Error('PayPal did not return a Sandbox approval link.');
      window.location.assign(value.approveUrl);
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
      const value = await asBuyer(() =>
        api<AmbientSessionView>(`/api/ambient/sessions/${sessionId}/authorize`, { method: 'POST', body: {} }),
      );
      setSession(value);
      setNotice('PayPal Sandbox authorization confirmed. The microphone can now be opened.');
    } catch (err) {
      setError(errorMessage(err));
      await load();
    } finally {
      setBusy(false);
    }
  }, [sessionId, load]);

  useEffect(() => {
    if (
      searchParams.get('paypal') === 'return' &&
      session?.flags.canAuthorize &&
      !autoAuthorizeRef.current
    ) {
      autoAuthorizeRef.current = true;
      void authorize();
    }
  }, [searchParams, session?.flags.canAuthorize, authorize]);

  const accept = async (accepted: boolean) => {
    if (!session) return;
    setBusy(true);
    setError(null);
    try {
      const value = await asBuyer(() =>
        api<AmbientSessionView>(`/api/ambient/sessions/${sessionId}/acceptance`, {
          method: 'POST',
          body: {
            accepted,
            termsHash: session.agreementHash,
            note: accepted ? 'Buyer reviewed the interval ledger and accepted the result.' : 'Buyer rejected the observed result.',
          },
        }),
      );
      setSession(value);
      setNotice(accepted ? 'Buyer acceptance recorded. No capture is automatic.' : 'The buyer rejected the result. No capture was made.');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const capture = async () => {
    if (!session) return;
    setBusy(true);
    setError(null);
    try {
      const value = await asBuyer(() =>
        api<AmbientSessionView>(`/api/ambient/sessions/${sessionId}/capture`, {
          method: 'POST',
          body: { confirmed: true, termsHash: session.agreementHash },
        }),
      );
      setSession(value);
      setNotice('PayPal returned a confirmed capture. The final Accord can record the provider reference.');
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
      const value = await asBuyer(() =>
        api<AmbientSessionView>(`/api/ambient/sessions/${sessionId}/void`, {
          method: 'POST',
          body: { reason: 'Participant requested authorization void.' },
        }),
      );
      setSession(value);
      setNotice('The Sandbox authorization was voided. No capture was made.');
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
      await asBuyer(() => api(`/api/ambient/sessions/${sessionId}/proof`));
      navigate(`/ambient/accord/${sessionId}`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (!session || !derived) {
    return <div className="page container">{error ? <Notice tone="danger">{error}</Notice> : <Loading label="Opening the physical window…" />}</div>;
  }

  const price = money(session.terms.financial.fixedPriceMinor, session.terms.financial.currency);
  const providerState = session.payment.captureId
    ? `Captured ${money(session.payment.capturedMinor ?? 0, session.terms.financial.currency)}`
    : session.payment.authorizationId
      ? 'Authorized in Sandbox'
      : session.payment.orderId
        ? 'Order created'
        : session.paymentState.replaceAll('_', ' ');
  const stateLabel = derived.outcome ? formatOutcome(derived.outcome) : sourceLabel(derived.state);
  const progressDegrees = Math.max(0, Math.min(360, derived.progress * 360));

  return (
    <div className="page ambient-page ambient-window-page">
      <div className="container stack stack--lg">
        <PageHeader
          eyebrow={`The Window · ${
            session.demo ? (isReplay ? 'SYNTHETIC REPLAY' : 'DEMO / LIVE') : 'PAYPAL SANDBOX'
          }`}
          title={session.target.objectName}
          lede="Continuity is the contract. The qualifying interval grows only while the bound model reports the enrolled source undetected and the evidence stays observable."
          breadcrumbs={<><Link to="/ambient">Ambient</Link> <span aria-hidden="true">/</span> {session.serviceName}</>}
          actions={
            <span className={`chip ${running ? 'chip--ok' : isReplay ? 'chip--warn' : 'chip--accent'}`}>
              <span className="chip__dot" aria-hidden="true" /> {running ? 'LIVE MICROPHONE' : isReplay ? 'REPLAY' : 'MICROPHONE CLOSED'}
            </span>
          }
        />

        {error ? <Notice tone="danger">{error}</Notice> : null}
        {notice ? <Notice tone="ok">{notice}</Notice> : null}
        {session.demo ? (
          <div className="window-honesty-banner">
            <span className="chip chip--warn">{isReplay ? 'SYNTHETIC REPLAY' : 'DEMO / LIVE'}</span>
            <span>
              {isReplay
                ? 'These interval states are a synthetic replay. No microphone is open, no physical machine was observed, and this demo can never create or capture a PayPal payment.'
                : 'This is a demonstration session with no PayPal order, authorization or capture. Live classifications may exercise the evaluator, but they are not financial evidence.'}
            </span>
          </div>
        ) : (
          <div className="window-honesty-banner">
            <span className="chip chip--dark">PAYPAL SANDBOX</span>
            <span>{session.sandboxNotice}</span>
          </div>
        )}

        <div className="window-layout">
          <section className="window-instrument">
            <div className="window-instrument__head">
              <div>
                <span className="eyebrow eyebrow--light">The qualifying interval</span>
                <h2 className="window-instrument__title">{stateLabel}</h2>
              </div>
              <div className="window-instrument__clock mono">{duration(derived.elapsedMs)}</div>
            </div>

            <div className="window-scope">
              <div className="window-scope__grid" aria-hidden="true" />
              <div
                className={`window-orbit ${derived.qualified ? 'is-qualified' : ''}`}
                style={{
                  background: `conic-gradient(from -90deg, ${derived.qualified ? 'var(--ambient-ok)' : 'var(--ambient-signal)'} 0deg ${progressDegrees}deg, rgba(245,238,228,.08) ${progressDegrees}deg 360deg)`,
                }}
                aria-label={`${Math.round(derived.progress * 100)} percent of the required continuous window`}
              >
                <div className="window-orbit__inner">
                  <span className="window-orbit__percent">{Math.round(derived.progress * 100)}<small>%</small></span>
                  <span className="window-orbit__caption">{derived.qualified ? 'continuous window completed' : 'toward the contract'}</span>
                </div>
              </div>
              <div className="window-scope__center">
                <span className="window-scope__target mono">{duration(session.terms.condition.requiredInactiveMs)}</span>
                <span className="tiny">required continuous non-detection</span>
              </div>
            </div>

            <div className="window-ledger" aria-label="Observed interval ledger">
              <div className="window-ledger__track" aria-hidden="true">
                {observations.map((observation) => {
                  const start = totalMs > 0 ? (observation.startMs / totalMs) * 100 : 0;
                  const width = totalMs > 0 ? ((observation.endMs - observation.startMs) / totalMs) * 100 : 0;
                  return (
                    <span
                      key={observation.seq}
                      className={`window-ledger__segment window-ledger__segment--${observation.sourceState.toLowerCase()}`}
                      style={{ left: `${start}%`, width: `${Math.max(width, 0.35)}%` }}
                      title={`${observation.sourceState} ${duration(observation.endMs - observation.startMs)} · confidence ${percent(observation.confidence, 0)}`}
                    />
                  );
                })}
                <span className="window-ledger__start" />
                <span className="window-ledger__end" />
              </div>
              <div className="window-ledger__labels">
                <span>0s</span>
                <span>{duration(totalMs)}</span>
              </div>
            </div>

            <div className="window-readout-grid">
              <Stat label="Baseline active" value={duration(derived.baselineActiveMs)} tone={derived.baselineActiveMs >= session.terms.condition.requiredBaselineActiveMs ? 'accent' : undefined} />
              <Stat label="Current continuous" value={duration(derived.currentInactiveMs)} tone={derived.currentInactiveMs >= session.terms.condition.requiredInactiveMs ? 'accent' : undefined} />
              <Stat label="Longest continuous" value={duration(derived.longestInactiveMs)} />
              <Stat label="Sensor loss / unknown" value={`${duration(derived.sensorLossMs)} / ${duration(derived.unknownMs)}`} tone={derived.sensorLossMs > 0 || derived.unknownMs > 0 ? 'accent' : undefined} />
            </div>

            {!isReplay ? (
              <div className="window-live-panel">
                <div className="row row--between">
                  <span className="eyebrow">Microphone</span>
                  <span className="mono tiny">{running ? 'OPEN · local inference' : 'CLOSED · no signal'}</span>
                </div>
                <Waveform level={level} live={running} />
                <div className="row row--between">
                  <span className="tiny muted">
                    {running ? `${sourceLabel(live.state)} · confidence ${percent(live.confidence, 0)}` : 'Nothing animates while the microphone is closed.'}
                  </span>
                  {session.flags.canStart ? (
                    <Button variant="money" onClick={() => void startLive()} loading={busy} disabled={running}>
                      <Icon name="mic" size={16} /> Open microphone and begin
                    </Button>
                  ) : null}
                  {session.state === 'OBSERVING' ? (
                    <Button variant="danger" onClick={() => void stopLive()} loading={busy || stoppingRef.current}>
                      <Icon name="stop" size={15} /> Stop and evaluate
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : (
              <div className="window-replay-controls">
                <Button variant="secondary" size="sm" onClick={() => setPlaying((value) => !value)} disabled={replayElapsed >= totalMs}>
                  <Icon name={playing ? 'pause' : 'play'} size={15} /> {playing ? 'Pause replay' : 'Resume replay'}
                </Button>
                <label className="window-scrub">
                  <span className="tiny muted">Replay position</span>
                  <input
                    type="range"
                    min={0}
                    max={Math.max(totalMs, 1)}
                    step={90}
                    value={replayElapsed}
                    onChange={(event) => {
                      setPlaying(false);
                      setReplayElapsed(Number(event.target.value));
                    }}
                  />
                </label>
                <span className="mono tiny">{duration(replayElapsed)} / {duration(totalMs)}</span>
                {session.demo && session.state === 'OBSERVING' && replayElapsed >= totalMs ? (
                  <Button variant="primary" size="sm" onClick={() => void stopLive()} loading={busy}>
                    Evaluate this replay
                  </Button>
                ) : null}
              </div>
            )}

            <div className="window-controls">
              {session.flags.canOrder ? (
                <Button variant="money" onClick={() => void order()} loading={busy}>
                  Create PayPal Sandbox order
                </Button>
              ) : null}
              {session.flags.canAuthorize ? (
                <Button variant="money" onClick={() => void authorize()} loading={busy}>
                  Confirm Sandbox authorization
                </Button>
              ) : null}
              {session.flags.canAcceptResult ? (
                <>
                  <Button variant="money" onClick={() => void accept(true)} loading={busy}>
                    Accept the observed result
                  </Button>
                  <Button variant="secondary" onClick={() => void accept(false)} loading={busy}>
                    Reject
                  </Button>
                </>
              ) : null}
              {session.flags.canCapture ? (
                <Button variant="money" onClick={() => void capture()} loading={busy}>
                  Capture {price} in Sandbox
                </Button>
              ) : null}
              {session.flags.canVoid ? (
                <Button variant="secondary" onClick={() => void voidAuthorization()} loading={busy}>
                  Void authorization
                </Button>
              ) : null}
              {session.flags.canProof ? (
                <>
                  <LinkButton to={`/ambient/accord/${session.id}`} variant="primary">
                    Open the Accord
                  </LinkButton>
                  <Button variant="secondary" onClick={() => void openProof()} loading={busy}>
                    Create / refresh proof
                  </Button>
                </>
              ) : null}
            </div>
            <p className="tiny window-footnote">
              {isReplay
                ? 'Demo history only. The replay is a fixed synthetic interval ladder; it is not a live measurement.'
                : session.demo
                  ? 'Demo session only. No PayPal order exists and no capture is possible; the deterministic evaluator still decides from the stored interval ledger.'
                  : 'The evaluator decides from the stored ledger. A quiet-looking screen is never enough to capture.'}
            </p>
          </section>

          <aside className="stack">
            <section className="window-terms-card">
              <div className="row row--between">
                <span className="eyebrow">Agreement</span>
                <span className={`chip ${session.state === 'CAPTURED' ? 'chip--ok' : session.state === 'NOT_QUALIFIED' ? 'chip--danger' : 'chip--accent'}`}>
                  {session.state.replaceAll('_', ' ')}
                </span>
              </div>
              <div className="window-terms-card__amount">{price}</div>
              <span className="tiny muted">fixed offer · accepted by both parties</span>
              <div className="terms-sheet">
                <div><span>Source</span><strong>{session.target.objectName}</strong></div>
                <div><span>Required</span><strong>{duration(session.terms.condition.requiredInactiveMs)}</strong></div>
                <div><span>Baseline</span><strong>{duration(session.terms.condition.requiredBaselineActiveMs)}</strong></div>
                <div><span>Confidence</span><strong>{session.terms.condition.confidenceFloor.toFixed(2)}</strong></div>
                <div><span>Payment</span><strong>{providerState}</strong></div>
                <div><span>Model</span><strong>{session.model.provenance === 'SYNTHETIC_REFERENCE' ? 'synthetic' : 'local'}</strong></div>
              </div>
              {session.authorizationExpiresAt ? (
                <p className="tiny muted">Authorization expires {new Date(session.authorizationExpiresAt).toLocaleString()}.</p>
              ) : null}
              <p className="tiny muted break">Terms hash <span className="mono">{session.agreementHash}</span></p>
            </section>

            {session.evaluation ? (
              <section className="card stack">
                <div className="row row--between">
                  <div>
                    <span className="eyebrow">Deterministic result</span>
                    <h2 className="h3">{formatOutcome(session.evaluation.outcome)}</h2>
                  </div>
                  <span className={`chip ${session.evaluation.eligibleForCapture ? 'chip--ok' : 'chip--danger'}`}>
                    {session.evaluation.eligibleForCapture ? 'eligible' : 'no capture'}
                  </span>
                </div>
                <p className="small muted">{session.evaluation.reason}</p>
                <div className="window-checks">
                  {session.evaluation.checks.map((check) => (
                    <div className={`window-check window-check--${check.status.toLowerCase()}`} key={check.id}>
                      <span aria-hidden="true">{check.status === 'PASS' ? '✓' : check.status === 'FAIL' ? '×' : '?'}</span>
                      <div><strong>{check.label}</strong><span className="tiny">{check.detail}</span></div>
                    </div>
                  ))}
                </div>
              </section>
            ) : (
              <section className="card stack">
                <span className="eyebrow">What the screen can’t say</span>
                <p className="small muted">
                  A quiet-looking visualization is not evidence of silence. Only the stored interval ledger and the
                  evaluator can qualify a window. The microphone is closed unless it is explicitly open.
                </p>
              </section>
            )}

            <section className="window-limit-card">
              <h2 className="h3">The boundary</h2>
              <ul className="window-limits">
                {session.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}
              </ul>
            </section>
          </aside>
        </div>

        <div className="row row--between">
          <Link to="/ambient" className="link">← Ambient overview</Link>
          <Link to={`/ambient/exchange/${session.agreementId}`} className="link">Read the exact terms →</Link>
        </div>
      </div>
    </div>
  );
}
