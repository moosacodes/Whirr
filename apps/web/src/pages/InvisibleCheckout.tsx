import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../lib/api.ts';
import type {
  DiscoveryMatchView,
  DiscoveryPublicView,
} from '../../../../packages/contracts/src/types.ts';
import { formatMinor } from '../../../../packages/meter/src/currency.ts';
import { DiscoveryCapture, type DiscoveryCaptureSample } from '../components/DiscoveryCapture.tsx';
import { Button, LinkButton, Loading, Notice, usePageTitle } from '../components/ui.tsx';
import { Icon } from '../components/visuals.tsx';
import { percent } from '../lib/format.ts';

const STAGES = ['Listen', 'Discover', 'Confirm', 'Use', 'Settle'] as const;

function StageRail({ active, confirmed }: { active: number; confirmed: boolean }) {
  return (
    <ol className="discover-stages" aria-label="Invisible checkout stages">
      {STAGES.map((stage, index) => {
        const done = index < active || (confirmed && index === 2);
        return (
          <li key={stage} className={`discover-stage${index === active ? ' is-active' : ''}${done ? ' is-done' : ''}`}>
            <span className="discover-stage__number">{done ? <Icon name="check" size={12} /> : index + 1}</span>
            <span>{stage}</span>
          </li>
        );
      })}
    </ol>
  );
}

function ResultView({ match }: { match: DiscoveryMatchView }) {
  const checkoutPath = match.checkoutUrl ? match.checkoutUrl.replace(/^https?:\/\/[^/]+/, '') : null;
  if (match.result === 'MATCH') {
    return (
      <div className="discover-result discover-result--match">
        <div className="row row--between" style={{ alignItems: 'flex-start' }}>
          <div className="stack" style={{ gap: '0.2rem' }}>
            <span className="eyebrow" style={{ color: 'var(--accent-soft)' }}>Discovery hypothesis</span>
            <h2 className="display" style={{ fontSize: 'clamp(2rem,5vw,3.4rem)', margin: 0 }}>
              {match.top ? match.candidates[0]?.name ?? 'Enrolled object' : 'Unknown'}
            </h2>
          </div>
          <span className="discover-score">{percent(match.top?.score ?? 0, 0)}</span>
        </div>
        <p className="small" style={{ color: 'rgba(255,253,248,0.82)', maxWidth: '60ch' }}>
          The closest enrollment is {percent(match.top?.score ?? 0)} similar, {(match.top?.margin ?? 0) * 100 > 0 ? `${percent(match.top?.margin ?? 0)}` : '0%'} ahead of the next object.
          This is a similarity hypothesis for a human to confirm — not identity, ownership or proof of use.
        </p>

        {match.terms ? (
          <div className="discover-terms">
            <div>
              <span className="eyebrow">Rate</span>
              <strong>{formatMinor(match.terms.minorPerMinute, match.terms.currency)}<span className="tiny"> / min</span></strong>
            </div>
            <div>
              <span className="eyebrow">Hard cap</span>
              <strong>{formatMinor(match.terms.capMinor, match.terms.currency)}</strong>
            </div>
            <div>
              <span className="eyebrow">Uncertain time</span>
              <strong>Excluded</strong>
            </div>
            <div>
              <span className="eyebrow">Terms</span>
              <strong>v{match.terms.version}</strong>
            </div>
          </div>
        ) : null}

        <div className="discover-result__actions">
          {match.checkoutAvailable && checkoutPath ? (
            <LinkButton to={checkoutPath} variant="money">
              Confirm this object &amp; review the real terms <Icon name="arrow" size={16} />
            </LinkButton>
          ) : (
            <Button variant="secondary" size="lg" disabled>
              Checkout unavailable
            </Button>
          )}
          <span className="tiny" style={{ color: 'rgba(255,253,248,0.66)', maxWidth: '48ch' }}>
            {match.checkoutReason}
          </span>
        </div>
        <p className="tiny" style={{ margin: 0, color: 'rgba(255,253,248,0.55)' }}>
          Checkout opens the existing 4.x consent flow. The discovery match creates no session, no authorization and no charge.
        </p>
      </div>
    );
  }
  const ambiguous = match.result === 'AMBIGUOUS';
  return (
    <div className={`discover-result ${ambiguous ? 'discover-result--ambiguous' : 'discover-result--unknown'}`}>
      <span className="eyebrow">No checkout</span>
      <h2 className="display" style={{ fontSize: 'clamp(2rem,5vw,3.2rem)', margin: 0 }}>
        {ambiguous ? 'Too close to call.' : 'This sound is not enrolled.'}
      </h2>
      <p className="small" style={{ color: 'rgba(255,253,248,0.78)', maxWidth: '58ch' }}>
        {match.reason} Whirr returns UNKNOWN or AMBIGUOUS rather than guessing. No object, price or payment action is offered.
      </p>
      <div className="discover-btn-row">
        <Button variant="secondary" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
          Try another live listen
        </Button>
        <Link className="btn btn--ghost" to="/shelf">Browse the standard bench</Link>
      </div>
    </div>
  );
}

export function InvisibleCheckout() {
  usePageTitle('Invisible checkout — Whirr 5.0');
  const [view, setView] = useState<DiscoveryPublicView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [match, setMatch] = useState<DiscoveryMatchView | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api<DiscoveryPublicView>('/api/discovery')
      .then((result) => {
        if (!cancelled) setView(result);
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
  }, []);

  const listen = useCallback(async (sample: DiscoveryCaptureSample) => {
    setBusy(true);
    setError(null);
    try {
      const result = await api<DiscoveryMatchView>('/api/discovery/match', {
        method: 'POST',
        body: {
          frames: sample.frames,
          frameFlags: sample.frameFlags,
          durationMs: sample.durationMs,
          sampleRate: sample.sampleRate,
          capturedAt: sample.capturedAt,
          deviceLabel: sample.deviceLabel,
          capture: sample.capture,
        },
      });
      setMatch(result);
    } catch (err) {
      setError(errorMessage(err));
      throw err;
    } finally {
      setBusy(false);
    }
  }, []);

  if (loading) return <Loading label="Opening the discovery bench…" />;
  if (!view) {
    return (
      <div className="page container page--narrow">
        <Notice tone="danger">{error ?? 'Discovery is not available.'}</Notice>
      </div>
    );
  }

  const stage = match ? 2 : busy ? 1 : 0;
  const report = view.report;

  return (
    <div className="page discover-page">
      <div className="container page--wide">
        <div className="discover-hero">
          <div className="discover-hero__grid" aria-hidden="true" />
          <div className="discover-hero__copy">
            <span className="eyebrow" style={{ color: 'var(--accent-soft)' }}>Whirr 5.0 · Invisible Checkout · experimental</span>
            <h1 className="display">
              There is nothing to scan.
              <br />
              <em>Just a machine, running.</em>
            </h1>
            <p className="lede" style={{ color: 'rgba(255,253,248,0.78)', maxWidth: '54ch' }}>
              An ordinary object becomes financially discoverable through the sound it already makes. Listen once. If the
              signal matches {view.enrollmentCount > 0 ? `one of ${view.enrollmentCount} enrolled physical object${view.enrollmentCount === 1 ? '' : 's'}` : 'an enrolled physical object'} closely enough, a human gets a checkout link — never an automatic charge.
            </p>
            <div className="row" style={{ gap: '0.5rem' }}>
              <span className="chip chip--on-dark"><Icon name="shield" size={13} /> Similarity, not identity</span>
              <span className="chip chip--on-dark"><Icon name="mic" size={13} /> Raw audio stays local</span>
              <span className="chip chip--on-dark"><Icon name="money" size={13} /> PayPal Sandbox only</span>
            </div>
          </div>
          <div className="discover-hero__console">
            <StageRail active={stage} confirmed={false} />
            {match ? (
              <>
                <ResultView match={match} />
                <Button variant="ghost" onClick={() => setMatch(null)}>
                  Listen again
                </Button>
              </>
            ) : (
              <DiscoveryCapture
                title="Listen for a known object"
                instruction="Hold the object near this device and let it run normally for six seconds. The room will be noisy; that is part of the experiment."
                buttonLabel={busy ? 'Matching…' : 'Listen for an object'}
                onCapture={listen}
                disabled={busy}
              />
            )}
            {error ? <Notice tone="danger">{error}</Notice> : null}
          </div>
        </div>

        <div className="discover-follow">
          <section className="card stack">
            <div className="row row--between">
              <div>
                <span className="eyebrow">The five-step contract</span>
                <h2 className="h2" style={{ fontSize: 'clamp(1.7rem,3vw,2.4rem)' }}>Listen → Discover → Confirm → Use → Settle</h2>
              </div>
              <span className="chip">{view.reportStatus.replaceAll('_', ' ').toLowerCase()}</span>
            </div>
            <div className="discover-explain">
              <div><strong>01 Listen</strong><p>One explicit live capture. Six seconds of ordinary room sound; raw audio never leaves the tab.</p></div>
              <div><strong>02 Discover</strong><p>A frozen band profile scores similarity to enrolled objects. Low score or a close second becomes UNKNOWN or AMBIGUOUS.</p></div>
              <div><strong>03 Confirm</strong><p>The human sees the object name and the existing published rate and cap. Nothing is agreed until the existing terms screen.</p></div>
              <div><strong>04 Use</strong><p>The existing 4.x Listening Room meters only confident operating time, under the same field guard and PayPal authorization.</p></div>
              <div><strong>05 Settle</strong><p>The existing signed receipt, review and PayPal Sandbox capture path remains unchanged. Discovery never captures.</p></div>
            </div>
          </section>

          <aside className="stack">
            <section className="card card--soft stack">
              <span className="eyebrow">What a match means</span>
              <p className="small" style={{ margin: 0 }}>
                A match means one short recording resembles an enrollment more than the alternatives. It does <strong>not</strong> prove
                which physical unit is present, who owns it, that a person is using it, or that a replay is absent.
              </p>
              <div className="panel">
                <dl className="kv">
                  <dt>Enrolled objects</dt><dd>{view.enrollmentCount}</dd>
                  <dt>Match threshold</dt><dd>{percent(view.protocol.minScore, 0)}</dd>
                  <dt>Separation required</dt><dd>{percent(view.protocol.minMargin, 1)}</dd>
                  <dt>Evidence</dt><dd>{view.reportStatus === 'NOT_RUN' ? 'Not run' : view.reportStatus}</dd>
                </dl>
              </div>
              <Link className="link small" to="/studio/discovery">Open the operator discovery studio →</Link>
            </section>
            <section className="card stack" id="evidence">
              <div className="row row--between">
                <div>
                  <span className="eyebrow">Held-out evidence</span>
                  <h2 className="h3">The experiment is allowed to fail.</h2>
                </div>
                <span className={`chip${report?.status === 'PASS' ? ' chip--ok' : report?.status === 'FAIL' ? ' chip--danger' : ' chip--warn'}`}>
                  {report?.status ?? 'NOT RUN'}
                </span>
              </div>
              {report ? (
                <>
                  <p className="small muted" style={{ margin: 0 }}>
                    {report.metrics.targetTrials} held-out target trials · {report.metrics.unknownTrials} unknown trials ·{' '}
                    {report.metrics.falseMatches} false match{report.metrics.falseMatches === 1 ? '' : 'es'} · median {report.metrics.medianLatencyMs.toFixed(1)} ms
                  </p>
                  <div className="discover-gates">
                    {report.gates.map((gate) => (
                      <div key={gate.id} className="discover-gate">
                        <span className={`discover-gate__dot is-${gate.status.toLowerCase()}`} />
                        <div>
                          <strong className="tiny">{gate.label}</strong>
                          <span className="tiny muted">{gate.observed} / {gate.threshold}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <p className="small muted" style={{ margin: 0 }}>
                    No held-out report exists. The page shows NOT RUN rather than a borrowed or invented number.
                  </p>
                  <p className="tiny muted" style={{ margin: 0 }}>
                    The protocol requires {view.protocol.minTargetTrials} target trials, {view.protocol.minUnknownTrials} unknown trials,
                    {' '}{view.protocol.minReplayTrials} replay trials and at least {view.protocol.minEnrollments} genuinely different enrolled objects.
                  </p>
                </>
              )}
              {view.limitations.map((limitation) => (
                <p key={limitation} className="tiny muted" style={{ margin: 0 }}>— {limitation}</p>
              ))}
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
}
