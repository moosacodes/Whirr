import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { METER_COPY } from '../lib/format.ts';
import type { MeterState } from '../../../../packages/meter/src/intervals.ts';
import type { Soundprint } from '../../../../packages/audio/src/soundprint.ts';

type IconName =
  | 'arrow'
  | 'mic'
  | 'shield'
  | 'check'
  | 'alert'
  | 'info'
  | 'copy'
  | 'play'
  | 'stop'
  | 'pause'
  | 'wave'
  | 'lock'
  | 'clock'
  | 'money'
  | 'download'
  | 'external'
  | 'qr';

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.7 as const,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };
  switch (name) {
    case 'arrow':
      return (
        <svg {...common}>
          <path d="M5 12h14M13 6l6 6-6 6" />
        </svg>
      );
    case 'mic':
      return (
        <svg {...common}>
          <rect x="9" y="3" width="6" height="11" rx="3" />
          <path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6" />
        </svg>
      );
    case 'shield':
      return (
        <svg {...common}>
          <path d="M12 3l7 3v6c0 4.5-3 7.6-7 9-4-1.4-7-4.5-7-9V6z" />
          <path d="M9 12l2 2 4-4" />
        </svg>
      );
    case 'check':
      return (
        <svg {...common}>
          <path d="M4 12.5l5 5L20 6.5" />
        </svg>
      );
    case 'alert':
      return (
        <svg {...common}>
          <path d="M12 4l9 16H3z" />
          <path d="M12 10v4M12 17.2v.1" />
        </svg>
      );
    case 'info':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 11v5M12 8v.1" />
        </svg>
      );
    case 'copy':
      return (
        <svg {...common}>
          <rect x="9" y="9" width="11" height="11" rx="2" />
          <path d="M15 5H6a2 2 0 0 0-2 2v9" />
        </svg>
      );
    case 'play':
      return (
        <svg {...common}>
          <path d="M8 5l11 7-11 7z" />
        </svg>
      );
    case 'stop':
      return (
        <svg {...common}>
          <rect x="6" y="6" width="12" height="12" rx="1.5" />
        </svg>
      );
    case 'pause':
      return (
        <svg {...common}>
          <path d="M9 5v14M15 5v14" />
        </svg>
      );
    case 'wave':
      return (
        <svg {...common}>
          <path d="M3 12h2M7 8v8M11 4v16M15 7v10M19 10v4M21 12h-1" />
        </svg>
      );
    case 'lock':
      return (
        <svg {...common}>
          <rect x="5" y="10" width="14" height="10" rx="2" />
          <path d="M8 10V7a4 4 0 0 1 8 0v3" />
        </svg>
      );
    case 'clock':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
      );
    case 'money':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v10M15 9.5c-.5-1-1.5-1.5-3-1.5-2 0-3 .9-3 2.2 0 3 6 1.5 6 4.4 0 1.3-1.1 2.2-3 2.2-1.5 0-2.5-.5-3-1.5" />
        </svg>
      );
    case 'download':
      return (
        <svg {...common}>
          <path d="M12 4v11M7 11l5 5 5-5M5 20h14" />
        </svg>
      );
    case 'external':
      return (
        <svg {...common}>
          <path d="M14 4h6v6M20 4l-9 9M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" />
        </svg>
      );
    case 'qr':
      return (
        <svg {...common}>
          <rect x="4" y="4" width="6" height="6" />
          <rect x="14" y="4" width="6" height="6" />
          <rect x="4" y="14" width="6" height="6" />
          <path d="M14 14h2v2h-2zM18 18h2v2h-2zM14 20h2M20 14h.1" />
        </svg>
      );
    default:
      return null;
  }
}

export type ObjectGlyphName =
  | 'fan'
  | 'dryer'
  | 'brush'
  | 'drill'
  | 'blender'
  | 'lamp'
  | 'kettle'
  | 'other';

const GLYPH_PATHS: Record<ObjectGlyphName, React.ReactNode> = {
  fan: (
    <>
      <circle cx="32" cy="28" r="6" />
      <path d="M32 22c0-8 4-13 10-13 5 0 7 5 4 10-2 4-5 6-9 7" />
      <path d="M37 31c7-3 14-1 15 5 1 5-3 8-8 7-4-1-6-4-7-8" />
      <path d="M30 34c3 7 2 14-4 16-5 2-9-2-8-7 1-4 4-7 8-8" />
      <path d="M32 44v8M24 56h16" />
    </>
  ),
  dryer: (
    <>
      <path d="M12 22h28a10 10 0 0 1 10 10v3a10 10 0 0 1-10 10H12z" />
      <path d="M50 26l8-3v18l-8-3" />
      <path d="M20 45v10h12V45" />
      <path d="M16 30h20M16 35h12" />
    </>
  ),
  brush: (
    <>
      <path d="M12 52l28-28 10 10-28 28z" />
      <path d="M40 24l10 10" />
      <path d="M12 52l-3 10 10-3" />
      <path d="M26 38l4 4" />
    </>
  ),
  drill: (
    <>
      <rect x="10" y="20" width="26" height="16" rx="6" />
      <path d="M36 26h10l6 2-6 2H36" />
      <path d="M22 36v6h10v-6" />
      <path d="M40 28l8-8M16 20V14h8" />
    </>
  ),
  blender: (
    <>
      <path d="M22 12h20l-3 26H25z" />
      <path d="M22 12l-2-4h24l-2 4" />
      <path d="M26 44h12l3 10H23z" />
      <path d="M28 50h8" />
    </>
  ),
  lamp: (
    <>
      <path d="M20 26l6-14h12l6 14z" />
      <path d="M32 26v22" />
      <path d="M22 52h20" />
      <path d="M30 20h4" />
    </>
  ),
  kettle: (
    <>
      <path d="M18 24h26l-3 24H21z" />
      <path d="M18 30l-8-4v12l8 4" />
      <path d="M44 28c8 2 8 14 0 16" />
      <path d="M26 20h10" />
    </>
  ),
  other: (
    <>
      <path d="M12 26l20-10 20 10v20L32 56 12 46z" />
      <path d="M12 26l20 10 20-10M32 36v20" />
      <path d="M24 16l8 4 8-4" />
    </>
  ),
};

export function ObjectGlyph({
  glyph,
  size = 64,
  tone,
  label,
}: {
  glyph: string;
  size?: number;
  tone?: 'accent' | 'dark';
  label?: string;
}) {
  const name = (Object.keys(GLYPH_PATHS).includes(glyph) ? glyph : 'other') as ObjectGlyphName;
  const box = Math.max(44, size);
  return (
    <span
      className={`glyph${tone ? ` glyph--${tone}` : ''}`}
      style={{ width: box, height: box }}
      role="img"
      aria-label={label ?? `${name} object`}
    >
      <svg
        width={box * 0.68}
        height={box * 0.68}
        viewBox="0 0 64 64"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {GLYPH_PATHS[name]}
      </svg>
    </span>
  );
}

export function MeterStateBadge({ state }: { state: MeterState }) {
  const copy = METER_COPY[state];
  return (
    <span className={`state state--${state.toLowerCase()}`}>
      <span className="state__dot" aria-hidden="true" />
      {copy.label}
    </span>
  );
}

export function Waveform({ level, live }: { level: number; live?: boolean }) {
  const history = useRef<number[]>([]);
  const [bars, setBars] = useState<number[]>(Array.from({ length: 48 }, () => 0.02));
  useEffect(() => {
    const scaled = Math.min(1, Math.sqrt(Math.max(0, level) * 12));
    history.current.push(scaled);
    if (history.current.length > 48) history.current.shift();
    setBars([...history.current, ...Array.from({ length: Math.max(0, 48 - history.current.length) }, () => 0.02)]);
  }, [level]);
  return (
    <div className={`waveform${live ? ' waveform--live' : ''}`} aria-hidden="true">
      {bars.map((bar, index) => (
        <span key={index} className="waveform__bar" style={{ height: `${Math.max(3, bar * 52)}px` }} />
      ))}
    </div>
  );
}

const BAND_LABELS = ['50', '120', '250', '500', '1k', '2k', '4k', '6k'];

/** Eight bands of the frozen feature spec, rendered as a scrolling waterfall. */
export function SpectralWaterfall({
  bands,
  state,
  height = 132,
}: {
  bands: number[];
  state: MeterState;
  height?: number;
}) {
  const [history, setHistory] = useState<number[][]>([]);
  useEffect(() => {
    setHistory((previous) => [...previous.slice(-31), bands]);
  }, [bands]);
  const columns = history.length ? history : [bands];
  return (
    <div className="waterfall" style={{ height }} role="img" aria-label="Live eight-band spectral energy view">
      <div className="waterfall__plot">
        {columns.map((column, columnIndex) => (
          <div className="waterfall__column" key={columnIndex}>
            {BAND_LABELS.map((label, bandIndex) => {
              const value = column[bandIndex] ?? 0;
              return (
                <span
                  key={label}
                  className={`waterfall__cell waterfall__cell--${state.toLowerCase()}`}
                  style={{ opacity: 0.08 + Math.min(1, Math.max(0, value)) * 0.92 }}
                  title={`${label} Hz-ish band: ${(value * 100).toFixed(1)}%`}
                />
              );
            })}
          </div>
        ))}
      </div>
      <div className="waterfall__axis" aria-hidden="true">
        {BAND_LABELS.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>
    </div>
  );
}

export function ExplanationCard({
  explanation,
  compact,
}: {
  explanation: {
    passportScore: number | null;
    topFeatures: Array<{ name: string; value: number; contribution: number }>;
    summary: string;
  };
  compact?: boolean;
}) {
  return (
    <div className={`explanation${compact ? ' explanation--compact' : ''}`}>
      <div className="row row--between">
        <span className="eyebrow">Why this second</span>
        {explanation.passportScore !== null ? (
          <span className="chip">passport {(explanation.passportScore * 100).toFixed(0)}%</span>
        ) : null}
      </div>
      <div className="explanation__bars">
        {explanation.topFeatures.map((feature) => (
          <div className="explanation__feature" key={feature.name}>
            <span className="mono tiny">{feature.name}</span>
            <span className="explanation__track" aria-hidden="true">
              <span
                className={feature.contribution >= 0 ? 'is-positive' : 'is-negative'}
                style={{ width: `${Math.min(100, Math.abs(feature.contribution) * 32 + 4)}%` }}
              />
            </span>
          </div>
        ))}
      </div>
      <p className="tiny muted" style={{ margin: 0 }}>{explanation.summary}</p>
    </div>
  );
}

export function SignatureSeal({
  keyId,
  signed,
  label = 'Installation signature',
}: {
  keyId?: string | null;
  signed: boolean;
  label?: string;
}) {
  return (
    <div className={`signature-seal${signed ? ' signature-seal--signed' : ' signature-seal--legacy'}`}>
      <span className="signature-seal__ring" aria-hidden="true" />
      <span className="signature-seal__label">{label}</span>
      <strong>{signed ? 'SIGNED' : 'LEGACY'}</strong>
      <span className="signature-seal__sub">
        {signed ? `ECDSA P-256 · key ${keyId?.slice(0, 10) ?? 'unknown'}…` : 'unsigned — not trusted as signed'}
      </span>
    </div>
  );
}

export function SoundprintBars({
  soundprint,
  height = 156,
  dark,
}: {
  soundprint: Soundprint;
  height?: number;
  dark?: boolean;
}) {
  const ceiling = Math.max(
    0.0001,
    ...soundprint.bands.flatMap((band) => [band.active, band.idle]),
  );
  return (
    <div
      className={`soundprint${dark ? ' soundprint--dark' : ''}`}
      style={{ height }}
      role="img"
      aria-label="Enrolled spectral profile: solid bars are the active sound, outlined bars are idle and negative sounds."
    >
      {soundprint.bands.map((band, index) => {
        const hz = band.fromHz >= 1000 ? `${band.fromHz / 1000}k` : `${band.fromHz}`;
        return (
          <div className="soundprint__band" key={`${band.fromHz}-${band.toHz}`}>
            <div className="soundprint__bars">
              <span
                className="soundprint__bar soundprint__bar--idle"
                style={{ height: `${Math.max(4, (band.idle / ceiling) * 100)}%` }}
                title={`Idle ${(band.idle * 100).toFixed(1)}%`}
              />
              <span
                className="soundprint__bar soundprint__bar--active"
                style={{ height: `${Math.max(4, (band.active / ceiling) * 100)}%` }}
                title={`Active ${(band.active * 100).toFixed(1)}%`}
              />
            </div>
            <span className="soundprint__hz">{index % 2 === 0 ? `${hz} Hz` : '\u00a0'}</span>
          </div>
        );
      })}
    </div>
  );
}

export interface TimelineInterval {
  startMs: number;
  endMs: number;
  state: MeterState;
}

/**
 * A compact, human-readable version of the enrolled spectral profile.
 * It is a calibration fingerprint, not a cryptographic identity mark.
 */
export function SoundTag({
  soundprint,
  dark = false,
}: {
  soundprint: Soundprint | null | undefined;
  dark?: boolean;
}) {
  if (!soundprint) {
    return (
      <div className={`sound-tag sound-tag--empty${dark ? ' sound-tag--dark' : ''}`}>
        <span className="sound-tag__label">Sound tag</span>
        <span className="sound-tag__empty">Not enrolled</span>
      </div>
    );
  }

  const ceiling = Math.max(0.0001, ...soundprint.bands.map((band) => band.active));
  return (
    <div
      className={`sound-tag${dark ? ' sound-tag--dark' : ''}`}
      aria-label={`Acoustic sound tag: ${soundprint.gateEnabled ? 'identity gate active' : 'activity profile only'}`}
    >
      <div className="sound-tag__head">
        <span className="sound-tag__label">Sound tag</span>
        <span className="sound-tag__status">
          <span className="sound-tag__dot" aria-hidden="true" />
          {soundprint.gateEnabled ? 'identity gate' : 'activity only'}
        </span>
      </div>
      <div className="sound-tag__bars" aria-hidden="true">
        {soundprint.bands.map((band, index) => (
          <span
            key={`${band.fromHz}-${band.toHz}`}
            style={{ height: `${Math.max(10, (band.active / ceiling) * 100)}%` }}
            title={`${index + 1}`}
          />
        ))}
      </div>
      <div className="sound-tag__foot">
        <span>50 Hz</span>
        <span>{soundprint.bands.length} bands / {Math.round(soundprint.matchThreshold * 100)}% gate</span>
        <span>7.8 kHz</span>
      </div>
    </div>
  );
}

/**
 * The Listening Room's object stage. The radial bars are driven by the same
 * eight bands used for classification; the rings animate only while the
 * microphone is genuinely open. No activity is fabricated when sensing is off.
 */
export function ListeningField({
  glyph,
  level,
  bands,
  state,
  live,
  label,
}: {
  glyph: string;
  level: number;
  bands: number[];
  state: MeterState;
  live: boolean;
  label: string;
}) {
  const energy = Math.min(1, Math.sqrt(Math.max(0, level) * 14));
  const normalized = Array.from({ length: 8 }, (_, index) => {
    const value = bands[index] ?? 0;
    return Math.max(0, Math.min(1, value));
  });
  return (
    <div
      className={`listening-field${live ? ' is-live' : ''}`}
      data-state={state.toLowerCase()}
      style={{ '--level': energy } as CSSProperties}
      role="img"
      aria-label={`${label}. ${live ? `Microphone open. ${state === 'ACTIVE_CONFIDENT' ? 'Running and billable.' : 'Not billable.'}` : 'Microphone closed. No sound is being measured.'}`}
    >
      <div className="listening-field__rings" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <div className="listening-field__bars" aria-hidden="true">
        {normalized.map((value, index) => (
          <span
            key={index}
            style={{ '--band': index, height: `${14 + value * 58}px` } as CSSProperties}
          />
        ))}
      </div>
      <div className="listening-field__core">
        <ObjectGlyph glyph={glyph} size={96} tone="dark" label={label} />
      </div>
      <span className="listening-field__stamp">
        <span className={`live-dot${live ? ' is-live' : ''}`} aria-hidden="true" />
        {live ? 'LIVE / ON-DEVICE' : 'MIC CLOSED'}
      </span>
    </div>
  );
}

export function Timeline({
  intervals,
  totalMs,
  height = 42,
  label,
  showAxis = true,
}: {
  intervals: TimelineInterval[];
  totalMs: number;
  height?: number;
  label?: string;
  showAxis?: boolean;
}) {
  const width = 1000;
  const span = Math.max(totalMs, ...intervals.map((i) => i.endMs), 1000);
  const states = new Set(intervals.map((i) => i.state));
  const summary =
    label ??
    `Sensor timeline over ${(span / 1000).toFixed(1)} seconds with ${intervals.length} intervals: ${[...states]
      .map((state) => METER_COPY[state].label)
      .join(', ')}.`;
  return (
    <svg
      className="timeline"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={summary}
      style={{ height }}
    >
      <rect className="timeline__track" x="0" y="8" width={width} height={height - 16} rx="3" />
      {intervals.map((interval, index) => {
        const x = (interval.startMs / span) * width;
        const w = Math.max(1.5, ((interval.endMs - interval.startMs) / span) * width);
        return (
          <rect
            key={`${interval.startMs}-${index}`}
            className={`timeline__bar--${interval.state.toLowerCase()}`}
            x={x}
            y="8"
            width={w}
            height={height - 16}
            rx="2"
          >
            <title>
              {METER_COPY[interval.state].label}: {(interval.startMs / 1000).toFixed(1)}s–
              {(interval.endMs / 1000).toFixed(1)}s
            </title>
          </rect>
        );
      })}
      {showAxis ? <line className="timeline__axis" x1="0" y1={height - 3} x2={width} y2={height - 3} /> : null}
    </svg>
  );
}

export function TimelineLegend() {
  return (
    <div className="legend" aria-hidden="true">
      <span className="legend__item">
        <span className="legend__swatch legend__swatch--active_confident" /> Running — billed
      </span>
      <span className="legend__item">
        <span className="legend__swatch legend__swatch--idle" /> Idle — free
      </span>
      <span className="legend__item">
        <span className="legend__swatch legend__swatch--uncertain" /> Uncertain — free
      </span>
      <span className="legend__item">
        <span className="legend__swatch legend__swatch--disconnected" /> Sensing stopped — free
      </span>
    </div>
  );
}

export function ConfusionMatrix({ matrix, labels }: { matrix: number[][]; labels: string[] }) {
  const totals = matrix.map((row) => row.reduce((a, b) => a + b, 0));
  const max = Math.max(1, ...matrix.flat());
  return (
    <div className="scroll-x">
      <table className="matrix">
        <caption className="tiny muted" style={{ captionSide: 'bottom', textAlign: 'left', paddingTop: 8 }}>
          Rows are true labels from held-out takes; columns are predictions. Frame counts.
        </caption>
        <thead>
          <tr>
            <th scope="col">true ↓ / predicted →</th>
            {labels.map((label) => (
              <th key={label} scope="col">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matrix.map((row, rowIndex) => (
            <tr key={labels[rowIndex]}>
              <th scope="row">{labels[rowIndex]}</th>
              {row.map((value, colIndex) => {
                const intensity = value / max;
                return (
                  <td
                    key={colIndex}
                    style={{
                      background:
                        rowIndex === colIndex
                          ? `rgba(47, 107, 79, ${0.1 + intensity * 0.45})`
                          : `rgba(194, 91, 42, ${0.06 + intensity * 0.5})`,
                    }}
                  >
                    {value}
                  </td>
                );
              })}
              <td style={{ color: 'var(--muted)' }}>{totals[rowIndex]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
