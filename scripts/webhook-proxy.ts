#!/usr/bin/env node
import http from 'node:http';
import { URL } from 'node:url';

/**
 * Loopback-only webhook ingress.
 *
 * This process exposes exactly one route: POST /api/paypal/webhook. Every
 * other method or path returns 404, so a tunnel pointed here cannot reach the
 * operator console or any other API route. It does not provide public HTTPS,
 * does not terminate TLS and does not make Gate E pass by itself.
 */

const PORT = Number(process.env.WHIRR_WEBHOOK_PROXY_PORT ?? 8790);
const HOST = process.env.WHIRR_WEBHOOK_PROXY_HOST ?? '127.0.0.1';
const target = new URL(process.env.WHIRR_API_ORIGIN ?? 'http://127.0.0.1:8787');
const MAX_BODY = 256 * 1024;
const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60_000;

if (target.hostname !== '127.0.0.1' && target.hostname !== 'localhost') {
  console.error('WHIRR_API_ORIGIN must be loopback. This proxy must never forward to a remote API.');
  process.exit(2);
}

const buckets = new Map<string, { count: number; resetAt: number }>();

function rateLimited(key: string): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }
  bucket.count += 1;
  return bucket.count > RATE_LIMIT;
}

function reject(res: http.ServerResponse, status: number, message: string): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify({ error: message }));
}

const server = http.createServer((req, res) => {
  if (req.method !== 'POST' || req.url !== '/api/paypal/webhook') {
    reject(res, 404, 'Not found');
    return;
  }
  const remote = req.socket.remoteAddress ?? 'unknown';
  if (rateLimited(remote)) {
    reject(res, 429, 'Too many webhook deliveries');
    return;
  }
  const declared = Number(req.headers['content-length'] ?? 0);
  if (Number.isFinite(declared) && declared > MAX_BODY) {
    reject(res, 413, 'Webhook body exceeds 256 KiB');
    return;
  }

  const chunks: Buffer[] = [];
  let total = 0;
  let aborted = false;
  req.on('data', (chunk: Buffer) => {
    if (aborted) return;
    total += chunk.length;
    if (total > MAX_BODY) {
      aborted = true;
      reject(res, 413, 'Webhook body exceeds 256 KiB');
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });
  req.on('end', () => {
    if (aborted) return;
    const body = Buffer.concat(chunks);
    const headers: http.OutgoingHttpHeaders = {};
    for (const [key, value] of Object.entries(req.headers)) {
      // Preserve the exact PayPal transmission headers. Do not forward cookies,
      // authorization, host overrides or arbitrary client headers.
      if (key.startsWith('paypal-') || key === 'content-type' || key === 'user-agent') {
        headers[key] = value;
      }
    }
    headers['content-length'] = String(body.length);
    headers.host = target.host;

    const upstream = http.request(
      {
        hostname: target.hostname,
        port: target.port || 80,
        path: '/api/paypal/webhook',
        method: 'POST',
        headers,
        timeout: 20_000,
      },
      (response) => {
        res.writeHead(response.statusCode ?? 502, {
          'content-type': response.headers['content-type'] ?? 'application/json; charset=utf-8',
          'cache-control': 'no-store',
        });
        response.pipe(res);
      },
    );
    upstream.on('timeout', () => {
      upstream.destroy(new Error('Upstream webhook timeout'));
    });
    upstream.on('error', () => {
      if (!res.headersSent) reject(res, 502, 'Webhook upstream unavailable');
      else res.end();
    });
    upstream.end(body);
  });
  req.on('error', () => {
    if (!res.headersSent) reject(res, 400, 'Could not read webhook body');
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Whirr webhook-only proxy on http://${HOST}:${PORT}`);
  console.log(`Forwarding only POST /api/paypal/webhook to ${target.origin}. All other paths return 404.`);
  console.log('This is loopback HTTP only: Gate E still requires public HTTPS and a genuine signed event.');
});

function shutdown(): void {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5_000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
