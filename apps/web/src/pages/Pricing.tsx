import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, errorMessage } from '../lib/api.ts';
import type { OwnerObjectView, PriceTerms } from '../../../../packages/contracts/src/types.ts';
import {
  decimalStringToMinor,
  formatMinor,
  minorToDecimalString,
  SUPPORTED_CURRENCIES,
  type Currency,
} from '../../../../packages/meter/src/currency.ts';
import { quoteBreakdown } from '../../../../packages/meter/src/pricing.ts';
import {
  Button,
  Check,
  Field,
  LinkButton,
  Loading,
  Notice,
  PageHeader,
  Select,
  TextInput,
  usePageTitle,
} from '../components/ui.tsx';
import { Icon, ObjectGlyph } from '../components/visuals.tsx';
import { money } from '../lib/format.ts';

export function Pricing() {
  const { objectId = '' } = useParams();
  const [view, setView] = useState<OwnerObjectView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currency, setCurrency] = useState<Currency>('USD');
  const [rate, setRate] = useState('0.20');
  const [cap, setCap] = useState('5.00');
  const [reserve, setReserve] = useState('0.00');
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [published, setPublished] = useState<(PriceTerms & { id: string; hash: string }) | null>(null);

  const load = useCallback(async () => {
    try {
      const owner = await api<OwnerObjectView>(`/api/operator/objects/${objectId}`);
      setView(owner);
      if (owner.terms) {
        setCurrency(owner.terms.currency);
        setRate(minorToDecimalString(owner.terms.minorPerMinute, owner.terms.currency));
        setCap(minorToDecimalString(owner.terms.capMinor, owner.terms.currency));
        setReserve(minorToDecimalString(owner.terms.fairnessReserveMinor ?? 0, owner.terms.currency));
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [objectId]);

  useEffect(() => {
    void load();
  }, [load]);

  usePageTitle(view ? `${view.object.name} pricing` : 'Pricing');

  const rateMinor = useMemo(() => decimalStringToMinor(rate, currency), [rate, currency]);
  const capMinor = useMemo(() => decimalStringToMinor(cap, currency), [cap, currency]);
  const reserveMinor = useMemo(() => decimalStringToMinor(reserve, currency), [reserve, currency]);

  const validation = useMemo(() => {
    if (rateMinor === null || rateMinor < 1) return 'Enter a rate with up to the currency’s decimal places.';
    if (capMinor === null || capMinor < 1) return 'Enter a valid cap.';
    if (capMinor < rateMinor) return 'The cap must be at least the price of one billable minute.';
    if (reserveMinor === null || reserveMinor < 0) return 'Enter a valid fairness reserve.';
    if (capMinor !== null && reserveMinor > Math.floor(capMinor * 0.1)) {
      return 'The fairness reserve may not exceed 10% of the cap.';
    }
    return null;
  }, [rateMinor, capMinor, reserveMinor]);

  const examples = useMemo(() => {
    if (rateMinor === null || capMinor === null || validation) return null;
    return {
      fifteen: quoteBreakdown(rateMinor, 15_000, capMinor, 0, currency),
      minute: quoteBreakdown(rateMinor, 60_000, capMinor, 0, currency),
      five: quoteBreakdown(rateMinor, 300_000, capMinor, 0, currency),
      cap: quoteBreakdown(rateMinor, 60 * 60_000, capMinor, 0, currency),
    };
  }, [rateMinor, capMinor, currency, validation]);

  const publish = async (event: FormEvent) => {
    event.preventDefault();
    if (rateMinor === null || capMinor === null || reserveMinor === null || validation) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ terms: PriceTerms & { id: string; hash: string }; object: OwnerObjectView }>(
        `/api/operator/objects/${objectId}/terms`,
        {
          method: 'PUT',
          body: {
            currency,
            minorPerMinute: rateMinor,
            capMinor,
            fairnessReserveMinor: reserveMinor,
            acknowledgeSandbox: ack,
          },
        },
      );
      setPublished(result.terms);
      setView(result.object);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Loading label="Loading pricing…" />;
  if (!view) {
    return (
      <div className="page container page--narrow">
        <Notice tone="danger">{error ?? 'Object not found.'}</Notice>
      </div>
    );
  }

  const model = view.activeModel;
  const blocked = !model || model.status === 'REJECTED';

  return (
    <div className="page container page--wide">
      <PageHeader
        eyebrow="Plain terms"
        breadcrumbs={
          <>
            <Link to="/studio">Studio</Link> <span aria-hidden="true">/</span>{' '}
            <Link to={`/studio/objects/${objectId}`}>{view.object.name}</Link> <span aria-hidden="true">/</span>{' '}
            <span>Pricing</span>
          </>
        }
        title={
          <span className="row" style={{ gap: '0.8rem' }}>
            <ObjectGlyph glyph={view.object.glyph} size={54} tone="accent" /> Price {view.object.name}
          </span>
        }
        lede="A rate per billable minute, one hard cap, no extra fees, and a single rounding operation at the end. The renter sees exactly this arithmetic before consenting."
        actions={
          model ? (
            <LinkButton to={`/studio/objects/${objectId}/model`} variant="secondary">
              Model evidence
            </LinkButton>
          ) : null
        }
      />

      {error ? (
        <div style={{ marginBottom: '1rem' }}>
          <Notice tone="danger">{error}</Notice>
        </div>
      ) : null}

      {blocked ? (
        <div style={{ marginBottom: '1.5rem' }}>
          <Notice tone="danger" title="Pricing is locked.">
            {!model
              ? 'No active model exists. Train a model before publishing terms.'
              : 'The active model was rejected by the precision gate, so its terms cannot be published. Record better takes and retrain.'}{' '}
            <Link className="link" to={`/studio/objects/${objectId}`}>
              Open capture lab
            </Link>
          </Notice>
        </div>
      ) : null}

      <div className="sidebar-layout">
        <form className="card stack" onSubmit={publish}>
          <div className="row row--between">
            <h2 className="h3">New terms version</h2>
            <span className="chip">
              model {model?.status} · {model ? Math.round(model.metrics.precision * 100) : '—'}% precision
            </span>
          </div>

          <div className="inline-fields">
            <Field label="Currency" htmlFor="currency">
              <Select id="currency" value={currency} onChange={(event) => setCurrency(event.target.value as Currency)}>
                {SUPPORTED_CURRENCIES.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label={`Rate per billable minute (${currency})`}
              htmlFor="rate"
              hint="Stored as an integer in minor units; decimals are parsed exactly, never as floats."
              error={rateMinor === null ? 'Invalid amount.' : null}
            >
              <TextInput
                id="rate"
                inputMode="decimal"
                value={rate}
                onChange={(event) => setRate(event.target.value)}
                placeholder="0.20"
              />
            </Field>
          </div>

          <Field
            label={`Hard cap (${currency})`}
            htmlFor="cap"
            hint="No capture can ever exceed this amount. The cap is the amount authorized in PayPal."
            error={capMinor === null ? 'Invalid amount.' : validation}
          >
            <TextInput id="cap" inputMode="decimal" value={cap} onChange={(event) => setCap(event.target.value)} placeholder="5.00" />
          </Field>

          <Field
            label={`Fairness reserve (${currency}) — optional`}
            htmlFor="reserve"
            hint="Pre-committed courtesy credit, maximum 10% of the cap. A renter may apply it once before review, with no interrogation."
            error={reserveMinor === null ? 'Invalid amount.' : null}
          >
            <TextInput id="reserve" inputMode="decimal" value={reserve} onChange={(event) => setReserve(event.target.value)} placeholder="0.00" />
          </Field>

          <div className="panel panel--accent stack" style={{ gap: '0.5rem' }}>
            <strong className="small">What a renter would see</strong>
            {examples && rateMinor !== null && capMinor !== null ? (
              <div className="table-wrap">
                <table className="table" style={{ minWidth: 0 }}>
                  <thead>
                    <tr>
                      <th>Billable time</th>
                      <th>Before cap</th>
                      <th>Charge</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>15 seconds</td>
                      <td className="mono">{formatMinor(examples.fifteen.roundedMinor, currency)}</td>
                      <td className="mono">{formatMinor(examples.fifteen.finalMinor, currency)}</td>
                    </tr>
                    <tr>
                      <td>1 minute</td>
                      <td className="mono">{formatMinor(examples.minute.roundedMinor, currency)}</td>
                      <td className="mono">{formatMinor(examples.minute.finalMinor, currency)}</td>
                    </tr>
                    <tr>
                      <td>5 minutes</td>
                      <td className="mono">{formatMinor(examples.five.roundedMinor, currency)}</td>
                      <td className="mono">{formatMinor(examples.five.finalMinor, currency)}</td>
                    </tr>
                    <tr>
                      <td>1 hour (cap applies)</td>
                      <td className="mono">{formatMinor(examples.cap.roundedMinor, currency)}</td>
                      <td className="mono">{formatMinor(examples.cap.finalMinor, currency)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            ) : (
              <span className="small muted">Fix the amounts to see examples.</span>
            )}
            <code className="mono tiny break">
              {examples?.minute.formula ?? 'round_half_up(rate × billable_ms / 60000), then min(cap)'}
            </code>
          </div>

          <div className="panel stack" style={{ gap: '0.5rem' }}>
            <strong className="small">Non-negotiable policy baked into every version</strong>
            <ul className="checklist small">
              <li>
                <Icon name="check" size={15} /> <span><strong>UNCERTAIN</strong> and <strong>IDLE</strong> time are never billed.</span>
              </li>
              <li>
                <Icon name="check" size={15} /> Rounding happens exactly once at session end.
              </li>
              <li>
                <Icon name="check" size={15} /> Credits can reduce a bill; no additional charge is ever added after consent.
              </li>
              <li>
                <Icon name="check" size={15} /> Capture is capped at the authorized amount and reviewed before settlement.
              </li>
            </ul>
          </div>

          {model?.status === 'LIMITED' ? (
            <Notice tone="warn" title="LIMITED model.">
              The model passed the limited-use gate but not automatic billing. Each session will require operator
              approval before capture. The policy is recorded in the terms and shown to the renter.
            </Notice>
          ) : null}

          <Check checked={ack} onChange={setAck} disabled={blocked}>
            I understand this is a <strong>PayPal Sandbox</strong> prototype: amounts are simulated, no real money can
            move, and the cap is the maximum authorized amount.
          </Check>

          <div className="row row--between">
            <span className="tiny muted">Publishing creates an immutable terms version with a SHA-256 hash.</span>
            <Button type="submit" loading={busy} disabled={blocked || !ack || Boolean(validation)}>
              Publish terms
            </Button>
          </div>
        </form>

        <aside className="stack">
          {view.terms ? (
            <section className="card stack">
              <div className="row row--between">
                <h2 className="h3">Current terms</h2>
                <span className="chip chip--ok">v{view.terms.version}</span>
              </div>
              <dl className="kv">
                <dt>Rate</dt>
                <dd>{money(view.terms.minorPerMinute, view.terms.currency)} / min</dd>
                <dt>Cap</dt>
                <dd>{money(view.terms.capMinor, view.terms.currency)}</dd>
                <dt>Fairness reserve</dt>
                <dd>{money(view.terms.fairnessReserveMinor ?? 0, view.terms.currency)}</dd>
                <dt>Rounding</dt>
                <dd>once at end</dd>
                <dt>Uncertain</dt>
                <dd>excluded</dd>
                <dt>Review</dt>
                <dd>{view.terms.billingPolicy === 'AUTO' ? 'automatic' : 'operator required'}</dd>
                <dt>Hash</dt>
                <dd className="mono tiny break">{view.terms.hash}</dd>
              </dl>
              <p className="tiny muted">
                Published {new Date(view.terms.createdAt).toLocaleString()}. Existing sessions keep the terms they
                consented to; new sessions use this version.
              </p>
            </section>
          ) : (
            <section className="card card--soft">
              <h2 className="h3">Not published</h2>
              <p className="small muted" style={{ marginTop: 8 }}>
                Once published, the service card becomes shareable and the renter flow is unlocked.
              </p>
            </section>
          )}

          {published ? (
            <section className="card stack" style={{ borderColor: 'rgba(47,107,79,.3)' }}>
              <span className="chip chip--ok">
                <span className="chip__dot" /> Terms v{published.version} live
              </span>
              <p className="small">
                {money(published.minorPerMinute, published.currency)} per billable minute, cap{' '}
                {money(published.capMinor, published.currency)}.
              </p>
              <code className="mono tiny break">{published.hash}</code>
              <LinkButton to={`/studio/objects/${objectId}/card`} variant="primary">
                Open service card <Icon name="arrow" size={16} />
              </LinkButton>
            </section>
          ) : null}

          <section className="card card--soft stack">
            <h2 className="h3">Why this shape?</h2>
            <p className="small muted">
              Time is the only thing the acoustic meter can defend. A cap makes the worst case explicit. Review
              protects against a classifier mistake. No late fees, no overage, no “convenience” charges.
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}
