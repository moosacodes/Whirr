import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { AmbientAgreementView } from '../../../../packages/contracts/src/types.ts';
import { api, errorMessage } from '../lib/api.ts';
import { EmptyState, LinkButton, Loading, Notice, PageHeader, usePageTitle } from '../components/ui.tsx';
import { money } from '../lib/format.ts';

export function AmbientOperator() {
  const [agreements, setAgreements] = useState<AmbientAgreementView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  usePageTitle('Ambient provider desk');

  useEffect(() => {
    api<{ agreements: AmbientAgreementView[] }>('/api/operator/ambient/agreements')
      .then((value) => setAgreements(value.agreements))
      .catch((err) => setError(errorMessage(err)));
  }, []);

  return (
    <div className="page ambient-page">
      <div className="container stack stack--lg">
        <PageHeader
          eyebrow="Provider desk · Ambient"
          title="Requests for a change in your world."
          lede="Review the exact source, duration, sensing rule, compensation and failure behavior. A provider decision is voluntary; no request authorizes a microphone by itself."
          actions={<LinkButton to="/studio" variant="secondary">Studio</LinkButton>}
        />
        {error ? <Notice tone="danger">{error}</Notice> : null}
        {!agreements ? (
          <Loading label="Loading provider requests…" />
        ) : agreements.length === 0 ? (
          <EmptyState title="No Ambient requests yet" action={<LinkButton to="/ambient/wish">Open the buyer Wish</LinkButton>}>
            Offers addressed to the operator account will appear here with their exact terms hash.
          </EmptyState>
        ) : (
          <div className="stack">
            {agreements.map((agreement) => (
              <Link className="card card--link exchange-list-row" key={agreement.id} to={`/ambient/exchange/${agreement.id}`}>
                <div>
                  <span className="eyebrow">{agreement.status} · {agreement.target.objectName}</span>
                  <h2 className="h3">{agreement.serviceName}</h2>
                  <p className="small muted">{agreement.interpretation.observableCondition}</p>
                </div>
                <div className="exchange-list-row__facts">
                  <strong>{money(agreement.financial.fixedPriceMinor, agreement.financial.currency)}</strong>
                  <span>{agreement.flags.awaitingProvider ? 'needs your decision' : agreement.flags.awaitingBuyer ? 'waiting for buyer' : 'terms settled'}</span>
                  <span className="mono tiny">{agreement.termsHash.slice(0, 14)}…</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
