import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { AmbientProofView } from '../../../../packages/contracts/src/types.ts';
import type { AmbientProofPayload } from '../../../../packages/protocol/src/ambient-proof.ts';
import { api, errorMessage } from '../lib/api.ts';
import { Loading, Notice, PageHeader, usePageTitle } from '../components/ui.tsx';
import { Icon } from '../components/visuals.tsx';
import { dateTime, duration, money } from '../lib/format.ts';

export function AmbientProofPage() {
  const { proofId = '' } = useParams();
  const [proof, setProof] = useState<AmbientProofView | null>(null);
  const [error, setError] = useState<string | null>(null);
  usePageTitle('Ambient proof');

  useEffect(() => {
    api<AmbientProofView>(`/api/ambient/proofs/${proofId}`)
      .then(setProof)
      .catch((err) => setError(errorMessage(err)));
  }, [proofId]);

  if (!proof) {
    return <div className="page container">{error ? <Notice tone="danger">{error}</Notice> : <Loading label="Verifying the signed Ambient proof…" />}</div>;
  }

  const payload = (proof.document as { payload?: AmbientProofPayload }).payload;
  const verification = proof.verification;
  return (
    <div className="page ambient-page">
      <div className="container stack stack--lg">
        <PageHeader
          eyebrow="Public Ambient proof"
          title={verification.valid ? 'The record verifies.' : 'The record does not verify.'}
          lede="This page displays exactly what the signed proof establishes and what it cannot. The verifier replays the agreement and interval ledger; it does not contact PayPal or inspect the physical world."
          actions={<span className={`chip ${verification.valid ? 'chip--ok' : 'chip--danger'}`}>{verification.valid ? 'VALID' : 'INVALID'}</span>}
        />

        <div className="proof-summary-grid">
          <section className={`card proof-verdict ${verification.valid ? 'proof-verdict--ok' : 'proof-verdict--bad'}`}>
            <span className="eyebrow">Verifier result</span>
            <h2 className="display display--sm">{verification.valid ? 'Integrity and contract replay pass.' : 'A required check failed.'}</h2>
            <p className="small muted">{verification.disclaimer}</p>
            <div className="proof-verdict__facts">
              <div><span className="tiny muted">Proof</span><strong className="mono break">{proof.id}</strong></div>
              <div><span className="tiny muted">Created</span><strong>{dateTime(proof.createdAt)}</strong></div>
              <div><span className="tiny muted">Agreement hash</span><strong className="mono break">{payload?.agreement.hash ?? proof.agreementHash}</strong></div>
            </div>
          </section>
          <section className="card stack">
            <span className="eyebrow">Checks</span>
            {verification.checks.map((check) => (
              <div className={`proof-check ${check.pass ? 'proof-check--ok' : 'proof-check--bad'}`} key={check.id}>
                <span aria-hidden="true">{check.pass ? '✓' : '×'}</span>
                <div><strong>{check.label}</strong><p className="tiny muted">{check.detail}</p></div>
              </div>
            ))}
          </section>
        </div>

        {payload ? (
          <section className="card proof-payload">
            <div className="row row--between">
              <div>
                <span className="eyebrow">The signed payload</span>
                <h2 className="h2">{payload.target.objectName} · {payload.evaluation.outcome}</h2>
              </div>
              <span className={`chip ${payload.payment.providerConfirmed ? 'chip--ok' : 'chip--warn'}`}>
                {payload.payment.providerConfirmed ? 'provider confirmed' : payload.payment.mode.replaceAll('_', ' ')}
              </span>
            </div>
            <div className="proof-facts">
              <div><span className="tiny muted">Observation</span><strong>{duration(payload.evaluation.inactiveMs)} non-detection · {duration(payload.evaluation.longestInactiveMs)} longest</strong></div>
              <div><span className="tiny muted">Interruptions</span><strong>{payload.evaluation.interruptions}</strong></div>
              <div><span className="tiny muted">Sensor loss</span><strong>{duration(payload.evaluation.sensorLossMs)}</strong></div>
              <div><span className="tiny muted">Accepted price</span><strong>{money(payload.agreement.terms.financial.fixedPriceMinor, payload.agreement.terms.financial.currency)}</strong></div>
              <div><span className="tiny muted">Buyer acceptance</span><strong>{payload.consent.humanAcceptance ? 'recorded' : 'not claimed'}</strong></div>
              <div><span className="tiny muted">Payment</span><strong>{payload.payment.captureId ? `captured ${money(payload.payment.capturedMinor ?? 0, payload.payment.currency)}` : payload.payment.mode.replaceAll('_', ' ')}</strong></div>
            </div>
            <div className="proof-domains">
              {payload.trust.map((entry) => (
                <div key={entry.domain}>
                  <span className="mono tiny">{entry.domain}</span>
                  <span className={`chip ${entry.status === 'CHECKED' ? 'chip--ok' : entry.status === 'NOT_CLAIMED' ? 'chip--warn' : ''}`}>{entry.status.replaceAll('_', ' ')}</span>
                  <p className="tiny muted">{entry.detail}</p>
                </div>
              ))}
            </div>
            <details className="details">
              <summary>View exact proof JSON</summary>
              <pre className="proof-json proof-json--tall">{JSON.stringify(proof.publicDocument, null, 2)}</pre>
            </details>
            <p className="tiny muted">
              This public proof carries interval states and hashes, not raw audio. A valid signature proves the
              installation signed this record; it does not prove microphone honesty or real-world silence.
            </p>
          </section>
        ) : null}

        <div className="row row--between">
          <Link to="/ambient" className="link">← Ambient overview</Link>
          <Link to={`/ambient/accord/${proof.sessionId}`} className="link">Open the Accord <Icon name="arrow" size={14} /></Link>
        </div>
      </div>
    </div>
  );
}
