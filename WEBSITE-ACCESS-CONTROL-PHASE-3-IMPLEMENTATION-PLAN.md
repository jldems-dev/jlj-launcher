# JLJ Gaming House — Website Access Control
## Phase 3: Settings UI and Website Rule Engine Implementation Plan

**Status:** Planning only. This report does not authorize implementation.

### Evidence labels

- **Verified:** observed in project source or a cited vendor source.
- **Proposal:** intended design for a future approved implementation.
- **Unverified:** not observable from this workspace or requires target-machine testing.

## 1. Recommendation and scope

**Proposal:** Build the owner-facing rules/settings interface inside the existing Owner Settings modal; keep Electron main as the only writer of `launcher.db`; use versioned SQL.js migrations and send validated policy snapshots through a narrow main-process service client to the future .NET Framework 4.8.1 service. The service, not Electron, will own DNS serving, enforcement and its protected last-known-good configuration. This phase does not activate enforcement or change DNS/browser/Windows policy.

The target browser set is Brave Browser and Microsoft Edge. Their enterprise policies can manage DNS-over-HTTPS (DoH), but policy behavior must be verified against the installed versions on the target PCs. I could not identify installed Brave or Edge executables or version values from the inspected workspace, so actual installed versions are **unverified**. Microsoft’s Edge policy documentation currently lists Windows support beginning at version 83 and documents the `off`, `automatic`, and `secure` modes. Brave officially supports Chromium policies and publishes Brave Windows policy templates; exact policy acceptance and application must still be tested against the installed Brave version. [Edge DoH mode](https://learn.microsoft.com/en-us/deployedge/microsoft-edge-policies/dnsoverhttpsmode), [Brave Group Policy](https://support.brave.app/hc/en-us/articles/360039248271-Group-Policy)

The feature is not a complete URL filter. DNS filtering sees domain lookups and can be bypassed by direct IP, encrypted tunnels, VPNs/proxies, unsupported applications, or local administrators. This limitation should be shown in operator help and customer-facing notice.

## 2. Existing integration points and verified behavior

The application uses classic HTML/CSS/JavaScript, not React. `index.html` contains `#ownerSettingsModal`; it currently has Socket.IO server settings, diagnostics, and PC Information Management. `src/renderer/features/ownerSettings.js` binds buttons, loads status/data, and opens/closes the modal. `assets/css/style.css` contains `.settings-panel`, `.settings-section-header`, and modal styles. The Website Access Control interface should append a section in this existing panel. Do not add a sidebar item, separate window, or new Settings page.

`src/renderer/core/state.js` contains renderer `State.isOwnerLoggedIn`; `src/renderer/features/library.js` sets and clears that UI state after login/logout; `src/renderer/core/init.js` initializes app behavior. This renderer state currently gates display/actions but is not sufficient authorization for machine-wide policy.

`src/preload/electronApi.js` exposes named APIs through contextBridge. The main window disables Node integration and enables context isolation, with sandbox disabled. `src/main/ipc/registerIpcHandlers.js` registers database and privileged handlers; existing mutations do not consistently prove a main-process owner session. `src/main/storage/gameStore.js` owns SQL.js initialization, schema creation and persistence. Its runtime database is in `userData`; database persistence exports/writes a whole in-memory DB image. Do not let the service write this DB concurrently.

`src/main/services/popupWindowService.js` has weaker popup web preferences (`nodeIntegration: true`, `contextIsolation: false`) and must not be used for this feature. Existing games, Steam, Roblox, hosting, launcher updates, and database functionality must remain independent and unaffected.

## 3. Proposed Owner Settings screen and interactions

Append a visually consistent **Website Access Control** section inside the current modal. Keep existing settings sections intact. Suggested internal subsections may use headings/accordions, but remain part of this modal.

### Protection Status card

Show:

- Protection enabled/disabled.
- Service installed/not installed and running/stopped/unavailable.
- Current mode: Monitoring or Enforcement (Enforcement labeled “not available in this phase” until separately approved and implemented).
- Last successful synchronization, applied policy revision/hash prefix, service version, last heartbeat and connection status.
- Recovery state and sanitized last error, with a visible degraded/unprotected warning when service health is bad.

Status is read-only. Poll at a modest interval while modal is open; stop polling when closed. A renderer timeout must not be interpreted as service stopped or configuration unapplied.

### Whitelist and blocklist

Use two clearly labeled lists/tabs/panels within the section. Each rule row shows canonical domain, enabled state, whether subdomains are included, updated time, and Edit/Enable/Disable/Remove controls. Provide Add Domain forms with a domain field and explicit “Include subdomains” checkbox. Validate before save and display the normalized result so Unicode input’s punycode form is understandable.

An allow rule means the DNS engine permits resolution for the matching name. A block rule means the engine returns the selected blocked response. The actual blocked response (e.g. NXDOMAIN versus refusal) remains a DNS protocol design choice to test; UI copy should not imply a browser-specific error page.

Editing a rule updates the existing normalized record; it must not create a second duplicate. Remove and enable/disable require confirmation where appropriate. All list rendering must use DOM text nodes or escaped text; never interpolate imported domain strings into executable HTML.

### Protection settings

Controls: Enable/Disable protection; Monitoring/Enforcement mode selector; Default action selector. Monitoring is the only mode that may be enabled in the first UI/rule-engine delivery. Enforcement must remain visibly unavailable until the DNS service, recovery drill, and browser policy checks are approved. If “default deny” is shown before enforcement is implemented, explain that it is a stored policy choice and does not currently block traffic.

Show service health summary, policy revision, sync button, and recovery state. “Sync” sends a validated snapshot; it cannot itself enable enforcement unless a later separately authorized implementation explicitly implements that state transition. Provide a clear fail-open/degraded message and an operator recovery affordance only once the service supports it safely.

### Import/export

Import uses a file picker in Electron main (not an arbitrary renderer file path), bounded size, JSON parsing, version check, strict schema validation, normalized duplicate detection, and preview. Preview groups additions, updates, duplicates/skips, and errors; nothing is written until operator confirms. Apply the whole accepted import transactionally. Export a versioned, normalized JSON file via a save dialog; omit logs, credentials, machine IDs, pipe details and service secrets.

### Activity logs

Show timestamp (UTC or localized with timezone clearly indicated), queried domain, allow/block decision, matched rule/source, and applied policy revision. Paginate and cap displayed rows. No full URLs, paths, query strings, page content, or user identity should be logged. An entry indicates a DNS query/decision, not that a website was successfully visited. Define retention and clear/export behavior before implementation.

### Service status

Show install state, running state, heartbeat age, service version, protocol version, applied revision/hash and Electron-to-service connection. Do not offer service stop/start or configuration-file access to standard accounts. If service absent, present “Protection service is not installed” and do not offer a fake active toggle.

## 4. Domain rule engine proposal

### Normalization and validation

1. Accept a domain name only, not a URL. Reject schemes, paths, query/fragment, ports, wildcards, IP literals, control characters, whitespace within labels, empty interior labels and malformed IDNA.
2. Trim outer whitespace, remove one trailing DNS root dot, convert using IDNA to ASCII/Punycode, lowercase, then validate DNS label/name length limits and label syntax.
3. Persist canonical `domain_ascii`. Optionally store a safe display form separately; canonical form controls matching and uniqueness.
4. Normalize before uniqueness checks, so case, terminal-dot and IDNA-equivalent inputs collide as the same domain.
5. Do not accept arbitrary wildcard expressions. “Include subdomains” is an explicit boolean.

### Matching and conflict behavior

- Exact host matches its exact rule.
- A subdomain match requires `include_subdomains=1` and a DNS label boundary: `a.example.test` is below `example.test`, while `notexample.test` is not.
- Choose the most-specific matching explicit rule. Parent and child rules may coexist. A child rule overrides a parent rule because it is more specific.
- Unique normalized domain means equal-scope conflicts are resolved at save/import time: the record is updated/rejected as duplicate rather than retaining allow and block rows. If multiple same-scope sources are ever introduced, explicit block takes priority for that scope.
- Monitoring records predicted decisions but does not block.
- During Enforcement only, unmatched domains use the configured default action; the proposed default-deny value must not be active until a reliable allowlist, service, recovery behavior, and required application endpoints have been verified.
- DNS alone cannot guarantee app-specific exceptions. Do not claim or expose per-application exemptions unless a separate reliable process-aware enforcement component exists.

## 5. SQL.js tables and migration/rollback strategy

Electron main remains the sole `launcher.db` writer. The DNS service maintains separate protected state/config and last-known-good snapshot under ProgramData. Add a migration ledger; do not rely only on untracked `CREATE TABLE IF NOT EXISTS` statements for these new tables.

| Table | Proposed columns/constraints | Use |
|---|---|---|
| `schema_migrations` | `version INTEGER PRIMARY KEY`, `applied_at TEXT NOT NULL`, `checksum TEXT NOT NULL` | Ordered migrations; detect unexpected edited migration. |
| `website_rules` | `id`, `domain_ascii UNIQUE NOT NULL`, `action CHECK ('allow','block')`, `enabled CHECK 0/1`, `include_subdomains CHECK 0/1`, `display_domain`, `created_at`, `updated_at` | One canonical rule per domain. |
| `website_access_settings` | singleton `id CHECK=1`, `enabled`, `mode CHECK monitoring/enforcement`, `default_action CHECK allow/deny`, `policy_revision`, `policy_hash`, `last_sync_at`, `updated_at` | Desired owner policy and last acknowledged service revision. Enforcement stays disabled/unavailable initially. |
| `website_exceptions` | `id`, normalized `domain_ascii`, exception type/scope, reason, enabled, created/updated timestamps | Future explicit domain exceptions only; do not imply application scoping without supporting engine. |
| `website_access_log` | `id`, `occurred_at`, `domain_ascii`, `decision`, `matched_rule_id`, `policy_revision`, `source`, sanitized `result_code` | Bounded domain-level activity records, indexed by time/domain, with explicit retention. |
| `website_service_status` | singleton ID, state, service/protocol version, heartbeat, applied revision/hash, sanitized last error, observed timestamp | Cached service health; never authoritative policy. |

### Safe migration procedure

1. In a test harness, copy a representative user-data DB; preserve the existing repository seed DB and all user records.
2. Before live migration, close or quiesce writes, copy the user-data database to a timestamped backup, record file hash, and verify integrity on the copy.
3. Apply each migration inside SQL transaction to the copy, create ledger row only after all statements succeed, and verify constraints/indices/schema version.
4. Compare old/new existing table schemas and row counts and confirm owner, game, settings, maps and PC-spec records are unchanged.
5. On failure, roll back transaction and retain original DB. On success, atomically replace file where platform permits, keep a recoverable backup, reopen and verify application startup and data. Never delete the backup automatically before a retention policy exists.
6. Make migrations additive and idempotent; do not rename/rewrite existing tables or use blanket database recreation.

## 6. Electron IPC and preload contract

The renderer talks only to named methods exposed by `src/preload/electronApi.js`; it never accesses a pipe, filesystem path, registry, process, or shell. Main process maintains owner authorization and validates every request independently of `State.isOwnerLoggedIn`.

Proposed narrow API methods:

```text
getWebsiteAccessStatus()                         read status
listWebsiteRules({ action, limit, cursor })       read bounded page
saveWebsiteRule(rule)                             add/edit
setWebsiteRuleEnabled({ id, enabled })            enable/disable
removeWebsiteRule({ id })                         remove
getWebsiteAccessSettings()                       read settings
saveWebsiteAccessSettings(settings)               save desired settings
previewWebsiteAccessImport(fileContents)           validate/preview bounded content
applyWebsiteAccessImport(validatedPreviewId)       apply reviewed import
exportWebsiteAccessConfig()                       main-process save dialog/export
listWebsiteAccessLogs({ from, limit, cursor })     bounded log page
syncWebsiteAccessPolicy()                         validate and send snapshot
```

These are proposed names, not implemented APIs. Import preview should retain a short-lived main-process preview token or content hash; apply must revalidate the payload and authorization to avoid renderer tampering. Validate sender is the intended main frame, session is active, exact object keys/types/enums, max string/list/file/log sizes, valid row IDs, and mode transitions. Return structured, sanitized error codes. Sensitive mutations require a fresh main-process owner session; machine-level apply also follows the agreed Windows administrator/UAC authorization path. Customer standard-user IPC calls must fail authorization even if renderer invokes the preload method manually.

Owner login state must be established/expired in Electron main; renderer state is only a display mirror. Credential hardening from the Phase 2 plan is a prerequisite to using the app-local owner login as part of any policy approval.

## 7. Future DNS service contract

The local DNS service is independent of Electron and handles DNS requests on the machine loopback interface. Do not select or hardcode an upstream provider here. Provider, transport, timeout, privacy and fallback behavior remain unresolved.

### Snapshot message

Electron sends a complete immutable snapshot over the restricted versioned named pipe:

```json
{
  "protocolVersion": 1,
  "requestId": "uuid",
  "operation": "ApplyPolicy",
  "payload": {
    "revision": 42,
    "sha256": "hex digest of canonical payload",
    "mode": "monitoring",
    "enabled": false,
    "defaultAction": "deny",
    "rules": [
      {"domain": "example.test", "action": "allow", "enabled": true, "includeSubdomains": false}
    ]
  }
}
```

The sample domain is illustrative only and is not a required allowlist entry. Production protocol should validate max snapshot bytes/rules, supported enum values, canonical domain form and checksum; reject stale revision, unsupported protocol or invalid content without partially applying.

Suggested operations: `GetCapabilities`, `GetStatus`, `ValidatePolicy`, `ApplyPolicy`, `GetLogs`, and `RestoreLastKnownGood`. Use correlated responses with `ok`, revision/hash, sanitized error code and health state. Service validates caller’s Windows token and operation permissions; a pipe DACL is not the sole authorization check.

### Service-side apply and DNS behavior

1. Validate snapshot completely and persist a new protected staged copy.
2. Atomically install config, update runtime matcher, and report revision only after successful health checks.
3. Preserve previous config and OS DNS state until commit; reject partial/malformed policy.
4. For queries, normalize the queried name, apply rule precedence, log only configured metadata, return the documented blocked response for denied queries, and forward allowed queries to the operator-configured upstream.
5. Maintain heartbeat, service/protocol version and applied revision/hash. Service health must not depend on Electron running.
6. On resolver/service failure, watchdog restores prior working IPv4/IPv6 adapter DNS configuration (fail-open) and marks protection degraded/unprotected. Recovery must be tested after crash, reboot and interrupted update.

## 8. Brave and Edge DoH policy strategy

### Microsoft Edge

Microsoft documents machine policy under `HKLM\SOFTWARE\Policies\Microsoft\Edge`, with `DnsOverHttpsMode` as a mandatory string policy supported on Windows from Edge 83. `off` disables browser DoH; `automatic` permits fallback to insecure DNS; `secure` requires DoH and requires a valid `DnsOverHttpsTemplates` value. For a local filtering resolver, setting `off` is the prospective choice because the browser should use the system resolver, but verify with actual Edge builds and `edge://policy` before deployment. Do not set a template or choose an upstream DoH provider in this plan. [Edge DoH mode policy](https://learn.microsoft.com/en-us/deployedge/microsoft-edge-policies/dnsoverhttpsmode), [Edge templates policy](https://learn.microsoft.com/en-us/DeployEdge/microsoft-edge-browser-policies/dnsoverhttpstemplates)

### Brave

Brave’s official enterprise page says Brave supports Chromium policies and provides Windows policy templates. The Chromium-compatible `DnsOverHttpsMode` policy is the candidate to disable DoH, under Brave’s machine policy namespace; confirm the exact value/type/template available in the current Brave policy bundle and confirm enforcement in `brave://policy` on each supported installed version before writing any policy. Do not rely on a third-party registry example. If the current Brave template does not expose the policy, use documented vendor-supported Chromium policy behavior only after a test confirms it works. [Brave Group Policy documentation](https://support.brave.app/hc/en-us/articles/360039248271-Group-Policy)

### Common policy ownership and limits

The service should snapshot prior values and whether each value existed, write only JLJ-owned policy settings, validate effective policy through browser policy pages/API where possible, and restore a prior value only if it still equals the value this product wrote. Never overwrite another administrator’s managed policy silently. Use machine scope so customer standard accounts cannot undo it. Policy changes may require browser restart. Browsers, portable copies, private/embedded browser engines, custom HTTPS DoH clients and VPNs are outside guaranteed coverage. DoH-off does not itself block alternate DNS over TLS, direct IP, proxies, or VPN tunnels.

## 9. Security and authorization requirements

- Main-process owner session with expiry/logout/navigation invalidation; validate it for every website mutation and import/export operation.
- Do not treat renderer-only auth as authority. Validate renderer sender/frame and payload shape/size.
- Preload exposes only narrow typed methods; never raw IPC, `child_process`, filesystem, registry or pipe handles.
- Named pipe is local-only with explicit restrictive DACL. Service checks actual client Windows token and separately authorizes read and mutation operations. Never trust `isOwner`/`isAdmin` from JSON.
- Customer Windows Standard Users cannot mutate rules/settings, write service state, change browser policies, stop/disable service or access mutation pipe.
- Explicit UAC/admin path for service installation or machine-wide policy changes. Do not keep Electron elevated.
- JSON imports are data only: size/count limits, fixed schema, no `$ref` execution or command fields, strict keys, full validation and atomic application.
- Escape/render as text; do not use imported data in HTML templates or inline event handlers.
- Avoid writing logs to renderer console with sensitive policy content. Sanitize service errors and prevent path, secret or stack disclosure.
- Service itself performs strict domain canonicalization and validation again; main-process validation is not sufficient for a privileged boundary.

## 10. Validation and test strategy

No application/build/test work is run in this plan phase. After approved implementation, use disposable Windows 10 Pro 22H2 x64 VMs/canary machines and these checks:

1. **UI behavior:** Add/edit/remove/toggle both allow and block rules; modal remains usable at target screen sizes; no new nav item/window/page; status/error/loading/empty states; keyboard and screen-reader labels; safe domain rendering.
2. **Domain unit cases:** uppercase, trailing root dot, IDNA/punycode equivalence, invalid URL syntax, wildcard/IP rejection, label and total length, duplicate canonical name, exact matching, subdomain label boundary, parent/child specificity, disabled rules and equal-scope block resolution.
3. **Import/export:** valid version; unsupported version; duplicate normalized entries; unknown keys; malformed JSON; oversized bytes/record count; invalid domains; preview counts; no write before confirmation; export/reimport round-trip and secret/log omission.
4. **Database:** backup/hash/integrity, migration transaction and repeatability, rollback injection, schema ledger/checksum, compare baseline records across owner/games/settings/maps/PC specs, whole-image store persistence, backup restore.
5. **Authorization/IPC:** unauthenticated, expired-session, renderer-forged, wrong-frame, oversized and wrong-type requests; Standard User attempts; UAC cancel; service impersonation/token checks; unauthorized pipe connection; replay/stale revisions; timeout/reconnect.
6. **Browser policy:** capture exact Brave/Edge versions; verify policy template support, machine policy refresh, values visible in `brave://policy` / `edge://policy`, browser restart behavior, system DNS routing after DoH disabled, and safe restoration after uninstall. Test existing third-party policy conflicts without overwriting them.
7. **Service contract:** service absent/stopped/slow; apply valid/invalid/stale snapshot; hash mismatch; atomic revision update; heartbeat; monitoring logs; last-known-good; crash fail-open DNS restoration; IPv4 and IPv6 adapters; upstream unavailable. No upstream is selected until separately approved.
8. **Regression:** existing Owner Settings, diagnostics, PC-spec and server URL features; game management/launch; Steam, Roblox and hosting workflows; launcher update checks. Confirm no website-control dependency interferes with these features.

## 11. Exact files expected to change after approval

This is a proposed scope inventory only.

| Existing files | Proposed changes |
|---|---|
| `index.html` | Add Website Access Control section inside `#ownerSettingsModal`; no new sidebar link/modal/page. |
| `src/renderer/features/ownerSettings.js` | Bind controls, render status/rule lists/logs/import preview, and request narrow APIs. |
| `assets/css/style.css` | Style section, tables, forms, status/error cards, responsive behavior in existing visual system. |
| `src/renderer/core/state.js` | Mirror owner/session/UI state only; never authorization. |
| `src/renderer/core/init.js` | Initialize/bind feature lifecycle if current init conventions require it. |
| `src/renderer/features/library.js` | Only if needed to notify main-process auth lifecycle on owner login/logout; preserve existing owner flows. |
| `src/preload/electronApi.js` | Expose only named website-access methods. |
| `src/main/ipc/registerIpcHandlers.js` | Register narrowly scoped, authorized, validated handlers. |
| `src/main/main.js` | Construct client/repository dependencies and own lifecycle if required. |
| `src/main/storage/gameStore.js` | Add migration invocation/repository access while preserving existing schema/data behavior. |
| Proposed `src/main/storage/migrations/` | Add versioned website schema migrations and rollback test helpers. |
| Proposed `src/main/storage/websiteAccessRepository.js` | Implement rule/settings/log/status queries and transactional writes via existing SQL.js DB owner. |
| Proposed `src/main/services/websiteProtectionClient.js` | Versioned named-pipe client, framing, timeouts, request correlation and sanitized errors. |
| Proposed `services/JLJWebsiteProtectionService/` | Future .NET Framework 4.8.1 service, DNS engine, pipe server, ACL, health, policy snapshot and recovery. |
| `package.json`, `.github/workflows/release.yml`, `scripts/validate-release.js` | Not part of this UI/rule-engine phase. Revisit only in a separately approved service packaging/release phase. |

Additional owner-credential hardening may require `src/main/storage/defaultData.js` and owner verification/storage code; that should be scoped as a security prerequisite before machine-level enforcement. No existing file is changed by this report.

## 12. Open questions and risks

1. What exact Brave and Edge versions/build channels are installed on every target PC? Workspace inspection could not confirm them.
2. Which DNS upstream/resolver is acceptable, and what logging/privacy terms apply? Provider remains intentionally undecided.
3. Should `website_exceptions` exist in first schema if app-scoped exceptions are unsupported by DNS? Recommendation: keep only domain-scope exceptions initially, or defer the table until its scope is defined.
4. What exact monitoring behavior is possible before the service is installed? Do not show fabricated query logs; show unavailable until service provides them.
5. What does “protection disabled” do to DNS when service is healthy? Define whether disabling restores captured pre-install adapter DNS or forwards without filtering.
6. What is the exact blocked DNS response and cache/TTL behavior?
7. Who owns conflicting machine browser policies and how does the operator resolve conflicts without overwriting them?
8. How long are activity logs kept, who may view/export them, and what customer notice is required?
9. Is enforcement default-deny intended for all device traffic or only web browsers? DNS alone is machine-wide and cannot consistently limit matching by app.
10. Windows 10 Pro 22H2 regular support has ended; confirm ESU and security update status before deployment.

## 13. References

- [Brave Group Policy and Chromium policy support](https://support.brave.app/hc/en-us/articles/360039248271-Group-Policy)
- [Microsoft Edge `DnsOverHttpsMode`](https://learn.microsoft.com/en-us/deployedge/microsoft-edge-policies/dnsoverhttpsmode)
- [Microsoft Edge `DnsOverHttpsTemplates`](https://learn.microsoft.com/en-us/DeployEdge/microsoft-edge-browser-policies/dnsoverhttpstemplates)
- [Windows named-pipe security](https://learn.microsoft.com/en-us/windows/win32/ipc/named-pipe-security-and-access-rights)
- [Windows 10 end-of-support status](https://learn.microsoft.com/en-us/lifecycle/announcements/windows-10-end-of-support)

## 14. Completion statement

This report is the Phase 3 planning deliverable. No source code, SQL.js database or records, package files, dependencies, DNS configuration, firewall, registry, Brave/Edge policies, Windows service, installer, or release configuration was modified. No migration or enforcement was enabled. **Stop and wait for explicit approval before implementation.**
