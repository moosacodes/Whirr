import { loadConfig } from '../apps/api/src/config.ts';
import { createApp } from '../apps/api/src/app.ts';
import { REFERENCE_FIXTURE_PATH, REFERENCE_OBJECT_ID } from './reference-config.ts';

async function main(): Promise<void> {
  const config = loadConfig();
  const { app } = await createApp(config, { logger: false });
  const failures: string[] = [];
  try {
    const health = await app.inject({ method: 'GET', url: '/api/health' });
    if (health.statusCode !== 200) failures.push(`health returned ${health.statusCode}`);
    if (health.headers['content-security-policy'] === undefined) failures.push('CSP header missing');
    if (health.headers['cache-control'] !== 'no-store') failures.push('API cache-control is not no-store');
    console.log(`health: ${health.statusCode}`);

    const judge = await app.inject({ method: 'GET', url: '/api/judge/status' });
    if (judge.statusCode !== 200) failures.push(`judge status returned ${judge.statusCode}`);
    const judgeBody = judge.json() as { reference: { available: boolean }; demoObjectId: string | null };
    console.log(`judge: ${judge.statusCode} · reference ${judgeBody.reference.available ? 'present' : 'missing'} · demo ${judgeBody.demoObjectId ?? 'missing'}`);
    if (!judgeBody.reference.available) failures.push('reference model is missing — run npm run setup');

    const service = await app.inject({ method: 'GET', url: `/api/service/${REFERENCE_OBJECT_ID}` });
    console.log(`service card: ${service.statusCode}`);
    if (service.statusCode !== 200) failures.push(`service card returned ${service.statusCode} (run npm run setup)`);

    const unauth = await app.inject({ method: 'GET', url: '/api/operator/objects' });
    if (unauth.statusCode !== 401) failures.push(`operator endpoint without a cookie returned ${unauth.statusCode}, expected 401`);

    const badLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/operator',
      headers: { 'content-type': 'application/json', 'x-whirr-csrf': '1' },
      payload: { key: 'not-the-operator-key-000000' },
    });
    if (badLogin.statusCode !== 401) failures.push(`bad operator key returned ${badLogin.statusCode}, expected 401`);

    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/operator',
      headers: { 'content-type': 'application/json', 'x-whirr-csrf': '1' },
      payload: { key: config.operatorKey },
    });
    if (login.statusCode !== 200) failures.push(`operator login returned ${login.statusCode}`);
    const setCookie = login.headers['set-cookie'];
    const cookie = Array.isArray(setCookie) ? setCookie[0]?.split(';')[0] : setCookie?.split(';')[0];
    if (cookie) {
      const objects = await app.inject({
        method: 'GET',
        url: '/api/operator/objects',
        headers: { cookie },
      });
      console.log(`operator session: ${objects.statusCode}`);
      if (objects.statusCode !== 200) failures.push(`authenticated operator endpoint returned ${objects.statusCode}`);
    } else {
      failures.push('login did not set an operator cookie');
    }

    const crossSite = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      headers: { 'content-type': 'application/json', origin: 'https://evil.example', 'x-whirr-csrf': '1' },
      payload: { objectId: REFERENCE_OBJECT_ID },
    });
    if (crossSite.statusCode !== 403) failures.push(`foreign origin returned ${crossSite.statusCode}, expected 403`);

    if (!REFERENCE_FIXTURE_PATH) failures.push('fixture path is not defined');
  } finally {
    await app.close();
  }

  if (failures.length) {
    console.error('\nSmoke failed:');
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exitCode = 1;
    return;
  }
  console.log('\nSmoke passed. This checks runtime plumbing, not the browser microphone or PayPal.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
