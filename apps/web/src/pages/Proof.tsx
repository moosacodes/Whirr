import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, errorMessage } from '../lib/api.ts';
import type { SignedProofBundle, TrustDomainStatus } from '../../../../packages/contracts/src/types.ts';
import { verifyDocument, type DocumentVerification } from '../../../../packages/verify/src/index.ts';
import {
  Button,
  LinkButton,
  Loading,
  Notice,
  PageHeader,
  TextInput,
  usePageTitle,
} from '../components/ui.tsx';
import { Icon, SignatureSeal } from '../components/visuals.tsx';
import { dateTime, duration, money } from '../lib/format.ts';

function trustTone(domain: TrustDomainStatus): 'ok' | 'warn' | 'danger' {
  if (domain.status === 'VERIFIED_OFFLINE') return 'ok';
  if (domain.status === 'NOT_VERIFIABLE_OFFLINE') return 'warn';
  return 'danger';
}

export function Proof() {
  const { id = '' } = useParams();
  const [bundle, setBundle] = useState<SignedProofBundle | null>(null);
  const [result, setResult] = useState<DocumentVerification | null>(null);
  const [pinnedKey, setPinnedKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  usePageTitle('Proof bundle v3');

  useEffect(() => {
    let cancelled = false;
    api<SignedProofBundle>(`/api/proof-bundles/${id}`)
      .then(async (next) => {
        if (cancelled) return;
        setBundle(next);
        setResult(await verifyDocument(next));
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
  }, [id]);

  const verifyAgain = async () => {
    if (!bundle) return;
    setError(null);
    setResult(await verifyDocument(bundle, pinnedKey.trim() ? { trustedKeyId: pinnedKey.trim() } : {}));
  };

  if (loading) return <Loading label="Opening the public proof bundle…" />;
  if (!bundle) {
    return (
      <div className="page container page--narrow">
        <Notice tone="danger" title="Proof bundle unavailable.">
          {error ?? 'This public bundle does not exist or was never issued.'}
        </Notice>
        <div className="row" style={{ marginTop: 12 }}>
          <LinkButton to="/verify" variant="secondary">Open verifier</LinkButton>
          <LinkButton to="/shelf" variant="ghost">Browse the shelf</LinkButton>
        </div>
      </div>
    );
  }

  const payload = bundle.payload;
  const receipt = payload.receipt;
  const passed = result?.checks.filter((check) => check.pass).length ?? 0;
  const failed = result?.checks.filter((check) => !check.pass).length ?? 0;
  const checks = result?.checks ?? [];
  const publicJson = JSON.stringify(bundle, null, 2);

  return (
    <div className="page container page--wide">
      <PageHeader
        eyebrow="Public proof bundle · v3"
        breadcrumbs={
          <>
            <Link to="/">Whirr</Link> <span aria-hidden="true">/</span> <span>Proof</span>
          </>
        }
        title="Portable proof of use."
        lede="One signed artifact carries the receipt, nested proof, interval ledger, Merkle inclusion proofs and a three-domain trust matrix. The integrity domain verifies in this tab. Sensing remains a signed client claim. Payment cannot be verified offline."
        actions={
          <>
            <a className="btn btn--secondary" href={`/api/proof-bundles/${id}`} download>
              <Icon name="download" size={15} /> Bundle JSON
            </a>
            <a className="btn btn--ghost" href="/verify-offline.html" target="_blank" rel="noreferrer">
              Standalone verifier
            </a>
          </>
        }
      />

      <div className="stack-lg">
        <section className="receipt-hero">
          <div className="row row--between" style={{ alignItems: 'flex-start' }}>
            <div className="stack" style={{ gap: '0.55rem' }}>
              <span className="eyebrow" style={{ color: 'rgba(245,238,228,.58)' }}>
                {payload.bundleId} · {payload.redacted ? 'redacted public bundle' : 'authenticated bundle'}
              </span>
              <h2 className="h2" style={{ color: 'var(--cream)' }}>{receipt.object.name}</h2>
              <div className="row">
                <span className={`chip ${result?.valid ? 'chip--ok' : 'chip--danger'}`}>
                  <span className="chip__dot" /> {result?.valid ? 'offline verification passes' : 'does not verify'}
                </span>
                <span className="chip chip--dark">{receipt.payment.mode === 'DEMO_NO_PAYMENT' ? 'demo · no payment' : 'PayPal Sandbox'}</span>
                <span className="chip chip--dark">{payload.intervals.length} interval leaves</span>
              </div>
            </div>
            <div className="receipt-hero__amount" style={{ textAlign: 'right' }}>
              <div className="big-number" style={{ color: 'var(--cream)', fontSize: 'clamp(2.4rem,5vw,4rem)' }}>
                {money(receipt.pricing.quoteMinor, receipt.pricing.currency)}
              </div>
              <p className="small" style={{ color: 'rgba(245,238,228,.6)' }}>
                {duration(receipt.totals.billableMs)} billable · issued {dateTime(payload.createdAt)}
              </p>
            </div>
          </div>
        </section>

        <div className="sidebar-layout">
          <div className="stack">
            <section className="card stack">
              <div className="row row--between">
                <div className="stack" style={{ gap: '0.2rem' }}>
                  <span className="eyebrow">Three trust domains</span>
                  <h2 className="h3">What verifies, what is declared, what needs the network.</h2>
                </div>
                <span className={`chip ${failed === 0 ? 'chip--ok' : 'chip--danger'}`}>{passed} pass · {failed} fail</span>
              </div>
              <div className="grid-3">
                {payload.trust.map((domain) => (
                  <div key={domain.domain} className="panel stack" style={{ gap: '0.4rem' }}>
                    <div className="row row--between">
                      <strong>{domain.domain}</strong>
                      <span className={`chip chip--${trustTone(domain)}`}>{domain.status.replaceAll('_', ' ').toLowerCase()}</span>
                    </div>
                    <p className="tiny muted">{domain.detail}</p>
                  </div>
                ))}
              </div>
            </section>

            <section className="card stack">
              <div className="row row--between">
                <h2 className="h3">Verification result</h2>
                <span className="chip">{checks.length} checks</span>
              </div>
              <label className="field">
                <span className="field__label">Optional key pin</span>
                <TextInput
                  value={pinnedKey}
                  onChange={(event) => setPinnedKey(event.target.value)}
                  placeholder="Expected installation key ID (32 hex characters)"
                  spellCheck={false}
                  className="mono"
                />
                <span className="field__hint">
                  Without a pin the bundle only proves internal consistency: the embedded key is self-attested. A pin detects key substitution.
                </span>
              </label>
              <div className="row">
                <Button onClick={() => void verifyAgain()}>Verify with this pin</Button>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setPinnedKey('');
                    if (bundle) void verifyDocument(bundle).then(setResult);
                  }}
                >
                  Verify unpinned
                </Button>
              </div>
              <div className="stack" style={{ gap: '0.5rem' }}>
                {checks.map((check) => (
                  <div key={check.id} className={`check-row check-row--${check.pass ? 'pass' : 'fail'}`}>
                    <Icon name={check.pass ? 'check' : 'alert'} size={16} />
                    <div>
                      <strong>{check.label}</strong>
                      <p>{check.detail}</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="card stack">
              <h2 className="h3">Interval ledger</h2>
              <p className="small muted">
                Every interval is a leaf in a SHA-256 Merkle tree. Editing a timestamp, state, confidence, quality flag, explanation or model pin changes its leaf and breaks the signed root.
              </p>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Seq</th>
                      <th>Window</th>
                      <th>State</th>
                      <th>Leaf</th>
                      <th>Merkle path</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payload.intervals.map((interval) => (
                      <tr key={interval.seq}>
                        <td className="mono">{interval.seq}</td>
                        <td className="mono tiny">{(interval.startMs / 1000).toFixed(2)}–{(interval.endMs / 1000).toFixed(2)}s</td>
                        <td className="tiny">{interval.state.replaceAll('_', ' ').toLowerCase()}</td>
                        <td className="mono tiny break">{interval.leafHash.slice(0, 16)}…</td>
                        <td className="tiny">{interval.merkleProof.length} sibling(s)</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <dl className="kv">
                <dt>Merkle root</dt>
                <dd className="mono tiny break">{payload.merkle.root}</dd>
                <dt>Leaf schema</dt>
                <dd className="mono tiny">{payload.merkle.leafSchema} · {payload.merkle.algorithm}</dd>
              </dl>
            </section>

            <section className="card stack">
              <div className="row row--between">
                <h2 className="h3">Capture provenance</h2>
                {payload.capture ? <span className="chip chip--warn">client-reported</span> : <span className="chip">not recorded</span>}
              </div>
              {payload.capture ? (
                <dl className="kv">
                  <dt>Provenance</dt>
                  <dd><span className="chip">{payload.capture.provenance}</span></dd>
                  <dt>Device label</dt>
                  <dd>{payload.capture.deviceLabel ?? 'not exposed'}</dd>
                  <dt>Sample rate</dt>
                  <dd className="mono">{payload.capture.sampleRate ? `${payload.capture.sampleRate} Hz` : '—'}</dd>
                  <dt>Permission</dt>
                  <dd>{payload.capture.permission}</dd>
                  <dt>Claimed at</dt>
                  <dd>{dateTime(payload.capture.claimedAt)}</dd>
                  <dt>Meaning</dt>
                  <dd className="tiny">{payload.capture.note}</dd>
                </dl>
              ) : (
                <Notice tone="warn">
                  No capture claim was stored. The ledger is still integrity-verified, but the bundle does not attribute it to a live microphone or any other capture path.
                </Notice>
              )}
            </section>

            <section className="card stack">
              <h2 className="h3">Limitations</h2>
              <ul className="checklist checklist--x">
                {payload.limitations.map((limitation) => (
                  <li key={limitation}><Icon name="alert" size={14} /><span className="tiny">{limitation}</span></li>
                ))}
              </ul>
            </section>
          </div>

          <aside className="stack">
            <section className="card stack">
              <span className="eyebrow">Integrity</span>
              <h2 className="h3">A seal, not a story.</h2>
              <SignatureSeal signed={Boolean(result?.envelope.valid)} keyId={bundle.keyId} />
              <dl className="kv">
                <dt>Bundle</dt>
                <dd className="mono tiny break">{payload.bundleId}</dd>
                <dt>Receipt</dt>
                <dd className="mono tiny break">{receipt.receiptId}</dd>
                <dt>Receipt hash</dt>
                <dd className="mono tiny break">{receipt.evidenceSha256}</dd>
                <dt>Merkle root</dt>
                <dd className="mono tiny break">{payload.merkle.root}</dd>
                <dt>Model</dt>
                <dd className="mono tiny break">{payload.model.version}</dd>
              </dl>
            </section>

            <section className="card stack">
              <h2 className="h3">Verify it yourself</h2>
              <p className="small muted">
                Download the JSON and run the single-file verifier or the CLI. Both recompute the receipt hash, every interval leaf and every inclusion proof without importing the application.
              </p>
              <code className="mono tiny break">npm run proof:verify -- bundle.json</code>
              <a className="btn btn--secondary btn--block" href="/verify-offline.html" target="_blank" rel="noreferrer">
                <Icon name="shield" size={15} /> Open standalone verifier
              </a>
              <LinkButton to="/verify" variant="ghost" block>
                Verify in Whirr
              </LinkButton>
            </section>

            <section className="card card--soft stack">
              <h2 className="h3">Payment state</h2>
              <dl className="kv">
                <dt>Mode</dt>
                <dd>{receipt.payment.mode}</dd>
                <dt>Recorded state</dt>
                <dd>{receipt.payment.state.replaceAll('_', ' ').toLowerCase()}</dd>
                <dt>Captured</dt>
                <dd>{receipt.payment.capturedMinor === null ? '—' : money(receipt.payment.capturedMinor, receipt.pricing.currency)}</dd>
              </dl>
              <Notice tone="warn">
                This is installation-recorded payment state. Verifying the bundle offline does not contact PayPal and cannot prove provider settlement.
              </Notice>
            </section>

            <section className="card stack">
              <h2 className="h3">Canonical JSON</h2>
              <textarea
                className="textarea mono"
                readOnly
                value={publicJson}
                style={{ minHeight: 180, fontSize: '0.68rem' }}
                aria-label="Public proof bundle JSON"
              />
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
}
