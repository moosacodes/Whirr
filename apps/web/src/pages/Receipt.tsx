import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, errorMessage } from '../lib/api.ts';
import type {
  EvidenceReceipt,
  ReceiptVerification,
  ReceiptTimelineEntry,
  SessionView,
  SignedReceiptProof,
} from '../../../../packages/contracts/src/types.ts';
import {
  Button,
  LinkButton,
  Loading,
  Notice,
  usePageTitle,
} from '../components/ui.tsx';
import { ExplanationCard, Icon, ObjectGlyph, Timeline, TimelineLegend } from '../components/visuals.tsx';
import { METER_COPY, PAYMENT_STATE_COPY, dateTime, duration, money, titleCase } from '../lib/format.ts';
import { makeQrDataUrl } from '../lib/qr.ts';

interface ReceiptResponse {
  receipt: EvidenceReceipt;
  verification: ReceiptVerification;
  stored: boolean;
  session: SessionView;
}

const CHECKS: Array<{
  key: keyof ReceiptVerification;
  label: string;
  detail: string;
}> = [
  { key: 'quoteMatches', label: 'Quote recomputes', detail: 'The displayed amount equals the policy recomputed from evidence rows.' },
  { key: 'capRespected', label: 'Cap respected', detail: 'The amount is at or below the consented cap.' },
  { key: 'evidenceMatches', label: 'Evidence root matches', detail: 'The interval evidence hash matches the stored session evidence root.' },
  { key: 'receiptHashMatches', label: 'Receipt hash matches', detail: 'The canonical receipt hash equals the stored receipt hash.' },
  { key: 'intervalsConsistent', label: 'Intervals consistent', detail: 'Intervals do not overlap, end after they start, and use the frozen model version.' },
  { key: 'passportConsistent', label: 'Passport evidence matches', detail: 'The receipt’s passport status and mismatch exclusions recompute from stored intervals.' },
  { key: 'providerAmountMatches', label: 'Provider amount matches', detail: 'When PayPal captured, its amount and currency equal the reviewed quote.' },
  { key: 'auditChainValid', label: 'Audit chain valid', detail: 'The hash-chained audit log verifies from the first event.' },
];

export function ReceiptPage() {
  const { id = '' } = useParams();
  const [data, setData] = useState<ReceiptResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [proof, setProof] = useState<SignedReceiptProof | null>(null);
  const [proofError, setProofError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'billed' | 'free' | 'uncertain' | 'mismatch'>('all');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [qr, setQr] = useState<string | null>(null);

  useEffect(() => {
    api<ReceiptResponse>(`/api/sessions/${id}/receipt`)
      .then(setData)
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    api<SignedReceiptProof>(`/api/sessions/${id}/proof`)
      .then((next) => {
        if (!cancelled) setProof(next);
      })
      .catch((err) => {
        if (!cancelled) setProofError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    if (!proof) {
      setQr(null);
      return;
    }
    makeQrDataUrl(`${window.location.origin}/api/proofs/${proof.payload.proofId}`)
      .then(setQr)
      .catch(() => setQr(null));
  }, [proof]);

  usePageTitle(data ? `Receipt ${data.receipt.receiptId}` : 'Evidence receipt');

  const filteredTimeline = useMemo<ReceiptTimelineEntry[]>(() => {
    if (!data) return [];
    return data.receipt.timeline.filter((entry) => {
      if (filter === 'billed') return entry.state === 'ACTIVE_CONFIDENT';
      if (filter === 'free') return entry.state !== 'ACTIVE_CONFIDENT';
      if (filter === 'uncertain') return entry.state === 'UNCERTAIN';
      if (filter === 'mismatch') return entry.qualityFlags.includes('SOUNDPRINT_MISMATCH');
      return true;
    });
  }, [data, filter]);
  const selectedEntry = filteredTimeline[selectedIndex] ?? filteredTimeline[0] ?? null;

  if (loading) return <Loading label="Verifying receipt…" />;
  if (!data) {
    return (
      <div className="page container page--narrow">
        <Notice tone="danger" title="Receipt is not ready.">
          {error ?? 'Stop and settle the session first.'}
        </Notice>
        <div className="row" style={{ marginTop: 12 }}>
          <LinkButton to={`/session/${id}/review`} variant="secondary">
            Back to review
          </LinkButton>
          <LinkButton to={`/session/${id}`} variant="ghost">
            Back to session
          </LinkButton>
        </div>
      </div>
    );
  }

  const { receipt, verification, session } = data;
  const checksPassed = CHECKS.filter((check) => {
    const value = verification[check.key];
    return value === true || value === null;
  }).length;

  return (
    <div className="page container page--wide">
      <div className="stack-lg">
        <header className="row row--between no-print" style={{ alignItems: 'flex-start' }}>
          <div className="stack" style={{ gap: '0.4rem' }}>
            <div className="breadcrumbs">
              <Link to="/">Whirr</Link> <span aria-hidden="true">/</span>{' '}
              <Link to={`/session/${id}/review`}>Session</Link> <span aria-hidden="true">/</span> <span>Receipt</span>
            </div>
            <span className="eyebrow">Evidence receipt</span>
            <h1 className="display display--sm">{receipt.finalized ? 'Settled, and provable.' : 'Draft evidence receipt.'}</h1>
            <p className="lede">
              A human-readable receipt backed by hashed interval evidence, a frozen terms version and the actual payment
              state. Every check below is computed by the server now, not copied from a claim.
            </p>
          </div>
          <div className="row no-print">
            <Button variant="secondary" onClick={() => window.print()}>
              Print
            </Button>
            <a className="btn btn--secondary" href={`/api/sessions/${id}/receipt/export`}>
              <Icon name="download" size={15} /> JSON
            </a>
            <a className="btn btn--secondary" href={`/api/sessions/${id}/proof`} download>
              <Icon name="shield" size={15} /> Signed proof
            </a>
            <a className="btn btn--ghost" href={`/api/sessions/${id}/receipt/export?redacted=1`}>
              Redacted
            </a>
          </div>
        </header>

        {!receipt.finalized ? (
          <Notice tone="warn" title="Not finalized.">
            This receipt is a draft until payment is captured, voided, or the demo session is completed. Its hash will
            change when finalization writes the final payment state.
          </Notice>
        ) : null}
        {receipt.payment.mode === 'DEMO_NO_PAYMENT' ? (
          <Notice tone="warn" title="Demo metering receipt.">
            No PayPal order, authorization, capture or refund exists for this session. The amount below is a measured
            simulated bill, not a payment.
          </Notice>
        ) : null}

        <section className="receipt-hero">
          <div className="row row--between" style={{ alignItems: 'flex-start' }}>
            <div className="stack" style={{ gap: '0.5rem' }}>
              <span className="eyebrow" style={{ color: 'rgba(245,238,228,.55)' }}>
                {receipt.receiptId}
              </span>
              <div className="row">
                <ObjectGlyph glyph={session.objectGlyph} size={62} tone="dark" />
                <div>
                  <h2 className="h2" style={{ color: 'var(--cream)' }}>{receipt.object.name}</h2>
                  <p className="small" style={{ color: 'rgba(245,238,228,.6)' }}>
                    {receipt.object.ownerLabel} · renter {receipt.renterRef}
                  </p>
                </div>
              </div>
              <div className="row">
                <span className={`chip ${receipt.finalized ? 'chip--ok' : 'chip--warn'}`}>
                  <span className="chip__dot" /> {receipt.finalized ? 'Finalized' : 'Draft'}
                </span>
                <span className="chip chip--dark">{PAYMENT_STATE_COPY[receipt.payment.state]}</span>
                <span className="chip chip--dark">{receipt.payment.mode === 'DEMO_NO_PAYMENT' ? 'demo · no payment' : 'PayPal Sandbox'}</span>
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div className="big-number" style={{ color: 'var(--cream)', fontSize: 'clamp(2.4rem,5vw,4rem)' }}>
                {money(receipt.pricing.quoteMinor, receipt.pricing.currency)}
              </div>
              <p className="small" style={{ color: 'rgba(245,238,228,.6)' }}>
                {duration(receipt.totals.billableMs)} billable · cap {money(receipt.pricing.capMinor, receipt.pricing.currency)}
              </p>
            </div>
          </div>
        </section>

        <div className="grid-4">
          <div className="stat stat--accent">
            <span className="stat__value">{duration(receipt.totals.billableMs)}</span>
            <span className="stat__label">billable</span>
          </div>
          <div className="stat">
            <span className="stat__value">{duration(receipt.totals.uncertainMs)}</span>
            <span className="stat__label">uncertain · free</span>
          </div>
          <div className="stat">
            <span className="stat__value">{duration(receipt.totals.idleMs)}</span>
            <span className="stat__label">idle · free</span>
          </div>
          <div className="stat">
            <span className="stat__value">{duration(receipt.totals.disconnectedMs)}</span>
            <span className="stat__label">disconnected · free</span>
          </div>
        </div>

        <div className="sidebar-layout">
          <div className="stack">
            <section className="card stack">
              <div className="row row--between">
                <h2 className="h3">Metered timeline</h2>
                <span className="chip">{receipt.timeline.length} intervals</span>
              </div>
              <Timeline
                intervals={receipt.timeline}
                totalMs={Math.max(receipt.totals.observedMs, 1000)}
                height={54}
                label="Receipt timeline reconstructed from hashed interval evidence"
              />
              <TimelineLegend />
              <p className="tiny muted">
                Each row below is covered by the evidence hash. The receipt contains states, confidence and quality
                flags; raw audio is not part of the record and was never uploaded.
              </p>
            </section>

            <section className="card stack">
              <h2 className="h3">Interval evidence</h2>
              <div className="row" style={{ gap: '0.35rem', flexWrap: 'wrap' }}>
                {(['all', 'billed', 'free', 'uncertain', 'mismatch'] as const).map((value) => (
                  <Button
                    key={value}
                    size="sm"
                    variant={filter === value ? 'primary' : 'ghost'}
                    onClick={() => {
                      setFilter(value);
                      setSelectedIndex(0);
                    }}
                  >
                    {value} {value === 'all' ? receipt.timeline.length : ''}
                  </Button>
                ))}
              </div>
              <div className="receipt-explorer">
                <div className="stack" style={{ gap: '0.55rem' }}>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Start</th>
                      <th>End</th>
                      <th>State</th>
                      <th>Confidence</th>
                      <th>Quality flags</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredTimeline.map((entry, index) => (
                      <tr
                        key={`${entry.startMs}-${index}`}
                        onClick={() => setSelectedIndex(index)}
                        style={{ cursor: 'pointer', background: selectedEntry === entry ? 'var(--accent-soft)' : undefined }}
                      >
                        <td className="mono">{(entry.startMs / 1000).toFixed(2)}s</td>
                        <td className="mono">{(entry.endMs / 1000).toFixed(2)}s</td>
                        <td>
                          <span className={`state state--${entry.state.toLowerCase()}`}>
                            <span className="state__dot" /> {METER_COPY[entry.state].label}
                          </span>
                        </td>
                        <td className="mono tiny">{(entry.confidence * 100).toFixed(1)}%</td>
                        <td className="tiny">{entry.qualityFlags.length ? entry.qualityFlags.join(', ') : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
                  <p className="tiny muted">{filteredTimeline.length} interval(s) in this view. Click a row to inspect its sealed explanation.</p>
                </div>
                <div className="card card--soft stack" style={{ minHeight: 190 }}>
                  {selectedEntry ? (
                    <>
                      <div className="row row--between">
                        <span className="eyebrow">Selected interval</span>
                        <span className={`state state--${selectedEntry.state.toLowerCase()}`}>
                          <span className="state__dot" /> {METER_COPY[selectedEntry.state].label}
                        </span>
                      </div>
                      <div className="row row--between tiny mono">
                        <span>{(selectedEntry.startMs / 1000).toFixed(2)}s → {(selectedEntry.endMs / 1000).toFixed(2)}s</span>
                        <span>{(selectedEntry.confidence * 100).toFixed(1)}% confidence</span>
                      </div>
                      {selectedEntry.explanation ? (
                        <ExplanationCard explanation={selectedEntry.explanation} compact />
                      ) : (
                        <p className="tiny muted">This is a v1 interval. It has a sealed state and evidence hash but no v2 explanation payload.</p>
                      )}
                      <p className="tiny muted">Free time is explicit: every non-running row is excluded by policy, not inferred from wall-clock time.</p>
                    </>
                  ) : (
                    <p className="small muted">No intervals match this filter.</p>
                  )}
                </div>
              </div>
            </section>

            <section className="card stack">
              <div className="row row--between">
                <h2 className="h3">Verification</h2>
                <span className={`chip ${checksPassed === CHECKS.length ? 'chip--ok' : 'chip--warn'}`}>
                  {checksPassed} / {CHECKS.length} pass
                </span>
              </div>
              <div className="stack" style={{ gap: '0.55rem' }}>
                {CHECKS.map((check) => {
                  const value = verification[check.key];
                  const state = value === null ? 'n/a' : value ? 'pass' : 'fail';
                  return (
                    <div key={check.key} className="panel" style={{ borderLeft: `3px solid ${state === 'pass' ? 'var(--ok)' : state === 'fail' ? 'var(--danger)' : 'var(--line-strong)'}` }}>
                      <div className="row row--between">
                        <strong className="small">{check.label}</strong>
                        <span className={`chip ${state === 'pass' ? 'chip--ok' : state === 'fail' ? 'chip--danger' : ''}`}>
                          {state === 'n/a' ? 'not applicable' : state}
                        </span>
                      </div>
                      <p className="tiny muted" style={{ marginTop: 4 }}>{check.detail}</p>
                    </div>
                  );
                })}
              </div>
              <p className="tiny muted">
                Recomputed quote: {money(verification.recomputedQuoteMinor, receipt.pricing.currency)} · checked{' '}
                {dateTime(verification.checkedAt)}.
              </p>
            </section>

            <section className="card stack">
              <h2 className="h3">Payment record</h2>
              <div className="table-wrap">
                <table className="table" style={{ minWidth: 0 }}>
                  <tbody>
                    <tr>
                      <th>Mode</th>
                      <td>{receipt.payment.mode}</td>
                    </tr>
                    <tr>
                      <th>State</th>
                      <td>{titleCase(receipt.payment.state)}</td>
                    </tr>
                    <tr>
                      <th>Order</th>
                      <td className="mono tiny break">{receipt.payment.orderId ?? '—'}</td>
                    </tr>
                    <tr>
                      <th>Authorization</th>
                      <td className="mono tiny break">{receipt.payment.authorizationId ?? '—'}</td>
                    </tr>
                    <tr>
                      <th>Capture</th>
                      <td className="mono tiny break">{receipt.payment.captureId ?? '—'}</td>
                    </tr>
                    <tr>
                      <th>Refund</th>
                      <td className="mono tiny break">{receipt.payment.refundId ?? '—'}</td>
                    </tr>
                    <tr>
                      <th>Refund amount</th>
                      <td className="mono">
                        {receipt.payment.refundMinor === null
                          ? '—'
                          : money(receipt.payment.refundMinor, receipt.pricing.currency)}
                      </td>
                    </tr>
                    <tr>
                      <th>Provider status</th>
                      <td className="mono tiny">{receipt.payment.providerStatus ?? '—'}</td>
                    </tr>
                    <tr>
                      <th>Captured amount</th>
                      <td className="mono">
                        {receipt.payment.capturedMinor === null ? '—' : money(receipt.payment.capturedMinor, receipt.pricing.currency)}
                      </td>
                    </tr>
                    <tr>
                      <th>Reconciled</th>
                      <td className="tiny">{dateTime(receipt.payment.providerReconciledAt)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="tiny muted">
                PayPal IDs are shown as returned by Sandbox. This prototype never claims provider success without a
                capture ID and matching amount.
              </p>
            </section>
          </div>

          <aside className="stack">
            <section className="card stack">
              <h2 className="h3">Pricing on the record</h2>
              <dl className="kv">
                <dt>Rate</dt>
                <dd>{money(receipt.pricing.minorPerMinute, receipt.pricing.currency)} / min</dd>
                <dt>Cap</dt>
                <dd>{money(receipt.pricing.capMinor, receipt.pricing.currency)}</dd>
                <dt>Base quote</dt>
                <dd>{money(receipt.pricing.baseQuoteMinor, receipt.pricing.currency)}</dd>
                <dt>Credit</dt>
                <dd>{money(receipt.pricing.creditMinor, receipt.pricing.currency)}</dd>
                <dt>Final</dt>
                <dd><strong>{money(receipt.pricing.quoteMinor, receipt.pricing.currency)}</strong></dd>
              </dl>
              <code className="mono tiny break">{receipt.pricing.formula}</code>
            </section>

            <section className="card stack">
              <h2 className="h3">Terms &amp; consent</h2>
              <dl className="kv">
                <dt>Terms version</dt>
                <dd>v{receipt.terms.version}</dd>
                <dt>Consent</dt>
                <dd>{dateTime(receipt.consent.acceptedAt)}</dd>
                <dt>Terms hash</dt>
                <dd className="mono tiny break">{receipt.termsHash}</dd>
                <dt>Consent hash</dt>
                <dd className="mono tiny break">{receipt.consent.termsHash}</dd>
              </dl>
              <p className="tiny muted">
                Consent is bound to the exact terms and model hashes. A mismatch fails receipt verification.
              </p>
            </section>

            <section className="card stack">
              <h2 className="h3">Model</h2>
              <div className="row">
                <span className={`chip chip--${receipt.model.status === 'READY' ? 'ok' : receipt.model.status === 'LIMITED' ? 'warn' : 'danger'}`}>
                  {receipt.model.status}
                </span>
                <span className="chip">{receipt.model.provenance === 'SYNTHETIC_REFERENCE' ? 'synthetic reference' : 'owner calibration'}</span>
              </div>
              <dl className="kv">
                <dt>Version</dt>
                <dd className="mono">{receipt.model.version}</dd>
                <dt>Precision</dt>
                <dd>{(receipt.model.precision * 100).toFixed(1)}%</dd>
                <dt>Recall</dt>
                <dd>{(receipt.model.recall * 100).toFixed(1)}%</dd>
                <dt>False bills</dt>
                <dd>{(receipt.model.falseBillableRatio * 100).toFixed(2)}%</dd>
                <dt>Takes</dt>
                <dd>{receipt.model.takeCount}</dd>
                <dt>Soundprint</dt>
                <dd>
                  {receipt.model.soundprint
                    ? receipt.model.soundprint.gateEnabled
                      ? `enrolled · ${(receipt.model.soundprint.matchThreshold * 100).toFixed(0)}% match gate`
                      : 'weak · identity gate disabled'
                    : 'not enrolled'}
                </dd>
                <dt>Passport exclusions</dt>
                <dd>
                  {receipt.passport.mismatchIntervals} interval(s) · {duration(receipt.passport.mismatchMs)} free
                </dd>
                <dt>Model hash</dt>
                <dd className="mono tiny break">{receipt.model.hash}</dd>
              </dl>
              <LinkButton to={`/passport/${receipt.object.id}`} variant="secondary" className="no-print">
                Open acoustic passport <Icon name="external" size={15} />
              </LinkButton>
            </section>

            <section className="card stack">
              <h2 className="h3">Hashes</h2>
              <span className="tiny muted">Evidence SHA-256</span>
              <code className="mono tiny break">{receipt.evidenceSha256}</code>
              <span className="tiny muted">Session evidence root</span>
              <code className="mono tiny break">{receipt.sessionEvidenceSha256 ?? '—'}</code>
              <span className="tiny muted">Receipt hash</span>
              <code className="mono tiny break">{verification.receiptHashMatches ? 'verified against stored hash' : 'does not match stored hash'}</code>
            </section>

            <section className="card stack">
              <span className="eyebrow">Shareable proof card</span>
              <h2 className="h3">A receipt with a seal.</h2>
              {proof ? (
                <>
                  <div className="proof-card">
                    <div className="row row--between">
                      <span className="chip chip--ok">signed · redacted</span>
                      <span className="tiny mono">{proof.payload.proofId}</span>
                    </div>
                    <div className="proof-card__qr">
                      {qr ? <img src={qr} alt="QR code to the signed receipt proof" width={148} height={148} /> : null}
                    </div>
                    <p className="small" style={{ margin: 0 }}>
                      {proof.payload.object.name} · {money(proof.payload.pricing.quoteMinor, proof.payload.pricing.currency)} ·{' '}
                      {duration(proof.payload.pricing.billableMs)}
                    </p>
                    <p className="tiny muted">
                      No renter reference, full payment ID or audio. The QR fetches this proof by its public ID; verify the
                      signature offline at <Link to="/verify">/verify</Link>.
                    </p>
                    <a className="btn btn--secondary btn--sm" href={`/api/sessions/${id}/proof`} download>
                      <Icon name="download" size={14} /> Download proof JSON
                    </a>
                  </div>
                  <code className="mono tiny break">{proof.keyId}</code>
                </>
              ) : (
                <p className="tiny muted">{proofError ?? 'Preparing the signed proof…'}</p>
              )}
            </section>

            <section className="card card--soft stack">
              <h2 className="h3">Limitations</h2>
              <ul className="checklist checklist--x">
                {receipt.limitations.map((limitation) => (
                  <li key={limitation}>
                    <Icon name="alert" size={14} /> <span className="tiny">{limitation}</span>
                  </li>
                ))}
              </ul>
            </section>

            {receipt.disputes.length > 0 ? (
              <section className="card stack">
                <h2 className="h3">Disputes</h2>
                {receipt.disputes.map((dispute) => (
                  <p key={dispute.id} className="tiny muted">
                    {dispute.status} · {money(dispute.creditMinor, receipt.pricing.currency)} credit · {dispute.reason}
                  </p>
                ))}
              </section>
            ) : null}

            <LinkButton to={`/s/${receipt.object.id}`} variant="secondary" className="no-print">
              Open service card
            </LinkButton>
            <LinkButton to={`/passport/${receipt.object.id}`} variant="ghost" className="no-print">
              Acoustic passport
            </LinkButton>
          </aside>
        </div>

        <p className="tiny muted" style={{ textAlign: 'center' }}>
          Schema {receipt.schema} · generated {dateTime(receipt.createdAt)} · Sandbox only, no real money.
        </p>
      </div>
    </div>
  );
}
