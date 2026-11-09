import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '../lib/api.ts';
import { useAuth } from '../lib/auth.tsx';
import { MeterController } from '../lib/meter-controller.ts';
import { MicrophoneEngine } from '../lib/audio.ts';
import type { IntervalExplanation, PreflightView, SessionView } from '../../../../packages/contracts/src/types.ts';
import type { ModelArtifact } from '../../../../packages/audio/src/classifier.ts';
import type { MeterState } from '../../../../packages/meter/src/intervals.ts';
import type { MeterInterval } from '../../../../packages/audio/src/hysteresis.ts';
import { quoteBreakdown } from '../../../../packages/meter/src/pricing.ts';
import {
  Button,
  LinkButton,
  Loading,
  Notice,
  PageHeader,
  SandboxBanner,
  usePageTitle,
} from '../components/ui.tsx';
import {
  ExplanationCard,
  Icon,
  MeterStateBadge,
  ObjectGlyph,
  SpectralWaterfall,
  Timeline,
  TimelineLegend,
  Waveform,
} from '../components/visuals.tsx';
import { METER_COPY, SESSION_STATE_COPY, duration, money } from '../lib/format.ts';

type PauseReason = 'USER_PAUSE' | 'TAB_HIDDEN' | 'DEVICE_LOST' | 'SENSOR_ERROR';

const TERMINAL = new Set([
  'STOPPED',
  'REVIEWED',
  'SETTLEMENT_PENDING',
  'SETTLED',
  'NO_CHARGE',
  'DEMO_COMPLETED',
  'FAILED',
  'ABANDONED',
]);

export function LiveSession() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { session: auth } = useAuth();

  const [view, setView] = useState<SessionView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [sensing, setSensing] = useState(false);
  const [meterState, setMeterState] = useState<MeterState>('DISCONNECTED');
  const [localBillable, setLocalBillable] = useState(0);
  const [localIntervals, setLocalIntervals] = useState<MeterInterval[]>([]);
  const [level, setLevel] = useState(0);
  const [model, setModel] = useState<ModelArtifact | null>(null);
  const [soundprintScore, setSoundprintScore] = useState<number | null>(null);
  const [soundprintMismatch, setSoundprintMismatch] = useState(false);
  const [bands, setBands] = useState<number[]>(Array.from({ length: 8 }, () => 0));
  const [explanation, setExplanation] = useState<IntervalExplanation | null>(null);
  const [preflightBusy, setPreflightBusy] = useState(false);

  const viewRef = useRef<SessionView | null>(null);
  const modelRef = useRef<ModelArtifact | null>(null);
  const controllerRef = useRef<MeterController | null>(null);
  const seqRef = useRef<{ value: number }>({ value: 1 });
  const sensingRef = useRef(false);
  const stoppingRef = useRef(false);
  const capStopRef = useRef(false);
  const autoReturnRef = useRef(false);
  const pauseRef = useRef<(reason: PauseReason) => Promise<void>>(async () => undefined);
  const stopRef = useRef<() => Promise<void>>(async () => undefined);

  usePageTitle(view ? `${view.objectName} session` : 'Live session');

  const applyView = useCallback((next: SessionView) => {
    viewRef.current = next;
    setView(next);
  }, []);

  const load = useCallback(async () => {
    try {
      const next = await api<SessionView>(`/api/sessions/${id}`);
      applyView(next);
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [applyView, id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    sensingRef.current = sensing;
  }, [sensing]);

  useEffect(() => {
    const handler = () => {
      if (document.hidden && sensingRef.current) {
        void pauseRef.current('TAB_HIDDEN');
      }
    };
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, []);

  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (sensingRef.current) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  useEffect(
    () => () => {
      void controllerRef.current?.hardStop();
    },
    [],
  );

  const ensureModel = useCallback(async (): Promise<ModelArtifact> => {
    if (modelRef.current) return modelRef.current;
    const response = await api<{ artifact: ModelArtifact }>(`/api/sessions/${id}/model`);
    modelRef.current = response.artifact;
    setModel(response.artifact);
    return response.artifact;
  }, [id]);

  const makeController = useCallback(
    (baseMs: number): MeterController => {
      const current = viewRef.current;
      const artifact = modelRef.current;
      if (!current || !artifact) throw new Error('Session model is not loaded yet.');
      return new MeterController({
        model: artifact,
        sessionId: id,
        token: current.sessionToken,
        baseMs,
        seq: seqRef.current,
        rateMinorPerMinute: current.terms.minorPerMinute,
        capMinor: current.terms.capMinor,
        currency: current.terms.currency,
        onState: setMeterState,
        onBillable: setLocalBillable,
        onInterval: (interval) => setLocalIntervals((previous) => [...previous.slice(-600), interval]),
        onLevel: setLevel,
        onBands: setBands,
        onExplanation: setExplanation,
        onSoundprint: (score, mismatch) => {
          setSoundprintScore(typeof score === 'number' ? score : null);
          setSoundprintMismatch(mismatch);
        },
        onError: (message, fatal) => {
          setError(message);
          if (fatal) {
            void controllerRef.current?.hardStop();
            controllerRef.current = null;
            setSensing(false);
          }
        },
        onDeviceLost: () => {
          setNotice('The microphone disconnected. Sensing was paused and no time is billed while disconnected.');
          void pauseRef.current('SENSOR_ERROR');
        },
        onCapReached: (amountMinor) => {
          if (capStopRef.current) return;
          capStopRef.current = true;
          const currentView = viewRef.current;
          setNotice(
            `Hard cap reached (${money(amountMinor, currentView?.terms.currency ?? 'USD')}). Stopping the session so nothing can exceed the consented cap.`,
          );
          void stopRef.current();
        },
      });
    },
    [id],
  );

  const startSensing = useCallback(async () => {
    setBusy('start');
    setError(null);
    setNotice(null);
    capStopRef.current = false;
    try {
      await ensureModel();
      let current = viewRef.current;
      if (!current) throw new Error('Session is not loaded.');
      if (current.state === 'READY') {
        current = await api<SessionView>(`/api/sessions/${id}/start`, { method: 'POST' });
        applyView(current);
      } else if (current.state === 'PAUSED') {
        current = await api<SessionView>(`/api/sessions/${id}/resume`, { method: 'POST' });
        applyView(current);
      } else if (current.state !== 'ACTIVE') {
        throw new Error(`Cannot start sensing from state ${current.state}.`);
      }
      setLocalBillable(0);
      setLocalIntervals([]);
      setSoundprintScore(null);
      setSoundprintMismatch(false);
      setBands(Array.from({ length: 8 }, () => 0));
      setExplanation(null);
      setMeterState('DISCONNECTED');
      const controller = makeController(current.meterClockMs);
      controllerRef.current = controller;
      await controller.start();
      setSensing(true);
    } catch (err) {
      const controller = controllerRef.current;
      controllerRef.current = null;
      await controller?.hardStop();
      setSensing(false);
      setError(
        `${errorMessage(err)} The microphone is opened only after an explicit press; if permission was denied, allow it in the browser and try again.`,
      );
      await load();
    } finally {
      setBusy(null);
    }
  }, [applyView, ensureModel, id, load, makeController]);

  const runPreflight = useCallback(async () => {
    if (preflightBusy || sensing) return;
    setPreflightBusy(true);
    setError(null);
    const frames: Array<{ features: number[]; flags: string[] }> = [];
    let engine: MicrophoneEngine | null = null;
    try {
      engine = new MicrophoneEngine({
        onFrame: (frame) => frames.push({ features: frame.features, flags: frame.flags }),
        onError: (message) => setError(message),
      });
      await engine.start();
      await new Promise((resolve) => setTimeout(resolve, 4_000));
      await engine.stop();
      engine = null;
      const levels = frames.map((frame) => frame.features[0] ?? -8).sort((a, b) => a - b);
      const noiseFloorLogRms = levels.length ? levels[Math.floor(levels.length * 0.2)]! : null;
      const mean = levels.length ? levels.reduce((sum, value) => sum + value, 0) / levels.length : 0;
      const levelVariance = levels.length
        ? levels.reduce((sum, value) => sum + (value - mean) ** 2, 0) / levels.length
        : 0;
      const clippedRatio = frames.length
        ? frames.filter((frame) => frame.flags.includes('CLIPPED')).length / frames.length
        : 0;
      const silentRatio = frames.length
        ? frames.filter((frame) => frame.flags.includes('SILENT') || frame.flags.includes('LOW_LEVEL')).length / frames.length
        : 1;
      const status =
        frames.length < 5 || noiseFloorLogRms === null || silentRatio >= 0.8
          ? 'NO_SIGNAL'
          : clippedRatio >= 0.2 || levelVariance >= 0.08
            ? 'UNSTABLE'
            : noiseFloorLogRms >= -1.6 || silentRatio >= 0.45
              ? 'NOISY'
              : 'READY';
      const recorded = await api<PreflightView>(`/api/sessions/${id}/preflight`, {
        method: 'POST',
        body: {
          status,
          frameCount: frames.length,
          durationMs: 4_000,
          noiseFloorLogRms,
          levelVariance,
          clippedRatio,
          silentRatio,
          flags: [...new Set(frames.flatMap((frame) => frame.flags))].slice(0, 12),
          detail: 'Local room check before sensing.',
        },
      });
      const current = viewRef.current;
      if (current) applyView({ ...current, preflight: recorded });
      if (recorded.status === 'READY') setNotice('Room check passed. The microphone is closed until you press start.');
      else if (recorded.status === 'NOISY') setNotice('Room check found noise. You can continue, but ambiguous time will stay unbilled.');
      else setNotice('Room check found a severe input problem. Fix the microphone or gain before starting.');
    } catch (err) {
      setError(errorMessage(err));
      await engine?.stop().catch(() => undefined);
    } finally {
      setPreflightBusy(false);
    }
  }, [applyView, id, preflightBusy, sensing]);

  const pauseSensing = useCallback(
    async (reason: PauseReason) => {
      if (!sensingRef.current) return;
      setBusy('pause');
      let flushError: string | null = null;
      try {
        await controllerRef.current?.stop();
      } catch (err) {
        flushError = errorMessage(err);
      }
      controllerRef.current = null;
      setSensing(false);
      setLocalBillable(0);
      setLocalIntervals([]);
      setSoundprintScore(null);
      setSoundprintMismatch(false);
      setBands(Array.from({ length: 8 }, () => 0));
      setExplanation(null);
      setMeterState('DISCONNECTED');
      try {
        const next = await api<SessionView>(`/api/sessions/${id}/pause`, {
          method: 'POST',
          body: { reason },
        });
        applyView(next);
        if (reason === 'TAB_HIDDEN') {
          setNotice('The tab was hidden, so sensing stopped. Resume when you are ready; hidden time is not billed.');
        } else if (reason === 'SENSOR_ERROR' || reason === 'DEVICE_LOST') {
          setNotice('Sensing stopped after a microphone problem. No time is billed while disconnected.');
        }
      } catch (err) {
        setError(errorMessage(err));
      } finally {
        if (flushError) setError(`Some evidence could not be uploaded before pausing (${flushError}). You are not overcharged; the missing interval is excluded.`);
        setBusy(null);
      }
    },
    [applyView, id],
  );

  const stopSensing = useCallback(async () => {
    if (stoppingRef.current) return;
    if (!capStopRef.current && !window.confirm('Stop the session and review the bill? The microphone will be released immediately.')) return;
    stoppingRef.current = true;
    setBusy('stop');
    let flushError: string | null = null;
    try {
      try {
        await controllerRef.current?.stop();
      } catch (err) {
        flushError = errorMessage(err);
      }
      controllerRef.current = null;
      setSensing(false);
      setLocalBillable(0);
      setLocalIntervals([]);
      setSoundprintScore(null);
      setSoundprintMismatch(false);
      setBands(Array.from({ length: 8 }, () => 0));
      setExplanation(null);
      setMeterState('DISCONNECTED');
      const next = await api<SessionView>(`/api/sessions/${id}/stop`, { method: 'POST' });
      applyView(next);
      if (flushError) {
        // The session is stopped; show this on the review screen rather than blocking it.
        sessionStorage.setItem('whirr:flush-warning', flushError);
      }
      navigate(`/session/${id}/review`);
    } catch (err) {
      setError(errorMessage(err));
      stoppingRef.current = false;
      setBusy(null);
      await load();
    }
  }, [applyView, id, load, navigate]);

  useEffect(() => {
    pauseRef.current = pauseSensing;
    stopRef.current = stopSensing;
  });

  // Handle PayPal's return and cancel URLs exactly once.
  useEffect(() => {
    const signal = searchParams.get('paypal');
    if (!view || !signal || autoReturnRef.current) return;
    if (signal === 'cancel') {
      autoReturnRef.current = true;
      setNotice('PayPal Sandbox approval was cancelled. No authorization or charge exists.');
      setSearchParams({}, { replace: true });
      return;
    }
    if (signal !== 'return') return;
    autoReturnRef.current = true;
    if (view.paymentState === 'AUTHORIZED' || view.state === 'READY') {
      setSearchParams({}, { replace: true });
      return;
    }
    if (view.paymentState !== 'ORDER_CREATED' && view.paymentState !== 'BUYER_APPROVED') {
      setSearchParams({}, { replace: true });
      return;
    }
    setBusy('authorize');
    api<SessionView>(`/api/sessions/${id}/paypal/authorize`, { method: 'POST' })
      .then((next) => {
        applyView(next);
        setSearchParams({}, { replace: true });
        setNotice('Buyer approved. The authorization is stored; nothing is captured until you review the stopped session.');
      })
      .catch((err) => {
        setError(errorMessage(err));
        setSearchParams({}, { replace: true });
      })
      .finally(() => setBusy(null));
  }, [applyView, id, searchParams, setSearchParams, view]);

  const createOrder = async () => {
    setBusy('order');
    setError(null);
    try {
      const result = await api<{ orderId: string; approveUrl: string | null }>(`/api/sessions/${id}/paypal/order`, {
        method: 'POST',
      });
      await load();
      if (!result.approveUrl) throw new Error('PayPal Sandbox did not return an approval URL.');
      let approval: URL;
      try {
        approval = new URL(result.approveUrl);
      } catch {
        throw new Error('PayPal Sandbox returned an invalid approval URL.');
      }
      if (
        approval.protocol !== 'https:' ||
        (approval.hostname !== 'sandbox.paypal.com' && !approval.hostname.endsWith('.sandbox.paypal.com'))
      ) {
        throw new Error('PayPal Sandbox returned an unrecognised approval host.');
      }
      window.location.assign(approval.toString());
    } catch (err) {
      setError(errorMessage(err));
      setBusy(null);
    }
  };

  const authorize = async () => {
    setBusy('authorize');
    setError(null);
    try {
      applyView(await api<SessionView>(`/api/sessions/${id}/paypal/authorize`, { method: 'POST' }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const checkPayment = async () => {
    setBusy('status');
    setError(null);
    try {
      await api(`/api/sessions/${id}/paypal/status?reconcile=1`);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const useDemo = async () => {
    setBusy('demo');
    setError(null);
    try {
      applyView(await api<SessionView>(`/api/sessions/${id}/demo-mode`, { method: 'POST' }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const billableForDisplay = (view?.billableMs ?? 0) + localBillable;
  const quote = useMemo(() => {
    if (!view) return null;
    return quoteBreakdown(
      view.terms.minorPerMinute,
      billableForDisplay,
      view.terms.capMinor,
      view.quote.creditMinor,
      view.terms.currency,
    );
  }, [billableForDisplay, view]);

  const timeline = useMemo(() => {
    if (!view) return { intervals: [], total: 0 };
    const intervals = [
      ...view.intervals.map((interval) => ({ startMs: interval.startMs, endMs: interval.endMs, state: interval.state })),
      ...localIntervals.map((interval) => ({ startMs: interval.startMs, endMs: interval.endMs, state: interval.state })),
    ];
    const total = Math.max(
      view.meterClockMs,
      ...intervals.map((interval) => interval.endMs),
      sensing ? billableForDisplay + 1000 : 1000,
    );
    return { intervals, total };
  }, [billableForDisplay, localIntervals, sensing, view]);

  if (loading) return <Loading label="Opening session…" />;
  if (!view) {
    return (
      <div className="page container page--narrow">
        <Notice tone="danger">{error ?? 'Session not found, or this browser does not own it.'}</Notice>
        <p className="small muted" style={{ marginTop: 12 }}>
          Renter sessions are bound to a signed cookie. Open the service card link again in this browser to start a new
          session.
        </p>
      </div>
    );
  }

  const terminal = TERMINAL.has(view.state);
  const capPercent = Math.min(100, quote ? (quote.finalMinor / Math.max(1, view.terms.capMinor)) * 100 : 0);
  const canStart = ['READY', 'ACTIVE', 'PAUSED'].includes(view.state);

  return (
    <div className="page container page--wide">
      <PageHeader
        eyebrow="Renter session"
        breadcrumbs={
          <>
            <Link to={`/s/${view.objectId}`}>{view.objectName}</Link> <span aria-hidden="true">/</span>{' '}
            <span className="mono">{view.id.slice(-8)}</span>
          </>
        }
        title={
          <span className="row" style={{ gap: '0.8rem' }}>
            <ObjectGlyph glyph={view.objectGlyph} size={54} tone="accent" /> {view.objectName}
          </span>
        }
        lede={
          terminal
            ? 'This session is no longer sensing. Review the evidence and settle or issue a receipt.'
            : 'The microphone runs only while you can see this page. Hiding the tab or losing the device pauses the meter; uncertain time is never billed.'
        }
        actions={<span className="chip">{SESSION_STATE_COPY[view.state]}</span>}
      />

      <div className="stack">
        <SandboxBanner configured={view.sandbox.configured} />
        {error ? <Notice tone="danger">{error}</Notice> : null}
        {notice ? <Notice tone="warn">{notice}</Notice> : null}
      </div>

      {terminal ? (
        <div className="card stack" style={{ marginTop: '1.5rem' }}>
          <div className="row row--between">
            <div className="stack" style={{ gap: '0.3rem' }}>
              <span className="eyebrow">Session closed</span>
              <h2 className="h2">{SESSION_STATE_COPY[view.state]}</h2>
              <p className="small muted">
                {duration(view.billableMs)} billable · {money(view.quote.quoteMinor, view.terms.currency)} final ·{' '}
                {view.paymentState.replaceAll('_', ' ').toLowerCase()}
              </p>
            </div>
            <div className="row">
              {view.state === 'STOPPED' || view.state === 'REVIEWED' ? (
                <LinkButton to={`/session/${id}/review`} variant="primary">
                  Review the bill <Icon name="arrow" size={16} />
                </LinkButton>
              ) : null}
              <LinkButton to={`/receipt/${id}`} variant="secondary">
                Evidence receipt
              </LinkButton>
            </div>
          </div>
          {view.intervals.length > 0 ? (
            <div className="timeline-card">
              <Timeline intervals={timeline.intervals} totalMs={timeline.total} height={46} />
              <div style={{ marginTop: 8 }}>
                <TimelineLegend />
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <>
        <section className="card stack" style={{ marginTop: '1.5rem' }}>
          <div className="row row--between">
            <div className="stack" style={{ gap: '0.2rem' }}>
              <span className="eyebrow">Room check · before sensing</span>
              <h2 className="h3">Is the room ready to listen?</h2>
            </div>
            <span
              className={`chip ${
                view.preflight?.status === 'READY'
                  ? 'chip--ok'
                  : view.preflight?.status === 'NOISY'
                    ? 'chip--warn'
                    : view.preflight
                      ? 'chip--danger'
                      : ''
              }`}
            >
              {view.preflight?.status ?? 'NOT RUN'}
            </span>
          </div>
          <p className="small muted">
            Four seconds of local analysis: noise floor, clipping, silence and level stability. The microphone is
            released immediately afterwards. A missing signal or unstable level blocks start; normal room noise only
            warns and can never increase the bill.
          </p>
          {view.preflight ? (
            <div className="grid-4">
              <div className="panel">
                <span className="stat__label">Noise floor</span>
                <div className="small mono">{view.preflight.noiseFloorLogRms === null ? '—' : view.preflight.noiseFloorLogRms.toFixed(2)}</div>
              </div>
              <div className="panel">
                <span className="stat__label">Level variance</span>
                <div className="small mono">{view.preflight.levelVariance.toFixed(3)}</div>
              </div>
              <div className="panel">
                <span className="stat__label">Clipped</span>
                <div className="small mono">{(view.preflight.clippedRatio * 100).toFixed(1)}%</div>
              </div>
              <div className="panel">
                <span className="stat__label">Silent</span>
                <div className="small mono">{(view.preflight.silentRatio * 100).toFixed(1)}%</div>
              </div>
            </div>
          ) : null}
          {view.preflight ? <p className="tiny muted">{view.preflight.detail}</p> : null}
          <div className="row">
            <Button
              variant="secondary"
              onClick={() => void runPreflight()}
              loading={preflightBusy}
              disabled={sensing || preflightBusy}
            >
              <Icon name="wave" size={16} /> {view.preflight ? 'Run room check again' : 'Run 4-second room check'}
            </Button>
            {view.preflight?.status === 'READY' ? <span className="tiny muted">Ready. Start when you are.</span> : null}
          </div>
        </section>

        <div className="sidebar-layout" style={{ marginTop: '1.5rem' }}>
          <div className="stack">
            <section className="meter">
              <div className="meter__halo" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
              <div className="row row--between">
                <MeterStateBadge state={sensing ? meterState : 'DISCONNECTED'} />
                <span className="tiny mono muted">
                  {sensing ? 'MIC OPEN · ON-DEVICE' : view.state === 'ACTIVE' ? 'SENSING INTERRUPTED' : 'MIC OFF'}
                </span>
              </div>
              <h2 className="meter__word">
                {sensing
                  ? METER_COPY[meterState].label
                  : view.state === 'PAUSED'
                    ? 'Paused'
                    : view.state === 'READY'
                      ? 'Ready'
                      : view.state === 'ACTIVE'
                        ? 'Reconnect'
                        : 'Awaiting approval'}
              </h2>
              <p className="meter__detail">
                {sensing
                  ? METER_COPY[meterState].detail
                  : view.state === 'PAUSED'
                    ? 'Sensing is paused. Paused time is not billable. Resume when you are ready.'
                    : view.state === 'ACTIVE'
                      ? 'The server clock is running but no new intervals are being billed. Press Reconnect to reopen the microphone.'
                      : 'Complete the sandbox authorization to unlock the microphone.'}
              </p>

              <div className="meter__numbers">
                <div className="meter__number">
                  <strong>{money(quote?.finalMinor ?? 0, view.terms.currency)}</strong>
                  <span>provisional bill</span>
                </div>
                <div className="meter__number">
                  <strong>{duration(billableForDisplay)}</strong>
                  <span>billable</span>
                </div>
                <div className="meter__number">
                  <strong>{money(view.terms.minorPerMinute, view.terms.currency)}</strong>
                  <span>per minute</span>
                </div>
                <div className="meter__number">
                  <strong>{money(view.terms.capMinor, view.terms.currency)}</strong>
                  <span>hard cap</span>
                </div>
              </div>

              <div className="cap-bar">
                <div className="cap-bar__track" role="progressbar" aria-valuemin={0} aria-valuemax={view.terms.capMinor} aria-valuenow={quote?.finalMinor ?? 0} aria-label="Provisional bill against consented cap">
                  <div className="cap-bar__fill" style={{ width: `${capPercent}%` }} />
                </div>
                <div className="cap-bar__labels">
                  <span>{capPercent.toFixed(0)}% of consented cap</span>
                  <span>{quote?.capApplied ? 'Cap reached — charge cannot grow' : 'Rounded once at the end'}</span>
                </div>
              </div>

              <div style={{ marginTop: '1.2rem' }}>
                <Waveform level={level} live={sensing} />
              </div>

              <div className="stack" style={{ gap: '0.55rem', marginTop: '0.9rem' }}>
                <div className="row row--between">
                  <span className="eyebrow">Eight-band energy · live</span>
                  <span className="tiny mono muted">{sensing ? 'on-device' : 'microphone closed'}</span>
                </div>
                <SpectralWaterfall bands={bands} state={sensing ? meterState : 'DISCONNECTED'} height={126} />
                {explanation ? <ExplanationCard explanation={explanation} compact /> : null}
              </div>

              {model?.soundprint ? (
                <div className="passport-live">
                  <div className="passport-live__head">
                    <div className="row" style={{ gap: '0.45rem' }}>
                      <span className="eyebrow">Acoustic passport</span>
                      <span className={`chip ${soundprintMismatch ? 'chip--warn' : model.soundprint.gateEnabled ? 'chip--ok' : 'chip--danger'}`}>
                        {model.soundprint.gateEnabled ? (soundprintMismatch ? 'mismatch · free' : 'matching object') : 'gate disabled'}
                      </span>
                    </div>
                    <strong>
                      {sensing && soundprintScore !== null ? `${Math.round(soundprintScore * 100)}% match` : 'waiting for sound'}
                    </strong>
                  </div>
                  <div className="passport-live__track" aria-hidden="true">
                    <span
                      className={soundprintMismatch ? 'is-mismatch' : ''}
                      style={{ width: `${Math.round((soundprintScore ?? 0) * 100)}%` }}
                    />
                  </div>
                  <p className="tiny muted" style={{ margin: 0 }}>
                    {model.soundprint.gateEnabled
                      ? `Enrolled threshold ${(model.soundprint.matchThreshold * 100).toFixed(0)}%. A confident active sound below it is marked uncertain and never billed.`
                      : 'This model did not find a safe identity threshold; the activity classifier still applies, without an identity claim.'}
                  </p>
                </div>
              ) : null}

              {soundprintMismatch && sensing ? (
                <p className="tiny" style={{ color: 'var(--warn)', marginTop: '0.6rem' }}>
                  Passport mismatch: this sound is not close enough to the object the operator taught. That time is
                  treated as uncertain and excluded from the bill.
                </p>
              ) : null}

              {timeline.intervals.length > 0 ? (
                <div style={{ marginTop: '1rem' }}>
                  <Timeline intervals={timeline.intervals} totalMs={timeline.total} height={40} />
                  <div style={{ marginTop: 6 }}>
                    <TimelineLegend />
                  </div>
                </div>
              ) : null}

              <div className="live-actions" style={{ marginTop: '1.2rem' }}>
                {canStart && !sensing ? (
                  <Button onClick={() => void startSensing()} loading={busy === 'start'} variant="money" size="lg">
                    <Icon name="mic" size={17} />
                    {view.state === 'PAUSED' ? 'Resume sensing' : view.state === 'ACTIVE' ? 'Reconnect microphone' : 'Start sensing'}
                  </Button>
                ) : null}
                {sensing ? (
                  <>
                    <Button onClick={() => void pauseSensing('USER_PAUSE')} loading={busy === 'pause'} variant="secondary" disabled={Boolean(busy)}>
                      <Icon name="pause" size={16} /> Pause
                    </Button>
                    <Button onClick={() => void stopSensing()} loading={busy === 'stop'} variant="danger" disabled={Boolean(busy)}>
                      <Icon name="stop" size={16} /> Stop &amp; review
                    </Button>
                  </>
                ) : null}
                {!sensing && view.state === 'ACTIVE' && !canStart ? null : null}
                {!sensing && (view.state === 'READY' || view.state === 'PAUSED' || view.state === 'ACTIVE') ? (
                  <Button onClick={() => void stopSensing()} loading={busy === 'stop'} variant="ghost" disabled={Boolean(busy)}>
                    Stop without resuming
                  </Button>
                ) : null}
              </div>

              {sensing ? (
                <p className="tiny muted" style={{ marginTop: '0.8rem' }}>
                  The microphone is live. Hiding this tab pauses sensing automatically. Closing the page without
                  stopping leaves the session open but stops all billing because no intervals are uploaded.
                </p>
              ) : null}
            </section>

            {view.state === 'CONSENTED' ? (
              <section className="card stack">
                <span className="eyebrow">Step 1 · authorization</span>
                <h2 className="h2" style={{ fontSize: '1.8rem' }}>
                  {view.sandbox.configured ? 'Authorize the cap in PayPal Sandbox.' : 'Continue with demo metering.'}
                </h2>
                <p className="small muted">
                  {view.sandbox.configured
                    ? `A PayPal Sandbox order will be created for the ${money(view.terms.capMinor, view.terms.currency)} cap. Approval does not charge anything; capture happens only after you stop and review.`
                    : 'No PayPal credentials are configured. This session will be labelled DEMO_NO_PAYMENT on the receipt and no provider call will be made.'}
                </p>
                <div className="panel">
                  <dl className="kv">
                    <dt>Authorized cap</dt>
                    <dd>{money(view.terms.capMinor, view.terms.currency)}</dd>
                    <dt>Rate</dt>
                    <dd>{money(view.terms.minorPerMinute, view.terms.currency)} / billable min</dd>
                    <dt>Terms hash</dt>
                    <dd className="mono tiny break">{view.termsHash}</dd>
                  </dl>
                </div>
                {view.sandbox.configured ? (
                  <Button onClick={() => void createOrder()} loading={busy === 'order'} variant="money" size="lg">
                    Create Sandbox authorization <Icon name="external" size={15} />
                  </Button>
                ) : (
                  <Button onClick={() => void useDemo()} loading={busy === 'demo'} variant="primary" size="lg">
                    Enter demo metering
                  </Button>
                )}
              </section>
            ) : null}

            {view.state === 'PAYMENT_PENDING' ? (
              <section className="card stack">
                <span className="eyebrow">Step 1 · authorization</span>
                <h2 className="h2" style={{ fontSize: '1.8rem' }}>Waiting for buyer approval.</h2>
                <p className="small muted">
                  The order exists in PayPal Sandbox. Approve it there, then return here. The authorization is verified
                  against PayPal before sensing is unlocked.
                </p>
                <dl className="kv">
                  <dt>Order</dt>
                  <dd className="mono tiny break">{view.paypal.orderId ?? '—'}</dd>
                  <dt>Provider status</dt>
                  <dd className="mono tiny">{view.paypal.providerStatus ?? 'UNKNOWN'}</dd>
                  <dt>Payment state</dt>
                  <dd>{view.paymentState.replaceAll('_', ' ').toLowerCase()}</dd>
                </dl>
                <div className="row">
                  {view.paypal.approveUrl ? (
                    <a className="btn btn--money" href={view.paypal.approveUrl}>
                      Approve in PayPal Sandbox <Icon name="external" size={15} />
                    </a>
                  ) : null}
                  <Button onClick={() => void authorize()} loading={busy === 'authorize'} variant="secondary">
                    I approved — verify authorization
                  </Button>
                  <Button onClick={() => void checkPayment()} loading={busy === 'status'} variant="ghost">
                    Check status
                  </Button>
                </div>
                <p className="tiny muted">
                  If PayPal still shows PAYER_ACTION_REQUIRED, complete the sandbox login and press the approval button
                  again. No sensing can start before a verified authorization exists.
                </p>
              </section>
            ) : null}

            {view.state === 'READY' ? (
              <section className="card stack">
                <span className="eyebrow">Step 2 · sensing</span>
                <h2 className="h2" style={{ fontSize: '1.8rem' }}>Ready when you are.</h2>
                <p className="small muted">
                  Pressing start opens the microphone, asks the browser for permission if needed, and begins on-device
                  classification. Nothing is uploaded except 21-number feature vectors and sealed state intervals.
                </p>
                <div className="panel">
                  <dl className="kv">
                    <dt>Authorization</dt>
                    <dd className="mono tiny break">{view.paypal.authorizationId ?? view.paymentState}</dd>
                    <dt>Cap</dt>
                    <dd>{money(view.terms.capMinor, view.terms.currency)}</dd>
                    <dt>Billing path</dt>
                    <dd>{view.reviewMode === 'AUTO' ? 'automatic review' : 'operator approval required'}</dd>
                  </dl>
                </div>
                <Button onClick={() => void startSensing()} loading={busy === 'start'} variant="money" size="lg">
                  <Icon name="mic" size={17} /> Start sensing
                </Button>
                <p className="tiny muted">
                  You can pause at any time. UNCERTAIN, IDLE and DISCONNECTED intervals are free by policy.
                </p>
              </section>
            ) : null}

            {view.state === 'ACTIVE' && !sensing ? (
              <section className="card stack">
                <Notice tone="warn" title="Sensing is not connected in this tab.">
                  The session is active but no microphone is open. No intervals are being uploaded, so no new billable
                  time is accruing. Reconnect to continue, or stop the session.
                </Notice>
                <div className="row">
                  <Button onClick={() => void startSensing()} loading={busy === 'start'} variant="money">
                    Reconnect microphone
                  </Button>
                  <Button onClick={() => void stopSensing()} loading={busy === 'stop'} variant="danger">
                    Stop session
                  </Button>
                </div>
              </section>
            ) : null}

            {view.state === 'PAUSED' && !sensing ? (
              <section className="card stack">
                <Notice tone="info" title="Paused, not billing.">
                  Paused time is excluded. Resume when you are ready to continue using the object.
                </Notice>
                <Button onClick={() => void startSensing()} loading={busy === 'start'} variant="money">
                  <Icon name="mic" size={16} /> Resume sensing
                </Button>
              </section>
            ) : null}
          </div>

          <aside className="stack">
            <section className="card stack">
              <div className="row row--between">
                <h2 className="h3">Terms you accepted</h2>
                <span className="chip">v{view.terms.version}</span>
              </div>
              <dl className="kv">
                <dt>Rate</dt>
                <dd>{money(view.terms.minorPerMinute, view.terms.currency)} / min</dd>
                <dt>Hard cap</dt>
                <dd>{money(view.terms.capMinor, view.terms.currency)}</dd>
                <dt>Rounding</dt>
                <dd>once at end</dd>
                <dt>Uncertain</dt>
                <dd>excluded</dd>
                <dt>Review</dt>
                <dd>{view.reviewMode === 'AUTO' ? 'automatic' : 'operator required'}</dd>
                <dt>Consent</dt>
                <dd>{view.consentedAt ? new Date(view.consentedAt).toLocaleString() : '—'}</dd>
              </dl>
              <details className="details">
                <summary>Exact terms hash</summary>
                <code className="mono tiny break">{view.termsHash}</code>
              </details>
            </section>

            <section className="card stack">
              <div className="row row--between">
                <h2 className="h3">Acoustic passport</h2>
                <span className="chip">{view.model.soundprint?.status ?? 'not enrolled'}</span>
              </div>
              <p className="small muted">
                {view.model.soundprint?.gateEnabled
                  ? 'The meter compares confident activity with this object’s enrolled spectral profile. A mismatch becomes free, uncertain time.'
                  : 'This model does not have an active identity gate. Metering still excludes idle, uncertain and disconnected time.'}
              </p>
              <LinkButton to={`/passport/${view.objectId}`} variant="secondary" block>
                Open public passport <Icon name="external" size={15} />
              </LinkButton>
            </section>

            <section className="card card--soft stack">
              <h2 className="h3">This page is the meter</h2>
              <p className="small muted">
                Intervals are sealed every 32&nbsp;ms and uploaded in 2-second batches. The server recomputes billable
                time from the evidence rows and rejects overlapping or out-of-order intervals.
              </p>
              <div className="stack" style={{ gap: '0.4rem' }}>
                <div className="row row--between tiny">
                  <span className="muted">Observed</span>
                  <span className="mono">{duration(view.observedMs + billableForDisplay)}</span>
                </div>
                <div className="row row--between tiny">
                  <span className="muted">Billable</span>
                  <span className="mono">{duration(billableForDisplay)}</span>
                </div>
                <div className="row row--between tiny">
                  <span className="muted">Excluded / idle</span>
                  <span className="mono">{duration(view.excludedMs + view.idleMs)}</span>
                </div>
              </div>
            </section>

            <section className="card stack">
              <h2 className="h3">Failure rules</h2>
              <ul className="small muted" style={{ margin: 0, paddingLeft: '1.1rem', lineHeight: 1.7 }}>
                <li>Mic permission denied → nothing starts, nothing bills.</li>
                <li>Tab hidden or device unplugged → sensing pauses automatically.</li>
                <li>Network loss → intervals queue in memory; uncaptured evidence is never billed.</li>
                <li>Cap reached → session stops; capture cannot exceed the cap.</li>
              </ul>
            </section>

            {auth?.operator ? (
              <LinkButton to={`/session/${id}/review`} variant="secondary" className="btn--inline">
                Operator review
              </LinkButton>
            ) : null}
          </aside>
        </div>
        </>
      )}

      {model ? (
        <p className="tiny muted" style={{ marginTop: '1.5rem' }}>
          Active model {model.version} · {model.provenance === 'SYNTHETIC_REFERENCE' ? 'synthetic reference' : 'owner calibration'} ·{' '}
          {(model.metrics.precision * 100).toFixed(1)}% held-out precision. Sensing is local; the model file is served to
          this browser and runs without a network round trip per frame.
        </p>
      ) : null}
    </div>
  );
}
