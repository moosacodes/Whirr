import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, errorMessage } from '../lib/api.ts';
import type { SessionView } from '../../../../packages/contracts/src/types.ts';
import {
  Loading,
  Notice,
  PageHeader,
  usePageTitle,
} from '../components/ui.tsx';
import { Button, LinkButton } from '../components/ui.tsx';
import { Timeline, TimelineLegend } from '../components/visuals.tsx';
import { duration } from '../lib/format.ts';

/**
 * Interval-only replay. It never opens the microphone and never plays audio:
 * it walks the already-recorded state intervals, so nothing here is presented
 * as a new sensing session.
 */
export function Replay() {
  const { id = '' } = useParams();
  const [view, setView] = useState<SessionView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(4);
  const [position, setPosition] = useState(0);
  const [run, setRun] = useState(0);
  usePageTitle('Interval replay');

  useEffect(() => {
    api<SessionView>(`/api/sessions/${id}`)
      .then((next) => {
        setView(next);
        setError(null);
      })
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, [id]);

  const total = useMemo(() => {
    if (!view) return 0;
    return Math.max(
      1000,
      view.meterClockMs,
      ...view.intervals.map((interval) => interval.endMs),
    );
  }, [view]);

  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    let previous = performance.now();
    const tick = (now: number) => {
      const delta = (now - previous) * speed;
      previous = now;
      setPosition((current) => {
        const next = current + delta;
        if (next >= total) {
          setPlaying(false);
          return total;
        }
        return next;
      });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, speed, total]);

  useEffect(() => {
    setPosition(0);
    setPlaying(false);
  }, [run]);

  if (loading) return <Loading label="Loading recorded intervals…" />;
  if (!view) return <div className="page container page--narrow"><Notice tone="danger">{error ?? 'Session not found.'}</Notice></div>;

  const active = [...view.intervals]
    .filter((interval) => interval.startMs <= position)
    .sort((left, right) => left.endMs - right.endMs)
    .at(-1);
  const currentState = active?.state ?? 'DISCONNECTED';

  return (
    <div className="page container page--wide">
      <PageHeader
        eyebrow="Evidence replay · no audio"
        breadcrumbs={
          <>
            <Link to={`/session/${id}`}>{view.objectName}</Link> <span aria-hidden="true">/</span>{' '}
            <span>replay</span>
          </>
        }
        title="Interval-only replay"
        lede="This page walks the signed state intervals already recorded for this session. The microphone is closed, no audio is stored or played, and this replay is not a new measurement."
        actions={
          <div className="row">
            <span className="chip chip--warn">REPLAY · NOT LIVE</span>
            <LinkButton to={`/receipt/${id}`} variant="secondary">Open receipt</LinkButton>
          </div>
        }
      />

      <div className="stack">
        <Notice tone="info" title="Replay of recorded evidence">
          Replayed states are the server-accepted intervals, not a re-analysis. Amounts are not recalculated here. The
          authoritative bill remains the reviewed receipt.
        </Notice>

        <section className="meter">
          <div className="row row--between">
            <span className="eyebrow">Playhead</span>
            <span className="chip">{currentState.replaceAll('_', ' ').toLowerCase()}</span>
          </div>
          <h2 className="meter__word" style={{ fontSize: 'clamp(2.2rem,5vw,4rem)' }}>
            {duration(position)}
          </h2>
          <p className="meter__detail">
            of {duration(total)} recorded timeline · {view.intervals.length} intervals · replay speed {speed}×
          </p>

          <div className="cap-bar" style={{ marginTop: '1rem' }}>
            <div
              className="cap-bar__track"
              role="progressbar"
              aria-label="Replay position"
              aria-valuemin={0}
              aria-valuemax={total}
              aria-valuenow={Math.round(position)}
            >
              <div className="cap-bar__fill" style={{ width: `${Math.min(100, (position / total) * 100)}%` }} />
            </div>
            <div className="cap-bar__labels">
              <span>{((position / total) * 100).toFixed(1)}%</span>
              <span>{active ? `${duration(active.endMs - active.startMs)} interval` : 'no active interval'}</span>
            </div>
          </div>

          <div className="timeline-card" style={{ marginTop: '1rem' }}>
            <Timeline
              intervals={view.intervals}
              totalMs={total}
              height={48}
              label="Recorded interval-only state timeline; no audio is replayed"
            />
            <div style={{ marginTop: 8 }}><TimelineLegend /></div>
          </div>

          <div className="row" style={{ marginTop: '1rem', flexWrap: 'wrap' }}>
            <Button onClick={() => setPlaying((value) => !value)} variant="primary">
              {playing ? 'Pause replay' : position >= total ? 'Replay again' : 'Play intervals'}
            </Button>
            <Button onClick={() => setRun((value) => value + 1)} variant="secondary">Reset</Button>
            {[1, 4, 16].map((value) => (
              <Button
                key={value}
                onClick={() => setSpeed(value)}
                variant={speed === value ? 'primary' : 'ghost'}
                size="sm"
              >
                {value}×
              </Button>
            ))}
          </div>
        </section>

        <section className="card stack">
          <div className="row row--between">
            <h2 className="h3">Interval under the playhead</h2>
            <span className="chip">{view.intervals.length} total</span>
          </div>
          {active ? (
            <dl className="kv">
              <dt>Window</dt>
              <dd className="mono">{duration(active.startMs)} – {duration(active.endMs)}</dd>
              <dt>State</dt>
              <dd>{active.state.replaceAll('_', ' ').toLowerCase()}</dd>
              <dt>Confidence</dt>
              <dd className="mono">{(active.confidence * 100).toFixed(1)}%</dd>
              <dt>Quality flags</dt>
              <dd>{active.qualityFlags.length ? active.qualityFlags.join(', ') : 'none'}</dd>
              <dt>Explanation</dt>
              <dd>{active.explanation?.summary ?? 'No explanation recorded for this interval.'}</dd>
            </dl>
          ) : (
            <p className="small muted" style={{ margin: 0 }}>Press play or move the replay position to inspect an interval.</p>
          )}
        </section>
      </div>
    </div>
  );
}
