# JLJ Website Access Control — Phase 4D Report

**Status: Source-level security verification and current-host tests completed. Windows 10 Pro 22H2 integration test plan and harness prepared; target-machine results remain pending. DNS enforcement is inactive.**

No service was installed or started. No network adapter DNS, firewall, registry, browser policy, launcher database, installer, or release configuration was modified. No upstream provider was selected. Phase 4E has not started.

## Verified in source

### Service identity and permissions

- `ProjectInstaller` configures `ServiceProcessInstaller.Account` as `LocalService` and the service start type as `Automatic`.
- After service installation, `ServiceIsolation.EnableRestrictedServiceSid` requests `SERVICE_SID_TYPE_RESTRICTED` through `ChangeServiceConfig2`. The service SID is computed from the upper-case service name encoded as UTF-16LE and the Windows service-SID SHA-1 construction.
- The state directory is under `%ProgramData%\JLJGamingHouse\WebsiteProtection`. Its explicit protected DACL grants Full Control to SYSTEM, LocalService, Administrators, and the service SID. The `owner.sid` file is given the same protected principal set. Builtin Users, Authenticated Users, and Everyone receive no allow entry in these filesystem ACLs.
- The service rejects the final state-directory path if it is a reparse point before using it. The store creates/reapplies its protected directory ACL before writes. These checks were inspected in source and ACL descriptors were tested in-process; the permissions on a deployed Windows 10 filesystem were not exercised.

### Pipe authentication and owner authorization

- The pipe DACL is protected from inheritance, allows only local connections (`PIPE_REJECT_REMOTE_CLIENTS`), and grants access to SYSTEM, LocalService, Administrators, the service SID, Builtin Users, and the provisioned owner SID. Builtin Users and the owner receive pipe read/write access; application authorization remains mandatory.
- The server resolves the peer SID inside `NamedPipeServerStream.RunAsClient` using the impersonated Windows identity. `ApplyPolicy` and `RestoreLastKnownGood` call `RequireOwner`, which compares that SID exactly with the provisioned owner SID. Status, capabilities, and policy validation are available to authenticated local users but do not mutate policy state.
- The pipe integration self-test was corrected to use the production caller-SID resolver rather than an injected test SID. Its local client now requests `TokenImpersonationLevel.Impersonation`; the self-test passed on the current host.
- Regression tests verify that a simulated Builtin Users caller is denied both mutation operations, can validate a policy without changing the stored revision, and that the pipe ACL contains the expected principals without Everyone or Authenticated Users grants.

### Service lifecycle and recovery

- `OnStart` initializes the protected policy store, reads the owner SID, starts the named-pipe server, and starts a heartbeat. Store initialization failure leaves the service degraded and does not accept a policy. `OnStop` disposes the heartbeat and stops the pipe; shutdown follows the same cleanup path.
- Installer configuration tests confirm LocalService and automatic startup settings. A read-only `sc.exe query` returned error 1060, confirming the service is not registered on this host.
- No Service Control Manager failure-restart actions are configured. The service currently does not modify DNS, so service termination cannot leave adapter DNS changed in this phase. Phase 4C's recovery coordinator remains mock-only and is not wired to service shutdown/crash events. A future activation design needs a tested external recovery/watchdog mechanism before any DNS adapter changes are allowed.

## Changes made for Phase 4D verification

- `services/JLJWebsiteProtectionService/ServiceProtocol.cs`: changed the pipe test harness to exercise real peer impersonation; added standard-user authorization, pipe ACL, filesystem ACL, and installer configuration assertions; qualified `System.TimeoutException` after adding service installer types to the test harness.
- `services/JLJWebsiteProtectionService/ServiceIdentityConfig.cs`: exposed the existing owner-file ACL factory internally so the self-test can verify the exact ACL without writing to ProgramData.
- `scripts/windows/Invoke-WebsiteProtectionIntegration.ps1`: prepared gated target-machine install, verification, lifecycle, and uninstall harness.
- `scripts/windows/WebsiteProtectionPipeProbe.cs`: prepared owner, standard-user, and concurrent named-pipe probe.
- `WEBSITE-ACCESS-CONTROL-PHASE-4D-REPORT.md`: this report.

## Windows 10 Pro 22H2 integration test preparation

The target environment is unavailable here. The following test tools were prepared but **not run against an installed service**:

- `scripts/windows/Invoke-WebsiteProtectionIntegration.ps1`: gated harness with actions `Preflight`, `Install`, `Verify`, `PipeOwner`, `PipeStandardUser`, `PipeConcurrent`, `Lifecycle`, and `Uninstall`. Except for read-only preflight, actions require Windows build 19045, Pro/Pro N, x64, and .NET Framework 4.8.1+; mutating operations additionally require elevation and an explicit disposable-machine confirmation string. Install refuses an existing service or ProgramData state. The harness snapshots DNS adapter configuration before install/lifecycle/uninstall and fails if it changes; it contains no DNS-setting write command. Uninstall verifies service removal and preserves ProgramData state for inspection.
- `scripts/windows/WebsiteProtectionPipeProbe.cs`: .NET Framework probe that checks owner policy apply/restore, standard-user status/validation access and mutation denial, and repeated concurrent pipe requests. It rejects an admin account for standard-user modes and compiles into the selected results directory when invoked.

The probe is compiled locally as a syntax/build check, but no probe request was sent to a service. The PowerShell harness passed PowerShell parser validation. No service binary was installed or started.

### Manual disposable-machine procedure

1. Create a clean snapshot of a disposable Windows 10 Pro 22H2 x64 VM. Do not use customer or production PCs. Keep networking in its normal state and record existing DNS server addresses; do not configure the listener as a system resolver.
2. Copy the reviewed source to the VM, install the .NET Framework 4.8.1 targeting pack/build tools, build `services/JLJWebsiteProtectionService/JLJWebsiteProtectionService.csproj`, and retain the exact service executable and build log. Run `-Action Preflight` from an elevated PowerShell session.
3. From the owner account, install with the script and the actual owner SID:

   ```powershell
   .\scripts\windows\Invoke-WebsiteProtectionIntegration.ps1 -Action Install `
     -ServiceExe .\services\JLJWebsiteProtectionService\bin\Release\JLJWebsiteProtectionService.exe `
     -OwnerSid '<owner SID>' `
     -DisposableConfirmation 'I CONFIRM THIS IS A DISPOSABLE WINDOWS 10 PRO 22H2 TEST MACHINE'
   ```

4. Run `-Action Verify` and confirm the service is LocalService, the service SID type is Restricted, and the actual state directory and `owner.sid` ACLs match the expected protected SIDs. Save command output and ACL listings.
5. Start the service using `-Action Lifecycle` from the elevated owner session. The action checks stop/start/restart and verifies the DNS adapter snapshot is unchanged. Run `-Action PipeOwner -OwnerSid '<owner SID>'` while signed in as that owner; it applies a test-only `integration-test.invalid` policy revision and verifies owner restore. Do this only in the disposable VM.
6. Sign in separately with a local Standard User account. Run `-Action PipeStandardUser -ExpectedOwnerSid '<owner SID>'`; confirm status/capabilities/policy validation succeed while `ApplyPolicy` and `RestoreLastKnownGood` return `UNAUTHORIZED`. Then run `-Action PipeConcurrent -ExpectedOwnerSid '<owner SID>' -ConcurrentClients 12` and record completion count/duration. The concurrent probe performs status reads only.
7. For reboot testing, record service state and DNS adapter snapshot, reboot the VM manually, then verify the automatic-start service reaches Running, query its service SID type and ACLs again, and compare DNS settings with the pre-reboot record. A reboot is intentionally not initiated by the harness.
8. For installer rollback/interruption testing, revert to a clean VM snapshot first. Run an installation in a disposable snapshot and terminate `InstallUtil.exe` only at a deliberately selected installation checkpoint from a second elevated test console. Record whether SCM registration, restricted SID configuration, and ProgramData files are partial. Recover with `-Action Uninstall` where possible or revert the VM snapshot. Repeat a clean installation afterward. Never attempt interruption testing on a shared or customer system.
9. For unexpected service termination, first record the DNS snapshot and service PID. In the disposable VM only, terminate the dedicated service process, then inspect SCM state, logs, and DNS configuration. Current source configures no SCM failure-restart actions and Phase 4C recovery is not connected, so the expected finding is that the service remains stopped and no DNS settings need restoration. Restore the VM snapshot after collecting results.
10. Run `-Action Uninstall` with the service executable path and disposable confirmation. Verify the service registration is removed, ProgramData state remains for evidence, and DNS adapter configuration is unchanged. Revert/delete the disposable VM after results are reviewed.

These steps verify service lifecycle and recovery limitations without activating DNS enforcement or changing adapters. Reboot and interrupted-install steps are deliberately manual so the operator can preserve a VM checkpoint and stop at a known installation stage.

### Prepared-script validation

- PowerShell parser check for `Invoke-WebsiteProtectionIntegration.ps1`: passed.
- `WebsiteProtectionPipeProbe.cs` compiled with the in-box Framework compiler: passed; the executable was deleted and the probe was not run.
- Static scan confirmed the harness contains no DNS-setting or registry-setting write command; mutating service actions are gated by OS checks, disposable-machine confirmation, and elevation.
- Target OS preflight, installation, service start/stop/restart, reboot, uninstall, owner/standard-user second-account checks, and interrupted-install testing remain pending on the disposable build 19045 VM.

No production policy, service startup, DNS listener, adapter, installer package, or release workflow behavior was enabled or changed.

## Tests and environment

- `npm.cmd test`: **46 passed, 0 failed**.
- All service C# sources compiled with the installed .NET Framework compiler; `--self-test` passed, including DNS foundation tests, real current-user named-pipe impersonation, standard-user operation checks, pipe ACL checks, protected ProgramData/file ACL descriptor checks, LocalService/automatic-start installer configuration, and existing protocol/state tests.
- Service project XML parsed successfully; `git diff --check` passed (Git showed its existing `.gitignore` line-ending advisory).
- Read-only host checks reported Windows build **26300**. `Get-CimInstance Win32_OperatingSystem` was denied, so the build was cross-checked through the read-only current-build registry value and `[Environment]::OSVersion`.
- The service is not installed (`sc.exe query` returned 1060). No disposable Windows 10 22H2 VM or test host was available during this work.

## Remaining limitations and risks

- Windows 10 Pro 22H2 x64 (build 19045), .NET Framework 4.8.1 targeting-pack build, and exact OS compatibility were not tested. Build 26300 results do not establish Windows 10 compatibility.
- LocalService token behavior, restricted service SID activation, SCM start/stop/restart, reboot startup, uninstall/rollback, and actual ProgramData ACLs under the service token require a disposable Windows test machine. The current pipe test uses the current interactive user token, not LocalService.
- The installer configures automatic startup but no SCM service-failure restart actions. Crash recovery for future network enforcement is not implemented; Phase 4C recovery remains disconnected and mock-only.
- Pipe DACL permits local standard users to connect and issue bounded status/validation requests. Mutation is denied by exact owner-SID checks. Denial-of-service resistance under repeated local connections remains to be assessed on the target service identity.
- The service object's own SCM security descriptor has not been explicitly set or verified on a real installation.
- IPv6 loopback is not implemented; Phase 4C binds only `127.0.0.1`.
- No claim is made that the service or protection feature is production-ready. Do not install or activate it until the missing target-environment and lifecycle checks are completed and reviewed.

Phase 4D source review and test preparation are complete for review. Run the prepared harness only on a disposable Windows 10 Pro 22H2 VM after approval. Phase 4E has not started.
