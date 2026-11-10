import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../lib/api.ts';
import type { PromiseCatalogView } from '../../../../packages/contracts/src/types.ts';
import { EmptyState, LinkButton, Loading, Notice, PageHeader, usePageTitle } from '../components/ui.tsx';
import { Icon, ObjectGlyph } from '../components/visuals.tsx';
import { money } from '../lib/format.ts';

export function Promises() {
  const [catalog, setCatalog] = useState<PromiseCatalogView | null>(null);
  const [error, setError] = useState<string | null>(null);
  usePageTitle('Physical promises');

  useEffect(() => {
    api<PromiseCatalogView>('/api/promises')
      .then(setCatalog)
      .catch((err) => setError(errorMessage(err)));
  }, []);

  const featured = catalog?.items[0]?.agreement;

  return (
    <div className="page promise-page">
      <div className="container stack stack--lg">
        <section className="promise-hero">
          <div className="promise-hero__grid" aria-hidden="true" />
          <div className="promise-hero__copy">
            <span className="eyebrow eyebrow--light">Whirr 6.0 · The Physical Promise Engine</span>
            <h1>
              Teach the world
              <br />
              what counts as <em>work.</em>
            </h1>
            <p className="lede">
              Show Whirr an ordinary physical process. Define the observable conditions that deserve payment. Let
              the evidence decide, then use a buyer-approved PayPal Sandbox authorization to settle the exact result.
            </p>
            <div className="row">
              <LinkButton to={featured ? `/promise/${featured.id}` : '/studio/promises'} variant="money">
                {featured ? 'Open the reference promise' : 'Teach the first promise'} <Icon name="arrow" size={16} />
              </LinkButton>
              <LinkButton to="/studio/promises" variant="secondary">
                Enter the Teaching Room
              </LinkButton>
            </div>
            <div className="promise-hero__chips">
              <span className="chip chip--on-dark">PayPal Sandbox only</span>
              <span className="chip chip--on-dark">On-device inference</span>
              <span className="chip chip--on-dark">Incomplete attempts never auto-charge</span>
            </div>
          </div>
          <div className="promise-hero__instrument" aria-hidden="true">
            <div className="promise-hero__dial">
              <span className="tiny mono">OBSERVABLE SEQUENCE</span>
              <div className="promise-hero__stages">
                {['IDLE', 'START', 'RUNNING', 'STOP', 'DECIDE'].map((stage, index) => (
                  <div key={stage} className={`promise-hero__stage${index < 4 ? ' is-on' : ''}`}>
                    <span className="mono">{String(index + 1).padStart(2, '0')}</span>
                    <strong>{stage}</strong>
                  </div>
                ))}
              </div>
              <div className="promise-hero__readout">
                <span>
                  <i className="status-dot status-dot--ok" /> observed
                </span>
                <span className="mono">$2.00 fixed</span>
                <span>provider decides settlement</span>
              </div>
            </div>
          </div>
        </section>

        <section className="promise-steps" aria-labelledby="promise-steps-title">
          <div className="promise-steps__head">
            <span className="eyebrow">From demonstration to defensible payment</span>
            <h2 id="promise-steps-title" className="display display--sm">
              A promise you can inspect.
            </h2>
          </div>
          <ol className="promise-steps__list">
            {[
              ['Demonstrate', 'Record idle, running, and unrelated sound. The browser extracts features; raw audio stays local.'],
              ['Learn', 'A small on-device event model learns the acoustic vocabulary and refuses uncertain sounds.'],
              ['Promise', 'A typed compiler turns plain language into exact duration, confidence, and failure rules.'],
              ['Settle', 'PayPal authorizes the ceiling. Whirr replays the evidence and requests capture only when the contract qualifies.'],
            ].map(([title, copy], index) => (
              <li key={title}>
                <span className="mono">{String(index + 1).padStart(2, '0')}</span>
                <strong>{title}</strong>
                <p className="small muted">{copy}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="stack" aria-labelledby="promise-catalog-title">
          <div className="row row--between">
            <div>
              <span className="eyebrow">Published agreements</span>
              <h2 id="promise-catalog-title" className="display display--sm">
                What can you promise?
              </h2>
            </div>
            <LinkButton to="/verify" variant="ghost">
              Verify a proof
            </LinkButton>
          </div>
          {error ? <Notice tone="danger">{error}</Notice> : null}
          {!catalog ? (
            <Loading label="Loading published promises…" />
          ) : catalog.items.length === 0 ? (
            <EmptyState
              title="No promise is published yet"
              action={<LinkButton to="/studio/promises">Open the Teaching Room</LinkButton>}
            >
              Record demonstrations, train the event model, then compile and approve an exact agreement. For the
              synthetic judge replay, run <span className="mono">npm run seed:promise</span>.
            </EmptyState>
          ) : (
            <div className="promise-catalog">
              {catalog.items.map(({ agreement, executionCount, qualifiedCount, capturedCount }) => (
                <Link className="promise-card" key={agreement.id} to={`/promise/${agreement.id}`}>
                  <div className="promise-card__top">
                    <ObjectGlyph glyph={agreement.object.glyph} />
                    <span className={`chip ${agreement.eventModel.provenance === 'SYNTHETIC_REFERENCE' ? 'chip--warn' : 'chip--ok'}`}>
                      {agreement.eventModel.provenance === 'SYNTHETIC_REFERENCE' ? 'synthetic reference' : 'taught locally'}
                    </span>
                  </div>
                  <div>
                    <span className="eyebrow">{agreement.object.name}</span>
                    <h3>{agreement.serviceName}</h3>
                    <p className="small muted">{agreement.proposalText}</p>
                  </div>
                  <div className="promise-card__terms">
                    <span>{agreement.terms.requiredSequence.join(' → ')}</span>
                    <span className="mono">
                      {(agreement.terms.constraints.minRunMs / 1000).toFixed(1)}s minimum
                    </span>
                  </div>
                  <div className="promise-card__foot">
                    <strong>{money(agreement.terms.financial.fixedPriceMinor, agreement.terms.financial.currency)}</strong>
                    <span className="tiny muted">
                      {executionCount} attempts · {qualifiedCount} qualified · {capturedCount} provider captures
                    </span>
                    <Icon name="arrow" size={16} />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>

        <Notice tone="info" title="What the evidence can and cannot prove.">
          Whirr observes acoustic states and replays the exact approved temporal rules. It does not prove that the
          machine produced a correct physical result, that a microphone was honest, or that the buyer controlled the
          room. PayPal Sandbox confirms provider actions, not real-world fulfillment.
        </Notice>
      </div>
    </div>
  );
}
