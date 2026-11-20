# Website Access Control — Phase 4B Report

**Status: Phase 4B foundation implemented for review. No Windows service was installed or started. DNS, browser, firewall, registry, installer, and release settings were not changed. Enforcement is always reported inactive.**

## Service architecture

- Added `services/JLJWebsiteProtectionService/`, a separate .NET Framework 4.8.1 Windows Service project. The service does not reference Electron or SQL.js and contains no access to `launcher.db`.
- The service is configured for `LocalService`, automatic startup after installation, and an install-time restricted service SID (`SERVICE_SID_TYPE_RESTRICTED`). No service was registered on this development computer.
- Service-owned policy/recovery files and fixed-code diagnostic log are under `%ProgramData%\JLJGamingHouse\WebsiteProtection`. The service and installer code protect that directory for SYSTEM, Administrators, LocalService, and the service SID. The installed owner SID is stored there with the same protected ACL.
- The project installer requires `/ownerSid=<Windows SID>`, provisions that identity, and configures the restricted service SID. The production installer was not modified.
- Startup reloads and validates the last-known-good policy. Status reports service/protocol versions, state, UTC heartbeat, accepted revision/hash, and always reports `mode=monitoring`, `enforcementActive=false`, and `resolverConfigured=false`.

## Named-pipe protocol and authorization

- Pipe: `\\.\pipe\JLJWebsiteProtection.v1`; newline-delimited UTF-8 JSON; 1 MiB maximum; one request per connection; five-second server read limit and 2.5-second default Electron client timeout.
- Requests have exactly `protocolVersion`, `requestId` (GUID), `operation`, and `body`. JSON parsing rejects duplicate keys, unknown/missing fields, invalid integer forms, excessive nesting, and malformed messages. Responses carry the same protocol version and request ID and use fixed error codes without exception text.
- Both ends enforce operation-specific request/response body shapes. The Electron client rejects a response with missing or extra fields, malformed typed values, a non-monitoring mode, or any claim that enforcement or a resolver is active.
- Operations: `GetCapabilities`, `GetStatus`, `ValidatePolicy`, `ApplyPolicy`, and `RestoreLastKnownGood`.
- Native pipe creation rejects remote clients and uses first-instance ownership to detect pipe squatting. Its protected DACL permits SYSTEM, LocalService, Administrators, the service SID, and local Builtin Users for connection; the service authenticates the impersonated Windows token and permits policy mutation only for the exact owner SID provisioned at installation. Other authenticated local users can request status/capabilities but cannot apply or restore a policy.
- Electron exposes only narrow preload methods. Main-process IPC applies the existing trusted-frame and active-owner-session checks before status, capability, validation, synchronization, or restore requests. The service independently verifies the actual Windows caller SID; it does not accept renderer-supplied owner/admin flags.
- SHA-256 is used only for policy integrity. A fixed cross-language test vector confirms that the .NET service validator and Phase 4A JavaScript snapshot builder use the same compact canonical JSON representation and digest.

## Policy acceptance and recovery

- The service independently enforces protocol version 1, default action `deny`, canonical lower-case ASCII/IDNA domains, unique domains, `allow`/`block` actions, explicit Boolean flags, the 5,000-rule limit, and the 1 MiB message limit.
- Revisions must increase. An exact repeat of the current revision and hash is idempotent; an older revision or same-revision different hash is rejected. Duplicate request IDs replay the previous response only for an identical request; reusing an ID for different bytes is rejected.
- Policy acceptance writes a complete validated snapshot to a temporary file, flushes it, and atomically replaces the last-known-good file before updating in-memory status. Startup revalidates the persisted file. Restore reloads that saved snapshot; it does not change networking.
- No DNS listener, upstream forwarding, adapter management, browser management, or enforcement path exists in this phase.

## Files changed in Phase 4B

Modified:

- `src/main/main.js`
- `src/main/ipc/registerIpcHandlers.js`
- `src/preload/electronApi.js`

Added:

- `src/main/websiteAccess/websiteServiceClient.js`
- `test/websiteServiceClient.test.js`
- `services/JLJWebsiteProtectionService/JLJWebsiteProtectionService.csproj`
- `services/JLJWebsiteProtectionService/Program.cs`
- `services/JLJWebsiteProtectionService/ProtectionService.cs`
- `services/JLJWebsiteProtectionService/ProjectInstaller.cs`
- `services/JLJWebsiteProtectionService/ServiceIdentityConfig.cs`
- `services/JLJWebsiteProtectionService/ServiceIsolation.cs`
- `services/JLJWebsiteProtectionService/ServiceLog.cs`
- `services/JLJWebsiteProtectionService/ServiceProtocol.cs`
- `services/JLJWebsiteProtectionService/StrictJsonParser.cs`
- `services/JLJWebsiteProtectionService/PolicySnapshotValidator.cs`
- `services/JLJWebsiteProtectionService/PolicyStateStore.cs`
- This report.

The broader Phase 1–4A work was already present in the working tree and has been preserved. Package manifests, databases, production installer, release workflow, and updater were not modified.

## Tests and environment

- `npm.cmd test`: **46 passed, 0 failed**, including Phase 4A policy tests and five named-pipe client tests for protocol mismatch, malformed/extra response fields, request correlation, size caps, timeout, unavailable service, and sanitized remote errors.
- The C# service sources compiled to a temporary executable with the in-box .NET Framework compiler, then the executable's `--self-test` passed: duplicate-key rejection, policy validation, checksum vector, tampered hash, unsupported protocol, unauthorized SID, stale revision, duplicate request/replay, atomic state reload/restart, restore, ACL principals, local named-pipe framing/transport, and server-side oversized-request rejection. The temporary executable and policy state were removed.
- `node --check` passed for the changed JavaScript files; the service project XML parsed; `git diff --check` passed.
- Tested on the current Windows x64 development host, build **26300**, not Windows 10 Pro 22H2 build 19045. The project targets .NET Framework 4.8.1, but this host lacks the .NET 4.8.1 targeting pack and MSBuild; manual compilation used the installed Framework compiler. This is not a formal target-framework build.
- The pipe transport/ACL harness uses an injected caller SID. An attempted real `RunAsClient` integration on this un-elevated development token failed with `PIPE_IDENTITY_ERROR`; the actual LocalService token impersonation path remains unverified and must be tested after installation in a disposable environment. No Windows service lifecycle was exercised.

## Known limitations and risks

- No Windows 10 compatibility claim is made. Build 19045, .NET Framework 4.8.1 reference-pack build, service installation/start/stop/restart, LocalService token impersonation, and post-reboot recovery require target-machine testing.
- Browser/renderer end-to-end interaction was not run. The narrow APIs are wired through main/preload; no new UI controls call them yet.
- The service's persisted policy state is not protected by a signature; trust comes from OS caller identity, the protected service directory, and SHA-256 integrity. SHA-256 alone does not authenticate a caller.
- The named-pipe ACL allows local Users to connect for read-only status and validation operations. The service-side token checks protect mutation operations. Denial-of-service resistance and repeated hostile-connection behavior need security testing.
- Installer rollback behavior and owner SID provisioning have not been exercised. The service was not installed.
- The upstream resolver is still unselected and unset; protection is unavailable. This phase does not prevent direct-IP access, VPNs, proxies, or all encrypted tunnels.

## Steps needed for Phase 4C

1. Review/approve this Phase 4B foundation and keep the service inactive.
2. Select and explicitly configure an upstream resolver; do not activate until one is valid.
3. Implement the loopback DNS listener, DNS packet validation, allow/block evaluation, bounded cache, upstream timeouts, and sanitized decision logging without changing adapters.
4. Implement mocked fail-open state transitions and recovery snapshot handling, then test service stop/crash/upstream-failure scenarios in disposable environments.
5. Complete real caller-token tests with the LocalService service identity. Keep DNS adapters and production enforcement unchanged until a later approved phase and Windows 10 target tests.
