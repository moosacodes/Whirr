import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, errorMessage } from '../lib/api.ts';
import { useAuth } from '../lib/auth.tsx';
import type { SessionView } from '../../../../packages/contracts/src/types.ts';
import { decimalStringToMinor } from '../../../../packages/meter/src/currency.ts';
import {
  Button,
  Check,
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
import { Icon, ObjectGlyph, Timeline, TimelineLegend } from '../components/visuals.tsx';
import { METER_COPY, SESSION_STATE_COPY, dateTime, duration, money } from '../lib/format.ts';

type PaymentStatus = {
  paymentState: string;
  providerStatus: string | null;
  capturedMinor: number | null;
  quoteMinor: number;
  captureId: string | null;
  authorizationId: string | null;
};

export function ReviewPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { session: auth } = useAuth();
  const [view, setView] = useState<SessionView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [disputeReason, setDisputeReason] = useState('');
  const [disputeCode, setDisputeCode] = useState<'WRONG_OBJECT' | 'NOT_RUNNING' | 'TOO_NOISY' | 'WRONG_INTERVAL' | 'OTHER'>('NOT_RUNNING');
  const [showDispute, setShowDispute] = useState(false);
  const [credit, setCredit] = useState('');
  const [creditReason, setCreditReason] = useState('Goodwill credit after reviewing evidence');
  const [flushWarning, setFlushWarning] = useState<string | null>(null);

  usePageTitle(view ? `Review ${view.objectName}` : 'Review bill');

  const load = useCallback(async () => {
    try {
      setView(await api<SessionView>(`/api/sessions/${id}`));
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    const warning = sessionStorage.getItem('whirr:flush-warning');
    if (warning) {
      setFlushWarning(warning);
      sessionStorage.removeItem('whirr:flush-warning');
    }
    void load();
  }, [load]);

  const acceptReview = async () => {
    if (!view) return;
    setBusy('accept');
    setError(null);
    try {
      setView(
        await api<SessionView>(`/api/sessions/${id}/review/accept`, {
          method: 'POST',
          body: { quoteHash: view.quote.quoteHash, accepted: true },
        }),
      );
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const openDispute = async () => {
    if (!view || selected.size === 0) return;
    setBusy('dispute');
    setError(null);
    try {
      await api(`/api/sessions/${id}/disputes`, {
        method: 'POST',
        body: { intervalIds: [...selected], reason: disputeReason.trim(), reasonCode: disputeCode },
      });
      setSelected(new Set());
      setDisputeReason('');
      setDisputeCode('NOT_RUNNING');
      setShowDispute(false);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const capture = async () => {
    setBusy('capture');
    setError(null);
    try {
      const next = await api<SessionView>(`/api/sessions/${id}/capture`, { method: 'POST' });
      setView(next);
      if (next.state === 'SETTLED' || next.paymentState === 'CAPTURE_COMPLETED') {
        navigate(`/receipt/${id}`);
      }
    } catch (err) {
      setError(errorMessage(err));
      await load();
    } finally {
      setBusy(null);
    }
  };

  const voidAuth = async () => {
    if (!window.confirm('Void the PayPal authorization and issue a no-charge receipt?')) return;
    setBusy('void');
    setError(null);
    try {
      const next = await api<SessionView>(`/api/sessions/${id}/void`, { method: 'POST' });
      setView(next);
      navigate(`/receipt/${id}`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const completeDemo = async () => {
    setBusy('demo');
    setError(null);
    try {
      await api<SessionView>(`/api/sessions/${id}/demo-complete`, { method: 'POST' });
      navigate(`/receipt/${id}`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const approve = async () => {
    setBusy('approve');
    setError(null);
    try {
      setView(await api<SessionView>(`/api/operator/sessions/${id}/approve-review`, { method: 'POST' }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const applyCredit = async () => {
    if (!view) return;
    const minor = decimalStringToMinor(credit, view.terms.currency);
    if (minor === null || minor <= 0) {
      setError('Enter a valid credit amount.');
      return;
    }
    setBusy('credit');
    setError(null);
    try {
      setView(
        await api<SessionView>(`/api/operator/sessions/${id}/credit`, {
          method: 'POST',
          body: { creditMinor: minor, reason: creditReason.trim() },
        }),
      );
      setCredit('');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const applyFairness = async () => {
    setBusy('fairness');
    setError(null);
    try {
      setView(await api<SessionView>(`/api/sessions/${id}/fairness-reserve`, { method: 'POST', body: {} }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const refund = async () => {
    setBusy('refund');
    setError(null);
    try {
      setView(await api<SessionView>(`/api/operator/sessions/${id}/refund`, { method: 'POST', body: {} }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const reconcile = async () => {
    setBusy('status');
    setError(null);
    try {
      const status = await api<PaymentStatus>(`/api/sessions/${id}/paypal/reconcile`, { method: 'POST' });
      await load();
      if (status.paymentState === 'CAPTURE_COMPLETED') navigate(`/receipt/${id}`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  if (loading) return <Loading label="Reconstructing the bill…" />;
  if (!view) {
    return (
      <div className="page container page--narrow">
        <Notice tone="danger">{error ?? 'Session not found.'}</Notice>
      </div>
    );
  }

  const live = ['READY', 'ACTIVE', 'PAUSED', 'CONSENTED', 'PAYMENT_PENDING'].includes(view.state);
  const settled = ['SETTLED', 'NO_CHARGE', 'DEMO_COMPLETED', 'SETTLEMENT_PENDING', 'FAILED'].includes(view.state);
  const awaitingOperator = view.reviewMode === 'OPERATOR_REQUIRED' && !view.operatorApprovedAt;
  const isOperator = Boolean(auth?.operator);

  return (
    <div className="page container page--wide">
      <PageHeader
        eyebrow="Bill review"
        breadcrumbs={
          <>
            <Link to={`/s/${view.objectId}`}>{view.objectName}</Link> <span aria-hidden="true">/</span>{' '}
            <span className="mono">{view.id.slice(-8)}</span> <span aria-hidden="true">/</span> <span>Review</span>
          </>
        }
        title="Review the meter's work."
        lede="Every billable segment is a row of evidence. Check it before accepting. Uncertainty, idle and disconnected time are already excluded; a dispute can only reduce this bill."
        actions={
          <span className="chip">{SESSION_STATE_COPY[view.state]}</span>
        }
      />

      {error ? (
        <div style={{ marginBottom: '1rem' }}>
          <Notice tone="danger">{error}</Notice>
        </div>
      ) : null}
      {flushWarning ? (
        <div style={{ marginBottom: '1rem' }}>
          <Notice tone="warn" title="Some evidence was lost before stopping.">
            {flushWarning} Missing intervals are excluded, so this can only reduce the bill.
          </Notice>
        </div>
      ) : null}

      {live ? (
        <div className="card stack">
          <Notice tone="warn" title="This session is still live.">
            Stop the session before reviewing or settling. No capture is possible while sensing is active.
          </Notice>
          <LinkButton to={`/session/${id}`} variant="primary">
            Return to the live meter <Icon name="arrow" size={16} />
          </LinkButton>
        </div>
      ) : (
        <div className="sidebar-layout">
          <div className="stack">
            <section className="card stack">
              <div className="row row--between">
                <div className="row">
                  <ObjectGlyph glyph={view.objectGlyph} size={50} tone="accent" />
                  <div className="stack" style={{ gap: '0.15rem' }}>
                    <h2 className="h2" style={{ fontSize: '1.7rem' }}>{view.objectName}</h2>
                    <span className="tiny muted">{view.ownerLabel}</span>
                  </div>
                </div>
                <div className="row">
                  <span className="chip">{view.sensorMode}</span>
                  <span className="chip">{view.paymentState.replaceAll('_', ' ').toLowerCase()}</span>
                </div>
              </div>
              <div className="grid-4">
                <div className="stat stat--accent">
                  <span className="stat__value">{money(view.quote.quoteMinor, view.terms.currency)}</span>
                  <span className="stat__label">final bill</span>
                </div>
                <div className="stat">
                  <span className="stat__value">{duration(view.billableMs)}</span>
                  <span className="stat__label">billable</span>
                </div>
                <div className="stat">
                  <span className="stat__value">{duration(view.excludedMs)}</span>
                  <span className="stat__label">uncertain · free</span>
                </div>
                <div className="stat">
                  <span className="stat__value">{money(view.terms.capMinor, view.terms.currency)}</span>
                  <span className="stat__label">consented cap</span>
                </div>
              </div>
              <div className="timeline-card">
                <Timeline
                  intervals={view.intervals}
                  totalMs={Math.max(view.meterClockMs, 1000)}
                  height={48}
                  label="Full sensor timeline for this session"
                />
                <div style={{ marginTop: 8 }}>
                  <TimelineLegend />
                </div>
              </div>
              <div className="panel">
                <span className="eyebrow">The arithmetic</span>
                <code className="mono tiny break" style={{ display: 'block', marginTop: 6 }}>{view.quote.formula}</code>
                <div className="row" style={{ marginTop: 8, gap: '1rem' }}>
                  <span className="tiny muted">Rate {money(view.terms.minorPerMinute, view.terms.currency)}/min</span>
                  <span className="tiny muted">Credit {money(view.quote.creditMinor, view.terms.currency)}</span>
                  <span className="tiny muted">Round once at end</span>
                  <span className="tiny muted">Cap respected</span>
                </div>
              </div>
            </section>

            <section className="card stack">
              <div className="row row--between">
                <h2 className="h3">Evidence intervals</h2>
                <span className="chip">{view.intervals.length} rows</span>
              </div>
              <p className="small muted">
                Only ACTIVE intervals are billable. Select billable rows to open a dispute; credits are applied only
                after an operator resolves it.
              </p>
              {view.intervals.length === 0 ? (
                <p className="small muted">No intervals were recorded. The bill is zero.</p>
              ) : (
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th />
                        <th>Start</th>
                        <th>End</th>
                        <th>State</th>
                        <th>Confidence</th>
                        <th>Evidence</th>
                      </tr>
                    </thead>
                    <tbody>
                      {view.intervals.map((interval) => {
                        const isBillable = interval.state === 'ACTIVE_CONFIDENT';
                        return (
                          <tr key={interval.id}>
                            <td>
                              {isBillable ? (
                                <input
                                  type="checkbox"
                                  aria-label={`Select interval at ${(interval.startMs / 1000).toFixed(1)} seconds`}
                                  checked={selected.has(interval.id)}
                                  onChange={(event) => {
                                    const next = new Set(selected);
                                    if (event.target.checked) next.add(interval.id);
                                    else next.delete(interval.id);
                                    setSelected(next);
                                  }}
                                  disabled={settled}
                                />
                              ) : null}
                            </td>
                            <td className="mono">{(interval.startMs / 1000).toFixed(1)}s</td>
                            <td className="mono">{(interval.endMs / 1000).toFixed(1)}s</td>
                            <td>
                              <span className={`state state--${interval.state.toLowerCase()}`}>
                                <span className="state__dot" /> {METER_COPY[interval.state].label}
                              </span>
                            </td>
                            <td className="mono tiny">{(interval.confidence * 100).toFixed(1)}%</td>
                            <td className="mono tiny break">{interval.evidenceHash.slice(0, 14)}…</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              {selected.size > 0 && !settled ? (
                <div className="panel panel--accent stack">
                  <strong className="small">{selected.size} interval(s) selected</strong>
                  <Field label="Structured reason">
                    <Select value={disputeCode} onChange={(event) => setDisputeCode(event.target.value as typeof disputeCode)}>
                      <option value="WRONG_OBJECT">Wrong object</option>
                      <option value="NOT_RUNNING">Object was not running</option>
                      <option value="TOO_NOISY">Too noisy to judge</option>
                      <option value="WRONG_INTERVAL">Wrong interval marked</option>
                      <option value="OTHER">Other</option>
                    </Select>
                  </Field>
                  <TextArea
                    value={disputeReason}
                    onChange={(event) => setDisputeReason(event.target.value)}
                    placeholder="Explain why these segments should not be billed (at least 10 characters)."
                    maxLength={600}
                  />
                  <div className="row">
                    <Button onClick={() => void openDispute()} loading={busy === 'dispute'} disabled={disputeReason.trim().length < 10}>
                      Open dispute
                    </Button>
                    <Button variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
                  </div>
                </div>
              ) : null}
              {!settled ? (
                <Button variant="ghost" size="sm" onClick={() => setShowDispute((value) => !value)}>
                  {showDispute ? 'Hide guidance' : 'How disputes work'}
                </Button>
              ) : null}
              {showDispute ? (
                <p className="tiny muted">
                  A dispute freezes settlement. An operator resolves it with an optional credit; the renter still has to
                  accept the resulting quote. Credits can only reduce the amount, never increase it.
                </p>
              ) : null}
            </section>

            {view.disputes.length > 0 ? (
              <section className="card stack">
                <h2 className="h3">Disputes</h2>
                {view.disputes.map((dispute) => (
                  <div key={dispute.id} className="panel stack" style={{ gap: '0.35rem' }}>
                    <div className="row row--between">
                      <span className={`chip ${dispute.status === 'RESOLVED' ? 'chip--ok' : dispute.status === 'REJECTED' ? 'chip--danger' : 'chip--warn'}`}>
                        {dispute.status}
                      </span>
                      <span className="tiny muted">{dateTime(dispute.createdAt)}</span>
                    </div>
                    <p className="small">{dispute.reason}</p>
                    <p className="tiny muted">
                      {dispute.reasonCode ?? 'OTHER'} · {dispute.intervalIds.length} interval(s) · credit {money(dispute.creditMinor, view.terms.currency)}
                      {dispute.resolution ? ` · ${dispute.resolution}` : ''}
                    </p>
                  </div>
                ))}
              </section>
            ) : null}
          </div>

          <aside className="stack">
            <section className="card stack" style={{ borderColor: 'rgba(194,91,42,.3)' }}>
              <span className="eyebrow">Settlement</span>
              <div className="big-number">{money(view.quote.quoteMinor, view.terms.currency)}</div>
              <p className="small muted">
                {view.paymentState === 'DEMO_MODE'
                  ? 'Demo metering. No PayPal operation exists for this session.'
                  : view.quote.quoteMinor === 0
                    ? 'Zero bill. The correct action is to void the authorization, never capture.'
                    : `Capture exactly this amount, up to the consented cap of ${money(view.terms.capMinor, view.terms.currency)}.`}
              </p>

              <div className="stack" style={{ gap: '0.5rem' }}>
                <div className="row row--between tiny">
                  <span className="muted">Quote hash</span>
                  <span className="mono break" style={{ maxWidth: '55%', textAlign: 'right' }}>{view.quote.quoteHash.slice(0, 20)}…</span>
                </div>
                <div className="row row--between tiny">
                  <span className="muted">Review mode</span>
                  <span>{view.reviewMode === 'AUTO' ? 'automatic' : 'operator required'}</span>
                </div>
                <div className="row row--between tiny">
                  <span className="muted">Payment</span>
                  <span>{view.paymentState.replaceAll('_', ' ').toLowerCase()}</span>
                </div>
                {view.paypal.authorizationId ? (
                  <div className="row row--between tiny">
                    <span className="muted">Authorization</span>
                    <span className="mono break" style={{ maxWidth: '55%', textAlign: 'right' }}>{view.paypal.authorizationId}</span>
                  </div>
                ) : null}
              </div>

              {view.fairnessReserveMinor > 0 ? (
                <div className="panel stack" style={{ gap: '0.4rem' }}>
                  <div className="row row--between">
                    <strong className="small">Fairness reserve</strong>
                    <span className="chip">{money(view.fairnessReserveMinor, view.terms.currency)}</span>
                  </div>
                  <p className="tiny muted">
                    Pre-committed courtesy credit, capped at 10% of the consented cap. It reduces this quote once, without
                    an interrogation. It is not a provider refund and cannot create a new charge.
                  </p>
                  {view.fairnessCreditAppliedMinor > 0 ? (
                    <span className="tiny">Applied: {money(view.fairnessCreditAppliedMinor, view.terms.currency)} off this bill.</span>
                  ) : view.canUseFairnessReserve ? (
                    <Button variant="secondary" size="sm" onClick={() => void applyFairness()} loading={busy === 'fairness'}>
                      Apply reserve once
                    </Button>
                  ) : (
                    <span className="tiny muted">Available only before review, while a balance remains.</span>
                  )}
                </div>
              ) : null}

              <hr className="divider" />

              {view.state === 'STOPPED' ? (
                <>
                  <Check checked={accepted} onChange={setAccepted}>
                    I have reviewed the intervals and accept this exact quote ({money(view.quote.quoteMinor, view.terms.currency)}). I understand the amount cannot increase.
                  </Check>
                  <Button onClick={() => void acceptReview()} loading={busy === 'accept'} disabled={!accepted} block>
                    Accept reviewed bill
                  </Button>
                </>
              ) : null}

              {view.state === 'REVIEWED' ? (
                <>
                  {awaitingOperator ? (
                    <Notice tone="warn" title="Operator review required.">
                      This LIMITED model needs an operator to approve the bill before any capture. The quote is frozen.
                    </Notice>
                  ) : null}
                  {view.paymentState === 'DEMO_MODE' ? (
                    <Button onClick={() => void completeDemo()} loading={busy === 'demo'} variant="primary" block>
                      Complete demo — no payment
                    </Button>
                  ) : view.paymentState === 'AUTHORIZED' ? (
                    <>
                      {view.quote.quoteMinor === 0 ? (
                        <Button onClick={() => void voidAuth()} loading={busy === 'void'} variant="secondary" block>
                          Void authorization — no charge
                        </Button>
                      ) : (
                        <Button
                          onClick={() => void capture()}
                          loading={busy === 'capture'}
                          disabled={awaitingOperator}
                          variant="money"
                          block
                          size="lg"
                        >
                          <Icon name="lock" size={16} /> Capture {money(view.quote.quoteMinor, view.terms.currency)} in Sandbox
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" onClick={() => void reconcile()} loading={busy === 'status'}>
                        Reconcile with PayPal
                      </Button>
                    </>
                  ) : view.paymentState === 'CAPTURE_PENDING' ? (
                    <Button variant="secondary" onClick={() => void reconcile()} loading={busy === 'status'} block>
                      Capture pending — check PayPal
                    </Button>
                  ) : (
                    <Notice tone="warn">
                      Payment is {view.paymentState.replaceAll('_', ' ').toLowerCase()}. Use reconciliation or the operator
                      console if this persists.
                    </Notice>
                  )}
                </>
              ) : null}

              {view.state === 'SETTLEMENT_PENDING' && view.paymentState === 'CAPTURE_REQUESTED' ? (
                <div className="stack" style={{ gap: '0.6rem' }}>
                  <Notice tone="warn" title="Capture outcome unknown.">
                    PayPal may have completed this capture even though Whirr did not receive the response. Retrying with
                    the original request id is safe: PayPal returns the prior result instead of charging twice.
                  </Notice>
                  <Button
                    onClick={() => void capture()}
                    loading={busy === 'capture'}
                    disabled={awaitingOperator || !view.flags.canRetryCapture}
                    variant="money"
                    block
                    size="lg"
                  >
                    <Icon name="lock" size={16} /> Retry capture safely
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => void reconcile()} loading={busy === 'status'}>
                    Reconcile with PayPal instead
                  </Button>
                </div>
              ) : null}

              {settled ? (
                <LinkButton to={`/receipt/${id}`} variant="primary" block>
                  Open evidence receipt <Icon name="arrow" size={16} />
                </LinkButton>
              ) : null}

              {view.state === 'SETTLEMENT_PENDING' && view.paymentState !== 'CAPTURE_REQUESTED' ? (
                <Button variant="secondary" onClick={() => void reconcile()} loading={busy === 'status'} block>
                  Check PayPal settlement
                </Button>
              ) : null}
            </section>

            {isOperator ? (
              <section className="card stack">
                <div className="row row--between">
                  <h2 className="h3">Operator tools</h2>
                  <span className="chip chip--dark">operator</span>
                </div>
                {view.reviewMode === 'OPERATOR_REQUIRED' && view.state === 'REVIEWED' && !view.operatorApprovedAt ? (
                  <Button onClick={() => void approve()} loading={busy === 'approve'} variant="primary" block>
                    Approve reviewed LIMITed bill
                  </Button>
                ) : view.operatorApprovedAt ? (
                  <p className="tiny muted">Approved {dateTime(view.operatorApprovedAt)}.</p>
                ) : null}

                <Field label="Apply credit" hint="Credits reduce the bill only; no additional charge can be created.">
                  <div className="row">
                    <TextInput
                      value={credit}
                      onChange={(event) => setCredit(event.target.value)}
                      inputMode="decimal"
                      placeholder="0.50"
                      style={{ maxWidth: 120 }}
                    />
                    <Button variant="secondary" size="sm" onClick={() => void applyCredit()} loading={busy === 'credit'} disabled={Boolean(busy)}>
                      Apply
                    </Button>
                  </div>
                </Field>
                <TextInput value={creditReason} onChange={(event) => setCreditReason(event.target.value)} maxLength={600} />
                {view.paymentState === 'CAPTURE_COMPLETED' ? (
                  <Button variant="danger" size="sm" onClick={() => void refund()} loading={busy === 'refund'} block>
                    Refund full Sandbox capture
                  </Button>
                ) : null}
                <Link to="/operator" className="link tiny">Operator console →</Link>
              </section>
            ) : null}

            <section className="card card--soft stack">
              <h2 className="h3">What was measured</h2>
              <dl className="kv">
                <dt>Observed</dt>
                <dd>{duration(view.observedMs)}</dd>
                <dt>Billable</dt>
                <dd>{duration(view.billableMs)}</dd>
                <dt>Idle</dt>
                <dd>{duration(view.idleMs)}</dd>
                <dt>Uncertain</dt>
                <dd>{duration(view.excludedMs)}</dd>
                <dt>Disconnected</dt>
                <dd>{duration(view.disconnectedMs)}</dd>
                <dt>Noise</dt>
                <dd>{money(view.quote.creditMinor, view.terms.currency)} credit</dd>
              </dl>
              <p className="tiny muted">
                These totals come from evidence rows, not from elapsed wall-clock time. Nothing is inferred for gaps.
              </p>
            </section>

            <section className="card stack">
              <h2 className="h3">Model at settlement</h2>
              <div className="row">
                <span className={`chip chip--${view.model.status === 'READY' ? 'ok' : view.model.status === 'LIMITED' ? 'warn' : 'danger'}`}>
                  {view.model.status}
                </span>
                <span className="chip">{view.model.metrics.provenance === 'SYNTHETIC_REFERENCE' ? 'synthetic' : 'calibrated'}</span>
              </div>
              <p className="small muted">
                {view.model.version} · {(view.model.metrics.precision * 100).toFixed(1)}% precision ·{' '}
                {(view.model.metrics.falseBillableRatio * 100).toFixed(2)}% false billable. Acoustic passport{' '}
                {view.model.soundprint?.gateEnabled
                  ? 'active'
                  : view.model.soundprint
                    ? 'weak / disabled'
                    : 'not enrolled'}{' '}
                · <Link to={`/passport/${view.objectId}`}>open passport</Link>.
              </p>
              <p className="tiny muted">
                A mismatch between the model that produced intervals and the one shown here would fail receipt
                verification.
              </p>
            </section>
          </aside>
        </div>
      )}
    </div>
  );
}
