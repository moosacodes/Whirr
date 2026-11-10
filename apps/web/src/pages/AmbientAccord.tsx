import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import type { AmbientProofView, AmbientSessionView } from '../../../../packages/contracts/src/types.ts';
import type { AmbientProofPayload } from '../../../../packages/protocol/src/ambient-proof.ts';
import { api, errorMessage } from '../lib/api.ts';
import { loadAmbientSession } from '../lib/ambient-session.ts';
import {
  LinkButton,
  Loading,
  Notice,
  PageHeader,
  Stat,
  usePageTitle,
} from '../components/ui.tsx';
import { Icon, ObjectGlyph } from '../components/visuals.tsx';
import { AmbientFrame } from '../components/ambient-experience.tsx';
import { dateTime, duration, money } from '../lib/format.ts';

export function AmbientAccord() {
  const { sessionId = '' } = useParams();
  const [searchParams] = useSearchParams();
  const [session, setSession] = useState<AmbientSessionView | null>(null);
  const [proof, setProof] = useState<AmbientProofView | null>(null);
  const [error, setError] = useState<string | null>(null);
  usePageTitle(session?.serviceName ?? 'The Accord');

  useEffect(() => {
    loadAmbientSession(sessionId, searchParams.get('replay') === '1')
      .then(setSession)
      .catch((err) => setError(errorMessage(err)));
  }, [sessionId, searchParams]);

  useEffect(() => {
    if (!session?.proofId) return;
    api<AmbientProofView>(`/api/ambient/proofs/${session.proofId}`)
      .then(setProof)
      .catch((err) => setError(errorMessage(err)));
  }, [session?.proofId]);

  if (!session) {
    return <div className="page container">{error ? <Notice tone="danger">{error}</Notice> : <Loading label="Opening the Accord…" />}</div>;
  }

  const payload = (proof?.document as { payload?: AmbientProofPayload } | null)?.payload ?? null;
  const evaluation = session.evaluation;
  const price = money(session.terms.financial.fixedPriceMinor, session.terms.financial.currency);
  const paymentLabel = session.demo
    ? 'DEMO_NO_PAYMENT'
    : session.payment.captureId
      ? `Captured ${money(session.payment.capturedMinor ?? 0, session.terms.financial.currency)}`
      : session.payment.voidId
        ? 'Authorization voided'
        : session.payment.authorizationId
          ? 'Authorized, not captured'
          : session.paymentState.replaceAll('_', ' ');

  return (
    <AmbientFrame current="accord" note="04 / RECORD">
        <div className="page ambient-page">
      <div className="container stack stack--lg">
        <PageHeader
          eyebrow="The Accord · 04 / Record"
          title="A record of cooperation."
          lede="What was requested, what was agreed, what the sensor observed, what remained uncertain, what the buyer accepted, and what PayPal actually did. The limits travel with the record."
          breadcrumbs={<><Link to="/ambient">Ambient</Link> <span aria-hidden="true">/</span> Accord</>}
          actions={
            session.proofId ? (
              <LinkButton to={`/ambient/proof/${session.proofId}`} variant="secondary">
                Public proof page
              </LinkButton>
            ) : null
          }
        />

        {error ? <Notice tone="danger">{error}</Notice> : null}

        <section className="accord-hero">
          <div className="accord-hero__top">
            <div className="row">
              <ObjectGlyph glyph={session.target.glyph} tone="dark" />
              <div>
                <span className="eyebrow eyebrow--light">{session.demo ? 'SYNTHETIC REPLAY · DEMO_NO_PAYMENT' : 'PAYPAL SANDBOX'}</span>
                <h2 className="display display--sm">{session.serviceName}</h2>
              </div>
            </div>
            <div className="accord-hero__stamp">
              <span className="accord-hero__stamp-label">{evaluation?.outcome ?? session.state}</span>
              <strong>{evaluation?.eligibleForCapture ? 'no capture yet' : 'no capture'}</strong>
              <span className="tiny">contract result</span>
            </div>
          </div>
          <div className="accord-hero__amount">{price}</div>
          <div className="accord-hero__facts">
            <div><span className="tiny">Buyer</span><strong className="mono">{session.terms.parties.buyerRef}</strong></div>
            <div><span className="tiny">Provider / merchant</span><strong className="mono">{session.terms.parties.providerRef}</strong></div>
            <div><span className="tiny">Payment</span><strong>{paymentLabel}</strong></div>
            <div><span className="tiny">Observation</span><strong>{session.demo ? 'synthetic replay' : 'browser microphone'}</strong></div>
          </div>
        </section>

        <div className="accord-grid">
          <div className="stack">
            <section className="card stack">
              <span className="eyebrow">01 · The request</span>
              <blockquote className="accord-quote">“{session.interpretation.requestedText}”</blockquote>
              <div className="accord-two">
                <div>
                  <span className="tiny muted">Approved observable interpretation</span>
                  <p className="small">{session.interpretation.observableCondition}</p>
                </div>
                <div>
                  <span className="tiny muted">What it cannot claim</span>
                  <p className="small">{session.interpretation.proxyDisclosure}</p>
                </div>
              </div>
            </section>

            <section className="card stack">
              <span className="eyebrow">02 · The interval ledger</span>
              <div className="window-ledger window-ledger--static">
                <div className="window-ledger__track" aria-hidden="true">
                  {session.observations.map((observation) => {
                    const total = session.observations.at(-1)?.endMs ?? 1;
                    return (
                      <span
                        key={observation.seq}
                        className={`window-ledger__segment window-ledger__segment--${observation.sourceState.toLowerCase()}`}
                        style={{
                          left: `${(observation.startMs / total) * 100}%`,
                          width: `${Math.max((((observation.endMs - observation.startMs) / total) * 100), 0.35)}%`,
                        }}
                        title={`${observation.sourceState} · ${duration(observation.endMs - observation.startMs)}`}
                      />
                    );
                  })}
                  <span className="window-ledger__start" />
                  <span className="window-ledger__end" />
                </div>
                <div className="window-ledger__labels"><span>0s</span><span>{duration(session.observations.at(-1)?.endMs ?? 0)}</span></div>
              </div>
              <div className="grid-4">
                <Stat label="Baseline active" value={duration(evaluation?.baselineActiveMs ?? 0)} />
                <Stat label="Non-detection" value={duration(evaluation?.inactiveMs ?? 0)} />
                <Stat label="Longest run" value={duration(evaluation?.longestInactiveMs ?? 0)} />
                <Stat label="Interruptions" value={evaluation?.interruptions ?? 0} tone={(evaluation?.interruptions ?? 0) > 0 ? 'accent' : undefined} />
              </div>
              <div className="accord-checks">
                {evaluation?.checks.map((check) => (
                  <div className={`accord-check accord-check--${check.status.toLowerCase()}`} key={check.id}>
                    <span aria-hidden="true">{check.status === 'PASS' ? '✓' : check.status === 'FAIL' ? '×' : '?'}</span>
                    <div><strong>{check.label}</strong><span className="tiny">{check.detail}</span></div>
                  </div>
                )) ?? <p className="small muted">No evaluation has been stored yet.</p>}
              </div>
              <p className="small muted">{evaluation?.reason ?? 'The window has not been evaluated.'}</p>
            </section>

            <section className="card stack">
              <span className="eyebrow">03 · Consent and acceptance</span>
              <div className="accord-consent">
                <div><span>Buyer accepted exact terms</span><strong>{dateTime(payload?.consent.buyerAcceptedAt ?? session.acceptedAt)}</strong></div>
                <div><span>Provider accepted exact terms</span><strong>{dateTime(payload?.consent.providerAcceptedAt ?? null)}</strong></div>
                <div><span>Buyer result acceptance</span><strong>{session.acceptance ? (session.acceptance.accepted ? 'accepted' : 'rejected') : 'not claimed'}</strong></div>
                <div><span>Observation started</span><strong>{dateTime(session.observationStartedAt)}</strong></div>
                <div><span>Observation ended</span><strong>{dateTime(session.observationStoppedAt)}</strong></div>
                <div><span>Terms hash</span><strong className="mono break">{session.agreementHash}</strong></div>
              </div>
            </section>
          </div>

          <aside className="stack">
            <section className="card stack">
              <span className="eyebrow">The financial record</span>
              <div className="terms-sheet">
                <div><span>Mode</span><strong>{session.demo ? 'DEMO_NO_PAYMENT' : 'PAYPAL_SANDBOX'}</strong></div>
                <div><span>Payment state</span><strong>{paymentLabel}</strong></div>
                <div><span>Order</span><strong className="mono break">{session.payment.orderId ?? '—'}</strong></div>
                <div><span>Authorization</span><strong className="mono break">{session.payment.authorizationId ?? '—'}</strong></div>
                <div><span>Capture</span><strong className="mono break">{session.payment.captureId ?? '—'}</strong></div>
                <div><span>Provider status</span><strong>{session.payment.providerStatus ?? '—'}</strong></div>
              </div>
              {session.demo ? (
                <Notice tone="warn">
                  This is not a PayPal transaction. No order, authorization, capture or void exists for this demo
                  history. A Sandbox capture requires a live buyer-approved session.
                </Notice>
              ) : (
                <p className="tiny muted">
                  The capture reference is a provider result, not a real-money transaction. A fresh PayPal API call is
                  required to confirm the current provider state.
                </p>
              )}
            </section>

            <section className="card stack">
              <div className="row row--between">
                <span className="eyebrow">Verification</span>
                <span className={`chip ${proof?.verification.valid ? 'chip--ok' : proof ? 'chip--danger' : 'chip--warn'}`}>
                  {proof?.verification.valid ? 'signed proof valid' : proof ? 'proof invalid' : 'no proof yet'}
                </span>
              </div>
              {proof ? (
                <>
                  <p className="small muted">{proof.verification.disclaimer}</p>
                  <div className="accord-verification-checks">
                    {proof.verification.checks.map((check) => (
                      <div key={check.id} className="row" style={{ alignItems: 'flex-start' }}>
                        <span className={check.pass ? 'accord-mark--ok' : 'accord-mark--bad'} aria-hidden="true">{check.pass ? '✓' : '×'}</span>
                        <span className="tiny"><strong>{check.label}:</strong> {check.detail}</span>
                      </div>
                    ))}
                  </div>
                  <LinkButton to={`/ambient/proof/${proof.id}`} variant="secondary" block>
                    Inspect signed proof <Icon name="external" size={14} />
                  </LinkButton>
                </>
              ) : (
                <p className="small muted">The signed record will be available once the session has a final contract result.</p>
              )}
            </section>

          </aside>
        </div>

        <section className="accord-boundary">
          <div className="accord-boundary__intro">
            <span className="eyebrow">The limits of the record</span>
            <h2 className="h3">What remains outside the instrument.</h2>
          </div>
          <div className="accord-boundary__grid">
            <section className="card card--soft stack">
              <span className="eyebrow">Evidence boundary</span>
              <ul className="window-limits">
                {payload?.limitations ? payload.limitations.map((line) => <li key={line}>{line}</li>) : session.limitations.map((line) => <li key={line}>{line}</li>)}
              </ul>
            </section>

            <section className="card stack">
              <span className="eyebrow">What PayPal can and cannot prove</span>
              <p className="small muted">
                PayPal can prove that its Sandbox authorization or capture API returned a reference. It cannot prove
                that a fan was physically off, that a room was silent, or that the buyer’s microphone was honest.
              </p>
              {payload ? (
                <div className="accord-trust">
                  {payload.trust.map((entry) => (
                    <div key={entry.domain}>
                      <span className="mono tiny">{entry.domain}</span>
                      <span className={`chip ${entry.status === 'CHECKED' ? 'chip--ok' : entry.status === 'NOT_CLAIMED' ? 'chip--warn' : ''}`}>{entry.status.replaceAll('_', ' ')}</span>
                      <p className="tiny muted">{entry.detail}</p>
                    </div>
                  ))}
                </div>
              ) : null}
            </section>
          </div>
        </section>

        <div className="row row--between">
          <Link to="/ambient" className="link">← Ambient overview</Link>
          <Link to={`/ambient/window/${session.id}?replay=1`} className="link">Replay the window →</Link>
        </div>
      </div>
      </div>
    </AmbientFrame>
  );
}
