# Website Access Control Migration Fix Report

**Result:** Migration repair implemented and regression suite passes. Electron main-process store startup passed against a disposable copy of the current runtime database. The live user database was inspected read-only and was already at migration version 2; this repair did not run a schema migration against it.

## Root causes

- **Version 1 checksum mismatch:** migration v1 had been edited after it was deployed. The deployed checksum (`6452a341132a9f7d61952ed12e7bd832f3281560221c096f566695ab10411da9`) matches the original v1 SQL exactly. Adding the retention column and index to v1 changed its checksum, so validation correctly rejected the existing ledger.
- **Missing `log_retention_days`:** deployed v1 did not define this column, while repository settings queries expected it. The mismatch prevented the migration runner from advancing to a schema revision that could add it.

## Changes

- Restored the original v1 SQL as immutable and added v2, which adds `log_retention_days INTEGER NOT NULL DEFAULT 30` with a range check and creates the rules action index.
- Made migrations apply sequentially, transactionally, and in ledger order. Existing checksums are validated and never rewritten. The completed schema is checked before repository access is enabled.
- Added a repository readiness guard so Website Access Control operations fail closed if initialization or migration fails.
- Added a pre-schema-change backup path in the main SQL.js store. It integrity-checks the source, copies it to a unique backup, verifies byte-identical SHA-256 and backup integrity, then applies changes. A post-startup database integrity check is also performed.
- Added migration regression tests and a disposable-profile Electron main-process startup smoke script.

## Database and backup status

- Read-only inspection of `%APPDATA%\\jljgaminghouse\\database\\launcher.db` found migration versions `[1, 2]`, the original v1 checksum above, `log_retention_days` present, one existing website rule, and `PRAGMA integrity_check = ok`. No rule domain or other personal record values were included in the report.
- That live database was already at v2 during inspection. No new pre-v2 backup was created by this repair. The existing `.pre-website-access-v1-...bak` predates the Website Access Control schema and is not represented as a v2 migration backup.
- A disposable copy of the runtime database was started through Electron's main-process store. Startup passed, existing records and schemas in the snapshot remained unchanged, v1 checksum was preserved, v2 remained current, retention default was 30, and integrity was `ok`. The disposable profile was removed after the check. Electron emitted Windows crypto/GPU diagnostic warnings in the disposable profile; they did not prevent the store startup check.
- The regression fixture that starts at v1 verifies that a byte-identical, integrity-checked backup exists before v2 is applied.

## Files changed for this repair

- `src/main/storage/websiteAccessMigrations.js`
- `src/main/storage/gameStore.js`
- `src/main/storage/websiteAccessRepository.js`
- `test/websiteAccessMigration.test.js`
- `test/gameStoreWebsiteMigration.test.js`
- `scripts/websiteAccessMigrationSmoke.js`
- `src/main/storage/defaultData.js` (removed trailing whitespace only)
- `WEBSITE-ACCESS-CONTROL-MIGRATION-FIX-REPORT.md`

Other Website Access Control source/UI work and planning reports already existed in the working tree before this repair; they were not replaced or reset. No dependencies, package files, release workflow, installer, updater, Windows settings, or live database records were intentionally modified.

## Validation

- `npm.cmd test`: **passed**, 34 tests, 0 failures. Includes fresh initialization, deployed v1 checksum validation, existing-record upgrade/default, tampered checksum rejection, idempotent repeat startup, failed migration rollback and recovery, repository readiness, backup verification, and data preservation.
- Electron main-process store smoke on disposable runtime DB copy: **passed**; v1 unchanged, v2 current, records preserved, integrity `ok`.
- `node scripts/validate-release.js --check-project --root .`: **passed** at project version `1.0.27`.
- `git diff --check`: **passed** after removing the trailing whitespace.
- No installer/build or full renderer/UI test was run. No release or tag was created.

## Remaining scope

The renderer/UI was not launched in this verification. The migration and Electron main-process store startup paths passed; the Windows crypto/GPU warnings from the disposable-profile Electron run should be assessed separately if they also occur in a normal user profile.
