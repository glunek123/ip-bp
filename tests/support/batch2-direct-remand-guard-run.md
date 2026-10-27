# 191 direct remand guard acceptance draft

The user approved 191 in the same isolated batch 2 environment. Source and
probe review still comes first; the root task alone runs the database and app.
The root task must update the owned-environment binding to the reviewed source
commit before any 191 probe. No probe in this file has been executed yet.

Pure source check, without PostgreSQL:

```powershell
. .\Use-ProjectRuntime.ps1
node --test tests/support/batch2-direct-remand-guard-migration.test.mjs
node --test tests/support/batch2-direct-remand-full-chain.test.mjs
```

After source review and owned-environment rebind, use the existing batch 2
wrapper. First run the complete historical chain probe in a random owned
schema. It applies every migration through 190, injects a fault before 191's
final COMMIT, proves rollback preserved the old function and removed the new
helper, retries the original 191 file, compares the 190 table inventory, and
verifies the random namespace is gone after cleanup.

```powershell
. .\Use-ProjectRuntime.ps1
$env:BATCH2_191_ACCEPTANCE_READY = 'approved-191-owned-schema'
node "$batch2Env/run.mjs" exec node --input-type=module -e 'const p = await import("./tests/support/batch2-direct-remand-full-chain.mjs"); console.log(JSON.stringify(await p.verifyBatch2DirectRemandFullChain()));'
```

Then run the independent three-table predicate probe, which tests source and
history negatives without claiming complete migration coverage:

```powershell
node "$batch2Env/run.mjs" exec node --input-type=module -e 'const p = await import("./tests/support/batch2-direct-remand-guard-migration.mjs"); console.log(JSON.stringify(await p.verifyBatch2DirectRemandGuardMigration()));'
```

The predicate probe applies the actual 191 file in a new random schema and probes first-child acceptance,
re-registration after a revoked child, active/missing intermediate rounds,
wrong case/department/entry/root/result/revocation, and a non-latest child.
The probe never applies 191 to public. It drops only its own random schema.

Only after both owned probes pass should the root task apply 191 to the
isolated public schema and rerun the existing
`tests/e2e/batch2-refund-lifecycle.spec.ts` remand scenario. It exercises real
HTTP acceptance, judgment registration, correction, reminder and refund facts.
Static tests and the isolated helper probe cannot replace it.
