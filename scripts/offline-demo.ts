import { createServer } from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from './reference-config.ts';

const DIST = path.join(ROOT, 'apps', 'web', 'dist');
const INDEX = path.join(DIST, 'index.html');
const PORT = Number(process.env.WHIRR_OFFLINE_PORT ?? 4174);
const HOST = '127.0.0.1';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.wav': 'audio/wav',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
};

function ensureBuild(): void {
  if (existsSync(INDEX)) return;
  console.log('No production build found; building the web app first…');
  const result = spawnSync('npx', ['vite', 'build', '--config', 'apps/web/vite.config.ts'], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: true,
  });
  if (result.status !== 0 || !existsSync(INDEX)) {
    throw new Error('Web build failed. Run `npm run build` and try again.');
  }
}

function openBrowser(url: string): void {
  if (process.platform === 'win32') spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
  else if (process.platform === 'darwin') spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
  else spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
}

function main(): void {
  ensureBuild();
  const server = createServer((req, res) => {
    try {
      const url = new URL(req.url ?? '/', `http://${HOST}:${PORT}`);
      let pathname = decodeURIComponent(url.pathname);
      if (pathname === '/') pathname = '/demo/offline';
      const candidate = path.resolve(DIST, `.${pathname}`);
      const relative = path.relative(DIST, candidate);
      if (relative.startsWith('..') || path.isAbsolute(relative)) {
        res.writeHead(403).end('Forbidden');
        return;
      }
      let file = candidate;
      if (!existsSync(file) || !statSync(file).isFile()) file = INDEX;
      if (!existsSync(file)) {
        res.writeHead(404).end('Not found');
        return;
      }
      const type = MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
      res.writeHead(200, {
        'Content-Type': type,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(readFileSync(file));
    } catch (error) {
      res.writeHead(500).end(`Offline replay error: ${(error as Error).message}`);
    }
  });
  server.listen(PORT, HOST, () => {
    const url = `http://${HOST}:${PORT}/demo/offline`;
    console.log('Whirr offline replay');
    console.log(`  ${url}`);
    console.log('No API, no login, no database. The synthetic fixture and reference model are loaded as static files.');
    console.log('Press Ctrl+C to stop.');
    openBrowser(url);
  });
  const shutdown = () => {
    server.close(() => process.exit(0));
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

try {
  main();
} catch (error) {
  console.error((error as Error).message);
  process.exitCode = 1;
}
