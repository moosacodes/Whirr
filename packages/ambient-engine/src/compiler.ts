import type { Currency } from '../../meter/src/currency.ts';
import { canonicalJson, sha256HexSync } from '../../protocol/src/index.ts';
import {
  AMBIENT_CONDITION_SCHEMA,
  COOPERATION_AGREEMENT_SCHEMA,
  type AmbientAgreementTerms,
  type AmbientCompilationIssue,
  type AmbientInterpretation,
  type AmbientModelRef,
  type AmbientTarget,
  type CompiledAmbientAgreement,
} from './types.ts';

export interface CompileAmbientInput {
  agreementId: string;
  revision: number;
  text: string;
  buyerRef: string;
  providerRef: string;
  target: AmbientTarget;
  eventModel: AmbientModelRef;
  currency: Currency;
  /** Explicit buyer offer. Text may also contain a price. */
  fixedPriceMinor?: number;
  /** Explicit requested duration. Text may also contain a duration. */
  durationSeconds?: number;
  /**
   * Provider counteroffers carry the buyer's original request text as history.
   * For those revisions the explicit negotiated price and duration are the
   * contract; parsing the old wish text must not silently undo the counter.
   */
  preferExplicitTerms?: boolean;
  now: string;
  expiresInMinutes?: number;
  authorizationExpiryMinutes?: number;
}

const MIN_DURATION_SECONDS = 10;
const MAX_DURATION_SECONDS = 120;
const DEFAULT_DURATION_SECONDS = 30;
const DEFAULT_BASELINE_ACTIVE_MS = 3_000;
const DEFAULT_CONFIDENCE_FLOOR = 0.6;
const DEFAULT_MAX_GAP_MS = 2_500;
const MAX_PRICE_MINOR = 10_000;

const UNSUPPORTED_PHYSICAL_CLAIMS: Array<[RegExp, string]> = [
  [/\belectric(?:ity|al)?\b|\bpower (?:use|usage|consumption)\b|\benergy (?:use|usage|savings?)\b/i, 'electricity or power consumption'],
  [/\bair quality\b|\bhumidity\b|\btemperature\b|\bheat\b|\bsmell\b|\bodor\b|\bchemical\b/i, 'air, temperature, smell, or chemical conditions'],
  [/\bcompletely silent\b|\bcomplete silence\b|\btotal silence\b|\bsoundproof\b|\bzero decibels?\b/i, 'complete silence or soundproofing'],
  [/\bdecibel\b|\bdb\s*\(a\)|\bcertif(?:y|ied|ication)\b|\bacoustic measurement\b/i, 'certified sound-level measurement'],
  [/\bsafe(?:ty)?\b|\bsecure\b|\blegal(?:ly)?\b|\bcompliant\b/i, 'safety, security, or legal compliance'],
  [/\ball (?:the )?(?:machines|appliances|sounds)\b|\bevery (?:machine|appliance|sound)\b|\bthe whole room\b|\bentire room\b/i, 'a whole-room or all-source guarantee'],
  [/\banything\b|\bwhatever\b|\bunconditionally\b|\bguaranteed\b/i, 'an unconditional or undefined guarantee'],
];

const QUIET_INTENT =
  /\b(?:quiet|silence|silent|pause[ds]?|pausing|stop(?:ped|ping)?|off|inactive|without|defer|delay|window|record(?:ing)?|voiceover|voice-over)\b/i;

function parseDurationSeconds(text: string): number | null {
  const minute = /(\d+(?:\.\d+)?)\s*(?:minutes?|mins?|m)\b/i.exec(text);
  if (minute) {
    const value = Number(minute[1]);
    return Number.isFinite(value) ? Math.round(value * 60) : null;
  }
  const second = /(\d+(?:\.\d+)?)\s*(?:seconds?|secs?|s)\b/i.exec(text);
  if (second) {
    const value = Number(second[1]);
    return Number.isFinite(value) ? Math.round(value) : null;
  }
  return null;
}

function parsePriceMinor(text: string, currency: Currency): number | null {
  const dollar = /\$\s*(\d+(?:\.\d{1,2})?)/.exec(text);
  const words = /(\d+(?:\.\d{1,2})?)\s*(?:dollars?|bucks?|usd)\b/i.exec(text);
  const match = dollar ?? words;
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) return null;
  const digits = currency === 'JPY' ? 0 : 2;
  return Math.round(value * 10 ** digits);
}

function unique(items: string[]): string[] {
  return [...new Set(items.filter(Boolean))];
}

export function hashAmbientTerms(terms: AmbientAgreementTerms): string {
  return sha256HexSync(canonicalJson(terms));
}

export function validateAmbientTermsShape(value: unknown): value is AmbientAgreementTerms {
  if (!value || typeof value !== 'object') return false;
  const terms = value as AmbientAgreementTerms;
  return (
    terms.schema === COOPERATION_AGREEMENT_SCHEMA &&
    Number.isSafeInteger(terms.revision) &&
    terms.revision >= 1 &&
    typeof terms.agreementId === 'string' &&
    Boolean(terms.target?.objectId) &&
    Boolean(terms.eventModel?.hash) &&
    terms.condition?.type === 'ENROLLED_SOURCE_INACTIVE' &&
    Number.isSafeInteger(terms.condition.requiredInactiveMs) &&
    terms.condition.requiredInactiveMs > 0 &&
    Number.isSafeInteger(terms.condition.requiredBaselineActiveMs) &&
    terms.condition.requiredBaselineActiveMs >= 0 &&
    Number.isFinite(terms.condition.confidenceFloor) &&
    terms.financial?.currency !== undefined &&
    Number.isSafeInteger(terms.financial.fixedPriceMinor) &&
    Number.isSafeInteger(terms.financial.maximumChargeMinor) &&
    terms.financial.fixedPriceMinor > 0 &&
    terms.financial.maximumChargeMinor >= terms.financial.fixedPriceMinor &&
    typeof terms.createdAt === 'string' &&
    typeof terms.expiresAt === 'string'
  );
}

export function compileAmbientAgreement(input: CompileAmbientInput): CompiledAmbientAgreement {
  const text = input.text.trim();
  const issues: AmbientCompilationIssue[] = [];
  const unsupportedClaims: string[] = [];

  for (const [pattern, label] of UNSUPPORTED_PHYSICAL_CLAIMS) {
    if (pattern.test(text)) unsupportedClaims.push(label);
  }

  const fatalUnsupported =
    /electric(?:ity|al)?|power (?:use|usage|consumption)|energy (?:use|usage|savings?)|air quality|humidity|temperature|smell|odor|chemical/i.test(
      text,
    ) ||
    /soundproof|certif(?:y|ied|ication)|decibel\b|db\s*\(a\)|guaranteed|unconditionally/i.test(text);

  if (!QUIET_INTENT.test(text)) {
    issues.push({
      code: 'UNSUPPORTED_CONDITION',
      severity: 'ERROR',
      message:
        'Whirr Ambient can currently evaluate one bounded condition: an enrolled source remaining undetected for a continuous window. Describe a pause, quiet window, recording window, or source inactivity.',
    });
  }

  if (fatalUnsupported) {
    issues.push({
      code: 'UNSUPPORTED_PHYSICAL_CLAIM',
      severity: 'ERROR',
      message: `This request asks for ${unsupportedClaims.join(', ')}. A browser microphone and an enrolled acoustic model cannot establish that condition. Narrow it to the enrolled source remaining undetected.`,
    });
  }

  const parsedDuration = input.preferExplicitTerms ? null : parseDurationSeconds(text);
  const durationSeconds =
    input.preferExplicitTerms
      ? input.durationSeconds ?? parseDurationSeconds(text) ?? DEFAULT_DURATION_SECONDS
      : parsedDuration ?? input.durationSeconds ?? DEFAULT_DURATION_SECONDS;
  if (
    !input.preferExplicitTerms &&
    parsedDuration !== null &&
    input.durationSeconds !== undefined &&
    parsedDuration !== input.durationSeconds
  ) {
    issues.push({
      code: 'DURATION_MISMATCH',
      severity: 'WARNING',
      message: `The request says ${parsedDuration}s while the form says ${input.durationSeconds}s. The request text is used.`,
    });
  }
  if (durationSeconds < MIN_DURATION_SECONDS || durationSeconds > MAX_DURATION_SECONDS) {
    issues.push({
      code: 'DURATION_OUT_OF_RANGE',
      severity: 'ERROR',
      message: `A window must be between ${MIN_DURATION_SECONDS} and ${MAX_DURATION_SECONDS} seconds.`,
    });
  }

  const parsedPrice = input.preferExplicitTerms ? null : parsePriceMinor(text, input.currency);
  const fixedPriceMinor = input.preferExplicitTerms
    ? input.fixedPriceMinor ?? parsePriceMinor(text, input.currency) ?? 0
    : parsedPrice ?? input.fixedPriceMinor ?? 0;
  if (
    !input.preferExplicitTerms &&
    parsedPrice !== null &&
    input.fixedPriceMinor !== undefined &&
    parsedPrice !== input.fixedPriceMinor
  ) {
    issues.push({
      code: 'PRICE_MISMATCH',
      severity: 'WARNING',
      message: `The request says ${parsedPrice} minor units while the form says ${input.fixedPriceMinor}. The request text is used.`,
    });
  }
  if (!Number.isSafeInteger(fixedPriceMinor) || fixedPriceMinor <= 0) {
    issues.push({
      code: 'PRICE_REQUIRED',
      severity: 'ERROR',
      message: 'Name a positive fixed offer, for example "$2", so the provider can decide before any sensing begins.',
    });
  } else if (fixedPriceMinor > MAX_PRICE_MINOR) {
    issues.push({
      code: 'PRICE_TOO_HIGH',
      severity: 'ERROR',
      message: `The prototype caps a single cooperation offer at ${MAX_PRICE_MINOR} minor units.`,
    });
  }

  if (text.length < 10) {
    issues.push({
      code: 'REQUEST_TOO_SHORT',
      severity: 'ERROR',
      message: 'Describe the physical condition you need in at least a short sentence.',
    });
  }
  if (text.length > 800) {
    issues.push({
      code: 'REQUEST_TOO_LONG',
      severity: 'ERROR',
      message: 'Keep the request under 800 characters.',
    });
  }

  const durationLabel =
    durationSeconds % 60 === 0 && durationSeconds >= 60
      ? `${durationSeconds / 60} minute${durationSeconds === 60 ? '' : 's'}`
      : `${durationSeconds} seconds`;

  const interpretation: AmbientInterpretation = {
    schema: AMBIENT_CONDITION_SCHEMA,
    title: `Keep ${input.target.objectName} undetected for ${durationLabel}`,
    requestedText: text,
    desiredCondition: `A ${durationLabel} window without the enrolled ${input.target.objectName} operating.`,
    observableCondition: `The validated model must detect ${input.target.objectName} active for at least ${DEFAULT_BASELINE_ACTIVE_MS / 1000} continuous seconds, then must not detect it for ${durationLabel} of continuous, observable microphone evidence.`,
    proxyDisclosure:
      'Whirr evaluates the enrolled source, not the room. "Inactive" means the bound model did not detect this source; it does not prove silence, power-off, or that no other activity occurred.',
    target: input.target,
    supported: !issues.some((issue) => issue.severity === 'ERROR'),
    unsupportedClaims: unique(unsupportedClaims),
    assumptions: [
      'The buyer and provider have legitimate authority over the requested activity and the physical space.',
      'The microphone is placed where the enrolled source is observable under the conditions used to train the model.',
      'The provider is the party who can voluntarily change the enrolled activity.',
    ],
    limitations: [
      'A missing detection is negative evidence under declared conditions, not proof of physical silence.',
      'A browser microphone, its operator, and the device clock are not independently trusted by the installation signature.',
      'The proof does not establish that PayPal captured money unless a provider-confirmed capture is present.',
      'The prototype is limited to invited participants and does not create a public nuisance market.',
    ],
  };

  if (unsupportedClaims.length > 0) {
    issues.push({
      code: 'NARROWED_INTERPRETATION',
      severity: 'WARNING',
      message: `The request mentions ${unique(unsupportedClaims).join(', ')}. The executable condition is narrower: only the enrolled source's detected inactivity is evaluated.`,
    });
  }

  const now = new Date(input.now);
  const expiresAt = new Date(now.getTime() + (input.expiresInMinutes ?? 45) * 60_000).toISOString();
  const terms: AmbientAgreementTerms = {
    schema: COOPERATION_AGREEMENT_SCHEMA,
    revision: input.revision,
    agreementId: input.agreementId,
    serviceName: `${durationLabel} without ${input.target.objectName}`,
    parties: {
      buyerRef: input.buyerRef,
      providerRef: input.providerRef,
    },
    target: input.target,
    eventModel: input.eventModel,
    condition: {
      type: 'ENROLLED_SOURCE_INACTIVE',
      requiredBaselineActiveMs: DEFAULT_BASELINE_ACTIVE_MS,
      requiredInactiveMs: durationSeconds * 1000,
      confidenceFloor: DEFAULT_CONFIDENCE_FLOOR,
      maxObservationGapMs: DEFAULT_MAX_GAP_MS,
      observationMode: 'BROWSER_MICROPHONE',
      sensorContinuity: 'REQUIRED',
      baselinePolicy: 'REQUIRE_ACTIVE_BASELINE',
      interruptionPolicy: 'RESET_QUALIFYING_WINDOW',
      uncertaintyPolicy: 'RESET_QUALIFYING_WINDOW',
      startWindow: {
        notBefore: input.now,
        notAfter: expiresAt,
      },
    },
    financial: {
      currency: input.currency,
      fixedPriceMinor,
      maximumChargeMinor: fixedPriceMinor,
      authorizationExpiryMinutes: input.authorizationExpiryMinutes ?? 60,
    },
    policies: {
      automaticCapture: false,
      failedCondition: 'NO_CAPTURE',
      uncertainEvidence: 'NO_CAPTURE',
      sensorLoss: 'NO_CAPTURE',
      humanAcceptance: 'BUYER_REQUIRED',
      failedAgreement: 'VOID_AUTHORIZATION',
    },
    interpretation,
    evidence: {
      storesRawAudio: false,
      storesFeatureSummaries: false,
      storesIntervalStates: true,
      statement:
        'The proof stores interval states, confidence buckets, quality flags, model identity, and hashes. Raw microphone audio is not sent to the server.',
    },
    createdAt: input.now,
    expiresAt,
  };

  const hash = hashAmbientTerms(terms);
  return {
    terms,
    hash,
    interpretation,
    issues,
    executable: !issues.some((issue) => issue.severity === 'ERROR'),
  };
}
