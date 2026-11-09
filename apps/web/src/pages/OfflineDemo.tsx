import { useEffect, useState } from 'react';
import type { ModelArtifact } from '../../../../packages/audio/src/classifier.ts';
import { assertModelArtifact, predictFrame } from '../../../../packages/audio/src/classifier.ts';
import { MeterStream, type MeterInterval } from '../../../../packages/audio/src/hysteresis.ts';
import { FRAME_MS } from '../../../../packages/audio/src/spec.ts';
import { fetchWav } from '../lib/audio.ts';
import { quoteBreakdown } from '../../../../packages/meter/src/pricing.ts';
import { LinkButton, Notice, usePageTitle } from '../components/ui.tsx';
import { Icon, Timeline, TimelineLegend } from '../components/visuals.tsx';
import { duration, money } from '../lib/format.ts';

interface Result {
  intervals: MeterInterval[];
  billableMs: number;
  durationMs: number;
  model: ModelArtifact;
}

export function OfflineDemo() {
  usePageTitle('Offline replay');
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [modelResponse, recording] = await Promise.all([
          fetch('/models/whirr-reference-fan.json', { credentials: 'same-origin' }),
          fetchWav('/fixtures/fan-cycle.wav'),
        ]);
        if (!modelResponse.ok) throw new Error('Reference model missing. Run npm run setup.');
        const model = (await modelResponse.json()) as unknown;
        assertModelArtifact(model);
        const meter = new MeterStream(model.policy);
        meter.reset(0);
        const intervals: MeterInterval[] = [];
        let billable = 0;
        let last = 0;
        for (const frame of recording.frames) {
          last = frame.endMs;
          const prediction = predictFrame(model, frame.features, frame.flags, Math.max(0, frame.endMs - FRAME_MS), frame.endMs);
          for (const interval of meter.push(prediction)) {
            if (interval.state === 'ACTIVE_CONFIDENT') billable += interval.endMs - interval.startMs;
            intervals.push(interval);
          }
        }
        for (const interval of meter.flush(last)) {
          if (interval.state === 'ACTIVE_CONFIDENT') billable += interval.endMs - interval.startMs;
          intervals.push(interval);
        }
        if (!cancelled) setResult({ intervals, billableMs: billable, durationMs: recording.durationMs, model });
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const quote = result ? quoteBreakdown(20, result.billableMs, 500, 0, 'USD') : null;

  return (
    <div className="page container page--narrow">
      <div className="stack-lg">
        <header className="stack">
          <span className="eyebrow">Offline replay</span>
          <h1 className="display display--sm">No server. No login. Same pipeline.</h1>
          <p className="lede">
            This page loads the bundled synthetic WAV and reference model directly, runs the same feature extractor and
            hysteresis as the live meter, and prints the deterministic result. It is a pipeline demonstration, not field
            evidence.
          </p>
          <span className="chip chip--danger" style={{ alignSelf: 'flex-start' }}>
            <Icon name="alert" size={13} /> synthetic fixture · not a live session
          </span>
        </header>

        {error ? (
          <Notice tone="danger" title="Replay unavailable.">
            {error}
          </Notice>
        ) : busy ? (
          <div className="card">
            <div className="row">
              <span className="spinner" aria-hidden="true" /> Processing the fixture through the frozen pipeline…
            </div>
          </div>
        ) : result && quote ? (
          <>
            <div className="grid-3">
              <div className="stat stat--accent">
                <span className="stat__value">{money(quote.finalMinor, 'USD')}</span>
                <span className="stat__label">simulated bill</span>
              </div>
              <div className="stat">
                <span className="stat__value">{duration(result.billableMs)}</span>
                <span className="stat__label">billable</span>
              </div>
              <div className="stat">
                <span className="stat__value">{duration(result.durationMs)}</span>
                <span className="stat__label">fixture length</span>
              </div>
            </div>

            <section className="card stack">
              <div className="row row--between">
                <h2 className="h3">Reconstructed timeline</h2>
                <span className="chip">{result.intervals.length} intervals</span>
              </div>
              <Timeline intervals={result.intervals} totalMs={result.durationMs} height={54} />
              <TimelineLegend />
              <code className="mono tiny break">{quote.formula}</code>
              <p className="tiny muted">
                Model {result.model.version} · {result.model.provenance} · active threshold{' '}
                {result.model.policy.activeThreshold.toFixed(2)}. The fixture is 5s idle, 15s active, 10s idle, 20s
                active, 5s idle; the classifier decides each 32ms frame, so the measured total may differ from 35s.
              </p>
            </section>

            <div className="row">
              <LinkButton to="/judge" variant="primary">Judge mode</LinkButton>
              <LinkButton to="/" variant="secondary">Back to Whirr</LinkButton>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
