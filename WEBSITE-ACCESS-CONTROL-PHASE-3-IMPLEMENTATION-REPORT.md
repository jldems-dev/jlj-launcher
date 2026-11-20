# JLJ Gaming House — Website Access Control
## Phase 3 Implementation Report — Halted for Database Compatibility Review

**Status: Implementation halted. Do not launch this working tree against the runtime database or release it until the migration conflict below is resolved.**

## Summary

The approved Phase 3A–3F work was started: owner session/security groundwork, domain rule helpers, SQL.js repository/migration code, versioned JSON import/export, narrow IPC/preload methods, and a section in the existing Owner Settings modal were added. Network enforcement, DNS configuration, Windows policies, the service, installer, and release workflow were not touched.

During a disposable-copy migration check, the runtime user database was found to already contain a Website Access Control schema and a version 1 migration ledger whose checksum does not match the migration implemented here. The source repository’s legacy `database/launcher.db` does not have these tables. The runtime schema also lacks the new `log_retention_days` column. Because the exact prior migration definition is not present in the source project, I stopped before attempting to adopt or rewrite its migration history.

The runtime database itself was read only. No application startup or migration was run against it. Inspection found zero website rules, zero exceptions, zero activity-log records, and one row each in the settings and service-status tables. No domain values or owner/game records were read into the report.

## Implemented so far

- Owner login success establishes a main-process session bound to the trusted main frame; website IPC checks sender, session, and expiration. Logout, main-frame navigation, hidden window, Windows lock, and suspend invalidate the session.
- Legacy plaintext credentials are verified compatibly and upgraded to salted Node `scrypt` hashes after a successful login. The renderer hardcoded login fallback was removed; no password is exported or logged by the new feature.
- Added IDNA/Punycode normalization, domain validation, duplicate handling, label-boundary matching, disabled-rule handling, and specificity/block-priority logic.
- Added website rules/settings/exceptions/log/status schema and a SQL.js repository, plus a verified byte-copy backup routine and atomic database file replacement.
- Added bounded JSON import preview/confirmation, normalized export, rule/settings/log APIs, and UI controls inside the existing Owner Settings modal.
- UI explicitly identifies the service as not installed, describes settings as stored only, leaves enforcement unavailable, and shows activity logs as unavailable rather than fabricating records.

These are incomplete and must not be considered ready for deployment until the migration issue and remaining checks are resolved.

## Files changed

Modified:

- `assets/css/style.css`
- `index.html`
- `src/main/ipc/registerIpcHandlers.js`
- `src/main/main.js`
- `src/main/storage/defaultData.js`
- `src/main/storage/gameStore.js`
- `src/preload/electronApi.js`
- `src/renderer/core/init.js`
- `src/renderer/features/library.js`
- `src/renderer/features/ownerSettings.js`

Added:

- `src/main/security/ipcSecurity.js`
- `src/main/security/ownerSession.js`
- `src/main/security/passwordVerifier.js`
- `src/main/storage/websiteAccessMigrations.js`
- `src/main/storage/websiteAccessRepository.js`
- `src/main/websiteAccess/domainRules.js`
- `src/main/websiteAccess/importExport.js`
- `test/ownerSecurity.test.js`
- `test/websiteAccessMigration.test.js`
- `test/websiteDomainRules.test.js`
- `WEBSITE-ACCESS-CONTROL-PHASE-3-IMPLEMENTATION-REPORT.md`

The three earlier Phase 1–3 planning reports were already untracked before this implementation and were left untouched. `package.json`, `package-lock.json`, installer configuration, release workflow, updater configuration, and the real runtime/repository database files were not changed.

## Database migration finding

The runtime database at `%APPDATA%\jljgaminghouse\database\launcher.db` already contains:

- `schema_migrations` with version 1 and a 64-character checksum;
- `website_rules` (0 rows);
- `website_access_settings` (1 row; its existing columns do not include `log_retention_days`);
- `website_exceptions` (0 rows);
- `website_access_log` (0 rows);
- `website_service_status` (1 row).

The repository seed database contains none of these Website Access Control tables. On a disposable byte-for-byte copy of the runtime database, the new migration stopped with `Website migration checksum mismatch at version 1`. This is the intended guard refusing to overwrite unknown migration history. Consequently the app’s startup migration path is **not safe for the current runtime database yet** and must not be shipped as-is.

Before resuming implementation, identify the exact migration that created the runtime schema and reconcile it without discarding its checksum/history. Then add a sequential additive migration for any missing columns. Re-run the compatibility check against a fresh disposable copy and compare all existing owner, game, settings, map, and PC-spec rows. Do not bypass checksum validation or replace the runtime DB with the repository seed.

## Tests and validation

- `npm.cmd test`: **passed**, 28 tests, 0 failures. This includes current project tests plus domain normalization/matching, migration transaction/checksum behavior on a fresh in-memory DB, import preview, password verifier, session expiry, and trusted-frame authorization.
- Disposable migration against a copy of the actual runtime DB: **stopped as expected** on the version 1 checksum mismatch. The copy was not used to modify the real DB. The failed temp copy was removed after verifying its generated path was inside the system temp directory.
- Real runtime DB: **not migrated or written**.
- Application startup against the real runtime DB: **not run**.
- `npm run validate:release`: not run.
- `npm run build`: not run.
- Existing game, Steam, Roblox, hosting, and application-update flows were not manually exercised; full regression validation remains outstanding.

## Remaining security and implementation review

- The runtime DB’s pre-existing Website Access Control schema must be reconciled before migration code is usable.
- New/empty database owner bootstrap currently has no interactive recovery/setup flow; no shared default password is created. Confirm how a trusted operator initializes such a database before deploying where no owner row exists.
- Existing weak owner passwords remain usable for compatibility and are hashed on successful login; a controlled password-change/recovery flow is still needed to strengthen weak legacy credentials.
- Session expiry is checked on protected requests; expiry is not proactively timed while the UI is idle. Protected operations still reject expired sessions.
- UI/browser behavior, import/export file dialogs, real Electron IPC, app startup, and Windows 10 behavior were not exercised end-to-end.
- No actual DNS activity exists because the future DNS service is intentionally out of scope.

## Explicit non-changes

No real database records, DNS adapter settings, IPv4/IPv6 settings, Windows Firewall rules, registry values, Brave or Edge policies, Windows services, installer settings, release workflow, auto-updater, or dependencies were modified. No website enforcement was activated.

**Work is stopped here pending review of the runtime database’s existing migration history.**
