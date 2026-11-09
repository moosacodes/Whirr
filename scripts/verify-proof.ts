#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { verifyDocument } from '../packages/verify/src/index.ts';

async function main(): Promise<void> {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: npm run proof:verify -- <document.json>');
    process.exitCode = 2;
    return;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(file, 'utf8')) as unknown;
  } catch (error) {
    console.error(`Could not read or parse ${file}: ${(error as Error).message}`);
    process.exitCode = 2;
    return;
  }
  if (!parsed || typeof parsed !== 'object' || (parsed as { schema?: string }).schema !== 'whirr.signed.v2') {
    console.error('LEGACY / NOT SIGNED: this is not a signed v2 Whirr envelope.');
    process.exitCode = 1;
    return;
  }
  const result = await verifyDocument(parsed);
  console.log(`Whirr ${result.kind} · ${result.valid ? 'VERIFIED' : 'NOT VERIFIED'}`);
  for (const check of result.checks) {
    console.log(`${check.pass ? 'PASS' : 'FAIL'}  ${check.label}: ${check.detail}`);
  }
  if (!result.valid) process.exitCode = 1;
}

void main();