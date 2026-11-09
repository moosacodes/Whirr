import 'dotenv/config';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { Config } from './config.ts';
import { normaliseOrigin } from './config.ts';
import { Store } from './db/index.ts';
import type { AppContext } from './context.ts';
import { RateLimiter } from './lib/rate-limit.ts';
import { ensureOperatorUser } from './lib/auth.ts';
import { loadSigner } from './lib/signing.ts';
import { AppError, errors } from './lib/errors.ts';
import { registerRoutes } from './routes/index.ts';
import { PayPalClient } from '../../../packages/paypal/src/client.ts';

export interface CreateAppOptions {
  logger?: boolean;
  paypal?: PayPalClient | null;
}

export interface CreatedApp {
  app: FastifyInstance;
  ctx: AppContext;
}

export async function createApp(config: Config, options: CreateAppOptions = {}): Promise<CreatedApp> {
  const store = new Store(config.dbPath);
  const paypal =
    options.paypal !== undefined
      ? options.paypal
      : config.paypal.configured
        ? new PayPalClient({
            baseUrl: config.paypal.baseUrl,
            clientId: config.paypal.clientId,
            clientSecret: config.paypal.clientSecret,
            webhookId: config.paypal.webhookId,
          })
        : null;

  const signer = await loadSigner(config.rootDir);
  const ctx: AppContext = {
    config,
    store,
    paypal,
    limiter: new RateLimiter(),
    signer,
    now: () => new Date(),
  };
  ensureOperatorUser(ctx);
  store.run(
    `INSERT INTO signing_keys (key_id, public_key, algorithm, created_at, retired_at)
     VALUES (?, ?, 'ECDSA_P256_SHA256', ?, NULL)
     ON CONFLICT(key_id) DO NOTHING`,
    signer.keyId,
    signer.publicKey,
    signer.createdAt,
  );

  const app = Fastify({
    logger:
      options.logger === false
        ? false
        : {
            level: config.logLevel,
            redact: {
              paths: [
                'req.headers.authorization',
                'req.headers.cookie',
                'req.headers["paypal-transmission-sig"]',
                'req.headers["paypal-cert-url"]',
                'res.headers["set-cookie"]',
              ],
              censor: '[redacted]',
            },
          },
    trustProxy: config.trustProxy,
    bodyLimit: 12 * 1024 * 1024,
    ajv: { customOptions: { removeAdditional: false } },
  });

  await app.register(cookie, { secret: config.cookieSecret });

  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    const text = typeof body === 'string' ? body : body.toString('utf8');
    if (req.url.startsWith('/api/paypal/webhook')) {
      (req as typeof req & { rawBody?: string }).rawBody = text;
    }
    try {
      done(null, text.length ? JSON.parse(text) : {});
    } catch (error) {
      const parseError = error as Error & { statusCode?: number };
      parseError.statusCode = 400;
      done(parseError, undefined);
    }
  });

  app.addHook('onRequest', async (req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Cross-Origin-Opener-Policy', 'same-origin');
    reply.header('Cross-Origin-Resource-Policy', 'same-origin');
    reply.header(
      'Permissions-Policy',
      'microphone=(self), camera=(self), fullscreen=(self), geolocation=(), payment=(self)',
    );
    reply.header(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "base-uri 'self'",
        "object-src 'none'",
        "frame-ancestors 'none'",
        "form-action 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "font-src 'self'",
        "media-src 'self' blob:",
        "connect-src 'self'",
        "worker-src 'self' blob:",
      ].join('; '),
    );
    if (config.production && (req.protocol === 'https' || req.headers['x-forwarded-proto'] === 'https')) {
      reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    const result = ctx.limiter.check(`global:${req.ip}`, config.rateLimitPerMinute, 60_000);
    if (!result.allowed) throw errors.tooMany();
  });

  app.addHook('preHandler', async (req) => {
    const method = req.method.toUpperCase();
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return;
    if (req.url.startsWith('/api/paypal/webhook')) return;

    const origin = req.headers.origin;
    if (typeof origin === 'string' && origin.length > 0) {
      const normalised = normaliseOrigin(origin);
      if (!config.publicOrigins.includes(normalised)) {
        throw new AppError(403, 'ORIGIN_REJECTED', 'Cross-origin state changes are not allowed.');
      }
    }
    const fetchSite = req.headers['sec-fetch-site'];
    if (typeof fetchSite === 'string' && !['same-origin', 'none'].includes(fetchSite)) {
      throw new AppError(403, 'CROSS_SITE_REJECTED', 'Cross-site state changes are not allowed.');
    }
    if (req.headers['x-whirr-csrf'] !== '1') {
      throw new AppError(403, 'CSRF_HEADER_REQUIRED', 'Missing same-origin request header.');
    }
  });

  app.addHook('onSend', async (req, reply, payload) => {
    if (req.url.startsWith('/api/')) reply.header('Cache-Control', 'no-store');
    return payload;
  });

  registerRoutes(app, ctx);

  if (config.serveStatic && existsSync(path.join(config.webDistPath, 'index.html'))) {
    await app.register(fastifyStatic, {
      root: config.webDistPath,
      wildcard: true,
      index: ['index.html'],
      cacheControl: true,
      maxAge: '1h',
      dotfiles: 'deny',
      immutable: false,
    });
  }

  app.setErrorHandler((error, req, reply) => {
    if (error instanceof AppError) {
      reply.code(error.statusCode).send({
        error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) },
      });
      return;
    }
    const fastifyError = error as Error & { code?: string; statusCode?: number };
    const statusCode = fastifyError.statusCode;
    if (statusCode === 413 || fastifyError.code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
      reply.code(413).send({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large.' } });
      return;
    }
    if (statusCode === 415 || fastifyError.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE') {
      reply.code(415).send({ error: { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Unsupported content type.' } });
      return;
    }
    if (fastifyError.code === 'FST_ERR_CTP_INVALID_JSON_BODY' || statusCode === 400) {
      reply.code(400).send({ error: { code: 'INVALID_JSON', message: 'Request body is not valid JSON.' } });
      return;
    }
    if (statusCode && statusCode >= 400 && statusCode < 500) {
      reply.code(statusCode).send({
        error: {
          code: statusCode === 403 ? 'FORBIDDEN' : 'REQUEST_REJECTED',
          message: statusCode === 403 ? 'Request forbidden.' : 'Request rejected.',
        },
      });
      return;
    }
    req.log.error({ err: error }, 'Unhandled request error');
    reply.code(500).send({ error: { code: 'INTERNAL', message: 'Unexpected server error.' } });
  });

  app.addHook('onClose', async () => {
    store.close();
  });

  return { app, ctx };
}
