import 'dotenv/config';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { SANDBOX_BASE_URL } from '../../../packages/paypal/src/client.ts';

export interface PayPalRuntimeConfig {
  configured: boolean;
  env: 'sandbox';
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  webhookId: string | null;
  webhookConfigured: boolean;
}

export interface Config {
  rootDir: string;
  port: number;
  host: string;
  dataDir: string;
  dbPath: string;
  publicOrigins: string[];
  primaryPublicOrigin: string;
  trustProxy: boolean;
  cookieSecret: string;
  operatorKey: string;
  operatorKeySource: string;
  paypal: PayPalRuntimeConfig;
  demoMode: boolean;
  rateLimitPerMinute: number;
  production: boolean;
  serveStatic: boolean;
  webDistPath: string;
  referenceModelPath: string;
  fixturesDir: string;
  logLevel: string;
  cookieSecure: boolean;
}

function envString(name: string): string | undefined {
  const value = process.env[name];
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function secretFile(dir: string, name: string): { value: string; source: string } {
  const filePath = path.join(dir, name);
  if (existsSync(filePath)) {
    const value = readFileSync(filePath, 'utf8').trim();
    if (value.length >= 16) return { value, source: filePath };
  }
  const value = randomBytes(32).toString('hex');
  writeFileSync(filePath, `${value}\n`, { mode: 0o600 });
  return { value, source: filePath };
}

export function normaliseOrigin(origin: string): string {
  return origin.trim().replace(/\/$/, '');
}

/** Rejects malformed, credentialed or path-bearing public origins. */
export function parsePublicOrigin(value: string): string {
  const normalised = normaliseOrigin(value);
  let url: URL;
  try {
    url = new URL(normalised);
  } catch {
    throw new Error(`Invalid public origin: ${value}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Public origins must use http or https: ${value}`);
  }
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error(`Public origins must not contain credentials, a path, query or fragment: ${value}`);
  }
  return url.origin;
}

export function loadConfig(overrides: Partial<Config> = {}): Config {
  const rootDir = overrides.rootDir ?? process.cwd();
  const dataDir = path.resolve(rootDir, envString('WHIRR_DATA_DIR') ?? 'data');
  ensureDir(dataDir);
  const dbPath = path.resolve(rootDir, envString('WHIRR_DB_PATH') ?? path.join(dataDir, 'whirr.db'));
  if (dbPath !== ':memory:') ensureDir(path.dirname(dbPath));

  const secretsDir = path.resolve(rootDir, '.whirr');
  ensureDir(secretsDir);

  const envCookieSecret = envString('WHIRR_COOKIE_SECRET');
  const cookieSecret = overrides.cookieSecret ?? envCookieSecret ?? secretFile(secretsDir, 'cookie-secret').value;
  const envOperatorKey = envString('WHIRR_OPERATOR_KEY');
  const operator = envOperatorKey
    ? { value: envOperatorKey, source: 'WHIRR_OPERATOR_KEY' }
    : secretFile(secretsDir, 'operator-key');
  const operatorKey = overrides.operatorKey ?? operator.value;

  if (operatorKey.length < 24) {
    throw new Error('WHIRR_OPERATOR_KEY must be at least 24 characters. Generate one with `openssl rand -hex 32`.');
  }
  if (cookieSecret.length < 32) {
    throw new Error('WHIRR_COOKIE_SECRET must be at least 32 characters.');
  }

  const port = overrides.port ?? Number(envString('WHIRR_PORT') ?? 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('WHIRR_PORT is invalid');
  const host = overrides.host ?? envString('WHIRR_HOST') ?? '127.0.0.1';
  const trustProxy = overrides.trustProxy ?? envString('WHIRR_TRUST_PROXY') === '1';
  const production = overrides.production ?? process.env.NODE_ENV === 'production';

  const envPaypal = envString('PAYPAL_ENV') ?? 'sandbox';
  if (envPaypal !== 'sandbox') {
    throw new Error(
      'Whirr is a PayPal Sandbox-only prototype and refuses PAYPAL_ENV other than "sandbox". No real money may move.',
    );
  }

  const clientId = overrides.paypal?.clientId ?? envString('PAYPAL_CLIENT_ID') ?? '';
  const clientSecret = overrides.paypal?.clientSecret ?? envString('PAYPAL_CLIENT_SECRET') ?? '';
  const webhookId = overrides.paypal?.webhookId ?? envString('PAYPAL_WEBHOOK_ID') ?? null;
  const baseUrl = overrides.paypal?.baseUrl ?? envString('PAYPAL_BASE_URL') ?? SANDBOX_BASE_URL;
  try {
    const url = new URL(baseUrl);
    const hostname = url.hostname;
    const isSandbox = hostname === 'api-m.sandbox.paypal.com';
    const isLoopback = hostname === '127.0.0.1' || hostname === 'localhost';
    if (!isSandbox && !isLoopback) {
      throw new Error(
        'PAYPAL_BASE_URL must be https://api-m.sandbox.paypal.com (loopback is allowed only for local contract tests).',
      );
    }
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
      throw new Error('PAYPAL_BASE_URL must not contain credentials, a path, query or fragment.');
    }
    if (production && isLoopback) {
      throw new Error('PAYPAL_BASE_URL loopback is not allowed when NODE_ENV=production.');
    }
  } catch (error) {
    throw new Error(`Invalid PAYPAL_BASE_URL: ${(error as Error).message}`, { cause: error });
  }

  const configured = Boolean(clientId && clientSecret);
  const paypal: PayPalRuntimeConfig = {
    configured,
    env: 'sandbox',
    baseUrl,
    clientId,
    clientSecret,
    webhookId: webhookId ?? null,
    webhookConfigured: Boolean(configured && webhookId),
  };

  const envPublicOrigin = envString('WHIRR_PUBLIC_ORIGIN');
  const localDevOrigins = [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    `http://localhost:${port}`,
    `http://127.0.0.1:${port}`,
  ];
  const localHost = host === '127.0.0.1' || host === 'localhost';
  if (production && !envPublicOrigin && !overrides.publicOrigins && !localHost) {
    throw new Error('WHIRR_PUBLIC_ORIGIN is required when NODE_ENV=production and WHIRR_HOST is not loopback.');
  }
  // A configured public origin replaces localhost defaults in production so a
  // deployed instance does not accept state-changing requests from localhost.
  const configuredOrigins = [
    ...(envPublicOrigin ? [envPublicOrigin] : []),
    ...(production ? [] : localDevOrigins),
  ].map(parsePublicOrigin);
  const publicOrigins = [
    ...new Set((overrides.publicOrigins ?? configuredOrigins).map(parsePublicOrigin)),
  ];
  if (publicOrigins.length === 0) throw new Error('At least one WHIRR_PUBLIC_ORIGIN is required.');
  const primaryPublicOrigin = parsePublicOrigin(
    overrides.primaryPublicOrigin ?? publicOrigins[0] ?? `http://localhost:${port}`,
  );
  if (production && primaryPublicOrigin.startsWith('http://')) {
    const hostname = new URL(primaryPublicOrigin).hostname;
    if (hostname !== 'localhost' && hostname !== '127.0.0.1') {
      throw new Error('WHIRR_PUBLIC_ORIGIN must use HTTPS when NODE_ENV=production.');
    }
  }

  const cookieSecureEnv = envString('WHIRR_COOKIE_SECURE');
  const cookieSecure =
    overrides.cookieSecure ?? (cookieSecureEnv === '1' || primaryPublicOrigin.startsWith('https://'));

  const configuredRateLimit =
    overrides.rateLimitPerMinute ?? Number(envString('WHIRR_RATE_LIMIT_PER_MINUTE') ?? 600);
  if (!Number.isInteger(configuredRateLimit) || configuredRateLimit < 1 || configuredRateLimit > 100_000) {
    throw new Error('WHIRR_RATE_LIMIT_PER_MINUTE must be an integer between 1 and 100000.');
  }

  const webDistPath = overrides.webDistPath ?? path.resolve(rootDir, 'apps/web/dist');
  const serveStatic = overrides.serveStatic ?? (production ? true : existsSync(webDistPath));

  return {
    rootDir,
    port,
    host,
    dataDir,
    dbPath,
    publicOrigins,
    primaryPublicOrigin,
    trustProxy,
    cookieSecret,
    operatorKey,
    operatorKeySource: envOperatorKey ? 'WHIRR_OPERATOR_KEY' : operator.source,
    paypal,
    demoMode: !configured,
    rateLimitPerMinute: configuredRateLimit,
    production,
    serveStatic,
    webDistPath,
    referenceModelPath: overrides.referenceModelPath ?? path.resolve(rootDir, 'models/whirr-reference-fan.json'),
    fixturesDir: overrides.fixturesDir ?? path.resolve(rootDir, 'fixtures/generated'),
    logLevel: overrides.logLevel ?? envString('WHIRR_LOG_LEVEL') ?? 'info',
    cookieSecure,
  };
}
