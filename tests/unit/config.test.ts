import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadConfig, parsePublicOrigin, type Config } from '../../apps/api/src/config.ts';

const roots: string[] = [];

function root(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'whirr-config-'));
  roots.push(directory);
  return directory;
}

function config(overrides: Partial<Config> = {}): Config {
  return loadConfig({
    rootDir: root(),
    operatorKey: 'config-test-operator-key-0123456789abcdef',
    cookieSecret: 'config-test-cookie-secret-0123456789abcdef0123456789abcdef',
    dbPath: ':memory:',
    paypal: {
      configured: false,
      env: 'sandbox',
      baseUrl: 'https://api-m.sandbox.paypal.com',
      clientId: '',
      clientSecret: '',
      webhookId: null,
      webhookConfigured: false,
    },
    ...overrides,
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
  for (const directory of roots.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('security configuration', () => {
  it('canonicalises public origins and rejects credentials, paths and non-HTTP schemes', () => {
    expect(parsePublicOrigin('https://whirr.example/')).toBe('https://whirr.example');
    expect(parsePublicOrigin('https://whirr.example:443')).toBe('https://whirr.example');
    expect(() => parsePublicOrigin('https://whirr.example/path')).toThrow(/credentials, a path/);
    expect(() => parsePublicOrigin('https://user:pass@whirr.example')).toThrow(/credentials, a path/);
    expect(() => parsePublicOrigin('javascript:alert(1)')).toThrow(/http or https/);
  });

  it('marks cookies Secure when the primary public origin is HTTPS', () => {
    const loaded = config({
      publicOrigins: ['https://whirr.example'],
      primaryPublicOrigin: 'https://whirr.example',
    });
    expect(loaded.cookieSecure).toBe(true);
  });

  it('requires an explicit public origin in production on a non-loopback host', () => {
    vi.stubEnv('WHIRR_PUBLIC_ORIGIN', '');
    expect(() => config({ production: true, host: '0.0.0.0' })).toThrow(/WHIRR_PUBLIC_ORIGIN is required/);
  });

  it('refuses plaintext public origins in production', () => {
    expect(() =>
      config({
        production: true,
        host: '0.0.0.0',
        publicOrigins: ['http://whirr.example'],
        primaryPublicOrigin: 'http://whirr.example',
      }),
    ).toThrow(/must use HTTPS/);
  });
});
