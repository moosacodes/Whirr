import { loadConfig } from '../apps/api/src/config.ts';
import { writeReferenceFixtures } from './generate-fixtures.ts';
import { trainReferenceModel } from './train-reference.ts';
import { seedReference } from './seed.ts';
import { writeEvaluation } from './evaluate-reference.ts';
import { seedPromise } from './seed-promise.ts';

async function main(): Promise<void> {
  console.log('Whirr setup\n');
  const config = loadConfig();
  console.log(`  database: ${config.dbPath}`);
  console.log(`  operator key file: ${config.operatorKeySource}`);
  console.log(`  PayPal: ${config.paypal.configured ? 'Sandbox credentials configured' : 'not configured — demo metering only'}`);
  console.log('');

  console.log('1/3 Generating synthetic reference fixtures…');
  const data = writeReferenceFixtures();
  console.log(`    ${data.takes.length} takes · ${(data.fixtureDurationMs / 1000).toFixed(1)}s WAV · ${data.fixtureLabel}`);
  console.log('    provenance: SYNTHETIC_REFERENCE');

  console.log('2/3 Training the reference classifier with leave-one-take-out validation…');
  const trained = trainReferenceModel();
  console.log(
    `    ${trained.artifact.status} · precision ${(trained.artifact.metrics.precision * 100).toFixed(2)}% · false billable ${(trained.artifact.metrics.falseBillableRatio * 100).toFixed(3)}%`,
  );
  if (trained.rejected) {
    console.warn('    WARNING: the reference model was rejected. Seeding will stop rather than fake a billable demo.');
  }

  console.log('3/3 Seeding the reference service…');
  const seeded = seedReference();
  const evaluation = writeEvaluation();
  console.log(`    object ${seeded.objectId} · model ${seeded.modelId} · terms ${seeded.termsId}`);
  console.log(
    `    fixture replay: ${(evaluation.fixture.billableMs / 1000).toFixed(2)}s billable → $${(evaluation.fixture.simulatedMinor / 100).toFixed(2)} simulated`,
  );

  console.log('4/4 Seeding the synthetic physical promise reference…');
  const promise = await seedPromise();
  console.log(`    agreement ${promise.agreementId} · event model ${promise.eventModelId} (${promise.modelStatus})`);
  console.log('    provenance: SYNTHETIC_REFERENCE — not a physical appliance field trial');

  console.log('\nReady.');
  console.log('  Read the operator key:  npm run key');
  console.log('  Start the app:          npm run dev');
  console.log(`  Reference service:      http://localhost:5173/s/${seeded.objectId}`);
  console.log('  Judge evidence:         http://localhost:5173/judge');
  console.log(`  Physical promise:       http://localhost:5173/promise/${promise.agreementId}`);
  if (!config.paypal.configured) {
    console.log('\nPayPal is not configured, so sessions are labelled demo metering and no payment is created.');
    console.log('Add Sandbox credentials to .env (see .env.example and docs/paypal-sandbox.md) to run the real provider flow.');
  }
}

try {
  await main();
} catch (error) {
  console.error(`\nSetup failed: ${(error as Error).message}`);
  process.exitCode = 1;
}
