# JLJ Gaming House Website Access Control — Phase 1 Inspection Report

**Inspection date:** 2026-11-19  
**Scope:** Read-only architecture and feasibility inspection. No implementation was performed.

## 1. Executive summary

The repository contains an Electron desktop launcher built from HTML, CSS, and classic JavaScript. It does **not** contain a React application, a C# project, a Windows protection service, a website rules engine, or website filtering tables. Electron and its existing PC-management, game-launching, hosting, diagnostics, and updater features are present.

The current owner Settings experience is a modal within the existing launcher, opened from the Owner section in the sidebar. It contains server URL settings, diagnostics, and PC information management. Website Access Control can be added inside that existing modal/panel without adding a top-level navigation item or a separate window.

The proposed feature is feasible as a layered, best-effort device policy, but a DNS allowlist by itself cannot ensure that every browser and application connection is blocked. DNS caches, encrypted DNS, proxies, VPNs, direct IPs, IPv6, and shared hosting/CDN addresses limit DNS-based enforcement. On a customer-accessible PC, protection also depends on customers using standard accounts rather than local administrator accounts.

There are two blocking deployment questions:

1. **Windows 10 edition/build:** Microsoft ended support for Windows 10 Home/Pro 22H2 on 2025-10-14. As of this report, Microsoft’s modern .NET support matrix lists Windows 10 support for .NET 10 only on Enterprise/LTSC editions. .NET 10 is the recommended Worker Service target only if the actual machines meet that matrix; regular Home/Pro computers need an OS/runtime support decision before implementation. See the [Windows 10 lifecycle notice](https://learn.microsoft.com/en-us/lifecycle/announcements/windows-10-end-of-support) and [supported .NET on Windows matrix](https://learn.microsoft.com/en-us/dotnet/core/install/windows).
2. **Authorization boundary:** Current owner authentication is held in renderer state, the default credentials are in source, and owner passwords are stored as plaintext in SQLite. IPC mutation handlers do not independently verify an owner session. That is insufficient authorization for system-wide DNS, firewall, or browser-policy changes. A new feature must add main-process authorization and service-side authorization; renderer visibility checks alone are not a security boundary.

No website feature should enter enforcement mode until the target Windows editions, account model, browsers, required application traffic, fail-safe behavior, and exception inventory have been confirmed and tested.

## 2. Verified existing project architecture

### Project and runtime

Verified from `package.json`, `package-lock.json`, installed package metadata, and source files:

- Electron **28.3.3**; electron-builder **26.8.1**; electron-updater **6.8.3**.
- Windows NSIS installer; `productName` is `JLJGAMINGHOUSE`; package version at inspection is **1.0.27**.
- CommonJS Node main process. Root `main.js` takes a single-instance lock and calls `src/main/main.js` bootstrap.
- Renderer document is root `index.html`, which loads ordered classic scripts from `src/renderer/`.
- The repository does not declare React and contains no React components. `src/renderer/index.js` is explanatory/commentary code; the HTML document and scripts are the actual UI entry.
- No `.cs`, `.csproj`, or `.sln` source project was found outside generated/dependency content. No JLJ website filtering service exists.
- Database implementation is `sql.js` (SQLite compiled to WebAssembly), not a native SQLite service shared by multiple processes.
- Existing relevant dependencies include `electron-updater`, `sql.js`, `sudo-prompt`, `systeminformation`, `socket.io-client`, `robotjs`, and `screenshot-desktop`.

### Electron processes and lifecycle

- [`main.js`](main.js): application entry point, single-instance enforcement, calls `app.disableHardwareAcceleration()` and `bootstrap()`.
- [`src/main/main.js`](src/main/main.js): initializes logging, storage, services, IPC handlers, tray, startup lifecycle, and app update checks. It opens the splash and main windows, starts at login, connects the existing admin Socket.IO service, and tears down services on quit.
- [`src/main/createWindow.js`](src/main/createWindow.js): creates the main `BrowserWindow` and loads `index.html` from `app.getAppPath()`.
- [`src/main/config/windowConfig.js`](src/main/config/windowConfig.js): main window uses `nodeIntegration: false`, `contextIsolation: true`, and `sandbox: false`; it loads `src/preload/electronApi.js`.
- [`src/preload/electronApi.js`](src/preload/electronApi.js): exposes a named `electronAPI` object via `contextBridge`; methods map to explicit IPC channels. The renderer does not receive raw `ipcRenderer` through this main-window preload.
- [`src/main/ipc/registerIpcHandlers.js`](src/main/ipc/registerIpcHandlers.js): registers database, app-update, diagnostics, game, hosting, Control Panel, power, window, and external-link handlers. It does not verify an owner-authenticated session for privileged or owner data writes.
- [`src/main/services/popupWindowService.js`](src/main/services/popupWindowService.js): the separate popup window currently sets `nodeIntegration: true` and `contextIsolation: false`; `src/renderer/popup.js` imports Electron directly. This is a weaker security configuration than the main window and should not be reused for the new admin surface.
- [`src/main/services/cpService.js`](src/main/services/cpService.js): existing Control Panel restriction uses PowerShell to change a per-user Explorer policy value and `sudo-prompt` for UAC elevation when the launcher process is not elevated. This is not a Windows service or a general privilege broker.
- [`src/main/services/adminSocketService.js`](src/main/services/adminSocketService.js): existing configurable Socket.IO connection supports remote administration actions, including remote input/screen streaming. This service is separate from local website policy and should not become an implicit remote path for privileged restriction changes.

The current main window has context isolation enabled but sandboxing disabled. Website service control must remain behind narrow preload methods and validated main-process handlers. The renderer must not receive shell, registry, firewall, or pipe primitives.

## 3. Existing Settings and exact integration point

There is no React Settings page/component or tab system. The current “Settings” is an owner-only modal embedded in `index.html`:

- [`index.html`](index.html): Owner navigation at the sidebar; `ownerSettingsNav` invokes `openOwnerSettings()`. `ownerSettingsModal` is the modal container. Current sections are Socket.IO Server, Diagnostics, and PC Information Management.
- [`src/renderer/features/ownerSettings.js`](src/renderer/features/ownerSettings.js): binds the existing modal controls, performs owner-state checks, loads diagnostics and server/PC data, saves settings, and renders the PC-spec list.
- [`src/renderer/features/library.js`](src/renderer/features/library.js): owner login/logout, `State.isOwnerLoggedIn`, owner badge and navigation visibility. The owner UI is hidden until login succeeds.
- [`src/renderer/core/state.js`](src/renderer/core/state.js): global renderer state object, including `isOwnerLoggedIn`.
- [`src/renderer/core/init.js`](src/renderer/core/init.js): binds owner settings and initializes the other features on DOM ready.
- [`assets/css/style.css`](assets/css/style.css): current modal, `.settings-panel`, section-header, server-row, and PC-grid styling.

**Future UI placement:** add a “Website Access Control” section or in-modal tab inside `ownerSettingsModal` and retain the existing `openOwnerSettings()` owner entry point. Do not create a sidebar item or a separate `BrowserWindow`. Because the current modal is a single scrolling panel, a tabbed sub-navigation would be a UI decision for the implementation phase, not something already present.

The requested future subsections—Protection Status, Whitelist, Blocklist, Exceptions, Import/Export, Protection Settings, Activity Logs, and Service Status—do not currently exist.

## 4. Authentication, authorization, and IPC security

### Verified current behavior

- `src/main/storage/defaultData.js` defines default owner credentials in source. `src/main/storage/gameStore.js` stores and compares username/password as ordinary text; no hashing or session object exists.
- `src/renderer/features/library.js` calls `electronAPI.verifyOwner()` and sets a renderer-only boolean `State.isOwnerLoggedIn`. When the API is unavailable it also contains a hardcoded fallback credential comparison.
- The sidebar and owner settings functions hide or gate UI actions based on renderer state. The main process does not issue or validate a privileged owner-session token.
- In `registerIpcHandlers.js`, owner verification exists, but database write handlers such as PC-spec writes, owner changes, server URL writes, and other mutations do not check an authenticated admin context.
- The preload exports those named operations to the renderer. This is narrow API exposure, but it does not itself prove the caller is the owner.
- Some existing system operations use UAC elevation through `sudo-prompt`. The NSIS app is currently per-user and configured without normal install elevation.

### Required design before implementation

1. Replace renderer-only authorization with main-process session state established after successful credential verification. Invalidate the session on logout, renderer reload/navigation, app lock, and timeout.
2. Validate every website-rule/settings/import/export/service-control IPC operation in the main process. Validate the sender is the expected local main frame and validate payload shape/size.
3. Have the Windows service make its own authorization decision for every state-changing command. Do not trust a renderer flag or a message field such as `isAdmin: true`.
4. Clarify whether “administrator” means the existing launcher owner account or a Windows administrator. Website enforcement changes machine-wide networking and browser policy, so app-local credentials alone are insufficient for Windows privilege elevation.
5. Migrate away from plaintext/default credentials before relying on them to authorize machine-wide policy. Use a strong password verifier and a controlled UAC/service authorization path.
6. Keep policy and recovery operations out of `popupWindowService` and its insecure popup preferences.

## 5. SQLite architecture and proposed database design

### Existing store

[`src/main/storage/gameStore.js`](src/main/storage/gameStore.js) creates the database at `app.getPath("userData")/database/launcher.db`. The repository also contains the legacy seed file `database/launcher.db`; on first run the store copies it to the user-data location only if the user-data DB does not already exist. The packaged app excludes `database/*.db` in `package.json`.

The source creates these existing tables:

- `owner`: singleton owner username/password and GCash value.
- `games`: game library and launch/play/update fields.
- `settings`: text key/value storage used for settings such as the admin server URL.
- `left4dead2_maps`: map choices.
- `pc_specs`: manually managed PC information.

Schema creation uses `CREATE TABLE IF NOT EXISTS`; a local `ensureColumn()` helper performs a few additive `ALTER TABLE` migrations. There is no schema-version/migration ledger. The database is loaded into an in-memory `sql.js` instance and `persist()` writes a complete exported database image to the file. `save()` transactionally rewrites the game and owner rows before persisting. Individual PC/settings operations also persist the exported image.

The source has no database backup/restore implementation. Diagnostics exports a ZIP of system information and logs; it is not a database backup. The database file existed during inspection but its user records were not read or changed.

**Concurrency warning:** the Electron store’s in-memory whole-database image must not be opened for writes by a concurrently running .NET service. Two processes could overwrite each other’s complete snapshots. Keep Electron main as the database owner and send validated policy snapshots to the service, or give the service a separate service-owned state file/database. Do not have the service edit the same `launcher.db` directly.

### Proposed schema (not created)

Retain a single Electron-owned database and add a versioned migration for these tables. The service receives a normalized config snapshot over the named pipe and stores its last-known-good copy in a separate ACL-protected service data directory.

| Table | Proposed fields and constraints | Purpose |
|---|---|---|
| `website_rules` | `id` PK; `domain_ascii` lower-case IDNA/Punycode `TEXT NOT NULL UNIQUE`; optional `display_domain`; `action` CHECK `allow`/`block`; `include_subdomains` and `enabled` CHECK 0/1; `created_at`, `updated_at` UTC; optional `created_by` | One effective website rule per normalized domain. Changing allow/block updates that rule rather than creating contradictory duplicates. |
| `website_settings` | singleton `id` PK CHECK `id=1`; `enabled`; `protection_mode` CHECK `monitor`/`enforce`; `default_action` CHECK `deny`/`allow` and default `deny`; config revision/hash; `last_applied_at`; `updated_at` | Global desired protection policy and last successfully applied revision. |
| `website_exceptions` | `id` PK; `domain_ascii`; optional `application_name`, normalized executable path and publisher identity; `reason`; `enabled`; `created_at`; unique key over the normalized scope | Admin-managed required-system/application exceptions. Mark whether each exception is domain-wide or genuinely process-specific. |
| `website_activity_logs` | `id` PK; `domain_ascii`; `decision` CHECK `allow`/`block`/`monitor`; `source` (e.g. resolver/firewall); optional source process only when reliably observed; timestamp UTC; policy revision | Records DNS/policy decisions, not necessarily actual page visits. Add indexes on `(timestamp)` and `(domain_ascii, timestamp)`, plus a retention policy. Do not store URL paths, query strings, or credentials. |
| `website_service_status` | singleton `id` PK; service state; heartbeat; applied revision/hash; last sync; last error code/message; updated timestamp | Main-process snapshot of service health. Service reports status over the pipe; it does not write the launcher DB itself. |

Use parameterized SQL and transactionally apply one numbered migration. Before migration, make an atomic file backup in the user-data database directory and verify it can be read. Roll back the transaction on any DDL/data-copy failure. Keep old game/settings rows untouched. Add schema migration versioning and test upgrade from copies of old DB schemas before release. Import/export should use a versioned JSON format, validate all rows and limits, show a preview, and require explicit owner approval before applying.

### Matching and conflict behavior

- Normalize Unicode labels to IDNA ASCII, lowercase, strip one terminal dot, and validate each DNS label and total length. Store only the normalized canonical form for matching.
- Reject schemes, paths, ports, embedded whitespace, empty labels, malformed IDNs, IP literals masquerading as domains, and wildcard `*` input. An IP-address feature would need a separately designed rule type.
- Duplicate normalized domains resolve to one rule; import must report conflicts and never silently choose arbitrary rows.
- Match exact domain or a label-boundary suffix only: `x.example.com` matches `example.com` only when subdomains are enabled; `notexample.com` never matches.
- Wildcards are unnecessary for the UI because an explicit `include_subdomains` flag covers the useful case. Do not accept arbitrary wildcard expressions.
- Recommended decision order: (1) minimum protected service/recovery endpoints, only after they are identified and documented; (2) most-specific matching admin rule; for rules with equal scope, explicit block wins; (3) verified application exception only when enforcement can actually identify the process; (4) default deny. Critical service endpoints should be separately protected from ordinary customer edits.
- DNS filtering cannot honor application-specific exceptions reliably: a DNS answer is normally shared across all apps on the device. Unless a process-aware network layer is implemented and tested, an “application exception” is effectively a domain-wide allow and must be labeled that way.

## 6. Proposed Windows service architecture

### Runtime recommendation and Windows support gate

Use a **.NET 10 LTS Worker Service** as the preferred implementation target, published self-contained for the actual machine architecture, **only after the target OS edition/build is confirmed to be in Microsoft’s supported Windows 10 matrix**. Microsoft lists .NET 10 LTS as active through 2028-11-14 and documents current Windows 10 support as limited to specific Enterprise/LTSC releases. Windows 10 Home/Pro 22H2 reached end of support on 2025-10-14. Do not assume a Pisonet machine runs Enterprise/LTSC or that “Windows 10” alone is a sufficient runtime target. References: [ .NET support policy](https://dotnet.microsoft.com/en-us/platform/support/policy), [Windows .NET OS matrix](https://learn.microsoft.com/en-us/dotnet/core/install/windows), [Windows 10 lifecycle](https://learn.microsoft.com/en-us/lifecycle/announcements/windows-10-end-of-support).

Microsoft documents the Worker Service + Windows Service hosting model and single-file/self-contained publishing. Proposed service identity should be a virtual service account or dedicated restricted identity with a service SID and only the permissions needed for DNS adapter configuration, firewall policy, protected data, and browser machine policies. Do not default to `LocalSystem` without a demonstrated requirement. Installation and machine-wide changes require an explicit elevated setup/UAC flow; do not run the entire launcher permanently elevated.

SCM automatic start and restart-on-failure can recover a crashed process, but they are not sufficient network recovery: a dead local resolver may leave adapters pointed at loopback. Use a separately verified health/rollback mechanism and preserve the pre-install DNS/policy configuration. A failure should restore the previous network state or enter a documented fail-open recovery mode rather than leave network access unavailable.

### Proposed project layout (all proposed; none exists)

```text
services/
  JLJWebsiteProtectionService/
    JLJWebsiteProtectionService.csproj
    Program.cs
    Hosting/ServiceWorker.cs
    Configuration/PolicySnapshot.cs
    Configuration/PolicyValidator.cs
    Communication/NamedPipeServer.cs
    Communication/MessageProtocol.cs
    Dns/FilteringDnsServer.cs
    Dns/UpstreamResolver.cs
    Enforcement/NetworkPolicyManager.cs
    Enforcement/AdapterDnsManager.cs
    Enforcement/FirewallPolicyManager.cs
    Enforcement/BrowserPolicyManager.cs
    Persistence/LastKnownGoodStore.cs
    Diagnostics/HealthReporter.cs
    Diagnostics/EventLogWriter.cs
    Recovery/RecoveryCoordinator.cs
```

Keep resolver, policy matching, service communication, OS policy operations, and recovery separate and unit-testable. Use .NET Worker Service hosting and a minimal internal DNS implementation/library with a reviewed license and update path; do not write a custom kernel driver as a first implementation.

### Lifecycle and installation

1. An explicit elevated installer step installs the signed service binary under a machine-wide protected directory and service data under `%ProgramData%\JLJGamingHouse\WebsiteProtection` with restrictive ACLs.
2. Capture current IPv4/IPv6 adapter DNS values, browser policy values, and app-owned firewall state before any change. Store a protected recovery manifest that ordinary users cannot edit.
3. Register the service for automatic start and conservative SCM recovery. Start it and verify resolver health before directing any adapter to it.
4. Start in Monitoring Mode. Keep policy disabled from blocking traffic until an owner confirms the measured exception set and network recovery procedures.
5. On config update, validate and write a new versioned snapshot atomically; apply changes in a transaction; check resolver and health; only then mark the new revision current. If a health check fails, restore the last-known-good policy and DNS state.
6. On service upgrade, stop cleanly, stage the new binary, preserve last-known-good config, start and health-check the replacement, and roll back the binary/config if the health check fails.
7. On uninstall, stop/delete only the JLJ service and remove only JLJ-owned firewall and browser policy values. Restore captured original DNS/settings before removing the recovery data. Never blanket-reset Windows Firewall, adapters, or browser policy.

## 7. Electron-to-service communication design

Use a local Windows named pipe such as `\\.\pipe\JLJWebsiteProtectionService.v1`. A pipe is local IPC, not authorization by itself. Windows named pipes support explicit DACL access control; default pipe permissions may grant broad read access, so set a deliberate ACL (see [Microsoft named-pipe security](https://learn.microsoft.com/en-us/windows/win32/ipc/named-pipe-security-and-access-rights)).

Proposed boundary and protocol:

- Renderer invokes narrow preload functions only, such as `websiteProtection.getStatus()`, `listRules()`, `saveRule(input)`, `setMode(mode)`, and `exportConfig()`. No raw pipe, shell, registry, firewall, or arbitrary IPC access is exposed.
- Main process checks the expected local frame, validates the owner session, normalizes/limits inputs, and serializes a schema-validated request to the pipe.
- Service DACL permits only the chosen launcher/service/admin identities. Use `PipeSecurity`/service SID; prevent remote clients and other logon sessions. Apply stronger authorization to mutating operations than read-only status.
- The service checks the client Windows token/authorization for each mutating operation and validates all fields independently. Since the launcher is normally per-user/non-elevated, decide whether apply-policy requires a UAC-approved helper or a Windows administrator session. Do not elevate all of Electron.
- Message envelope: `{ protocolVersion, requestId, operation, payload }`; bounded UTF-8 JSON line/frame; response `{ protocolVersion, requestId, ok, result|error }`. Set maximum frame size, allowlisted operations, strict payload validation, and rate limits.
- Use request correlation IDs, bounded message queues, per-request deadlines, cancellation on app exit, and explicit error codes. Pipe reconnect health checks use short timeouts and must not block UI startup.
- Config sync includes monotonically increasing revision, normalized rules, settings, and a content hash. Service rejects stale revisions, invalid policy, duplicates, unsupported schema versions, and oversized lists. It atomically stores last-known-good data before applying.
- Service status includes version, uptime/heartbeat, applied revision/hash, mode, resolver listener state, DNS config state, last successful sync, and sanitized last error. Status must not expose secrets or user browsing data by default.

Application owner login and Windows administrator credentials are not interchangeable. Confirm which administrator authorization UX is intended before selecting the pipe ACL and UAC model.

## 8. DNS, Windows Firewall, and browser enforcement evaluation

### Local DNS filtering

The service can run a local forwarding resolver bound only to loopback and answer allowed domains through an explicitly chosen upstream resolver while returning a blocked response for denied domains. Windows adapter DNS would need to point to the local resolver for IPv4 **and** IPv6 interfaces. Handle DHCP changes, multiple NICs, VPN adapters, DNS suffixes, captive portals, DNSSEC behavior, UDP and TCP DNS, upstream timeouts, CNAME chains, TTL/cache, and startup ordering.

DNS filtering acts on hostname lookups. It does not inspect URL paths, query parameters, encrypted HTTPS content, or prove that the user completed a website request. OS/browser caches and hosts-file entries can avoid new queries. Domain logs therefore represent observed DNS decisions, not a complete visit history.

### Windows Firewall / FQDN dynamic keywords

Windows Defender Firewall provides outbound program, protocol, port, address, and dynamic FQDN/IP rules. Microsoft describes FQDN dynamic keywords as requiring DNS resolution and explicitly lists bypass/coverage limits: proxies, secure DNS, some VPN tunnel configurations, and cached endpoint IPs. It is therefore an additional layer, not a complete hostname filter. Shared CDN IPs can block unrelated services, and address changes can make rules stale. [Microsoft FQDN rule limitations](https://learn.microsoft.com/en-us/windows/security/operating-system-security/network-security/windows-firewall/dynamic-keywords).

Firewall rules can block known external DNS/DoT endpoints and restrict selected programs, but port 443 is used by ordinary HTTPS and DoH. Blocking all HTTPS or broad CDN ranges would break required games and updates. Need exact tests per supported OS build and network adapter before relying on a rule.

### Browser enterprise policies

Chrome, Edge, and Firefox document Windows enterprise policies to control DNS-over-HTTPS. For example, Chrome and Edge support a managed `DnsOverHttpsMode` policy with `off`, `automatic`, and `secure` behaviors; Firefox has an enterprise `DNSOverHTTPS` policy. These policies cover those managed browsers only; they do not control arbitrary applications, portable browsers, embedded webviews, VPN clients, or direct network code. Chrome enterprise policy should only be applied to transparently managed operator-owned devices and will identify the browser as managed. References: [Chrome DNS-over-HTTPS policy](https://chromeenterprise.google/intl/en_us/policies/dns-over-https-mode/), [Edge policy](https://learn.microsoft.com/en-us/deployedge/microsoft-edge-policies/dnsoverhttpsmode), [Firefox policy templates](https://mozilla.github.io/policy-templates/).

Windows 11 has native encrypted DNS controls (DoH/DoT); this project targets Windows 10, so browser-specific policies and actual installed browser versions must be inventoried. DoT commonly uses port 853, but port blocking alone cannot prevent other encrypted DNS transports over HTTPS/443.

### IPv6, VPN/proxy, direct IP, and WFP

- Apply resolver and firewall policy to IPv4 and IPv6. Disabling IPv6 globally is not a safe default and can break local discovery and applications.
- VPNs can carry DNS and traffic inside a tunnel; application VPNs and browser proxies may bypass the system resolver. Restricting VPN/proxy use requires account policy, application restrictions, and carefully tested firewall rules; a domain list alone cannot guarantee it.
- Direct-IP connections and cached IPs skip DNS. IP blocking is imprecise where CDNs/shared hosting reuse addresses. TLS SNI and HTTP Host may be encrypted or unavailable (including ECH), and packet filtering does not provide general URL visibility.
- WFP has user-mode and kernel-mode filtering layers. Built-in WFP management is preferable where sufficient; deep packet/stream inspection may require callout drivers. Microsoft advises using standard filtering functionality rather than custom kernel callouts when it suffices. Do not create a custom driver in the first version. References: [WFP architecture](https://learn.microsoft.com/en-us/windows/win32/fwp/windows-filtering-platform-architecture-overview), [callout driver considerations](https://learn.microsoft.com/en-us/windows-hardware/drivers/network/callout-driver-programming-considerations).

**Conclusion:** DNS + locked browser policies + selective Windows Firewall rules can reduce casual bypass on standard-user accounts, but this cannot honestly be described as an absolute block across every browser/app if users can run arbitrary software or have local administrator access. For stronger enforcement, consider network-level filtering at the router/gateway in addition to endpoint controls. A hard guarantee against local administrators would require OS/device-management controls beyond the launcher.

## 9. Exceptions and required application research

No exception domain list is supplied by this repository, and this report does not invent one. `Spotify` appears only in diagnostics text stating it is not part of this application; no Spotify feature or integration was found. Steam and Roblox launching/integration code exists. Windows Update, Electron/GitHub updates, and the configurable admin Socket.IO endpoint also need to keep working.

Before enforcement, capture and test real traffic for the exact supported versions and deployment network for:

- Windows activation, Windows Update, time synchronization, DNS/captive portal/network connectivity checks, and any domain-join/management services actually used.
- Steam sign-in, friends, store, game downloads/CDNs, and each supported game’s auth/matchmaking/update endpoints.
- Roblox launcher/player/auth/content/update flows.
- JLJ launcher startup, admin Socket.IO server, diagnostics export if it contacts anything, GitHub Releases/update metadata/assets and installer downloads.
- Spotify only if the operator confirms it is required on these computers; the source does not implement it.
- Any browser synchronization, certificate revocation, anti-cheat, game voice/chat, or payment services required by the actual usage policy.

Collect DNS decisions in Monitoring Mode and compare with vendor-published endpoint information where available. Observe by app/network telemetry only as permitted; DNS server logs normally do not reveal which process issued a query. Domain/CDN endpoints can change by region, update channel, and version. Require a real functional test of each application after candidate allow rules are applied.

## 10. Monitoring, enforcement, and recovery

### Modes

- **Monitoring:** compute allow/block/default-deny decisions and record them without actively rejecting traffic. Be explicit about coverage: the service only sees lookups that pass through it. A transparent passive mode and a DNS-proxy observation mode have different coverage and network side effects; choose and document one.
- **Enforcement:** apply default-deny decisions to the resolver and any verified supporting firewall/browser policies. Show desired and actually applied policy revisions separately. Start only after monitoring tests, exception approvals, recovery tests, and backup verification.

### Recovery requirements

- Never switch adapter DNS until the local resolver answers health probes. Record original per-interface IPv4/IPv6 DNS mode/servers and policy values.
- Keep a last-known-good policy snapshot and protected recovery manifest; write replacement files atomically and validate before activation.
- On invalid policy or failed apply, restore the previous active policy. On service health loss, use a tested independent watchdog/recovery mechanism to restore the original working DNS state or an explicitly chosen safe fallback; restarting the failed service alone may leave loopback DNS unreachable.
- Emergency disable must require an authorized admin/UAC action, stop policy enforcement, restore network and browser/firewall settings, verify ordinary DNS and connectivity, then report service state. Provide an offline recovery path if the launcher cannot start.
- On uninstall, restore only values captured by JLJ and remove only JLJ-owned firewall objects/registry values. Do not reset unrelated administrator policies.
- Keep customer-visible monitoring and enforcement status, support an exportable diagnostic record, and minimize log retention. Activity logs are sensitive browsing metadata and need a retention period and access policy.

## 11. Security and operational risk assessment

| Risk | Why it applies | Required mitigation / limitation |
|---|---|---|
| Renderer or IPC bypass | Existing owner UI checks are renderer-only; several mutation IPCs have no admin-session check. | Main-process authorization for every new operation, sender validation, narrow APIs, and service-side authorization. Do not trust UI state. |
| Weak local owner credential | Current default is in source and SQLite comparison/storage is plaintext. | Replace with a proper verifier and explicit UAC/service authorization before system-level policy changes. |
| Customer has local admin | A local administrator can stop/change service, policies, DNS, firewall, install VPN/proxy, or replace files. | Operate kiosk/customer accounts as standard users; use protected service ACLs and machine policies. No client-only solution can reliably constrain a machine owner/admin. |
| Customer changes DNS | Per-adapter DNS can be changed in Windows UI/commands by sufficiently privileged users. | Standard-user accounts, machine policy, IPv4+IPv6 controls, DNS firewall policy, drift detection, recovery. |
| DoH/DoT, VPN, proxy, direct IP | These can avoid resolver decisions; 443 is shared with ordinary HTTPS. | Browser policies and narrowly tested network controls; acknowledge incomplete coverage and test bypass paths. |
| IPv6 leak | IPv6 may use alternate DNS or route around IPv4 rules. | Configure and test all active interfaces for both stacks; no blanket IPv6 disable. |
| DNS/service failure | Loopback DNS may strand all applications; upstream failure appears as app failure. | Health-gated activation, recovery watchdog, SCM restart, preserved baseline, fail-open option, offline recovery drill. |
| Bad/malicious rule or import | A typo in default-deny policy can block Windows/game/update services; import may be malformed. | Strict validator, preview, bounded import, transaction, backup, monitoring, last-known-good rollback. |
| DB corruption or concurrent writes | SQL.js rewrites an in-memory database snapshot; a second writer could overwrite it. | Electron main remains the only writer; migrations with backup/verification; service state separate. |
| Service/update failure | Service is machine-wide and separately versioned from Electron. | Signed binaries, staged install, version handshake, policy compatibility, service health check and rollback; do not publish an app that requires an absent/unhealthy service without safe degraded mode. |
| Electron updater failure | Existing Electron updates are GitHub-release based; service does not exist in current updater. | Version compatibility checks, preserve last-known-good service binary/config, staged coordination, no service deletion until replacement passes health checks. |
| Accidental blocking | Windows, Steam, Roblox, anti-cheat, game CDNs and updates have changing dependencies. | Real endpoint inventory, monitoring period, application acceptance tests, staged canary PCs, emergency disable. |
| Windows lifecycle | Windows 10 Home/Pro support ended in 2025; .NET 10 Windows 10 support has edition restrictions. | Confirm edition/build/ESU and OS upgrade path before implementation. |
| Privacy/log exposure | DNS logs reveal destinations and patterns. | Log only necessary domain decision metadata, not URLs/content; restrict access, set retention, disclose customer monitoring. |

## 12. Installer and packaging implications

Current `package.json` contains electron-builder configuration inline. It specifies NSIS `target`, one-click, per-user install (`perMachine: false`), `allowElevation: false`, no change-install-location page, app output `dist`, and exclusion of `database/*.db`. There is no current custom NSIS include or service installer. Existing app data is under Electron `app.getPath("userData")`, separate from package files. The current application starts at login, but that is not equivalent to a boot-start Windows service.

A service must be installed system-wide and requires elevation; therefore the existing per-user installer cannot simply copy the EXE beside the launcher and pretend that it is a registered service. Options to evaluate:

1. Separate signed service installer/uninstaller invoked with explicit UAC from the launcher installer; or
2. Carefully designed NSIS custom install/uninstall hooks that request elevation only for service installation and handle cancellation/rollback correctly.

Do not run the Electron GUI as SYSTEM or permanently elevated. Decide whether service installation is mandatory or optional and what the launcher does when the service is absent. Store the self-contained service under protected Program Files and state/recovery files under ACL-protected ProgramData. Keep service binary and config out of per-user `app.getPath("userData")`. Add architecture and minimum Windows checks. Preserve uninstall rollback and never delete the existing user database.

## 13. Auto-update and GitHub Releases

Verified current configuration:

- `package.json` points electron-builder at GitHub repository `jldems-dev/jlj-launcher`, provider `github`, `releaseType: draft`, NSIS, and versioned artifact name.
- `src/main/services/appUpdateService.js` uses `electron-updater`; auto-download is disabled, prereleases and downgrades are disabled, stable `latest` channel is used, and update checks/download/install are exposed via explicit IPC and renderer controls. It also checks that no game is active before install.
- `.github/workflows/release.yml` validates tag/version/lockfile, installs dependencies, runs tests, builds an NSIS artifact to a GitHub draft, validates installer, `latest.yml`, and blockmap, checks remote draft assets, and publishes only after those checks.
- `scripts/validate-release.js` checks project metadata and the installer/update metadata. Current release version is 1.0.27; no website service versioning exists.

No release configuration was changed during this inspection. A future service must have its own version and compatibility protocol. Recommended update order: bundle/service artifact in a staged draft; install or upgrade service with rollback while retaining previous service/config; verify service health and schema compatibility; only then allow the Electron release to become the current version. If Electron and service are independently updated, define backward-compatible pipe protocol versions and policy schema versions. Existing auto-update functionality cannot currently install or upgrade a Windows service.

## 14. Recommended Windows Filtering architecture

For the first implementation, use a local DNS forwarding/filtering service as the primary domain decision layer; configure the system DNS path for IPv4 and IPv6; apply browser enterprise DoH policies to explicitly supported browsers; and use Windows Firewall for carefully tested resolver/VPN/app controls and selected FQDN dynamic-keyword rules where supported. Do not claim universal network filtering.

Use a browser-level URL allow/block policy only as defense in depth. It cannot cover non-browser applications. A domain allowlist also cannot safely represent per-application permissions if the DNS response is shared by all processes. Avoid inline TLS interception, certificate installation, custom kernel callout drivers, or broad outbound-443 blocking in the initial scope.

## 15. Testing strategy for Windows 10

Testing must use disposable VMs or spare Pisonet machines with a restorable OS/network image; do not perform the initial service rollout on customer production machines.

1. Inventory exact Windows editions/builds, architecture, NICs, IPv4/IPv6, DHCP/static DNS, browser versions, account memberships, UAC, and network gateway behavior.
2. Unit-test canonicalization, IDNA edge cases, label boundaries, duplicate imports, exact/subdomain mode, most-specific conflict rules, disable/monitor/enforce transitions, transaction rollback, and versioned schema upgrades.
3. Test pipe DACLs, wrong-user/admin access, malformed/oversized messages, replay/stale revisions, timeout, disconnect, busy service, app restart, and service restart.
4. In Monitoring Mode, test Windows Update, system time/connectivity checks, browser startup, GitHub updater, launcher admin socket, Steam login/download/game update, Roblox login/content, and any confirmed Spotify requirements. Verify no domain list has been inferred without observation/vendor data.
5. Test enforcement with caches warm and cold; DNS UDP/TCP; CNAME; IPv4 and IPv6; Ethernet/Wi-Fi/DHCP renew; adapter/VPN changes; sleep/resume/reboot; upstream outage; service crash; invalid config; disk full; database backup failure; firewall/policy write denial; installer cancellation; and uninstall.
6. Exercise bypass limits intentionally: browser DoH/DoT settings, alternate resolver, proxy, VPN, cached/direct IP, hosts file, portable browser, and non-browser clients. Record which are blocked, missed, or out of scope.
7. Verify recovery restores original resolver/policy and that DNS/network access returns even when service startup fails. Test offline recovery and rollback from a failed service upgrade.
8. Test on every supported OS edition/build and hardware architecture, with standard-user and administrator accounts. A result from one Windows edition does not prove support for others.

## 16. Recommended development phases

1. **Approval and environment definition:** confirm Windows edition/build/ESU, user/admin model, browser list, required applications, enforcement goal, privacy/log retention, and fail-open policy.
2. **Security and data groundwork:** design an admin session enforced in Electron main, secure credential verification, database migration/backup scheme, rule schema, and strict policy validator.
3. **Rule engine and UI:** implement owner Settings section, list/import/export, canonicalization, conflict display, and deterministic rule engine with unit tests; no OS policy changes yet.
4. **Service monitor-only prototype:** .NET Worker Service, named-pipe protocol, health/status, resolver observation, last-known-good storage, install/uninstall and rollback on lab VMs.
5. **Monitoring pilot:** capture real required app domains, review logs/privacy, build and validate exception list, verify baseline restore.
6. **Enforcement pilot:** apply DNS and browser policies to a disposable/canary computer, test documented bypasses and all required app flows, measure false blocks.
7. **Packaging/update lifecycle:** add elevated service install/update/uninstall transaction, signed versioned artifacts, protocol/schema compatibility and failed-upgrade rollback to the installer/release process.
8. **Staged rollout:** enable enforcement only after sign-off, recovery drill, support plan, and clear operator/customer notice.

## 17. Exact existing files for future changes

These paths currently exist and would likely be modified in future approved implementation phases:

| Area | Existing files | Likely purpose |
|---|---|---|
| Owner Settings UI | `index.html`; `src/renderer/features/ownerSettings.js`; `assets/css/style.css` | Add Website Access Control inside existing modal, controls, status, lists, import/export UI and styling. |
| Renderer state/init/auth | `src/renderer/core/state.js`; `src/renderer/core/init.js`; `src/renderer/features/library.js` | Maintain owner session state, bind UI, and display/clear access correctly. Do not treat this renderer state as authorization. |
| Narrow API and privileged boundary | `src/preload/electronApi.js`; `src/main/ipc/registerIpcHandlers.js`; `src/main/main.js` | Add explicit API/handlers, main authorization, client lifecycle and communication client. |
| Persistence/migration | `src/main/storage/gameStore.js` (and possibly a new website rules repository/migration module) | Versioned new tables, transaction, backup, queries, and single-writer ownership. |
| Installer/release/update | `package.json`; `.github/workflows/release.yml`; `scripts/validate-release.js`; new service installer/publish files | Service artifact packaging, UAC installer transaction, artifact checks, compatibility and service rollback. These files must not be changed until approval. |
| Existing privilege/elevation reference only | `src/main/services/cpService.js`; `src/main/services/popupWindowService.js`; `src/main/config/windowConfig.js` | Review privilege patterns and keep new operations within secure main/preload boundaries; do not reuse insecure popup settings. |

These are integration candidates, not an instruction to modify them. New future files (not currently present) would include a separate `services/JLJWebsiteProtectionService/` project and a narrowly scoped Electron main-process service client.

## 18. Dependencies, assumptions, and unresolved questions

### Verified facts

- The actual frontend is classic JavaScript/HTML/CSS, not React.
- Existing SQLite database is SQL.js/WASM and the repository has a legacy `database/launcher.db`; user-data DB is separate at runtime.
- No database backup/restore implementation or website tables were found.
- Owner password defaults and stored values are plaintext in current source/store.
- Main window has context isolation enabled, node integration disabled, sandbox disabled; popup window has node integration enabled and context isolation disabled.
- `sudo-prompt` exists for current UAC actions; no Windows service or named-pipe implementation exists.
- Source contains Steam and Roblox functionality, but no Spotify integration was found.
- Release config is GitHub draft + NSIS + updater; current release workflow validates remote assets then publishes. No release configuration was modified by this task.

### Assumptions requiring confirmation

- Windows 10 is the target, but the actual SKU, version/build, x64/ARM architecture, ESU enrollment, and whether Windows 11 upgrades are possible are unknown.
- Customer logon accounts are assumed to be standard users; this has not been verified.
- Supported browsers and versions are unknown. The feature cannot promise coverage for unlisted/portable browsers.
- It is assumed that operator-managed browser policies and disclosure of domain-level activity logging are acceptable.
- It is assumed default-deny is desired even if an unresearched application stops working; this should not become operational policy until required endpoints are inventoried.

### Questions to resolve before Phase 2

1. What exact Windows edition/build is on each Pisonet PC (Home, Pro, Enterprise/LTSC, IoT LTSC), and are Windows 10 Home/Pro machines enrolled in ESU or scheduled for Windows 11?
2. Are customers standard users, or can they use local administrator credentials? Is the launcher owner account distinct from Windows administrators?
3. Which browsers and versions must be supported? Are portable browsers, VPNs, proxies, or remote desktop permitted?
4. Is website allowlisting device-wide (recommended for DNS) or must an approved domain work only for one application?
5. Is fail-open network availability preferred if the service fails, accepting temporary policy bypass, or is temporary network loss acceptable? The project brief says not to leave a PC without working network, so a tested rollback/fallback is required.
6. Which applications are required on these PCs, including whether Spotify is actually used? Can their owners provide endpoint documentation and test accounts?
7. What activity-log retention and customer notice/privacy policy are acceptable?
8. Should service installation be a separate UAC-approved installer or an optional stage in the NSIS installer? What is the required behavior if an owner cancels UAC?
9. Is endpoint DNS filtering sufficient as a risk-reduction feature, or is stronger network-level filtering at the router/gateway required?

## 19. References consulted

- [.NET Support Policy](https://dotnet.microsoft.com/en-us/platform/support/policy)
- [Install .NET on Windows — supported operating systems](https://learn.microsoft.com/en-us/dotnet/core/install/windows)
- [Windows 10 reaching end of support](https://learn.microsoft.com/en-us/lifecycle/announcements/windows-10-end-of-support)
- [Create a Windows Service with .NET Worker Service](https://learn.microsoft.com/en-us/dotnet/core/extensions/windows-service)
- [Named Pipe Security and Access Rights](https://learn.microsoft.com/en-us/windows/win32/ipc/named-pipe-security-and-access-rights)
- [Windows Firewall Dynamic Keywords and FQDN limitations](https://learn.microsoft.com/en-us/windows/security/operating-system-security/network-security/windows-firewall/dynamic-keywords)
- [Windows Filtering Platform architecture](https://learn.microsoft.com/en-us/windows/win32/fwp/windows-filtering-platform-architecture-overview)
- [WFP callout driver considerations](https://learn.microsoft.com/en-us/windows-hardware/drivers/network/callout-driver-programming-considerations)
- [Chrome DNS-over-HTTPS enterprise policy](https://chromeenterprise.google/intl/en_us/policies/dns-over-https-mode/)
- [Microsoft Edge DNS-over-HTTPS policy](https://learn.microsoft.com/en-us/deployedge/microsoft-edge-policies/dnsoverhttpsmode)
- [Firefox enterprise policy templates](https://mozilla.github.io/policy-templates/)
- [GitHub Actions workflow and release configuration](.github/workflows/release.yml)

## 20. Inspection-only confirmation

This task created only `WEBSITE-ACCESS-CONTROL-PHASE-1-REPORT.md`. No source file, package manifest/lockfile, dependency installation, database, installer configuration, or release workflow was changed during this inspection. No database migration or service installation was run. Existing files and database records were not modified. The working tree state that existed before this report was not reset or rewritten.

**Phase 1 is complete. No Phase 2 implementation has started. Awaiting review and explicit approval.**
