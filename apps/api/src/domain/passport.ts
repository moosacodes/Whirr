import type { AppContext } from '../context.ts';
import type { ObjectRow, TermsRow, UserRow } from './rows.ts';
import { parseArtifact } from './rows.ts';
import { activeModel, activeTerms, modelSummary } from './objects.ts';
import { newId } from '../lib/ids.ts';
import { canonicalJson, hashCanonical } from '../lib/hash.ts';
import { reportForModel } from './validation.ts';
import { driftForObject } from './drift.ts';
import type {
  DriftView,
  PassportPayload,
  PassportStamp,
  PassportView,
  PriceTerms,
  ServiceObjectView,
  SignedPassport,
  ValidationReport,
} from '../../../../packages/contracts/src/types.ts';

const DAY_MS = 86_400_000;

interface PassportVersionRow {
  id: string;
  object_id: string;
  version: number;
  key_id: string;
  payload_hash: string;
  document_json: string;
  created_at: string;
}

export interface PassportHistoryEntry {
  version: number;
  createdAt: string;
  payloadHash: string;
  keyId: string;
}

export interface PassportBundle {
  envelope: SignedPassport;
  history: PassportHistoryEntry[];
  drift: DriftView;
  validation: ValidationReport | null;
  stamps: PassportStamp[];
}

function ageDays(ctx: AppContext, at: string | null): number | null {
  if (!at) return null;
  return Math.max(0, Math.floor((ctx.now().getTime() - Date.parse(at)) / DAY_MS));
}

function buildStamps(input: {
  objectId: string;
  modelVersion: string;
  modelHash: string;
  trainedAt: string;
  modelStatus: string;
  takeCount: number;
  terms: TermsRow | null;
  sessionCount: number;
  lastSessionAt: string | null;
  resolvedDisputes: number;
  previous: PassportVersionRow | null;
}): PassportStamp[] {
  const stamps: PassportStamp[] = [
    {
      id: `calibration-${input.modelVersion}`,
      kind: 'calibration',
      label: `Calibration ${input.modelVersion}`,
      detail: `${input.takeCount} takes · ${input.modelStatus} · one guided sitting`,
      at: input.trainedAt,
      hash: input.modelHash,
    },
  ];
  if (input.terms) {
    stamps.push({
      id: `terms-${input.terms.version}`,
      kind: 'terms',
      label: `Rate card v${input.terms.version}`,
      detail: `${input.terms.currency} ${input.terms.minor_per_minute} / min · cap ${input.terms.cap_minor}`,
      at: input.terms.created_at,
      hash: input.terms.terms_hash,
    });
  }
  if (input.sessionCount > 0) {
    stamps.push({
      id: 'sessions-aggregate',
      kind: 'sessions',
      label: `${input.sessionCount} recorded session${input.sessionCount === 1 ? '' : 's'}`,
      detail: 'Aggregate count only. Public stamps never contain renter identity.',
      at: input.lastSessionAt,
      hash: hashCanonical({ objectId: input.objectId, sessions: input.sessionCount, last: input.lastSessionAt }),
    });
  }
  if (input.resolvedDisputes > 0) {
    stamps.push({
      id: 'disputes-aggregate',
      kind: 'dispute',
      label: `${input.resolvedDisputes} dispute${input.resolvedDisputes === 1 ? '' : 's'} resolved`,
      detail: 'Resolution count only; no dispute text or renter identity is published.',
      at: null,
      hash: hashCanonical({ objectId: input.objectId, resolvedDisputes: input.resolvedDisputes }),
    });
  }
  if (input.previous) {
    const previousPayload = JSON.parse(input.previous.document_json) as SignedPassport;
    stamps.push({
      id: `passport-${input.previous.version}`,
      kind: 'passport',
      label: `Passport v${input.previous.version}`,
      detail: `Previous signed edition · key ${input.previous.key_id.slice(0, 10)}…`,
      at: previousPayload.payload.createdAt,
      hash: input.previous.payload_hash,
    });
  }
  return stamps;
}

function factsFor(payload: PassportPayload): string {
  const clone = { ...payload } as Partial<PassportPayload> & Record<string, unknown>;
  delete clone.passportVersion;
  delete clone.createdAt;
  delete clone.previousPassportHash;
  clone.stamps = payload.stamps.filter((stamp) => stamp.kind !== 'passport');
  return canonicalJson(clone);
}

function termsFor(row: TermsRow | null): (PriceTerms & { hash: string }) | null {
  if (!row) return null;
  const parsed = getTermsSafe(row);
  return { ...parsed, hash: row.terms_hash };
}

function getTermsSafe(row: TermsRow): PriceTerms {
  return JSON.parse(row.terms_json) as PriceTerms;
}

export async function passportForObject(ctx: AppContext, object: ObjectRow): Promise<PassportBundle> {
  const modelRow = activeModel(ctx, object);
  if (!modelRow) throw new Error('A passport cannot be built without an active model.');
  const artifact = parseArtifact(modelRow);
  const termsRow = activeTerms(ctx, object);
  const owner = ctx.store.get<UserRow>('SELECT * FROM users WHERE id = ?', object.owner_id);
  const validation = reportForModel(ctx, modelRow.id);
  const sessions = ctx.store.get<{ count: number; last: string | null }>(
    'SELECT COUNT(*) AS count, MAX(created_at) AS last FROM sessions WHERE object_id = ?',
    object.id,
  );
  const disputes = ctx.store.get<{ count: number }>(
    "SELECT COUNT(*) AS count FROM disputes d JOIN sessions s ON s.id = d.session_id WHERE s.object_id = ? AND d.status = 'RESOLVED'",
    object.id,
  );
  const previous = ctx.store.get<PassportVersionRow>(
    'SELECT * FROM passport_versions WHERE object_id = ? ORDER BY version DESC LIMIT 1',
    object.id,
  ) ?? null;
  const drift = driftForObject(ctx, object.id, modelRow.created_at);
  const stamps = buildStamps({
    objectId: object.id,
    modelVersion: modelRow.version,
    modelHash: modelRow.model_hash,
    trainedAt: modelRow.created_at,
    modelStatus: modelRow.status,
    takeCount: artifact.training.takeCount,
    terms: termsRow,
    sessionCount: sessions?.count ?? 0,
    lastSessionAt: sessions?.last ?? null,
    resolvedDisputes: disputes?.count ?? 0,
    previous,
  });

  const serviceObject: ServiceObjectView = {
    id: object.id,
    name: object.name,
    category: object.category,
    glyph: object.glyph,
    description: object.description,
    photoDataUrl: object.photo_data_url,
    ownerLabel: owner?.display_name ?? 'Whirr operator',
    status: object.status,
    createdAt: object.created_at,
  };
  const tags = [
    'This passport is installation attestation: it proves this installation signed these bytes, not that a third party verified the object or the time.',
    'The acoustic signature is a calibration-fit consistency check, not an anti-spoof or identity document.',
    'A similar machine, playback or a changed room can reproduce or alter the sound. Whirr does not claim physical truth.',
    'Public stamps aggregate counts and hashes only; they do not publish renter identity or audio.',
    ...artifact.limitations.filter((limitation) => !limitation.toLowerCase().includes('synthetic')),
  ];
  if (artifact.provenance === 'SYNTHETIC_REFERENCE') {
    tags.unshift('This is a synthetic reference model. Its metrics demonstrate the protocol and are not real-object accuracy.');
  }

  const basePayload = {
    schema: 'whirr.passport.v2' as const,
    object: serviceObject,
    model: {
      version: modelRow.version,
      hash: modelRow.model_hash,
      status: modelRow.status,
      provenance: artifact.provenance,
      precision: artifact.metrics.precision,
      recall: artifact.metrics.recall,
      falseBillableRatio: artifact.metrics.falseBillableRatio,
      takeCount: artifact.training.takeCount,
      featureSpecVersion: artifact.featureSpecVersion,
      datasetHash: artifact.training.datasetHash,
      trainedAt: artifact.createdAt,
      soundprint: artifact.soundprint ?? null,
      validation,
    },
    terms: termsFor(termsRow),
    calibration: {
      ageDays: ageDays(ctx, modelRow.created_at),
      takeCount: artifact.training.takeCount,
      validation,
    },
    drift,
    stamps,
    limitations: tags,
    attestation: 'Signed by this Whirr installation. This is not a trusted timestamp, a third-party identity or proof that the physical object was present.',
  };
  // The previous-passport stamp is derived from the previous edition itself,
  // so it must not make an otherwise unchanged passport look different.
  const currentFacts = canonicalJson({
    ...basePayload,
    stamps: basePayload.stamps.filter((stamp) => stamp.kind !== 'passport'),
  });

  if (previous) {
    const previousPayload = JSON.parse(previous.document_json) as SignedPassport;
    if (factsFor(previousPayload.payload) === currentFacts) {
      const rows = ctx.store.all<PassportVersionRow>(
        'SELECT * FROM passport_versions WHERE object_id = ? ORDER BY version ASC',
        object.id,
      );
      return {
        envelope: previousPayload,
        history: rows.map((row) => ({ version: row.version, createdAt: row.created_at, payloadHash: row.payload_hash, keyId: row.key_id })),
        drift,
        validation,
        stamps: previousPayload.payload.stamps,
      };
    }
  }

  const version = (previous?.version ?? 0) + 1;
  const payload: PassportPayload = {
    ...basePayload,
    passportVersion: version,
    previousPassportHash: previous?.payload_hash ?? null,
    createdAt: ctx.now().toISOString(),
  };
  const envelope = await ctx.signer.sign('passport', payload);
  ctx.store.run(
    `INSERT INTO passport_versions (id, object_id, version, key_id, payload_hash, document_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    newId('ppt'),
    object.id,
    version,
    envelope.keyId,
    hashCanonical(payload),
    JSON.stringify(envelope),
    payload.createdAt,
  );
  const rows = ctx.store.all<PassportVersionRow>(
    'SELECT * FROM passport_versions WHERE object_id = ? ORDER BY version ASC',
    object.id,
  );
  return {
    envelope,
    history: rows.map((row) => ({ version: row.version, createdAt: row.created_at, payloadHash: row.payload_hash, keyId: row.key_id })),
    drift,
    validation,
    stamps: payload.stamps,
  };
}

export async function passportView(ctx: AppContext, object: ObjectRow): Promise<PassportView> {
  const modelRow = activeModel(ctx, object);
  if (!modelRow) throw new Error('No active model');
  const termsRow = activeTerms(ctx, object);
  const owner = ctx.store.get<UserRow>('SELECT * FROM users WHERE id = ?', object.owner_id);
  const sessions = ctx.store.get<{ count: number; last: string | null }>(
    'SELECT COUNT(*) AS count, MAX(created_at) AS last FROM sessions WHERE object_id = ?',
    object.id,
  );
  const artifact = parseArtifact(modelRow);
  const bundle = await passportForObject(ctx, object);
  return {
    object: {
      id: object.id,
      name: object.name,
      category: object.category,
      glyph: object.glyph,
      description: object.description,
      photoDataUrl: object.photo_data_url,
      ownerLabel: owner?.display_name ?? 'Whirr operator',
      status: object.status,
      createdAt: object.created_at,
    },
    model: modelSummary(modelRow),
    soundprint: artifact.soundprint ?? null,
    terms: termsRow ? { ...getTermsSafe(termsRow), id: termsRow.id, hash: termsRow.terms_hash } : null,
    sessionCount: sessions?.count ?? 0,
    lastSessionAt: sessions?.last ?? null,
    shareUrl: `${ctx.config.primaryPublicOrigin}/s/${object.id}`,
    signedPassport: bundle.envelope,
    passportHistory: bundle.history,
    drift: bundle.drift,
    validation: bundle.validation,
    stamps: bundle.stamps,
  };
}
