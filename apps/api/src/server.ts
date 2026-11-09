import { loadConfig } from './config.ts';
import { createApp } from './app.ts';
import { drainOutbox } from './domain/webhooks.ts';

async function main(): Promise<void> {
  const config = loadConfig();
  const { app, ctx } = await createApp(config);

  await app.listen({ port: config.port, host: config.host });

  const base = `http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}`;
  app.log.info(
    {
      base,
      devUi: 'http://localhost:5173',
      db: config.dbPath,
      paypal: config.paypal.configured
        ? { mode: 'PayPal Sandbox (real provider calls, simulated funds)', webhook: config.paypal.webhookConfigured }
        : { mode: 'DEMO metering only — no PayPal credentials configured, no payment will be processed' },
      operatorKeyFile: config.operatorKeySource,
    },
    'Whirr is running',
  );
  if (config.demoMode) {
    app.log.warn('PayPal Sandbox is not configured. Payments are disabled; sessions are labelled demo metering.');
  }
  app.log.info('Operator key: run `npm run key` (or read the operatorKeyFile above). It is never logged or sent to the browser.');

  const timer = setInterval(() => {
    drainOutbox(ctx).catch((error) => {
      app.log.warn({ err: error }, 'Outbox drain failed');
    });
  }, 15_000);
  timer.unref();

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'Shutting down');
    clearInterval(timer);
    try {
      await app.close();
    } finally {
      process.exit(0);
    }
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error) => {
  console.error('Whirr failed to start:', error);
  process.exit(1);
});
