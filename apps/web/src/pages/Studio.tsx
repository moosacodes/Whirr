import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, errorMessage } from '../lib/api.ts';
import { fileToSmallDataUrl } from '../lib/image.ts';
import type { ObjectCategory, ObjectGlyph, ObjectsResponse, OwnerObjectView } from '../../../../packages/contracts/src/types.ts';
import { OBJECT_CATEGORIES, OBJECT_GLYPHS } from '../../../../packages/contracts/src/types.ts';
import {
  Button,
  EmptyState,
  Field,
  Loading,
  Notice,
  PageHeader,
  Select,
  TextArea,
  TextInput,
  usePageTitle,
} from '../components/ui.tsx';
import { Icon, ObjectGlyph as Glyph } from '../components/visuals.tsx';
import { formatMinor } from '../../../../packages/meter/src/currency.ts';

const CATEGORY_LABELS: Record<ObjectCategory, string> = {
  fan: 'Fan',
  hair_dryer: 'Hair dryer',
  toothbrush: 'Electric toothbrush',
  power_tool: 'Power tool',
  kitchen_appliance: 'Kitchen appliance',
  other: 'Other object',
};

const GLYPH_LABELS: Record<ObjectGlyph, string> = {
  fan: 'Fan',
  dryer: 'Dryer',
  brush: 'Brush',
  drill: 'Drill',
  blender: 'Blender',
  lamp: 'Lamp',
  kettle: 'Kettle',
  other: 'Box',
};

function readiness(item: OwnerObjectView): { label: string; tone: 'ok' | 'warn' | 'danger' | ''; detail: string } {
  if (item.object.status === 'REVOKED') return { label: 'Revoked', tone: 'danger', detail: 'No new sessions can start.' };
  if (!item.activeModel) return { label: 'Needs training', tone: 'warn', detail: 'Record takes, then train a model.' };
  if (item.activeModel.status === 'REJECTED')
    return { label: 'Model rejected', tone: 'danger', detail: 'Improve the takes and retrain.' };
  if (item.activeModel.metrics.provenance === 'USER_CALIBRATION' && item.fieldTest.status !== 'FIELD_PASS')
    return {
      label: 'Field test required',
      tone: 'warn',
      detail: 'Complete the Real-World Calibration Lab before publishing or starting a Listening Room session.',
    };
  if (!item.terms) return { label: 'Needs pricing', tone: 'warn', detail: 'Publish plain terms to go live.' };
  return { label: 'Published', tone: 'ok', detail: 'Service card is live.' };
}

export function Studio() {
  usePageTitle('Operator studio');
  const navigate = useNavigate();
  const [data, setData] = useState<ObjectsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const [name, setName] = useState('');
  const [category, setCategory] = useState<ObjectCategory>('fan');
  const [glyph, setGlyph] = useState<ObjectGlyph>('fan');
  const [description, setDescription] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api<ObjectsResponse>('/api/operator/objects'));
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    setCreating(true);
    setError(null);
    try {
      const created = await api<OwnerObjectView>('/api/operator/objects', {
        method: 'POST',
        body: {
          name: name.trim(),
          category,
          glyph,
          description: description.trim(),
          ...(photo ? { photoDataUrl: photo } : {}),
        },
      });
      navigate(`/studio/objects/${created.object.id}`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setCreating(false);
    }
  };

  if (loading) return <Loading label="Loading your studio…" />;

  return (
    <div className="page container page--wide">
      <PageHeader
        eyebrow="Operator studio"
        title="Objects, taught by ear."
        lede="Every object here is metered by sound alone. Train on a few takes, publish terms, and share one link. The reference fan is synthetic and labelled as such."
        actions={
          <Button onClick={() => setShowCreate((value) => !value)} variant={showCreate ? 'secondary' : 'primary'}>
            <Icon name={showCreate ? 'pause' : 'arrow'} size={16} />
            {showCreate ? 'Close new object' : 'New object'}
          </Button>
        }
      />

      {error ? (
        <div style={{ marginBottom: '1rem' }}>
          <Notice tone="danger">{error}</Notice>
        </div>
      ) : null}

      {showCreate ? (
        <form className="card stack" onSubmit={create} style={{ marginBottom: '2rem' }}>
          <div className="row row--between">
            <h2 className="h3">Teach a new object</h2>
            <span className="tiny muted">Audio is recorded later, in the capture lab.</span>
          </div>
          <div className="grid-2">
            <Field label="Object name" htmlFor="object-name" hint="What a renter will see.">
              <TextInput
                id="object-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Desk fan № 2"
                minLength={2}
                maxLength={60}
                required
              />
            </Field>
            <Field label="Category" htmlFor="object-category">
              <Select
                id="object-category"
                value={category}
                onChange={(event) => setCategory(event.target.value as ObjectCategory)}
              >
                {OBJECT_CATEGORIES.map((value) => (
                  <option key={value} value={value}>
                    {CATEGORY_LABELS[value]}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="Description" htmlFor="object-description" hint="Optional, 280 characters.">
            <TextArea
              id="object-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={280}
              placeholder="A quiet three-speed desk fan. Runs on the honor system, metered by sound."
            />
          </Field>
          <div className="grid-2">
            <Field label="Glyph" hint="Used on the service card and receipt.">
              <div className="row" style={{ gap: '0.4rem' }}>
                {OBJECT_GLYPHS.map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setGlyph(value)}
                    aria-label={GLYPH_LABELS[value]}
                    aria-pressed={glyph === value}
                    style={{
                      border: glyph === value ? '2px solid var(--accent)' : '1px solid var(--line)',
                      borderRadius: 12,
                      background: 'var(--surface)',
                      padding: 3,
                      cursor: 'pointer',
                    }}
                  >
                    <Glyph glyph={value} size={44} label={GLYPH_LABELS[value]} />
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Optional photo" hint="Resized locally to a small JPEG; never used for sensing.">
              <input
                className="input"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  if (!file) {
                    setPhoto(null);
                    return;
                  }
                  setPhotoBusy(true);
                  try {
                    setPhoto(await fileToSmallDataUrl(file));
                    setError(null);
                  } catch (err) {
                    setError(errorMessage(err));
                    setPhoto(null);
                  } finally {
                    setPhotoBusy(false);
                  }
                }}
              />
              {photo ? (
                <div className="row" style={{ marginTop: 8 }}>
                  <img src={photo} alt="Object preview" style={{ width: 54, height: 54, objectFit: 'cover', borderRadius: 8 }} />
                  <Button type="button" variant="ghost" size="sm" onClick={() => setPhoto(null)}>
                    Remove
                  </Button>
                </div>
              ) : photoBusy ? (
                <span className="tiny muted">Resizing…</span>
              ) : null}
            </Field>
          </div>
          <div className="row row--between">
            <span className="tiny muted">Training and sensing happen entirely on this machine.</span>
            <Button type="submit" loading={creating} disabled={name.trim().length < 2}>
              Create object
            </Button>
          </div>
        </form>
      ) : null}

      {data && data.objects.length === 0 ? (
        <EmptyState
          title="No objects yet"
          action={
            <Button onClick={() => setShowCreate(true)}>
              Create your first object <Icon name="arrow" size={16} />
            </Button>
          }
        >
          Start with a fan, a hair dryer or anything that makes a distinct noise when it runs. The seeded reference
          fan appears after <span className="mono">npm run setup</span>.
        </EmptyState>
      ) : null}

      <div className="grid-2">
        {data?.objects.map((item) => {
          const state = readiness(item);
          return (
            <article key={item.object.id} className="card">
              <div className="row row--between" style={{ alignItems: 'flex-start' }}>
                <div className="row" style={{ alignItems: 'flex-start' }}>
                  {item.object.photoDataUrl ? (
                    <img
                      src={item.object.photoDataUrl}
                      alt=""
                      style={{ width: 58, height: 58, borderRadius: 14, objectFit: 'cover' }}
                    />
                  ) : (
                    <Glyph glyph={item.object.glyph} size={58} tone="accent" />
                  )}
                  <div className="stack" style={{ gap: '0.25rem' }}>
                    <h2 className="h3">{item.object.name}</h2>
                    <span className="tiny muted">
                      {CATEGORY_LABELS[item.object.category as ObjectCategory] ?? item.object.category} ·{' '}
                      {item.takes.length} take{item.takes.length === 1 ? '' : 's'}
                    </span>
                  </div>
                </div>
                <span className={`chip${state.tone ? ` chip--${state.tone}` : ''}`}>
                  <span className="chip__dot" aria-hidden="true" />
                  {state.label}
                </span>
              </div>

              <div className="grid-2" style={{ marginTop: '1.1rem', gap: '0.7rem' }}>
                <div className="panel">
                  <span className="stat__label">Model</span>
                  <div className="small" style={{ marginTop: 4 }}>
                    {item.activeModel ? (
                      <>
                        <strong>{item.activeModel.status}</strong> · {Math.round(item.activeModel.metrics.precision * 100)}% precision
                        <div className="tiny muted">{item.activeModel.version} · {item.activeModel.metrics.provenance === 'SYNTHETIC_REFERENCE' ? 'synthetic reference' : 'your calibration'}</div>
                      </>
                    ) : (
                      <span className="muted">Not trained</span>
                    )}
                  </div>
                </div>
                <div className="panel">
                  <span className="stat__label">Terms</span>
                  <div className="small" style={{ marginTop: 4 }}>
                    {item.terms ? (
                      <>
                        <strong>{formatMinor(item.terms.minorPerMinute, item.terms.currency)}</strong>/min
                        <div className="tiny muted">Cap {formatMinor(item.terms.capMinor, item.terms.currency)}</div>
                      </>
                    ) : (
                      <span className="muted">Not published</span>
                    )}
                  </div>
                </div>
              </div>

              <p className="tiny muted" style={{ marginTop: '0.8rem' }}>
                {state.detail}
                {item.activeSessions > 0 ? ` ${item.activeSessions} session(s) currently open.` : ''}
              </p>

              <div className="row" style={{ marginTop: '1rem' }}>
                <Link className="btn btn--primary btn--sm" to={`/studio/objects/${item.object.id}`}>
                  Capture lab
                </Link>
                <Link className="btn btn--secondary btn--sm" to={`/studio/objects/${item.object.id}/model`}>
                  Model
                </Link>
                <Link className="btn btn--secondary btn--sm" to={`/studio/objects/${item.object.id}/calibration-lab`}>
                  Field lab
                </Link>
                <Link className="btn btn--secondary btn--sm" to={`/studio/objects/${item.object.id}/pricing`}>
                  Pricing
                </Link>
                {item.terms ? (
                  <Link className="btn btn--ghost btn--sm" to={`/studio/objects/${item.object.id}/card`}>
                    Service card
                  </Link>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>

      {data && data.objects.length > 0 ? (
        <div className="card card--soft" style={{ marginTop: '2rem' }}>
          <div className="row row--between">
            <div className="stack" style={{ gap: '0.25rem' }}>
              <h2 className="h3">Demo loop</h2>
              <p className="small muted">
                Open a published card in a second window to consent, authorize up to the cap and meter a session.
              </p>
            </div>
            {data.paypal.configured ? (
              <span className="chip chip--ok">
                <span className="chip__dot" /> PayPal Sandbox ready
              </span>
            ) : (
              <span className="chip chip--warn">
                <span className="chip__dot" /> Demo metering — no PayPal credentials
              </span>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
