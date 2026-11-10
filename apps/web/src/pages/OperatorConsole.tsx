import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../lib/api.ts';
import type { OperatorOverview, SessionListItem } from '../../../../packages/contracts/src/types.ts';
import { decimalStringToMinor } from '../../../../packages/meter/src/currency.ts';
import {
  Button,
  EmptyState,
  Field,
  Loading,
  Notice,
  PageHeader,
  Select,
  Stat,
  TextArea,
  TextInput,
  usePageTitle,
} from '../components/ui.tsx';
import { SESSION_STATE_COPY, dateTime, duration, money, titleCase } from '../lib/format.ts';

export function OperatorConsole() {
  usePageTitle('Operator console');
  const [data, setData] = useState<OperatorOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [disputeId, setDisputeId] = useState<string | null>(null);
  const [resolution, setResolution] = useState('Reviewed evidence with the renter and applied a credit.');
  const [credit, setCredit] = useState('');
  const [decision, setDecision] = useState<'RESOLVED' | 'REJECTED'>('RESOLVED');

  const load = useCallback(async () => {
    try {
      setData(await api<OperatorOverview>('/api/operator/overview'));
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const sessionById = useMemo(() => {
    const map = new Map<string, SessionListItem>();
    for (const session of data?.sessions ?? []) map.set(session.id, session);
    return map;
  }, [data]);

  const resolveDispute = async (id: string) => {
    const session = data?.disputes.find((d) => d.id === id);
    const linked = session ? sessionById.get(session.sessionId) : undefined;
    const currency = linked?.currency ?? 'USD';
    let creditMinor = 0;
    if (credit.trim()) {
      const parsed = decimalStringToMinor(credit, currency);
      if (parsed === null) {
        setError('Credit is not a valid amount for this currency.');
        return;
      }
      creditMinor = parsed;
    }
    if (resolution.trim().length < 3) {
      setError('Add a short resolution note.');
      return;
    }
    setBusy(`dispute-${id}`);
    setError(null);
    try {
      await api(`/api/operator/disputes/${id}/resolve`, {
        method: 'POST',
        body: { status: decision, creditMinor, resolution: resolution.trim() },
      });
      setDisputeId(null);
      setCredit('');
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const drain = async () => {
    setBusy('drain');
    setError(null);
    try {
      await api('/api/operator/outbox/drain', { method: 'POST' });
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const toggleShelf = async (objectId: string, listed: boolean) => {
    setBusy(`shelf-${objectId}`);
    setError(null);
    try {
      await api(`/api/operator/objects/${objectId}/shelf`, { method: 'POST', body: { listed } });
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  if (loading) return <Loading label="Loading operator console…" />;
  if (!data) {
    return (
      <div className="page container page--narrow">
        <Notice tone="danger">{error ?? 'Unable to load operator data.'}</Notice>
      </div>
    );
  }

  const settled = data.sessions.filter((session) => ['SETTLED', 'NO_CHARGE', 'DEMO_COMPLETED'].includes(session.state)).length;
  const openDisputes = data.disputes.filter((dispute) => dispute.status === 'OPEN');

  return (
    <div className="page container page--wide">
      <PageHeader
        eyebrow="Operator console"
        title="Everything the meter did."
        lede="Live sessions, disputes, provider webhooks and the audit chain in one place. Financial mutations still run through the same consent, review and cap checks as the renter flow."
        actions={
          <>
            <Button variant="secondary" onClick={() => void drain()} loading={busy === 'drain'}>
              Drain outbox
            </Button>
            <Button variant="ghost" onClick={() => void load()}>Refresh</Button>
          </>
        }
      />

      {error ? (
        <div style={{ marginBottom: '1rem' }}>
          <Notice tone="danger">{error}</Notice>
        </div>
      ) : null}

      <div className="grid-4" style={{ marginBottom: '1.5rem' }}>
        <Stat label="Objects" value={data.objects.length} />
        <Stat label="Sessions" value={data.sessions.length} />
        <Stat label="Closed" value={settled} tone="accent" />
        <Stat label="Disputes" value={openDisputes.length} />
      </div>

      <div className="sidebar-layout">
        <div className="stack">
          <section className="card stack">
            <div className="row row--between">
              <h2 className="h3">Sessions</h2>
              <span className="chip">{data.sessions.length}</span>
            </div>
            {data.sessions.length === 0 ? (
              <p className="small muted">No renter sessions yet. Share a published service card.</p>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Object</th>
                      <th>State</th>
                      <th>Billable</th>
                      <th>Quote</th>
                      <th>Payment</th>
                      <th>Review</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {data.sessions.map((session) => (
                      <tr key={session.id}>
                        <td>
                          <strong>{session.objectName}</strong>
                          <div className="tiny muted">{dateTime(session.createdAt)} · {session.renterRef}</div>
                        </td>
                        <td>
                          <span className="chip">{SESSION_STATE_COPY[session.state]}</span>
                          {session.disputeCount > 0 ? <div className="tiny" style={{ color: 'var(--danger)' }}>{session.disputeCount} dispute(s)</div> : null}
                        </td>
                        <td className="mono">{duration(session.billableMs)}</td>
                        <td className="mono">{money(session.quoteMinor, session.currency)}</td>
                        <td className="tiny">{titleCase(session.paymentState)}</td>
                        <td className="tiny">{session.reviewMode === 'AUTO' ? 'auto' : 'operator'}</td>
                        <td>
                          <div className="row" style={{ gap: '0.3rem' }}>
                            <Link className="btn btn--secondary btn--sm" to={`/session/${session.id}/review`}>
                              Review
                            </Link>
                            {['SETTLED', 'NO_CHARGE', 'DEMO_COMPLETED'].includes(session.state) ? (
                              <Link className="btn btn--ghost btn--sm" to={`/receipt/${session.id}`}>
                                Receipt
                              </Link>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="card stack">
            <div className="row row--between">
              <h2 className="h3">Disputes</h2>
              <span className="chip">{openDisputes.length} open</span>
            </div>
            {data.disputes.length === 0 ? (
              <p className="small muted">No disputes. A quiet meter is a good sign, not proof.</p>
            ) : (
              <div className="stack" style={{ gap: '0.8rem' }}>
                {data.disputes.map((dispute) => {
                  const linked = sessionById.get(dispute.sessionId);
                  const currency = linked?.currency ?? 'USD';
                  return (
                    <div key={dispute.id} className="panel stack" style={{ gap: '0.5rem' }}>
                      <div className="row row--between">
                        <div className="row">
                          <span className={`chip ${dispute.status === 'RESOLVED' ? 'chip--ok' : dispute.status === 'REJECTED' ? 'chip--danger' : 'chip--warn'}`}>
                            {dispute.status}
                          </span>
                          <Link className="link tiny" to={`/session/${dispute.sessionId}/review`}>
                            {linked?.objectName ?? dispute.sessionId.slice(-8)}
                          </Link>
                        </div>
                        <span className="tiny muted">{dateTime(dispute.createdAt)}</span>
                      </div>
                      <p className="small">{dispute.reason}</p>
                      <p className="tiny muted">
                        {dispute.intervalIds.length} interval(s) · credit {money(dispute.creditMinor, currency)}
                        {dispute.resolution ? ` · ${dispute.resolution}` : ''}
                      </p>
                      {dispute.status === 'OPEN' ? (
                        disputeId === dispute.id ? (
                          <div className="stack" style={{ gap: '0.5rem' }}>
                            <div className="inline-fields">
                              <Field label="Decision">
                                <Select value={decision} onChange={(event) => setDecision(event.target.value as 'RESOLVED' | 'REJECTED')}>
                                  <option value="RESOLVED">Resolve</option>
                                  <option value="REJECTED">Reject</option>
                                </Select>
                              </Field>
                              <Field label={`Credit (${currency})`} hint="Optional; can only reduce the bill.">
                                <TextInput value={credit} onChange={(event) => setCredit(event.target.value)} inputMode="decimal" placeholder="0.00" />
                              </Field>
                            </div>
                            <Field label="Resolution note">
                              <TextArea value={resolution} onChange={(event) => setResolution(event.target.value)} maxLength={600} />
                            </Field>
                            <div className="row">
                              <Button size="sm" onClick={() => void resolveDispute(dispute.id)} loading={busy === `dispute-${dispute.id}`}>
                                Save resolution
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => setDisputeId(null)}>Cancel</Button>
                            </div>
                          </div>
                        ) : (
                          <Button size="sm" variant="secondary" onClick={() => setDisputeId(dispute.id)}>
                            Resolve dispute
                          </Button>
                        )
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section className="card stack">
            <div className="row row--between">
              <h2 className="h3">Webhook evidence</h2>
              <span className="chip">{data.webhooks.length}</span>
            </div>
            {data.webhooks.length === 0 ? (
              <p className="small muted">
                No webhook events. Without a public tunnel and <span className="mono">PAYPAL_WEBHOOK_ID</span>, Whirr uses
                provider polling for reconciliation and never pretends a webhook arrived.
              </p>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Event</th>
                      <th>Type</th>
                      <th>Verified</th>
                      <th>Result</th>
                      <th>Received</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.webhooks.map((event) => (
                      <tr key={event.id}>
                        <td className="mono tiny break">{event.eventId}</td>
                        <td className="tiny">{event.eventType}</td>
                        <td>{event.verified ? <span className="chip chip--ok">verified</span> : <span className="chip chip--danger">unverified</span>}</td>
                        <td className="tiny">{event.result ?? '—'}</td>
                        <td className="tiny muted">{dateTime(event.receivedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>

        <aside className="stack">
          <section className="card stack">
            <h2 className="h3">Self-check gates</h2>
            <div className="stack" style={{ gap: '0.5rem' }}>
              {data.selfCheck.map((check) => (
                <div key={check.id} className="panel" style={{ borderLeft: `3px solid ${check.status === 'PASS' ? 'var(--ok)' : check.status === 'FAIL' ? 'var(--danger)' : 'var(--warn)'}` }}>
                  <div className="row row--between">
                    <span className="small">{check.label}</span>
                    <span className={`chip ${check.status === 'PASS' ? 'chip--ok' : check.status === 'FAIL' ? 'chip--danger' : 'chip--warn'}`}>
                      {check.status}
                    </span>
                  </div>
                  <p className="tiny muted" style={{ marginTop: 4 }}>{check.detail}</p>
                </div>
              ))}
            </div>
            <Link to="/judge" className="link tiny">Full judge evidence →</Link>
          </section>

          <section className="card stack">
            <div className="row row--between">
              <h2 className="h3">Shelf health</h2>
              <Link to="/shelf" className="link tiny">Public shelf →</Link>
            </div>
            <div className="stack" style={{ gap: '0.55rem' }}>
              {data.objects.map((object) => (
                <div key={object.object.id} className="panel stack" style={{ gap: '0.35rem' }}>
                  <div className="row row--between">
                    <Link className="link small" to={`/studio/objects/${object.object.id}`}>{object.object.name}</Link>
                    <span className={`chip ${object.shelfListed ? 'chip--ok' : ''}`}>{object.shelfListed ? 'listed' : 'unlisted'}</span>
                  </div>
                  <p className="tiny muted" style={{ margin: 0 }}>
                    {object.drift.status.replaceAll('_', ' ')} · {object.calibrationAgeDays ?? '—'}d old ·{' '}
                    {object.activeSessions} live
                  </p>
                  <div className="row" style={{ gap: '0.35rem' }}>
                    <Button
                      size="sm"
                      variant="ghost"
                      loading={busy === `shelf-${object.object.id}`}
                      onClick={() => void toggleShelf(object.object.id, !object.shelfListed)}
                    >
                      {object.shelfListed ? 'Unlist' : 'List'}
                    </Button>
                    <Link className="btn btn--ghost btn--sm" to={`/studio/objects/${object.object.id}/poster`}>Poster</Link>
                    <Link className="btn btn--ghost btn--sm" to={`/passport/${object.object.id}`}>Passport</Link>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="card stack">
            <h2 className="h3">Audit chain</h2>
            <div className="stack" style={{ gap: '0.35rem' }}>
              {data.audit.map((entry) => (
                <div key={entry.id} className="row row--between tiny">
                  <span className="mono">{entry.action}</span>
                  <span className="mono muted">{entry.hash.slice(0, 10)}…</span>
                </div>
              ))}
            </div>
            <p className="tiny muted">Each event commits to the previous hash; verification recomputes the chain.</p>
          </section>

          <section className="card card--soft stack">
            <h2 className="h3">Provider mode</h2>
            <span className={`chip ${data.paypal.configured ? 'chip--ok' : 'chip--warn'}`}>
              <span className="chip__dot" /> {data.paypal.configured ? 'PayPal Sandbox configured' : 'Demo metering only'}
            </span>
            <p className="small muted">
              {data.paypal.configured
                ? 'Orders, authorizations and captures call the real Sandbox API. The app cannot reach live PayPal: the client rejects non-sandbox hosts and credentials.'
                : 'No PayPal calls are made. Session receipts are labelled DEMO_NO_PAYMENT.'}
            </p>
            <p className="tiny muted">Webhook verification: {data.paypal.webhookConfigured ? 'configured' : 'not configured'}.</p>
          </section>
        </aside>
      </div>

      {data.objects.length === 0 ? <EmptyState title="No objects in the fleet" /> : null}
    </div>
  );
}
