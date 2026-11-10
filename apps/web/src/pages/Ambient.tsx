import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { AmbientCatalogView, AmbientJudgeView } from '../../../../packages/contracts/src/types.ts';
import { api, errorMessage } from '../lib/api.ts';
import { EmptyState, LinkButton, Loading, Notice, usePageTitle } from '../components/ui.tsx';
import { Icon, ObjectGlyph } from '../components/visuals.tsx';
import { duration, money, percent } from '../lib/format.ts';

export function Ambient() {
  const [catalog, setCatalog] = useState<AmbientCatalogView | null>(null);
  const [judge, setJudge] = useState<AmbientJudgeView | null>(null);
  const [error, setError] = useState<string | null>(null);
  usePageTitle('Whirr Ambient');

  useEffect(() => {
    Promise.all([api<AmbientCatalogView>('/api/ambient'), api<AmbientJudgeView>('/api/ambient/judge')])
      .then(([nextCatalog, nextJudge]) => {
        setCatalog(nextCatalog);
        setJudge(nextJudge);
      })
      .catch((err) => setError(errorMessage(err)));
  }, []);

  const featured = catalog?.items[0];
  return (
    <div className="page ambient-page">
      <section className="ambient-hero">
        <div className="ambient-hero__grain" aria-hidden="true" />
        <div className="container ambient-hero__inner">
          <div className="ambient-hero__copy">
            <span className="eyebrow eyebrow--light">Whirr 7.0 · Ambient cooperation</span>
            <h1 className="display">
              Don’t buy
              <br />
              what exists.
              <br />
              <em>Buy what could change.</em>
            </h1>
            <p className="lede">
              Ask for a condition in the world. Make an exact, bounded offer to the person who controls the
              activity. Observe whether the enrolled source actually stayed inactive. Let PayPal Sandbox carry the
              agreed compensation only after the evidence and a human acceptance.
            </p>
            <div className="row ambient-hero__actions">
              <LinkButton to="/ambient/wish" variant="money">
                State a wish <Icon name="arrow" size={16} />
              </LinkButton>
              <LinkButton to="/ambient/judge" variant="secondary">
                Inspect the honest replay
              </LinkButton>
            </div>
            <div className="ambient-hero__chips">
              <span className="chip chip--on-dark">PayPal Sandbox only</span>
              <span className="chip chip--on-dark">Microphone-closed means no observation</span>
              <span className="chip chip--on-dark">No capture on interruption</span>
            </div>
          </div>
          <div className="ambient-hero__instrument" aria-hidden="true">
            <div className="ambient-hero__dial">
              <span className="tiny mono">THE QUIET WINDOW</span>
              <div className="ambient-hero__dial-ring">
                <span className="ambient-hero__dial-core">30s</span>
                <span className="ambient-hero__dial-label">source not detected</span>
              </div>
              <div className="ambient-hero__dial-foot">
                <span><i className="status-dot status-dot--ok" /> continuous</span>
                <span className="mono">$2.00 offer</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="container stack stack--lg ambient-body">
        {error ? <Notice tone="danger">{error}</Notice> : null}
        {!catalog ? (
          <Loading label="Reading the Ambient catalog…" />
        ) : (
          <>
            <section className="ambient-surfaces" aria-labelledby="ambient-surfaces-title">
              <div className="section-head">
                <div>
                  <span className="eyebrow">Four surfaces, one agreement</span>
                  <h2 id="ambient-surfaces-title" className="display display--sm">
                    A request becomes a record.
                  </h2>
                </div>
                <p className="small muted">
                  The product is designed around one physical conflict, not a dashboard. Every screen makes the
                  negotiated terms and the evidence boundary legible.
                </p>
              </div>
              <div className="ambient-surface-grid">
                {[
                  ['01', 'The Wish', 'Say what you need the world to do. Whirr narrows it to a condition it can actually observe.'],
                  ['02', 'The Exchange', 'The provider sees the exact target, duration, sensing, price and failure rules. They accept, decline or counter.'],
                  ['03', 'The Window', 'The agreement becomes a live observation. Continuity builds; an interruption fractures it.'],
                  ['04', 'The Accord', 'The evidence, consent and provider result become a portable record — with the limits left visible.'],
                ].map(([number, title, copy]) => (
                  <article className="ambient-surface" key={title}>
                    <span className="mono">{number}</span>
                    <h3>{title}</h3>
                    <p className="small muted">{copy}</p>
                  </article>
                ))}
              </div>
            </section>

            <section className="ambient-catalog" aria-labelledby="ambient-sources-title">
              <div className="section-head">
                <div>
                  <span className="eyebrow">Enrolled sources</span>
                  <h2 id="ambient-sources-title" className="display display--sm">
                    Published objects that can answer a wish.
                  </h2>
                </div>
                <LinkButton to="/ambient/wish" variant="primary">State a wish</LinkButton>
              </div>
              {catalog.sources.length === 0 ? (
                <EmptyState title="No published source is ready">
                  Publish a calibrated object with a current READY event model to make it available to buyers.
                </EmptyState>
              ) : (
                <div className="ambient-catalog__grid">
                  {catalog.sources.map((source) => (
                    <article className="ambient-catalog__card" key={source.target.objectId}>
                      <div className="row row--between">
                        <ObjectGlyph glyph={source.target.glyph} />
                        <span className={`chip ${source.model.provenance === 'SYNTHETIC_REFERENCE' ? 'chip--warn' : 'chip--ok'}`}>
                          {source.model.provenance === 'SYNTHETIC_REFERENCE' ? 'synthetic reference' : 'local calibration'}
                        </span>
                      </div>
                      <span className="eyebrow">{source.publishedVia === 'PUBLISHED_TERMS' ? 'Published service' : 'Published promise'}</span>
                      <h3>{source.target.objectName}</h3>
                      <p className="small muted">{source.target.description}</p>
                      <div className="ambient-catalog__metrics">
                        <span><strong>{percent(source.model.macroRecall)}</strong> model recall</span>
                        <span><strong>{source.model.status}</strong> model state</span>
                        <span><strong>{source.model.takeCount}</strong> calibration takes</span>
                      </div>
                      <div className="ambient-catalog__foot">
                        <span className="mono">{source.model.hash.slice(0, 16)}…</span>
                        <LinkButton to="/ambient/wish" variant="ghost">
                          State a wish <Icon name="arrow" size={15} />
                        </LinkButton>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>

            <section className="ambient-catalog" aria-labelledby="ambient-catalog-title">
              <div className="section-head">
                <div>
                  <span className="eyebrow">Published cooperation</span>
                  <h2 id="ambient-catalog-title" className="display display--sm">
                    What can be observed?
                  </h2>
                </div>
                <LinkButton to="/ambient/judge" variant="ghost">Judge mode</LinkButton>
              </div>
              {catalog.items.length === 0 ? (
                <EmptyState
                  title="No Ambient agreement is seeded"
                  action={<code className="mono">npm run seed:ambient</code>}
                >
                  The Quiet Window needs the reference event model and the two synthetic replay histories.
                </EmptyState>
              ) : (
                <div className="ambient-catalog__grid">
                  {catalog.items.map((item) => (
                    <Link className="ambient-catalog__card" key={item.agreementId} to={`/ambient/exchange/${item.agreementId}`}>
                      <div className="row row--between">
                        <ObjectGlyph glyph={item.target.glyph} />
                        <span className={`chip ${item.demoOnly ? 'chip--warn' : 'chip--ok'}`}>
                          {item.demoOnly ? 'demo histories' : 'live enabled'}
                        </span>
                      </div>
                      <span className="eyebrow">{item.target.objectName}</span>
                      <h3>{item.serviceName}</h3>
                      <p className="small muted">
                        {duration(item.requiredInactiveMs)} of continuous non-detection after an active baseline.
                      </p>
                      <div className="ambient-catalog__metrics">
                        <span><strong>{money(item.fixedPriceMinor, item.currency)}</strong> fixed offer</span>
                        <span><strong>{percent(item.model.macroRecall)}</strong> model recall</span>
                        <span><strong>{item.qualifiedCount}/{item.sessionCount}</strong> windows qualified</span>
                      </div>
                      <div className="ambient-catalog__foot">
                        <span className="mono">{item.termsHash.slice(0, 16)}…</span>
                        <span className="row"><span>{item.latestOutcome ?? 'no window yet'}</span><Icon name="arrow" size={15} /></span>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </section>

            {featured ? (
              <section className="ambient-quiet-note">
                <div>
                  <span className="eyebrow">The launch scenario</span>
                  <h2 className="display display--sm">Quiet Window</h2>
                  <p className="lede">
                    A workshop machine is legitimately operating. Someone needs a short recording window. They offer
                    compensation for a voluntary pause. Whirr observes whether <em>that enrolled source</em> stayed
                    undetected for the agreed interval.
                  </p>
                </div>
                <div className="ambient-quiet-note__facts">
                  <div><span className="tiny muted">Target</span><strong>{featured.target.objectName}</strong></div>
                  <div><span className="tiny muted">Required</span><strong>{duration(featured.requiredInactiveMs)}</strong></div>
                  <div><span className="tiny muted">Model</span><strong>{featured.model.provenance === 'SYNTHETIC_REFERENCE' ? 'synthetic reference' : 'local calibration'}</strong></div>
                  <div><span className="tiny muted">Payment</span><strong>Sandbox authorization only</strong></div>
                </div>
              </section>
            ) : null}

            <Notice tone="warn" title="The observation is deliberately narrow.">
              “Inactive” means the validated model did not confidently detect the bound source under the agreed
              conditions. It does not prove silence, power-off, safety, legal compliance, or that the provider caused
              the stop. A microphone can be muted or fooled; Whirr records the limitation instead of hiding it.
            </Notice>

            {judge?.available ? (
              <section className="ambient-replay-strip">
                <div>
                  <span className="eyebrow">Credential-free judge path</span>
                  <h2 className="h2">Two histories. One honest comparison.</h2>
                  <p className="small muted">
                    Inspect a synthetic interrupted window and a synthetic qualifying window. Both are labelled
                    REPLAY and DEMO_NO_PAYMENT; neither is a physical trial or a PayPal capture.
                  </p>
                </div>
                <div className="row">
                  {judge.seed.interruptedSessionId ? (
                    <LinkButton to={`/ambient/window/${judge.seed.interruptedSessionId}?replay=1`} variant="secondary">
                      Open interrupted replay
                    </LinkButton>
                  ) : null}
                  {judge.seed.qualifiedSessionId ? (
                    <LinkButton to={`/ambient/accord/${judge.seed.qualifiedSessionId}?replay=1`} variant="primary">
                      Inspect qualified Accord
                    </LinkButton>
                  ) : null}
                </div>
              </section>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
