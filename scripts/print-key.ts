import { loadConfig } from '../apps/api/src/config.ts';

try {
  const config = loadConfig();
  console.log('Whirr operator key');
  console.log('==================');
  console.log(config.operatorKey);
  console.log('');
  console.log(`Source: ${config.operatorKeySource}`);
  console.log('Use this on /operator/login. Treat it like a password; it is never sent to the browser.');
  console.log('The server stores only a hash-chain audit entry for successful and failed sign-ins.');
} catch (error) {
  console.error(`Could not load the operator key: ${(error as Error).message}`);
  process.exitCode = 1;
}
