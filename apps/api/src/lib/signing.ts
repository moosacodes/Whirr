import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import path from 'node:path';
import { webcrypto } from 'node:crypto';
import {
  bytesToBase64,
  keyIdForPublicKey,
  signEnvelope,
  type SignedDocumentType,
  type SignedEnvelope,
} from '../../../../packages/protocol/src/index.ts';

interface KeyFile {
  schema: 'whirr.signing-key.v1';
  createdAt: string;
  publicKey: string;
  privateKey: string;
}

export interface Signer {
  keyId: string;
  publicKey: string;
  algorithm: 'ECDSA_P256_SHA256';
  createdAt: string;
  source: string;
  sign<T>(type: SignedDocumentType, payload: T): Promise<SignedEnvelope<T>>;
}

async function generateKeyFile(): Promise<KeyFile> {
  const pair = await webcrypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  );
  const privateKey = await webcrypto.subtle.exportKey('pkcs8', pair.privateKey);
  const publicKey = await webcrypto.subtle.exportKey('spki', pair.publicKey);
  return {
    schema: 'whirr.signing-key.v1',
    createdAt: new Date().toISOString(),
    publicKey: bytesToBase64(new Uint8Array(publicKey)),
    privateKey: bytesToBase64(new Uint8Array(privateKey)),
  };
}

export async function loadSigner(rootDir: string): Promise<Signer> {
  const dir = path.join(rootDir, '.whirr');
  const file = path.join(dir, 'signing-key.json');
  mkdirSync(dir, { recursive: true });
  let record: KeyFile;
  if (existsSync(file)) {
    record = JSON.parse(readFileSync(file, 'utf8')) as KeyFile;
    if (record.schema !== 'whirr.signing-key.v1' || !record.publicKey || !record.privateKey) {
      throw new Error('The local signing key is unreadable or has an unsupported schema.');
    }
  } else {
    record = await generateKeyFile();
    writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
    try {
      chmodSync(file, 0o600);
    } catch {
      // Windows may not implement POSIX modes; the file is still under .whirr.
    }
  }
  const keyId = await keyIdForPublicKey(record.publicKey);
  return {
    keyId,
    publicKey: record.publicKey,
    algorithm: 'ECDSA_P256_SHA256',
    createdAt: record.createdAt,
    source: file,
    sign: <T>(type: SignedDocumentType, payload: T) =>
      signEnvelope(type, payload, record.privateKey, record.publicKey),
  };
}
