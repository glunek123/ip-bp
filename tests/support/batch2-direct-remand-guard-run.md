# 191 direct remand guard acceptance draft

This is a forward migration draft. The approved batch 2 target currently stops
at 190. Do not run 191 or this database probe until the operator separately
approves the 191 scope and records the updated owned-environment binding.

Pure source check, without PostgreSQL:

```powershell
. .\Use-ProjectRuntime.ps1
node --test tests/support/batch2-direct-remand-guard-migration.test.mjs
```

After explicit 191 approval and owned-environment rebind, use the existing
batch 2 owned wrapper. In that controlled PowerShell process, run:

```powershell
. .\Use-ProjectRuntime.ps1
$env:BATCH2_191_ACCEPTANCE_READY = 'approved-191-owned-schema'
node "$batch2Env/run.mjs" exec node --input-type=module -e 'const p = await import("./tests/support/batch2-direct-remand-guard-migration.mjs"); console.log(JSON.stringify(await p.verifyBatch2DirectRemandGuardMigration()));'
```

The probe applies the
actual 191 file in a new random schema and probes first-child acceptance,
re-registration after a revoked child, active/missing intermediate rounds,
wrong case/department/entry/root/result/revocation, and a non-latest child.
The probe never applies 191 to public. It drops only its own random schema.

The full chain still needs the existing
`tests/e2e/batch2-refund-lifecycle.spec.ts` remand scenario against the final
candidate after an authorized public migration. That scenario exercises real
HTTP acceptance, judgment registration, correction, reminder and refund facts.
Static tests and the isolated helper probe cannot replace it.
