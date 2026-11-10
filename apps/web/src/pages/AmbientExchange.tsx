import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type {
  AmbientAgreementView,
  AmbientSessionView,
} from '../../../../packages/contracts/src/types.ts';
import { useAuth } from '../lib/auth.tsx';
import { ApiError, api, errorMessage } from '../lib/api.ts';
import {
  Button,
  Field,
  LinkButton,
  Loading,
  Notice,
  PageHeader,
  TextArea,
  TextInput,
  usePageTitle,
} from '../components/ui.tsx';
import { Icon, ObjectGlyph } from '../components/visuals.tsx';
import { AmbientFrame } from '../components/ambient-experience.tsx';
import { duration, money } from '../lib/format.ts';

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

export function AmbientExchange() {
  const { agreementId = '' } = useParams();
  const navigate = useNavigate();
  const { session: auth } = useAuth();
  const [view, setView] = useState<AmbientAgreementView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [demoMode, setDemoMode] = useState(true);
  const [counterPrice, setCounterPrice] = useState('2.00');
  const [counterSeconds, setCounterSeconds] = useState('30');
  const [counterNote, setCounterNote] = useState('I can hold the source inactive for this window and price.');
  usePageTitle(view?.serviceName ?? 'The Exchange');

  const load = useCallback(async () => {
    try {
      const next = await api<AmbientAgreementView>(`/api/ambient/agreements/${agreementId}`);
      setView(next);
      setCounterPrice((next.financial.fixedPriceMinor / 100).toFixed(2));
      setCounterSeconds(String(Math.round(next.terms.condition.requiredInactiveMs / 1000)));
      setError(null);
      return next;
    } catch (err) {
      setError(errorMessage(err));
      return null;
    }
  }, [agreementId]);

  useEffect(() => {
    void load();
  }, [load]);

  const respond = async (action: 'ACCEPT' | 'REJECT' | 'COUNTER') => {
    if (!view) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const next = await api<AmbientAgreementView>(`/api/operator/ambient/agreements/${view.id}/respond`, {
        method: 'POST',
        body:
          action === 'COUNTER'
            ? {
                action,
                termsHash: view.termsHash,
                priceMinor: Math.round(Number(counterPrice) * 100),
                durationSeconds: Number(counterSeconds),
                note: counterNote || null,
              }
            : { action, termsHash: view.termsHash },
      });
      setView(next);
      setNotice(
        action === 'COUNTER'
          ? 'The counteroffer is now the current revision. The buyer must accept it.'
          : action === 'ACCEPT'
            ? 'The provider accepted the exact terms. The buyer must now approve the same revision.'
            : 'The provider declined this revision. No payment can proceed.',
      );
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const buyerDecide = async (action: 'ACCEPT' | 'REJECT') => {
    if (!view) return;
    setBusy(true);
    setError(null);
    try {
      const next = await asBuyer(() =>
        api<AmbientAgreementView>(`/api/ambient/agreements/${view.id}/decision`, {
          method: 'POST',
          body: { action, termsHash: view.termsHash },
        }),
      );
      setView(next);
      setNotice(action === 'ACCEPT' ? 'The exact final terms are accepted. A session can now begin.' : 'The offer was rejected.');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const openSession = async () => {
    if (!view) return;
    setBusy(true);
    setError(null);
    try {
      const next = await asBuyer(() =>
        api<AmbientSessionView>(`/api/ambient/agreements/${view.id}/sessions`, {
          method: 'POST',
          body: { demo: demoMode, observationMode: demoMode ? 'REPLAY' : 'LIVE' },
        }),
      );
      navigate(`/ambient/window/${next.id}`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (!view) {
    return (
      <div className="page container">
        {error ? <Notice tone="danger">{error}</Notice> : <Loading label="Opening the negotiated terms…" />}
      </div>
    );
  }

  const current = view.currentOffer;
  const canRespond = view.flags.canRespond;
  const accepted = view.status === 'ACCEPTED';
  return (
    <AmbientFrame current="exchange" note="02 / TERMS">
      <div className="page ambient-page">
      <div className="container stack stack--lg">
        <PageHeader
          eyebrow="The Exchange · 02 / Terms"
          title="Make the terms exact."
          lede={`A bounded negotiation for ${view.serviceName}. No autonomous agents negotiate for either person; every change creates a new immutable revision.`}
          breadcrumbs={<><Link to="/ambient">Ambient</Link> <span aria-hidden="true">/</span> Exchange</>}
          actions={
            <span className={`chip ${accepted ? 'chip--ok' : view.flags.awaitingBuyer ? 'chip--warn' : 'chip--accent'}`}>
              {view.status.replaceAll('_', ' ')}
            </span>
          }
        />

        {error ? <Notice tone="danger">{error}</Notice> : null}
        {notice ? <Notice tone="ok">{notice}</Notice> : null}

        <div className="exchange-grid">
          <section className="card exchange-request stack">
            <div className="row row--between">
              <div className="row">
                <ObjectGlyph glyph={view.target.glyph} />
                <div>
                  <span className="eyebrow">Bound source</span>
                  <h2 className="h3">{view.target.objectName}</h2>
                </div>
              </div>
              <span className="chip">{view.model.provenance === 'SYNTHETIC_REFERENCE' ? 'synthetic model' : 'calibrated model'}</span>
            </div>
            <div className="exchange-request__wish">
              <span className="tiny muted">Original request</span>
              <p>“{view.interpretation.requestedText}”</p>
            </div>
            <div className="exchange-request__condition">
              <span className="tiny muted">What both parties are agreeing to observe</span>
              <p>{view.interpretation.observableCondition}</p>
            </div>
            <div className="terms-sheet">
              <div><span>Fixed price</span><strong>{view.financial.displayPrice}</strong></div>
              <div><span>Maximum</span><strong>{view.financial.displayMaximum}</strong></div>
              <div><span>Continuous window</span><strong>{duration(view.terms.condition.requiredInactiveMs)}</strong></div>
              <div><span>Baseline required</span><strong>{duration(view.terms.condition.requiredBaselineActiveMs)}</strong></div>
              <div><span>Interruption</span><strong>Reset</strong></div>
              <div><span>Sensor loss</span><strong>No capture</strong></div>
              <div><span>Human acceptance</span><strong>Buyer required</strong></div>
              <div><span>Payment recipient</span><strong>Sandbox merchant / operator</strong></div>
            </div>
            <p className="tiny muted">
              {view.sandbox.env === 'sandbox' ? 'PayPal Sandbox only.' : 'Sandbox.'} The provider is the operator account
              bound to this object. Whirr does not claim that a separate workshop participant was paid.
            </p>
          </section>

          <aside className="stack">
            <section className="card stack">
              <span className="eyebrow">Offer history</span>
              <ol className="offer-list">
                {view.offers.map((offer) => (
                  <li key={offer.id} className={offer.id === current?.id ? 'is-current' : ''}>
                    <div className="row row--between">
                      <strong className="mono">rev {offer.revision}</strong>
                      <span className={`chip ${offer.status === 'ACCEPTED' ? 'chip--ok' : offer.status === 'COUNTERED' ? 'chip--warn' : ''}`}>{offer.status}</span>
                    </div>
                    <span className="small">{offer.proposedBy === 'BUYER' ? 'Buyer' : 'Provider'} · {money(offer.priceMinor, view.financial.currency)} · {duration(offer.durationMs)}</span>
                    <span className="tiny muted">{offer.note ?? 'No note attached.'}</span>
                  </li>
                ))}
              </ol>
              <p className="tiny muted">
                Current terms hash <span className="mono break">{view.termsHash}</span>. The buyer must approve this exact
                revision; a superseded offer cannot be used for a capture.
              </p>
            </section>

            {canRespond ? (
              <section className="card stack exchange-provider">
                <div>
                  <span className="eyebrow">Provider decision</span>
                  <h2 className="h3">Do you voluntarily agree?</h2>
                </div>
                <p className="small muted">
                  You control the activity being modified. Only accept if you have the authority to pause it and the
                  requested conditions are physically possible.
                </p>
                <div className="row">
                  <Button variant="money" loading={busy} onClick={() => void respond('ACCEPT')}>
                    Accept exact terms
                  </Button>
                  <Button variant="secondary" loading={busy} onClick={() => void respond('REJECT')}>
                    Decline
                  </Button>
                </div>
                <details className="details">
                  <summary>Make a counteroffer</summary>
                  <div className="stack" style={{ marginTop: '0.75rem' }}>
                    <div className="inline-fields">
                      <Field label="Price (USD)" htmlFor="counter-price">
                        <TextInput id="counter-price" type="number" min="0.01" step="0.01" value={counterPrice} onChange={(event) => setCounterPrice(event.target.value)} />
                      </Field>
                      <Field label="Continuous seconds" htmlFor="counter-seconds">
                        <TextInput id="counter-seconds" type="number" min="10" max="120" value={counterSeconds} onChange={(event) => setCounterSeconds(event.target.value)} />
                      </Field>
                    </div>
                    <Field label="Note" htmlFor="counter-note">
                      <TextArea id="counter-note" rows={2} value={counterNote} onChange={(event) => setCounterNote(event.target.value)} />
                    </Field>
                    <Button variant="primary" loading={busy} onClick={() => void respond('COUNTER')}>
                      Send counteroffer
                    </Button>
                  </div>
                </details>
              </section>
            ) : null}

            {view.flags.canBuyerDecide ? (
              <section className="card stack exchange-buyer">
                <span className="eyebrow">Buyer approval</span>
                <h2 className="h3">Approve the final revision?</h2>
                <p className="small muted">
                  This is the buyer’s exact-terms consent, not a payment authorization. A PayPal order is created only
                  after this step.
                </p>
                <div className="row">
                  <Button variant="money" loading={busy} onClick={() => void buyerDecide('ACCEPT')}>Accept final terms</Button>
                  <Button variant="secondary" loading={busy} onClick={() => void buyerDecide('REJECT')}>Reject</Button>
                </div>
              </section>
            ) : null}

            {view.roles.buyer && !accepted && !view.flags.canBuyerDecide ? (
              <section className="card stack">
                <span className="eyebrow">Waiting for the provider</span>
                <h2 className="h3">Your offer is on the table.</h2>
                <p className="small muted">
                  The provider must accept this exact revision or send one counteroffer. No PayPal order exists yet, and
                  no microphone may open before both parties accept the same terms hash.
                </p>
              </section>
            ) : null}

            {view.roles.provider && accepted ? (
              <section className="card stack">
                <span className="eyebrow">Terms settled</span>
                <h2 className="h3">The buyer can now open the window.</h2>
                <p className="small muted">
                  You accepted the exact final terms. The buyer controls the financial authorization and the observation
                  start; you do not need to keep this page open.
                </p>
              </section>
            ) : null}

            {accepted && view.roles.buyer ? (
              <section className="card stack exchange-open">
                <span className="eyebrow">Next · The Window</span>
                <h2 className="h3">Create the observation session</h2>
                <p className="small muted">
                  The demo path uses a synthetic replay history and can never capture money. The live path requires a
                  PayPal Sandbox authorization and an open microphone.
                </p>
                <label className="check">
                  <input type="checkbox" checked={demoMode} onChange={(event) => setDemoMode(event.target.checked)} />
                  <span>Use the labelled demo replay (no order, no capture)</span>
                </label>
                {view.latestSession ? (
                  <LinkButton to={`/ambient/window/${view.latestSession.id}`} variant="primary">
                    Open existing window <Icon name="arrow" size={16} />
                  </LinkButton>
                ) : (
                  <Button variant={demoMode ? 'primary' : 'money'} loading={busy} disabled={!demoMode && !view.sandbox.configured} onClick={() => void openSession()}>
                    {demoMode ? 'Open demo window' : 'Open live Sandbox window'}
                  </Button>
                )}
                {!view.sandbox.configured ? (
                  <Notice tone="warn">
                    PayPal Sandbox is not configured on this installation. Demo windows still work; live authorization
                    and capture are unavailable.
                  </Notice>
                ) : null}
              </section>
            ) : null}

            {!view.roles.buyer && !view.roles.provider ? (
              <section className="card stack">
                <span className="eyebrow">Read-only view</span>
                <p className="small muted">
                  You are not the provider for this object and this browser is not the buyer who created the offer.
                  The terms remain inspectable, but only the bound parties can change their consent.
                </p>
                {!auth?.operator ? (
                  <LinkButton to={`/operator/login?next=${encodeURIComponent(`/ambient/exchange/${view.id}`)}`} variant="secondary">
                    Operator sign in
                  </LinkButton>
                ) : null}
              </section>
            ) : null}
          </aside>
        </div>

        <Notice tone="warn" title="The Exchange is not a general marketplace.">
          The prototype is restricted to invited, authorized participants. It does not support public bounties for
          creating a nuisance, anonymous payments to stop lawful activity, or a claim that the provider is the PayPal
          merchant when it is not.
        </Notice>
      </div>
      </div>
    </AmbientFrame>
  );
}
