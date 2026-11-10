import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, errorMessage } from '../lib/api.ts';
import type { PromiseProofView } from '../../../../packages/contracts/src/types.ts';
import { Loading, Notice, PageHeader, SandboxBanner, usePageTitle } from '../components/ui.tsx';
import { Icon } from '../components/visuals.tsx';

export function PromiseProofPage() {
  const { proofId = '' } = useParams();
  const [proof, setProof] = useState<PromiseProofView | null>(null);
  const [error, setError] = useState<string | null>(null);
  usePageTitle('Physical promise proof');

  useEffect(() => {
    api<PromiseProofView>(`/api/promises/proofs/${proofId}/verify`)
      .then(setProof)
      .catch((err) => setError(errorMessage(err)));
  }, [proofId]);

  if (!proof) {
    return <div className="page"><div className="container">{error ? <Notice tone="danger">{error}</Notice> : <Loading label="Recomputing the proof…" />}</div></div>;
  }

  const payload = (proof.publicDocument as { payload?: { object?: { name?: string }; evaluation?: { outcome?: string }; agreement?: { hash?: string }; payment?: { mode?: string } } })?.payload;
  const verification = proof.verification;

  return (
    <div className="page promise-page">
      <div className="container stack stack--lg">
        <PageHeader
          eyebrow="Whirr physical proof v1"
          title={`${payload?.object?.name ?? 'Physical promise'} · ${payload?.evaluation?.outcome ?? 'evaluation'}`}
          lede="This page independently recomputes the agreement hash, model binding, observation ledger, temporal rule replay and internal payment consistency without trusting a stored qualified flag."
          breadcrumbs={<><Link to="/promise">Promises</Link> <span aria-hidden="true">/</span> Proof</>}
          actions={<span className={`chip chip--${verification.valid ? 'ok' : 'danger'}`}>{verification.valid ? 'CHECKS PASS' : 'CHECK FAILED'}</span>}
        />
        <SandboxBanner configured={true} />
        <div className="proof-grid">
          <section className="card stack">
            <span className="eyebrow">Verifier results</span>
            <div className="proof-domain-grid">
              {[
                ['Signature', verification.signatureValid],
                ['Agreement hash', verification.agreementHashValid],
                ['Model binding', verification.modelHashValid],
                ['Observation hash', verification.observationsHashValid],
                ['Evidence root', verification.evidenceRootValid],
                ['Temporal replay', verification.evaluationMatches],
                ['Payment consistency', verification.paymentConsistent],
              ].map(([label, pass]) => (
                <div className={`proof-domain proof-domain--${pass ? 'ok' : 'fail'}`} key={String(label)}>
                  <Icon name={pass ? 'check' : 'alert'} size={17} />
                  <span>{label}</span>
                  <strong>{pass ? 'PASS' : 'FAIL'}</strong>
                </div>
              ))}
            </div>
            <div className="run-checks">
              {verification.checks.map((check) => (
                <div className={`run-check run-check--${check.pass ? 'pass' : 'fail'}`} key={check.id}>
                  <span aria-hidden="true">{check.pass ? '✓' : '×'}</span>
                  <div><strong>{check.label}</strong><span className="tiny">{check.detail}</span></div>
                </div>
              ))}
            </div>
          </section>

          <aside className="stack">
            <section className="card stack">
              <span className="eyebrow">What is proven</span>
              <ul className="promise-rules">
                <li>This installation signed the exact payload.</li>
                <li>The approved terms hash to the claimed agreement.</li>
                <li>The model artifact hashes to the terms binding.</li>
                <li>The observation ledger replays to the same outcome.</li>
                <li>No capture exceeds the fixed ceiling.</li>
              </ul>
            </section>
            <section className="card stack">
              <span className="eyebrow">What is not proven</span>
              <p className="small muted">{verification.disclaimer}</p>
            </section>
            <section className="card stack">
              <span className="eyebrow">Payment mode</span>
              <p className="small muted">
                {payload?.payment?.mode === 'DEMO_NO_PAYMENT'
                  ? 'Demo observation: no provider authorization or capture is claimed.'
                  : 'PayPal Sandbox references are bound into the proof. Provider access is still required to confirm the settlement independently.'}
              </p>
            </section>
          </aside>
        </div>

        <section className="card stack">
          <div className="row row--between">
            <span className="eyebrow">Portable document</span>
            <span className="mono tiny">{proof.agreementHash.slice(0, 24)}…</span>
          </div>
          <pre className="proof-json proof-json--tall">{JSON.stringify(proof.publicDocument, null, 2)}</pre>
        </section>
      </div>
    </div>
  );
}
