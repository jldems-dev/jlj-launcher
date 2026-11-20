# JLJ Gaming House — Website Access Control
## Phase 2: Windows 10 Compatibility, Security and Implementation Plan

**Status:** Inspection and planning only. No implementation is authorized by this document.

### Evidence labels

- **Verified:** observed in the source project or supported by a cited primary source.
- **Proposal:** recommended design, subject to approval and implementation testing.
- **Assumption / open question:** information not yet established.

## 1. Executive recommendation

**Proposal:** For the confirmed Windows 10 Pro 22H2 x64 target, use a small, independent .NET Framework 4.8.1 Windows Service, installed and updated through an explicitly UAC-approved machine-wide installer stage. The service owns only the networking and managed-policy operations required for this feature. Keep Electron un-elevated and keep its SQL.js database as the sole application database writer. Have Electron main send validated, versioned policy snapshots to the service over a restricted Windows named pipe.

This recommendation is about technical compatibility, not continued OS security support. Windows 10 Home/Pro 22H2 support ended on October 14, 2025. As of this plan’s date, continued deployment should be contingent on an appropriate ESU arrangement or a supported Windows migration plan. The customer’s ESU enrollment is unknown. Microsoft’s current modern .NET support matrix lists Windows 10 only for Enterprise/LTSC editions, not Windows 10 Pro; therefore .NET 10 Worker Service is not the supported Pro 22H2 choice. Microsoft lists .NET Framework 4.8.1 as installable on Windows 10 22H2 x64, with Framework support following the parent OS lifecycle. [Windows 10 lifecycle](https://learn.microsoft.com/en-us/lifecycle/announcements/windows-10-end-of-support), [.NET on Windows support matrix](https://learn.microsoft.com/en-us/dotnet/core/install/windows), [.NET Framework system requirements](https://learn.microsoft.com/en-us/dotnet/framework/get-started/system-requirements), [.NET Framework lifecycle FAQ](https://learn.microsoft.com/en-us/lifecycle/faq/dotnet-framework)

The requested protection level is practical bypass resistance, not tamper-proof control. DNS filtering, browser policies, and Windows Firewall can reduce ordinary bypasses for standard users. A local administrator can ultimately change or remove local controls, and applications using encrypted tunnels or direct IPs may evade hostname policy. A gateway-level policy would provide a stronger boundary.

## 2. Existing project and compatibility findings

### Verified project facts

- The renderer is HTML, CSS, and classic JavaScript; this project is not React-based. Owner Settings is already a modal in `index.html`, with behavior in `src/renderer/features/ownerSettings.js` and styles in `assets/css/style.css`.
- Electron main owns a SQL.js database loaded in memory and persisted as a whole database image. Its runtime DB is under Electron `userData`; the repository also has a legacy seed DB at `database/launcher.db`. The installed application’s user data and the repository seed are distinct.
- Existing tables include `owner`, `games`, `settings`, `left4dead2_maps`, and `pc_specs`. Schema setup uses `CREATE TABLE IF NOT EXISTS` and additive column checks; there is no migration ledger or website access-control schema.
- No website protection Windows service, named-pipe client, website rules, or browser policy management code exists in the inspected source.
- The main window enables context isolation and disables Node integration; sandbox is disabled. `popupWindowService.js` uses Node integration and disables context isolation. It is not an appropriate place for privileged website controls.
- Owner login state is currently renderer-side. Existing owner credentials are stored as plain text, and privileged IPC mutations do not consistently validate a main-process owner session. Current owner authentication is insufficient by itself to authorize machine-wide networking changes.
- The current NSIS setup is per-user (`perMachine: false`) and disallows elevation. It cannot silently install a machine-wide service. The app currently uses Electron 28.3.3; its runtime version is unrelated to the proposed service runtime and must remain unchanged by this plan.
- Steam, Roblox, game management/launch, auto-update, and other existing features are outside this feature’s change scope and must remain intact. No required application domains are inferred here.

### Windows/runtime compatibility comparison

| Technology | Windows 10 Pro 22H2 x64 assessment | Recommendation |
|---|---|---|
| .NET Framework 4.8.1 Windows Service | Microsoft lists it as installable on Windows 10 22H2 x64. It is an in-place Framework update over 4.8. Windows 10 lifecycle support still applies. | **Preferred for the confirmed OS target**, after validating the install prerequisite and service behavior on the exact image. |
| Modern .NET Worker Service (.NET 10) | Current Microsoft support matrix limits modern .NET on Windows 10 to Enterprise/LTSC rows; Windows 10 Pro 22H2 is not listed as supported. Self-contained deployment does not make an unsupported OS supported. | Do not choose for the confirmed Pro target. Revisit for supported Windows versions after testing. |
| Native C++ Windows Service | Can use the Windows Service Control Manager and native APIs without a managed runtime dependency; development, memory-safety, servicing, and test burden are higher. | Viable if avoiding Framework is a hard requirement, but not the lowest-risk first implementation. |
| Go Windows service | Can run independently and can use Windows service APIs via maintained Go packages, but adds toolchain, packaging, and API/security ownership. | Viable alternative; requires a prototype proving service ACL, networking, and update behavior. |
| PowerShell service wrapper or Electron child process | Wrapper/service lifecycle and policy security are harder to constrain; Electron child process is coupled to UI lifecycle and app updates. | Not recommended for a privileged independent service. |

**OS lifecycle issue:** Windows 10 Pro 22H2 reached end of regular support on October 14, 2025. Organization ESU is available for eligible enrolled devices; actual enrollment, entitlement, and update status must be checked before deployment. [Windows 10 end of support](https://learn.microsoft.com/en-us/lifecycle/announcements/windows-10-end-of-support), [Windows 10 ESU for organizations](https://learn.microsoft.com/en-us/windows/whats-new/enable-extended-security-updates)

## 3. Proposed service architecture

1. Install a signed x64 service binary under a protected Program Files directory through an explicit administrator-approved installer stage.
2. Register it with the Windows Service Control Manager for automatic start and bounded restart recovery. It must start and enforce its previously committed policy without Electron running.
3. Use a service SID and protected service executable/configuration ACLs. Prefer a restricted service account if all required operations can be granted narrowly. If machine DNS/firewall/policy APIs require LocalSystem, use LocalSystem only with a restricted service SID, minimal code surface, strict input validation, and writes limited to JLJ-owned settings/rules.
4. Keep service state in its own protected ProgramData subdirectory. Do not let the service open or write `launcher.db`.
5. Separate read-only health/status from privileged mutation commands. Service work must be serialized; reject oversized, malformed, stale, replayed, or unsupported protocol messages.
6. Scope firewall rules and browser policy values with stable JLJ-owned names/markers so uninstall can remove only its own artifacts.

**Proposal:** DNS filtering is implemented as a local loopback resolver or a clearly selected upstream filtering provider, only after upstream/provider and privacy requirements are decided. Use Windows Firewall as defense-in-depth against DNS bypass paths where reliable. Manage browser settings only for explicitly supported browsers using their documented enterprise policy mechanisms. Avoid a custom WFP kernel callout driver in the first release; it materially increases kernel-mode and recovery risk. [Windows Service guidance](https://learn.microsoft.com/en-us/dotnet/framework/windows-services/introduction-to-windows-service-applications), [WFP architecture](https://learn.microsoft.com/en-us/windows/win32/fwp/windows-filtering-platform-architecture-overview)

## 4. Authorization, UAC, accounts, and ACLs

- **Owner authorization:** Add a main-process authenticated session with a short idle lifetime and invalidation on logout, window reload/navigation, app lock, or app exit. Every website-access IPC handler checks that session and validates the sender frame and payload. Renderer-only booleans are presentation state, not authority.
- **Credential hygiene:** Before using launcher owner credentials to approve machine-wide policy changes, replace plaintext/default credentials with a strong salted password verifier and a controlled recovery/change process. Do not treat the launcher owner identity as proof of a Windows administrator token.
- **UAC:** Service installation, removal, or upgrade requires an explicit UAC consent path. Electron must remain unelevated. For each policy apply operation, either require a fresh short-lived elevated broker action or have the already-installed service validate the caller’s real Windows token and explicitly authorize the action. Avoid persistent elevation and avoid asking for UAC on routine read-only status calls.
- **Windows accounts:** Customers are Standard Users. They may view a minimal status if desired, but must not modify rules, change mode, stop/disable the service, alter policy files, or remove JLJ firewall/policy entries. The operator’s Windows account should be a member of local Administrators, but elevation still requires a valid elevated token/UAC approval.
- **Service ACLs:** Protect service configuration, binary, ProgramData state, and named pipe. Grant write/control only to SYSTEM and Administrators/service identity. Do not grant customer SID or `Authenticated Users` write access.
- **Machine identity ambiguity:** Confirm whether one launcher-owner account controls each machine, whether operators have distinct Windows admin identities, and whether customers can obtain any admin credentials. Local administrators can bypass local controls; this feature must not promise protection against a hostile admin.
- **Privacy:** Define customer notice and retention before recording domain events. Prefer short retention and minimal fields; do not collect full URLs, page paths, query strings, or content.

## 5. Named-pipe protocol

**Proposal:** Use a local-only pipe such as `\\.\pipe\JLJGamingHouse.WebsiteProtection.v1` with a restrictive explicit DACL and message-mode framing. Electron main process alone connects; renderer gets only narrow methods via preload. The service authenticates the connected client’s Windows token and checks allowed operations. A pipe name is not a secret.

Suggested request envelope:

```json
{"protocol":1,"requestId":"uuid","operation":"GetStatus","payload":{}}
```

Suggested response envelope:

```json
{"protocol":1,"requestId":"uuid","ok":true,"result":{}}
```

Initial allowlisted operations: `GetStatus`, `GetCapabilities`, `ValidatePolicy`, `ApplyPolicy`, `SetMode`, `RestoreLastKnownGood`, and `GetHealthSummary`. No arbitrary shell, command line, registry path, firewall rule text, or file path operation is allowed. Enforce maximum frame and collection sizes, strict schema/version validation, request timeout, correlation ID, monotonic policy revision/hash, and audit result codes. Unknown versions/operations fail closed for the request. Pipe disconnect must not change the active policy.

Use a read-only status pipe/DACL for standard users only if the status data is safe to disclose; otherwise permit only the interactive operator/admin. UAC and Windows token validation must be tested on actual standard-user and administrator accounts, including filtered admin tokens. Do not trust JSON fields like `isOwner` or `isAdmin`.

## 6. SQL.js migration plan (design only)

Keep Electron main as the only writer of the existing launcher DB. Add a migration ledger and sequential schema versions; each migration should run transactionally and idempotently. Before production migration, create a byte-for-byte backup of the per-user DB, verify its hash and SQLite integrity, migrate a copy, compare existing tables/row counts and sample foreign/unique constraints, then atomically replace the live DB with rollback on any error. Never migrate the repository seed in place or copy an installed user DB over development data. Existing application records must remain unchanged.

Proposed tables (not created):

| Table | Proposed purpose and constraints |
|---|---|
| `schema_migrations` | Integer version, applied UTC timestamp, migration checksum; reject unexpected checksum drift. |
| `website_rules` | Normalized domain unique key, `allow`/`block`, `include_subdomains`, enabled flag, created/updated time, optional operator attribution. |
| `website_access_settings` | Singleton enabled flag, monitoring/enforcement mode, default action, policy revision/hash, last successful apply time. |
| `website_exceptions` | Explicit approved exception scope, reason, enabled state, creator and time. Any application identity field is only meaningful if enforcement truly supports app scoping. |
| `website_access_log` | UTC time, normalized queried domain, decision, rule/source/revision and coarse result; no full URL or payload. Add retention and indexes. |
| `website_service_status` | Last observed state, heartbeat, service/protocol version, applied revision/hash and sanitized last error. Treat as a cache, not authoritative policy. |

The service stores its last-known-good applied snapshot and recovery metadata separately under protected ProgramData. It must not concurrently mutate SQL.js’ whole-image database. Decide log volume/retention and whether logging is local-only before implementation.

## 7. Domain rules and import/export validation

- Normalize DNS names to lower-case IDNA ASCII/Punycode; trim surrounding whitespace and a single terminal dot. Reject empty labels, invalid IDNA, schemes, paths, ports, wildcards, embedded whitespace, IP literals, control characters, and overlong names.
- Store/display normalized canonical value and optionally preserve a sanitized display value. Normalize before duplicate detection so Unicode and ASCII equivalents cannot create conflicting rules.
- Match exact host by default. If `include_subdomains` is enabled, match on DNS label boundary (`sub.example.com` matches `example.com`, while `notexample.com` does not).
- Resolve conflict using the most-specific matching explicit rule; on same normalized scope, enforce one unique record and do not permit contradictory duplicate actions. Protected recovery/system essentials must be a tiny fixed, reviewed set, separate from user rules. Default deny means unlisted destinations are blocked only while enforcement is active and only within supported traffic paths.
- Application-specific exceptions cannot be implemented by a DNS resolver alone: DNS resolution is shared at machine level. Do not expose app-scoped exceptions until a tested enforcement layer can reliably identify the requesting process.
- Import only a documented versioned JSON format; enforce byte/count limits; reject unknown keys or invalid records; validate all rows before any save; show preview/add/update/skip/errors; apply atomically; never execute imported content. Export normalized rules/settings only, excluding credentials, raw logs, machine identifiers, or service secrets.

## 8. Network and browser enforcement boundaries

| Path | Proposed treatment | Known limitation |
|---|---|---|
| IPv4 DNS | Configure each active adapter deliberately and record prior per-adapter state. Firewall should prevent customer applications from bypassing the designated resolver where feasible. | DHCP/VPN/adapter changes and cached answers require monitoring and reapplication logic. |
| IPv6 DNS | Apply equivalent policy to IPv6 adapters and test separately. Do not disable IPv6 globally as a shortcut. | Unmanaged IPv6 paths can bypass IPv4-only rules. |
| DNS over HTTPS | Set managed DoH policies for supported Chrome/Edge/Firefox versions; restrict unmanaged browser settings where enterprise policy supports it. | Arbitrary DoH over HTTPS/443, other browsers, embedded browser engines, and custom clients can evade endpoint DNS filtering. |
| DNS over TLS | Block outbound TCP/UDP 853 for standard-user traffic when compatible with required services. | VPN tunnels and custom ports can bypass; broad rules may affect applications. |
| Windows Firewall | Add/remove only JLJ-owned, narrowly scoped rules; protect ordinary DNS ports and selected known bypass paths. | Dynamic FQDN firewall rules depend on DNS observations and are not a complete URL filter; shared hosting/CDNs risk collateral blocks. |
| Direct IP | Default-deny policy can limit selected traffic but IP-only filtering cannot represent domain policy reliably. | HTTPS to shared/CDN IPs and hard-coded endpoints make IP blocks imprecise; certificate hostname is not universally available to firewall. |
| VPN/proxy | Manage supported browser proxy settings and block known VPN protocols/apps only after compatibility review. | Arbitrary HTTPS tunnels, VPNs, proxies, remote desktop, and local admin access cannot be comprehensively defeated by this design. |

Managed browser policies should be selected only after browser/version confirmation. Chrome publishes a `DnsOverHttpsMode` policy; Edge documents `DnsOverHttpsMode`; Firefox provides enterprise policy templates. Policy should be applied using documented machine policy locations and removed only if values still match the JLJ-owned value. [Chrome policy](https://chromeenterprise.google/intl/en_us/policies/dns-over-https-mode/), [Edge policy](https://learn.microsoft.com/en-us/deployedge/microsoft-edge-policies/dnsoverhttpsmode), [Firefox policies](https://mozilla.github.io/policy-templates/), [Windows Firewall FQDN/dynamic keyword behavior](https://learn.microsoft.com/en-us/windows/security/operating-system-security/network-security/windows-firewall/dynamic-keywords)

Do not claim complete URL/content filtering: domain DNS sees requested names, not paths or necessarily successful page visits. Caches, encrypted DNS, direct IP, proxies, VPNs, and application-specific encrypted channels affect visibility and enforcement. A gateway-managed DNS/filtering service is the preferred stronger enforcement boundary if bypass resistance is a hard requirement.

## 9. Modes, health, recovery, and uninstall

- **Monitoring mode:** Observe supported resolver requests and calculate proposed decisions without blocking. Label events as DNS queries, not confirmed visits. Encrypted DNS not passing through the managed resolver is not visible.
- **Enforcement mode:** Require a healthy resolver, valid last-known-good config, successful IPv4 and IPv6 checks, browser policy checks, and a tested recovery action before enablement. Show the operator the planned change and require explicit confirmation.
- **Health checks:** SCM running state, pipe responsiveness, resolver loopback query, upstream reachability, config revision/hash, active adapter DNS, firewall rule presence, and browser policy state. Avoid network-content checks.
- **Last-known-good:** Validate full policy, write a temporary snapshot, flush and atomically replace service-owned config, apply OS changes, verify health, then mark revision committed. On failure, restore prior snapshot and OS state.
- **Fail-open recovery:** If local resolver/service fails, restore prior working adapter DNS and remove/disable only JLJ-owned rules that strand connectivity. This allows temporary policy bypass, but avoids leaving a PC offline. Make recovery watchdog independent of the Electron renderer and test power loss/crash/reboot scenarios. Clearly show degraded/unprotected state until repaired.
- **Restore/uninstall:** Explicit owner/admin action; snapshot old per-adapter DNS and prior browser policy values before first mutation. Restore only values still owned by this installation; remove only named JLJ firewall rules, service files, ACLs and policy keys. Never reset all network settings or unrelated firewall/policy state. Preserve website rules/log export if requested, otherwise explain deletion and retention before removal.

## 10. Owner Settings UI integration

Integrate a new **Website Access Control** section inside the existing Owner Settings modal (`index.html`), with behavior in `src/renderer/features/ownerSettings.js` and styles in `assets/css/style.css`. Do not add a sidebar entry or a second modal.

Suggested screen elements: service health/mode card; Monitoring/Enforcement switch with clear consequences; default behavior; allow/block rules table; normalized domain entry and subdomain option; import preview and export; last apply time/revision; error and recovery state. Use explicit loading, permission-required, unsupported-browser/OS, service-unavailable, and degraded states. Keep a direct restore/disable recovery action available to the authorized operator.

Renderer calls a narrow preload API; preload never exposes raw pipes or shell. Main IPC repeats authorization and validates input. Status may be displayed to customers only if privacy and operational policy permit. Existing game, Steam, Roblox, owner settings, and update flows remain independent.

## 11. Installer, updates, and compatibility strategy

Current per-user NSIS behavior cannot register a machine service. After explicit approval, evaluate a separate signed elevated service installer versus a clearly UAC-approved machine-wide NSIS flow. Do not silently convert current per-user installs or elevate the Electron application itself.

Service update sequence proposal: validate signed/versioned artifact; stop service; stage new binary; preserve service-owned last-known-good and recovery record; update; start; verify pipe/protocol/health; commit only after health check; otherwise restore prior binary/config. Electron and service protocol must be backward compatible across staged updates. Keep service installer artifacts explicitly validated by release checks. A service update must not auto-publish or bypass existing release protection. Uninstall should be a deliberate, elevated action and restore network state before removing the service.

Compatibility plan: initial support explicitly Windows 10 Pro 22H2 x64 with .NET Framework 4.8.1 and current security updates/ESU where applicable; later add Windows 11 x64 as a separately tested target. Re-evaluate Framework servicing and choose a modern .NET service only when all supported target OS editions are on Microsoft’s supported matrix. Do not assume OS version compatibility from Electron compatibility alone.

## 12. Test, rollout, and recovery plan

All testing must use disposable Windows 10 Pro 22H2 x64 VMs or a designated canary PC, with snapshots and no production customer policy until approval.

1. **Compatibility:** Framework 4.8.1 installed/detected; service install/start/stop/restart; cold boot with Electron absent; service crash and recovery; Windows updates/ESU status recorded.
2. **Identity/ACL:** Standard customer cannot change rules, stop service, write policy/config, change DNS/firewall, or access mutation pipe. Elevated operator can do approved operations after authorization/UAC. Test filtered admin token and UAC cancel.
3. **Database:** Clone real schema/data to a disposable copy; backup/hash/integrity; migration rollback and repeatability; assert existing owner, game, settings, maps and PC-spec rows unchanged. No production DB touched during development tests.
4. **Rules:** IDNA normalization, trailing dot, case, label-boundary subdomains, conflicting parent/child rules, invalid import, duplicate normalized names, oversized files and atomic import.
5. **Network:** DHCP and static DNS, Ethernet/Wi-Fi, adapter add/remove, IPv4/IPv6, cache, upstream unavailable, DoH/DoT, supported browsers, VPN/proxy, direct IP. Record expected bypasses; do not claim blocked unless observed on the target setup.
6. **Recovery:** malformed policy, interrupted write, service crash, power loss, bad update, missing Framework prerequisite, uninstall, restore original adapter DNS and policy state. Verify unrelated rules/settings are untouched.
7. **Application regression:** Launch/update JLJ app; Steam and Roblox use cases; games and hosting; Windows Update; internet recovery; existing Owner Settings. Required domains are supplied and verified by the operator before allowlist tests. No domains are invented in this plan.
8. **Pilot:** monitoring first, review false positives/privacy, then a single canary enforcement rollout with an operator recovery drill and written sign-off before broader deployment.

No lint, build, install, migration, or platform test was run for this planning task; no implementation exists to validate yet.

## 13. Exact files likely to change in an approved implementation

This is a planning inventory, not authorization to edit. Some paths are verified existing files; new paths are proposals.

| Area | Existing or proposed paths | Expected role |
|---|---|---|
| Settings UI | Existing: `index.html`, `src/renderer/features/ownerSettings.js`, `assets/css/style.css` | Add the section inside the existing modal and its controls/status. |
| Renderer auth/state | Existing: `src/renderer/core/state.js`, `src/renderer/core/init.js`, `src/renderer/features/library.js` | Owner session presentation and UI lifecycle; never the authorization source. |
| Preload/main boundary | Existing: `src/preload/electronApi.js`, `src/main/ipc/registerIpcHandlers.js`, `src/main/main.js` | Narrow website APIs, IPC validation/session checks and service-client lifecycle. |
| SQL.js persistence | Existing: `src/main/storage/gameStore.js`; proposed `src/main/storage/websiteAccessRepository.js`, `src/main/storage/migrations/` | Migration ledger, transactional tables, validated persistence and backup/rollback helpers. |
| Electron service client | Proposed `src/main/services/websiteProtectionClient.js` and protocol schemas | Named-pipe requests, version negotiation, timeout and safe status handling. |
| Windows service | Proposed `services/JLJWebsiteProtectionService/` project/source/tests | Independent service, resolver/policy operations, ACL setup, health and recovery. |
| Installer/release | Existing: `package.json`, `.github/workflows/release.yml`, `scripts/validate-release.js`; proposed service installer/build/signing files | Only after approval: signed service artifact, explicit elevation, release validation and transactional update. Existing updater/release safeguards must be preserved. |
| Auth hardening | Existing: `src/main/storage/defaultData.js`, owner verification portions of `src/main/storage/gameStore.js` and `src/main/ipc/registerIpcHandlers.js` | Remove default/plaintext authorization weakness before machine-level policy is exposed. |

Do not modify unrelated game, Steam, Roblox, database records, or auto-update behavior. Exact final file list should be narrowed after a design review and before implementation.

## 14. Unresolved questions and risks

1. Is the target PC enrolled in Windows 10 ESU, and what is the supported Windows 11 migration timeline?
2. Which browsers and exact versions are supported? Are portable browsers allowed?
3. Is the application owner a Windows local administrator, and is the owner credential distinct from Windows credentials? Who can approve UAC?
4. Is coverage device-wide, or is per-application exceptions a requirement? DNS alone cannot safely provide application-scoped exceptions.
5. Which upstream DNS provider/local resolver is acceptable, and what query data leaves the PC?
6. Is temporary fail-open/unfiltered access acceptable to preserve connectivity during failure? If not, policy needs a different recovery decision and higher lockout risk.
7. What are the required application endpoints/domains, supplied by operator/vendor evidence? What applications beyond Steam/Roblox must work?
8. What notice, retention duration, export access, and deletion policy should apply to domain logs?
9. Should service installation be a separate UAC installer or an optional stage in a machine installer? What happens when UAC is cancelled?
10. Does the customer require local endpoint-only controls, or is gateway filtering available? Endpoint controls cannot robustly stop a hostile local administrator or all encrypted tunnels.
11. Is .NET Framework 4.8.1 already present on the target image, and can the approved installer provide it offline if required?

## 15. References

- [Windows 10 reaching end of support](https://learn.microsoft.com/en-us/lifecycle/announcements/windows-10-end-of-support)
- [Windows 10 ESU for organizations](https://learn.microsoft.com/en-us/windows/whats-new/enable-extended-security-updates)
- [Modern .NET on Windows: supported OS matrix](https://learn.microsoft.com/en-us/dotnet/core/install/windows)
- [.NET Framework system requirements](https://learn.microsoft.com/en-us/dotnet/framework/get-started/system-requirements)
- [.NET Framework lifecycle FAQ](https://learn.microsoft.com/en-us/lifecycle/faq/dotnet-framework)
- [Create a Windows Service with .NET Worker Service](https://learn.microsoft.com/en-us/dotnet/core/extensions/windows-service)
- [Named Pipe Security and Access Rights](https://learn.microsoft.com/en-us/windows/win32/ipc/named-pipe-security-and-access-rights)
- [Windows Firewall Dynamic Keywords](https://learn.microsoft.com/en-us/windows/security/operating-system-security/network-security/windows-firewall/dynamic-keywords)
- [Windows Filtering Platform architecture](https://learn.microsoft.com/en-us/windows/win32/fwp/windows-filtering-platform-architecture-overview)
- [Chrome DNS-over-HTTPS policy](https://chromeenterprise.google/intl/en_us/policies/dns-over-https-mode/)
- [Microsoft Edge DNS-over-HTTPS policy](https://learn.microsoft.com/en-us/deployedge/microsoft-edge-policies/dnsoverhttpsmode)
- [Firefox enterprise policy templates](https://mozilla.github.io/policy-templates/)

## 16. Phase 2 completion statement

This document is the Phase 2 planning deliverable. No application source files, database files or records, package manifests or lockfiles, dependencies, installer/release/updater configuration, Windows DNS, firewall, registry, browser policies, or services were modified. No service was installed or registered. **Stop here and wait for explicit approval before implementation.**
