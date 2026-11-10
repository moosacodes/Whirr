import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, errorMessage } from '../lib/api.ts';
import type { EventModelDetailView } from '../../../../packages/contracts/src/types.ts';
import { Loading, Notice, PageHeader, usePageTitle } from '../components/ui.tsx';
import { percent } from '../lib/format.ts';

export function PromiseModel() {
  const { agreementId = '' } = useParams();
  const [model, setModel] = useState<EventModelDetailView | null>(null);
  const [error, setError] = useState<string | null>(null);
  usePageTitle('Promise model card');

  useEffect(() => {
    api<EventModelDetailView>(`/api/promises/${agreementId}/model`)
      .then(setModel)
      .catch((err) => setError(errorMessage(err)));
  }, [agreementId]);

  if (!model) {
    return <div className="page"><div className="container">{error ? <Notice tone="danger">{error}</Notice> : <Loading label="Loading model card…" />}</div></div>;
  }

  return (
    <div className="page promise-page">
      <div className="container stack stack--lg">
        <PageHeader
          eyebrow="Model card"
          title={model.version}
          lede="The event model recognizes only the acoustic classes it was taught. Completion is a temporal contract decision, not an acoustic completion claim."
          breadcrumbs={<><Link to={`/promise/${agreementId}`}>Agreement</Link> <span aria-hidden="true">/</span> Model</>}
          actions={<span className={`chip chip--${model.status === 'READY' ? 'ok' : 'warn'}`}>{model.status}</span>}
        />
        <div className="promise-layout">
          <section className="card stack">
            <span className="eyebrow">Validation</span>
            <div className="promise-metrics promise-metrics--dark">
              <div><span className="mono">{percent(model.metrics.macroRecall)}</span><span className="tiny muted">macro recall</span></div>
              <div><span className="mono">{percent(model.metrics.frameAccuracy)}</span><span className="tiny muted">frame accuracy</span></div>
              <div><span className="mono">{percent(model.metrics.unknownRate)}</span><span className="tiny muted">unknown refusal</span></div>
            </div>
            <div className="confusion">
              <div className="confusion__row confusion__row--head">
                <span />
                {model.metrics.confusionLabels.map((label) => <span key={label}>{label}</span>)}
              </div>
              {model.metrics.confusion.map((row, index) => (
                <div className="confusion__row" key={model.metrics.confusionLabels[index]}>
                  <span>{model.metrics.confusionLabels[index]}</span>
                  {row.map((value, cell) => <span key={cell}>{value}</span>)}
                </div>
              ))}
            </div>
            <p className="small muted">
              Leave-one-take-out validation. Frames from a held-out recording never enter training. A small dataset
              supports exploratory evidence, not a guarantee of field reliability.
            </p>
          </section>
          <aside className="stack">
            <section className="card stack">
              <span className="eyebrow">Binding</span>
              <div className="run-terms">
                <div><span>Model id</span><strong className="mono">{model.id}</strong></div>
                <div><span>Takes</span><strong>{model.takeCount}</strong></div>
                <div><span>Groups</span><strong>{model.groupCount}</strong></div>
                <div><span>Frames</span><strong>{model.frameCount}</strong></div>
                <div><span>Provenance</span><strong>{model.provenance}</strong></div>
              </div>
            </section>
            <section className="card stack">
              <span className="eyebrow">Limitations</span>
              <ul className="promise-rules promise-rules--warn">
                {model.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}
              </ul>
            </section>
          </aside>
        </div>
        <section className="card stack">
          <span className="eyebrow">Artifact</span>
          <pre className="proof-json proof-json--tall">{JSON.stringify(model.artifact, null, 2)}</pre>
        </section>
      </div>
    </div>
  );
}
