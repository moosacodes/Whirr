import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

export type AmbientStep = 'overview' | 'wish' | 'exchange' | 'window' | 'accord' | 'evidence';

const STEPS: Array<{ id: AmbientStep; number: string; label: string }> = [
  { id: 'wish', number: '01', label: 'Wish' },
  { id: 'exchange', number: '02', label: 'Exchange' },
  { id: 'window', number: '03', label: 'Window' },
  { id: 'accord', number: '04', label: 'Accord' },
];

/**
 * A fixed atmospheric layer behind the four product surfaces. It is purely
 * decorative: the agreement, observation and payment state all live in the
 * real page content and APIs.
 */
export function AmbientFrame({
  current,
  note,
  children,
}: {
  current: AmbientStep;
  note?: string;
  children: ReactNode;
}) {
  return (
    <div className={`ambient-experience ambient-experience--${current}`}>
      <div className="ambient-field" aria-hidden="true">
        <span className="ambient-field__halo" />
        <span className="ambient-field__grid" />
        <span className="ambient-field__grain" />
      </div>
      <div className="ambient-frame">
        <FlowRail current={current} note={note} />
        {children}
      </div>
    </div>
  );
}

export function FlowRail({ current, note }: { current: AmbientStep; note?: string }) {
  return (
    <nav className="flow-rail" aria-label="Agreement process">
      <div className="flow-rail__inner">
        <Link
          to="/ambient"
          className={`flow-rail__overview${current === 'overview' ? ' is-current' : ''}`}
          aria-current={current === 'overview' ? 'page' : undefined}
        >
          Ambient <span className="flow-rail__edition">7.0</span>
        </Link>
        <span className="flow-rail__connector" aria-hidden="true" />
        {STEPS.map((step) => {
          const active = current === step.id;
          const content = (
            <>
              <span className="flow-rail__number">{step.number}</span>
              <span>{step.label}</span>
            </>
          );
          return (
            <span className="flow-rail__step-wrap" key={step.id}>
              {step.id === 'wish' ? (
                <Link
                  to="/ambient/wish"
                  className={`flow-rail__step${active ? ' is-current' : ''}`}
                  aria-current={active ? 'step' : undefined}
                >
                  {content}
                </Link>
              ) : (
                <span
                  className={`flow-rail__step${active ? ' is-current' : ''}`}
                  aria-current={active ? 'step' : undefined}
                >
                  {content}
                </span>
              )}
              <span className="flow-rail__connector" aria-hidden="true" />
            </span>
          );
        })}
        <span className="flow-rail__note">
          <span className="flow-rail__pulse" aria-hidden="true" />
          {note ?? 'Witnessed agreement'}
        </span>
      </div>
    </nav>
  );
}
