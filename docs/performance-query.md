# Query performance

**Scope:** local SQLite prepared statements for Ambient agreement/session/provider lookups
**Review date:** 10 November 2026
**Status:** local synthetic measurement; not a production capacity claim

## Command

```bash
npm run setup
npm run bench:query
```

The command copies the local seeded database to a temporary directory, inserts
1,000 synthetic Ambient sessions and payment operations, warms the prepared
statements, then records 2,000 lookups per query. It writes
`docs/performance-query.json` with the hardware, dataset size, p50, p95, maximum,
and the actual `EXPLAIN QUERY PLAN` details.

The synthetic rows use a real seeded agreement, object, buyer, and provider. The
measurement is repeatable but not representative of a large production dataset,
concurrent clients, HTTP serialization, browser audio, or PayPal latency.

## Indexed paths

The migration adds:

- `idx_ambient_sessions_agreement` for the latest session by agreement;
- `idx_ambient_sessions_order`, `..._authorization`, `..._capture`, and `..._void`
  for provider callback/reconciliation lookups;
- `idx_ambient_payment_operations_provider` for operation lookup by provider
  reference.

`tests/unit/db-migration.test.ts` asserts the indexes exist and that SQLite's
query planner uses them for the three dominant reads.

## Results

Use the committed `docs/performance-query.json` for the exact machine-readable
result. Report the hardware, row count, and sample size with any p50/p95 values;
do not turn these local numbers into a production-scale claim. Full HTTP load,
multi-process writers, browser audio latency, and larger datasets remain open
for #10.
