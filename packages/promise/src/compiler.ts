import { decimalStringToMinor, formatMinor, type Currency } from '../../meter/src/currency.ts';
import { canonicalJson, sha256HexSync } from '../../protocol/src/index.ts';
import {
  PHYSICAL_AGREEMENT_SCHEMA,
  type AgreementCompilationInput,
  type AgreementSummaryLine,
  type CompilationIssue,
  type CompiledAgreement,
  type NaturalLanguageProposal,
  type PromiseAgreementTerms,
} from './types.ts';

const MAX_PRICE_MINOR = 100_000;
const DEFAULT_MAX_RUN_MS = 300_000;
const DEFAULT_AUTHORIZATION_MINUTES = 120;

const UNSUPPORTED_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\b(refund|money back|reimburse)\b/i, reason: 'Refunds are not part of this agreement language.' },
  { pattern: /\b(tip|bonus|penalty|surcharge|late fee)\b/i, reason: 'Variable or punitive charges are not supported.' },
  { pattern: /\b(percent|percentage|per minute|hourly|per hour)\b/i, reason: 'Only a fixed price for one qualified cycle is supported.' },
  { pattern: /\b(escrow|release funds|hold funds until|third party)\b/i, reason: 'Whirr does not offer escrow or fund release.' },
  { pattern: /\b(subscription|recurring|every month|weekly)\b/i, reason: 'Recurring billing is not supported.' },
  { pattern: /\b(if possible|maybe|probably|roughly|around)\b/i, reason: 'Ambiguous quantities cannot become executable terms.' },
  { pattern: /\b(and|or)\s+(also\s+)?(charge|pay)\b/i, reason: 'Only one settlement condition is supported.' },
];

function durationToMs(amount: string, unit: string): number | null {
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) return null;
  const normalised = unit.toLowerCase();
  const factor = normalised.startsWith('min') ? 60_000 : 1_000;
  const ms = Math.round(value * factor);
  if (!Number.isSafeInteger(ms) || ms < 1_000 || ms > 3_600_000) return null;
  return ms;
}

export function parsePromiseText(text: string, currency: Currency): NaturalLanguageProposal {
  const trimmed = text.trim();
  const unsupportedPhrases: string[] = [];
  for (const entry of UNSUPPORTED_PATTERNS) {
    if (entry.pattern.test(trimmed)) unsupportedPhrases.push(entry.reason);
  }

  const currencyWord =
    currency === 'USD' ? '(?:dollars?|usd)' : currency === 'GBP' ? '(?:pounds?|gbp)' : currency === 'EUR' ? '(?:euros?|eur)' : '(?:' + currency.toLowerCase() + ')';
  const priceWord = new RegExp(`(\\d+(?:\\.\\d{1,2})?)\\s*${currencyWord}\\b`, 'i').exec(trimmed);
  const symbol = currency === 'USD' ? '\\$' : currency === 'GBP' ? '£' : currency === 'EUR' ? '€' : '';
  const priceSymbol = symbol ? new RegExp(`${symbol}\\s*(\\d+(?:\\.\\d{1,2})?)`).exec(trimmed) : null;
  const priceRaw = priceSymbol?.[1] ?? priceWord?.[1] ?? null;
  const priceMinor = priceRaw ? decimalStringToMinor(priceRaw, currency) : null;

  const durationPattern = /(\d+(?:\.\d+)?)\s*(seconds?|secs?|minutes?|mins?)\b/gi;
  const durations: Array<{ ms: number; unit: string; index: number }> = [];
  for (let match = durationPattern.exec(trimmed); match; match = durationPattern.exec(trimmed)) {
    const ms = durationToMs(match[1]!, match[2]!);
    if (ms !== null) durations.push({ ms, unit: match[2]!.toLowerCase(), index: match.index });
  }

  let minRunMs: number | null = null;
  let maxRunMs: number | null = null;
  const minimumPattern = /(?:at least|minimum(?: of)?|no less than|must run (?:for )?|runs? for|for)\s+(\d+(?:\.\d+)?)\s*(seconds?|secs?|minutes?|mins?)\b/i;
  const maximumPattern = /(?:at most|no more than|maximum(?: of)?|up to|not exceed)\s+(\d+(?:\.\d+)?)\s*(seconds?|secs?|minutes?|mins?)\b/i;
  const minimumMatch = minimumPattern.exec(trimmed);
  const maximumMatch = maximumPattern.exec(trimmed);
  if (minimumMatch) minRunMs = durationToMs(minimumMatch[1]!, minimumMatch[2]!);
  if (maximumMatch) maxRunMs = durationToMs(maximumMatch[1]!, maximumMatch[2]!);
  if (minRunMs === null && durations.length > 0) minRunMs = durations[0]!.ms;
  if (maxRunMs === null && durations.length > 1) {
    const candidate = durations.find((duration) => duration.ms !== minRunMs);
    maxRunMs = candidate?.ms ?? null;
  }
  if (maxRunMs === null && minRunMs !== null) {
    maxRunMs = Math.min(DEFAULT_MAX_RUN_MS, Math.max(minRunMs + 30_000, minRunMs * 3));
  }

  const requiresStop = /\b(complete|completed|completion|cycle|stop|stops|finish|finished)\b/i.test(trimmed);
  const rejectsEarlyStop = /\b(not|don't|do not|no)\b[^.]{0,40}\b(charge|pay|count)\b/i.test(trimmed) || /\b(interrupted|early stop|stops early)\b/i.test(trimmed);

  return {
    text: trimmed,
    priceMinor,
    currency,
    minRunMs,
    maxRunMs,
    requiresStop,
    rejectsEarlyStop,
    unsupportedPhrases: [...new Set(unsupportedPhrases)],
  };
}

export function compilePhysicalAgreement(input: AgreementCompilationInput): CompiledAgreement {
  const proposal = parsePromiseText(input.text, input.currency);
  const issues: CompilationIssue[] = [];
  const add = (code: string, severity: 'ERROR' | 'WARNING', message: string): void => {
    issues.push({ code, severity, message });
  };

  if (input.text.trim().length < 12) add('TEXT_TOO_SHORT', 'ERROR', 'Describe what should be paid for in a complete sentence.');
  if (input.text.length > 800) add('TEXT_TOO_LONG', 'ERROR', 'Keep the proposal under 800 characters.');
  if (proposal.unsupportedPhrases.length > 0) {
    add('UNSUPPORTED_CLAUSE', 'ERROR', proposal.unsupportedPhrases.join(' '));
  }
  if (proposal.priceMinor === null) {
    add('PRICE_REQUIRED', 'ERROR', `State an exact price in ${input.currency}, for example ${formatMinor(200, input.currency)}.`);
  } else if (proposal.priceMinor <= 0) {
    add('PRICE_NOT_POSITIVE', 'ERROR', 'The fixed price must be greater than zero.');
  } else if (proposal.priceMinor > MAX_PRICE_MINOR) {
    add('PRICE_TOO_HIGH', 'ERROR', `The price must not exceed ${formatMinor(MAX_PRICE_MINOR, input.currency)}.`);
  }
  if (proposal.minRunMs === null) add('MIN_DURATION_REQUIRED', 'ERROR', 'State a minimum operating duration, for example "at least 15 seconds".');
  if (proposal.maxRunMs === null) add('MAX_DURATION_REQUIRED', 'ERROR', 'A maximum operating duration could not be derived.');
  if (proposal.minRunMs !== null && proposal.maxRunMs !== null && proposal.maxRunMs < proposal.minRunMs) {
    add('DURATION_CONTRADICTION', 'ERROR', 'The maximum duration is shorter than the minimum qualified duration.');
  }
  if (proposal.minRunMs !== null && proposal.minRunMs < 3_000) {
    add('MIN_DURATION_TOO_SHORT', 'ERROR', 'The qualified run must last at least 3 seconds so a single noise click cannot settle an agreement.');
  }
  if (proposal.maxRunMs !== null && proposal.maxRunMs > 900_000) {
    add('MAX_DURATION_TOO_LONG', 'ERROR', 'The maximum run must not exceed 15 minutes.');
  }
  if (!proposal.requiresStop) {
    add('COMPLETION_CONDITION_REQUIRED', 'ERROR', 'The agreement must require a completed cycle or observable stop.');
  }
  if (!proposal.rejectsEarlyStop) {
    add('FAILURE_POLICY_UNCLEAR', 'WARNING', 'Early or interrupted attempts will not be charged under the fixed failure policy.');
  }
  if (!input.serviceName.trim()) add('SERVICE_NAME_REQUIRED', 'ERROR', 'Name the service being offered.');
  if (!input.objectId.trim()) add('OBJECT_REQUIRED', 'ERROR', 'Choose the physical object this promise applies to.');
  if (!input.eventModel.id || !/^[a-f0-9]{64}$/.test(input.eventModel.hash)) {
    add('MODEL_REQUIRED', 'ERROR', 'A trained event model with a valid digest is required.');
  }
  if (input.eventModel.status !== 'READY') {
    add('MODEL_NOT_READY', 'ERROR', 'The event model did not pass its validation gate and cannot back a payable agreement.');
  }
  const now = new Date(input.now);
  if (!Number.isFinite(now.getTime())) add('INVALID_TIME', 'ERROR', 'Agreement creation time is invalid.');
  const expiryMinutes = input.expiresInMinutes ?? DEFAULT_AUTHORIZATION_MINUTES;
  if (!Number.isInteger(expiryMinutes) || expiryMinutes < 5 || expiryMinutes > 24 * 60) {
    add('INVALID_EXPIRY', 'ERROR', 'Authorization expiry must be between 5 minutes and 24 hours.');
  }

  const expiresAt = new Date(now.getTime() + expiryMinutes * 60_000).toISOString();
  const terms: PromiseAgreementTerms = {
    schema: PHYSICAL_AGREEMENT_SCHEMA,
    revision: 1,
    serviceName: input.serviceName.trim(),
    objectId: input.objectId,
    objectName: input.objectName,
    eventModel: { ...input.eventModel },
    requiredSequence: ['IDLE', 'START', 'RUNNING', 'EXPECTED_STOP'],
    constraints: {
      minRunMs: proposal.minRunMs ?? 15_000,
      maxRunMs: proposal.maxRunMs ?? DEFAULT_MAX_RUN_MS,
      maxObservationGapMs: 4_000,
      confidenceFloor: 0.6,
      sensorContinuity: true,
      noUncertainInterval: true,
      singleCycle: true,
      requireIdleBaseline: true,
    },
    financial: {
      currency: input.currency,
      fixedPriceMinor: proposal.priceMinor ?? 0,
      maximumChargeMinor: proposal.priceMinor ?? 0,
      authorizationExpiryMinutes: expiryMinutes,
    },
    policies: {
      failure: 'NO_CAPTURE',
      uncertainty: 'NO_CAPTURE',
      sensorLoss: 'NO_CAPTURE',
      humanAcceptance: 'NONE',
    },
    evidence: {
      reportingStates: ['IDLE', 'ACTIVE_CONFIDENT', 'UNCERTAIN', 'DISCONNECTED'],
      acousticStopDistinction: false,
      statement:
        'Stop and completion are temporal inferences from confident idle and active meter states, not separately classified acoustic events. This agreement does not prove product quality or manufacturing success.',
    },
    createdAt: now.toISOString(),
    expiresAt,
  };

  const hash = hashAgreementTerms(terms);
  return {
    terms,
    hash,
    proposal,
    issues,
    executable: !issues.some((issue) => issue.severity === 'ERROR'),
  };
}

export function hashAgreementTerms(terms: PromiseAgreementTerms): string {
  return sha256HexSync(canonicalJson(terms));
}

export function agreementSummary(terms: PromiseAgreementTerms): AgreementSummaryLine[] {
  return [
    { id: 'service', label: 'Service', value: terms.serviceName },
    { id: 'object', label: 'Physical object', value: terms.objectName },
    { id: 'sequence', label: 'Required sequence', value: terms.requiredSequence.join(' → ') },
    {
      id: 'duration',
      label: 'Qualified run',
      value: `${(terms.constraints.minRunMs / 1000).toFixed(1)}s to ${(terms.constraints.maxRunMs / 1000).toFixed(1)}s`,
    },
    { id: 'price', label: 'Fixed price', value: formatMinor(terms.financial.fixedPriceMinor, terms.financial.currency) },
    {
      id: 'ceiling',
      label: 'Maximum charge',
      value: formatMinor(terms.financial.maximumChargeMinor, terms.financial.currency),
    },
    { id: 'uncertain', label: 'Uncertain evidence', value: 'No capture' },
    { id: 'sensor', label: 'Sensor loss', value: 'No capture' },
    { id: 'stop', label: 'Stop evidence', value: 'Temporal inference, not a separate sound class' },
    { id: 'model', label: 'Event model', value: `${terms.eventModel.version} (${terms.eventModel.hash.slice(0, 12)}…)` },
    { id: 'expiry', label: 'Authorization expires', value: terms.expiresAt },
  ];
}

export function validateTermsShape(value: unknown): value is PromiseAgreementTerms {
  if (!value || typeof value !== 'object') return false;
  const terms = value as Partial<PromiseAgreementTerms>;
  if (terms.schema !== PHYSICAL_AGREEMENT_SCHEMA) return false;
  if (!terms.constraints || !terms.financial || !terms.eventModel) return false;
  const c = terms.constraints;
  const f = terms.financial;
  return (
    Number.isSafeInteger(c.minRunMs) &&
    Number.isSafeInteger(c.maxRunMs) &&
    c.minRunMs > 0 &&
    c.maxRunMs >= c.minRunMs &&
    Number.isFinite(c.confidenceFloor) &&
    Number.isSafeInteger(f.fixedPriceMinor) &&
    Number.isSafeInteger(f.maximumChargeMinor) &&
    f.fixedPriceMinor > 0 &&
    f.maximumChargeMinor >= f.fixedPriceMinor
  );
}
