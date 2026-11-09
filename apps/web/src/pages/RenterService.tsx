import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, errorMessage } from '../lib/api.ts';
import type { ServiceView, SessionView } from '../../../../packages/contracts/src/types.ts';
import {
  Button,
  Check,
  Loading,
  Notice,
  SandboxBanner,
  TextInput,
  usePageTitle,
} from '../components/ui.tsx';
import { Icon, ObjectGlyph, TimelineLegend } from '../components/visuals.tsx';
import { formatMinor } from '../../../../packages/meter/src/currency.ts';
import { money } from '../lib/format.ts';

const STATES = [
  ['ACTIVE', 'Running', 'Machine activity is confidently detected. This is billable time.'],
  ['IDLE', 'Idle', 'The object is quiet. Not billable.'],
  ['UNCERTAIN', 'Uncertain', 'Audio is ambiguous, clipped or too quiet. Never billable.'],
  ['DISCONNECTED', 'Sensing stopped', 'No sensor evidence. Never billable.'],
] as const;

export function RenterService() {
  const { objectId = '' } = useParams();
  const navigate = useNavigate();
  const [view, setView] = useState<ServiceView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api<ServiceView>(`/api/service/${objectId}`)
      .then((result) => {
        if (!cancelled) setView(result);
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [objectId]);

  usePageTitle(view ? `${view.object.name} — rent by sound` : 'Service card');

  const begin = async () => {
    if (!view) return;
    setBusy(true);
    setError(null);
    try {
      const created = await api<SessionView>('/api/sessions', {
        method: 'POST',
        body: { objectId: view.object.id },
      });
      const consented = await api<SessionView>(`/api/sessions/${created.id}/consent`, {
        method: 'POST',
        body: {
          termsHash: view.termsHash,
          accepted: true,
          ...(name.trim() ? { displayName: name.trim() } : {}),
        },
      });
      navigate(`/session/${consented.id}`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Loading label="Opening service card…" />;
  if (!view) {
    return (
      <div className="page container page--narrow">
        <Notice tone="danger">{error ?? 'This service card is not available.'}</Notice>
      </div>
    );
  }

  const unavailable = view.object.status !== 'ACTIVE' || view.activeSession || !view.model;
  const model = view.model;

  return (
    <div className="page container page--wide">
      <div className="stack-lg">
        <div className="row row--between">
          <div className="breadcrumbs">
            <Link to="/">Whirr</Link> <span aria-hidden="true">/</span> <span>{view.object.name}</span>
          </div>
          <SandboxBanner configured={view.sandbox.configured} webhookConfigured={view.sandbox.webhookConfigured} />
        </div>

        <section className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div className="grid-2" style={{ gap: 0, alignItems: 'stretch' }}>
            <div className="stack" style={{ padding: 'clamp(1.4rem,3vw,2.4rem)' }}>
              <div className="row">
                {view.object.photoDataUrl ? (
                  <img
                    src={view.object.photoDataUrl}
                    alt={view.object.name}
                    style={{ width: 76, height: 76, objectFit: 'cover', borderRadius: 18 }}
                  />
                ) : (
                  <ObjectGlyph glyph={view.object.glyph} size={76} tone="accent" />
                )}
                <div className="stack" style={{ gap: '0.2rem' }}>
                  <span className="chip">
                    <span className={`chip__dot ${view.object.status === 'ACTIVE' ? '' : ''}`} />
                    {view.object.status === 'ACTIVE' ? 'Available' : 'Unavailable'}
                  </span>
                  <h1 className="display" style={{ fontSize: 'clamp(2.2rem,4.5vw,3.6rem)' }}>{view.object.name}</h1>
                </div>
              </div>
              <p className="lede" style={{ fontSize: '1rem' }}>
                {view.object.description || 'A ordinary object, metered by sound. No new hardware, no lock, no app install.'}
              </p>
              <div className="grid-3" style={{ gap: '0.6rem' }}>
                <div className="stat">
                  <span className="stat__value" style={{ fontSize: '1.5rem' }}>{formatMinor(view.terms.minorPerMinute, view.terms.currency)}</span>
                  <span className="stat__label">per billable minute</span>
                </div>
                <div className="stat stat--accent">
                  <span className="stat__value" style={{ fontSize: '1.5rem' }}>{formatMinor(view.terms.capMinor, view.terms.currency)}</span>
                  <span className="stat__label">hard cap</span>
                </div>
                <div className="stat">
                  <span className="stat__value" style={{ fontSize: '1.5rem' }}>{view.terms.billingPolicy === 'AUTO' ? 'Auto' : 'Review'}</span>
                  <span className="stat__label">billing path</span>
                </div>
              </div>
              <div className="panel">
                <span className="eyebrow">How the bill is calculated</span>
                <code className="mono tiny break" style={{ display: 'block', marginTop: 6 }}>
                  round_half_up({view.terms.minorPerMinute} × billable_ms / 60000), then min({view.terms.capMinor})
                </code>
                <p className="tiny muted" style={{ marginTop: 6 }}>
                  Examples: 15s = {money(view.example.fifteenSecondsMinor, view.terms.currency)} · 35s ={' '}
                  {money(view.example.thirtyFiveSecondsMinor, view.terms.currency)} · 5 min ={' '}
                  {money(view.example.fiveMinutesMinor, view.terms.currency)}. Rounded once at the end.
                </p>
              </div>
            </div>

            <div style={{ background: 'var(--surface-2)', padding: 'clamp(1.4rem,3vw,2.4rem)', borderLeft: '1px solid var(--line)' }}>
              <div className="stack">
                <span className="eyebrow">Consent to rent</span>
                <h2 className="h2" style={{ fontSize: 'clamp(1.5rem,2.5vw,2rem)' }}>One object. One microphone. One cap.</h2>
                <p className="small muted">
                  You are about to authorize <strong>{money(view.terms.capMinor, view.terms.currency)}</strong> in PayPal
                  Sandbox. Nothing is captured until the session is stopped and you review the evidence.
                </p>
                <div className="panel">
                  <dl className="kv">
                    <dt>Terms</dt>
                    <dd>v{view.terms.version}</dd>
                    <dt>Rate</dt>
                    <dd>{money(view.terms.minorPerMinute, view.terms.currency)}/min</dd>
                    <dt>Cap</dt>
                    <dd>{money(view.terms.capMinor, view.terms.currency)}</dd>
                    <dt>Uncertain</dt>
                    <dd>excluded</dd>
                    <dt>Hash</dt>
                    <dd className="mono tiny break">{view.termsHash}</dd>
                  </dl>
                </div>
                {unavailable ? (
                  <Notice tone="warn" title="This object is not taking new sessions.">
                    {view.object.status !== 'ACTIVE'
                      ? 'The operator revoked the service card.'
                      : view.activeSession
                        ? 'A session is already open on this object. Only one live meter is allowed at a time.'
                        : 'No active model is published for this object.'}
                  </Notice>
                ) : null}
                <label className="field">
                  <span className="field__label">Display name (optional)</span>
                  <TextInput
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    maxLength={60}
                    placeholder="What should the receipt call you?"
                    disabled={unavailable}
                  />
                </label>
                <Check checked={consent} onChange={setConsent} disabled={unavailable}>
                  I have read the rate, the hard cap and the model limitations. I consent to this device’s microphone
                  being used <strong>only after I press start</strong>, and to on-device acoustic features being sent to
                  the local Whirr server. Raw audio is never uploaded.
                </Check>
                <Button
                  onClick={() => void begin()}
                  loading={busy}
                  disabled={!consent || unavailable}
                  variant="money"
                  size="lg"
                  block
                >
                  {view.sandbox.configured ? 'Continue to PayPal Sandbox' : 'Continue with demo metering'}
                </Button>
                <p className="tiny muted">
                  {view.sandbox.configured
                    ? 'You will approve the cap in PayPal Sandbox before any sensing begins.'
                    : 'PayPal is not configured here, so no order will be created. Usage is still measured and receipted.'}
                </p>
              </div>
            </div>
          </div>
        </section>

        <div className="grid-2">
          <section className="card stack">
            <div className="row row--between">
              <h2 className="h3">What the meter reports</h2>
              <TimelineLegend />
            </div>
            <div className="stack" style={{ gap: '0.7rem' }}>
              {STATES.map(([state, title, detail]) => (
                <div key={state} className="row" style={{ alignItems: 'flex-start', gap: '0.7rem' }}>
                  <span className={`state state--${state.toLowerCase()}`} style={{ flex: '0 0 auto' }}>
                    <span className="state__dot" /> {title}
                  </span>
                  <span className="small muted">{detail}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="card stack">
            <h2 className="h3">The model, on the record</h2>
            {model ? (
              <>
                <div className="row">
                  <span className={`chip chip--${model.status === 'READY' ? 'ok' : model.status === 'LIMITED' ? 'warn' : 'danger'}`}>
                    {model.status}
                  </span>
                  <span className="chip">
                    {model.metrics.provenance === 'SYNTHETIC_REFERENCE' ? 'synthetic reference' : 'owner calibration'}
                  </span>
                </div>
                <div className="grid-3" style={{ gap: '0.5rem' }}>
                  <div className="panel">
                    <span className="stat__label">Precision</span>
                    <div className="small mono">{(model.metrics.precision * 100).toFixed(1)}%</div>
                  </div>
                  <div className="panel">
                    <span className="stat__label">Recall</span>
                    <div className="small mono">{(model.metrics.recall * 100).toFixed(1)}%</div>
                  </div>
                  <div className="panel">
                    <span className="stat__label">False bills</span>
                    <div className="small mono">{(model.metrics.falseBillableRatio * 100).toFixed(2)}%</div>
                  </div>
                </div>
                <p className="small muted">
                  {model.metrics.provenance === 'SYNTHETIC_REFERENCE'
                    ? 'This model was trained on synthetic fixtures to demonstrate the full pipeline. Its numbers are not evidence of accuracy on a real object.'
                    : `Trained from ${model.metrics.takeCount} owner-recorded takes. Its precision and false-bill rate were measured on held-out takes.`}
                </p>
                <div className="panel stack" style={{ gap: '0.45rem' }}>
                  <div className="row row--between">
                    <span className="stat__label">Acoustic passport</span>
                    <span className={`chip ${model.soundprint?.gateEnabled ? 'chip--ok' : model.soundprint ? 'chip--danger' : ''}`}>
                      {model.soundprint ? (model.soundprint.gateEnabled ? 'identity gate active' : 'passport weak') : 'not enrolled'}
                    </span>
                  </div>
                  <p className="tiny muted" style={{ margin: 0 }}>
                    {model.soundprint?.gateEnabled
                      ? `A confidently active frame must stay close to this object’s enrolled spectral profile (${(model.soundprint.matchThreshold * 100).toFixed(0)}% threshold). A mismatch is free, uncertain time.`
                      : 'This object does not have an active soundprint identity gate. Activity classification and uncertainty exclusion still apply.'}
                  </p>
                  <Link to={`/passport/${view.object.id}`} className="link tiny">
                    Open the acoustic passport →
                  </Link>
                </div>
                <details className="details">
                  <summary>Limitations you should know</summary>
                  <ul className="small muted" style={{ margin: '0.4rem 0 0', paddingLeft: '1.1rem' }}>
                    {view.limitations.map((item) => (
                      <li key={item} style={{ marginBottom: 4 }}>{item}</li>
                    ))}
                  </ul>
                </details>
              </>
            ) : (
              <p className="small muted">No model is published.</p>
            )}
          </section>
        </div>

        <div className="grid-2">
          <section className="card stack">
            <h2 className="h3">Privacy, in plain words</h2>
            <ul className="checklist">
              {view.privacy.map((item) => (
                <li key={item}>
                  <Icon name="check" size={15} /> <span className="small">{item}</span>
                </li>
              ))}
            </ul>
          </section>
          <section className="card card--soft stack">
            <h2 className="h3">What can go wrong</h2>
            <p className="small muted">
              This is an acoustic meter, not a lock. It can miss a very quiet object, and someone could play a recording
              of the object to fool it. False positives are constrained by the precision gate and every interval is
              reviewable; if you believe a segment is wrong, dispute it before settlement. Whirr does not secure the
              physical object or an unattended venue.
            </p>
            {error ? <Notice tone="danger">{error}</Notice> : null}
            <p className="tiny muted">
              Sandbox only. No real money. The operator label is {view.object.ownerLabel}.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
