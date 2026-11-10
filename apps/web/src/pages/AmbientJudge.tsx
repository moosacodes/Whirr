import { useEffect, useState } from 'react';
import type { AmbientJudgeView, AmbientSessionSummary } from '../../../../packages/contracts/src/types.ts';
import { api, errorMessage } from '../lib/api.ts';
import { LinkButton, Loading, Notice, PageHeader, Stat, usePageTitle } from '../components/ui.tsx';
import { Icon } from '../components/visuals.tsx';
import { AmbientFrame } from '../components/ambient-experience.tsx';
import { dateTime, money } from '../lib/format.ts';

function SessionCard({ session, title, copy }: { session: AmbientSessionSummary | null; title: string; copy: string }) {
  if (!session) {
    return (
      <section className="ambient-judge-card ambient-judge-card--empty">
        <span className="eyebrow">{title}</span>
        <h2 className="h2">Reference missing</h2>
        <p className="small muted">Run <span className="mono">npm run seed:ambient</span> to install the two honest replay histories.</p>
      </section>
    );
  }
  const qualified = session.outcome === 'QUALIFIED';
  return (
    <section className={`ambient-judge-card ${qualified ? 'ambient-judge-card--ok' : 'ambient-judge-card--bad'}`}>
      <div className="row row--between">
        <span className="eyebrow">{title}</span>
        <span className={`chip ${qualified ? 'chip--ok' : 'chip--danger'}`}>{session.outcome ?? session.state}</span>
      </div>
      <h2 className="h2">{qualified ? 'The window held.' : 'The window broke.'}</h2>
      <p className="small muted">{copy}</p>
      <div className="ambient-judge-card__facts">
        <div><span className="tiny muted">Captured</span><strong>{session.capturedMinor === null ? 'no money' : money(session.capturedMinor, 'USD')}</strong></div>
        <div><span className="tiny muted">Eligible</span><strong>{session.eligibleForCapture ? 'contract only' : 'no'}</strong></div>
        <div><span className="tiny muted">Mode</span><strong>{session.demo ? 'DEMO / REPLAY' : 'LIVE'}</strong></div>
        <div><span className="tiny muted">Created</span><strong>{dateTime(session.createdAt)}</strong></div>
      </div>
      <div className="row">
        <LinkButton to={`/ambient/window/${session.id}?replay=1`} variant={qualified ? 'primary' : 'secondary'}>
          Open the replay <Icon name="arrow" size={15} />
        </LinkButton>
        <LinkButton to={`/ambient/accord/${session.id}?replay=1`} variant="ghost">
          Inspect Accord
        </LinkButton>
      </div>
    </section>
  );
}

function gateTone(status: string) {
  if (status === 'OBSERVED' || status === 'PASS') return 'chip--ok';
  if (status === 'OPEN_NOT_RUN' || status === 'OPEN_NOT_VERIFIED' || status === 'OPEN') return 'chip--warn';
  return 'chip--danger';
}

export function AmbientJudge() {
  const [judge, setJudge] = useState<AmbientJudgeView | null>(null);
  const [error, setError] = useState<string | null>(null);
  usePageTitle('Ambient judge mode');

  useEffect(() => {
    api<AmbientJudgeView>('/api/ambient/judge')
      .then(setJudge)
      .catch((err) => setError(errorMessage(err)));
  }, []);

  if (!judge) {
    return <div className="page container">{error ? <Notice tone="danger">{error}</Notice> : <Loading label="Collecting Ambient evidence…" />}</div>;
  }

  if (!judge.available) {
    return (
      <AmbientFrame current="evidence" note="JUDGE / NOT SEEDED">
        <div className="page ambient-page container">
          <PageHeader
            eyebrow="Evidence · Judge mode"
            title="The Quiet Window is not seeded."
            lede="The judge path needs the synthetic reference model and the two histories. No live claim is being made."
            actions={<LinkButton to="/ambient" variant="secondary">Ambient overview</LinkButton>}
          />
          <Notice tone="warn">{judge.limitations.join(' ')}</Notice>
        </div>
      </AmbientFrame>
    );
  }

  const interrupted = judge.sessions.find((session) => session.id === judge.seed.interruptedSessionId) ?? null;
  const qualified = judge.sessions.find((session) => session.id === judge.seed.qualifiedSessionId) ?? null;
  const physicalFieldTrial = judge.evidence.physicalFieldTrial as string;
  return (
    <AmbientFrame current="evidence" note="JUDGE / EXTERNAL GATES OPEN">
      <div className="page ambient-page">
      <div className="container stack stack--lg">
        <PageHeader
          eyebrow="Evidence · Judge mode"
          title="Failure, success, and the gap between them."
          lede="The same agreement against an interrupted series and a continuous one. The histories are synthetic and labelled; they demonstrate the contract and the verifier, not a physical machine trial."
          actions={
            <>
              <LinkButton to="/ambient/wish" variant="primary">Try the Wish</LinkButton>
              <LinkButton to="/verify" variant="secondary">Existing proof verifier</LinkButton>
            </>
          }
        />

        {error ? <Notice tone="danger">{error}</Notice> : null}
        <div className="ambient-judge-stats">
          <Stat label="Agreement" value={judge.seed.agreementId ?? '—'} />
          <Stat label="Provenance" value={judge.seed.provenance?.replaceAll('_', ' ') ?? '—'} tone="accent" />
          <Stat label="Windows" value={judge.sessions.length} />
          <Stat label="Real captures" value={judge.evidence.genuineSandboxCapture === 'OBSERVED' ? 'observed' : 'open'} tone={judge.evidence.genuineSandboxCapture === 'OBSERVED' ? 'accent' : undefined} />
        </div>

        <div className="ambient-judge-grid">
          <SessionCard
            session={interrupted}
            title="CASE A · INTERRUPTED"
            copy="The source was active before the window, then reappeared halfway through the requested interval. The qualifying run reset. No buyer acceptance and no capture are claimed."
          />
          <SessionCard
            session={qualified}
            title="CASE B · QUALIFIED"
            copy="The source remained undetected for the full continuous interval after the active baseline. The buyer accepted the result. This is still a demo with no PayPal transaction."
          />
        </div>

        <section className="card stack">
          <div className="row row--between">
            <div>
              <span className="eyebrow">Evidence ledger</span>
              <h2 className="h2">What is actually established?</h2>
            </div>
            <span className="chip chip--warn">external gates stay open</span>
          </div>
          <div className="ambient-gates">
            {[
              ['Physical source enrollment', 'OPEN', 'The model is trained on the repository’s synthetic reference fixture. No physical appliance was recorded for this release.'],
              ['Real interrupted observation', physicalFieldTrial === 'OBSERVED' ? 'OBSERVED' : 'OPEN_NOT_RUN', 'The seeded failure is a replay, not a field trial.'],
              ['Real qualifying observation', physicalFieldTrial === 'OBSERVED' ? 'OBSERVED' : 'OPEN_NOT_RUN', 'The seeded success is a replay, not a field trial.'],
              ['Genuine Sandbox capture', judge.evidence.genuineSandboxCapture, 'A live buyer-approved Sandbox authorization and capture has not been observed on this installation.'],
              ['Genuine PayPal webhook', judge.evidence.webhookDelivery, 'No authentic signed Sandbox webhook is recorded.'],
              ['Buyer comprehension', judge.evidence.buyerComprehension, 'No external participant study has been run.'],
              ['Independent proof verifier', 'OBSERVED', 'The signed Ambient proof is recomputed from the exact terms and interval ledger. Tamper tests are in the repository.'],
              ['Previous 6.0 evidence', 'PRESERVED', 'The 6.0 physical promise proof format and its historical records remain intact.'],
            ].map(([label, status, detail]) => (
              <div className="ambient-gate" key={label}>
                <div className="row row--between"><strong>{label}</strong><span className={`chip ${gateTone(status)}`}>{status.replaceAll('_', ' ')}</span></div>
                <p className="tiny muted">{detail}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="ambient-judge-bottom">
          <div>
            <span className="eyebrow">What the demo does prove</span>
            <h2 className="h2">A deterministic, inspectable difference.</h2>
            <p className="small muted">
              The interrupted ledger cannot reach the required continuous non-detection interval. The qualified ledger
              can. Both are replayed through the same evaluator and independently verified from the signed proof. The
              model never gets to decide whether money moves; it only classifies intervals.
            </p>
          </div>
          <div>
            <span className="eyebrow">What it does not prove</span>
            <h2 className="h2">That a fan was actually off.</h2>
            <p className="small muted">
              The reference model is synthetic. The browser can be muted, spoofed, or fooled by playback. The seeded
              buyer acceptance and payment are demo records. No physical trial, live Sandbox capture, genuine webhook,
              public deployment, or Devpost submission is claimed.
            </p>
          </div>
        </section>

        <Notice tone="warn" title="This is a vertical slice, not a field result.">
          {judge.limitations.join(' ')}
        </Notice>

        <div className="row row--between">
          <span className="tiny muted">Model provenance: {judge.seed.provenance ?? 'unknown'} · generated {dateTime(judge.generatedAt)}</span>
          <LinkButton to="/ambient" variant="ghost">Back to Ambient</LinkButton>
        </div>
      </div>
      </div>
    </AmbientFrame>
  );
}
