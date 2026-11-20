# JLJ Website Access Control — Phase 4C Report

**Status: Phase 4C foundation implemented for review. Protection remains inactive.**

No adapter DNS settings, Windows service state, firewall, registry, browser policy, database, installer, release workflow, package manifest, or updater was changed. `ProtectionService` does not instantiate or start the listener, upstream resolver, or recovery coordinator. No upstream provider is selected.

## Implemented

- Added a DNS request processor that consumes the existing validated whitelist policy snapshot. Enabled matching block rules override allow rules; otherwise unmatched names are denied. Denied requests return `REFUSED` and never reach upstream.
- Added a UDP and TCP DNS listener whose constructor accepts a port but no bind address. Both sockets bind only to IPv4 loopback (`127.0.0.1`); sender addresses are checked as loopback. The listener is not connected to service startup.
- Added strict packet length, header, question, EDNS, and response validation. Query-name compression is rejected; response compression pointers must point backward into the packet. Invalid queries receive `FORMERR` where the packet has enough bytes to construct a response.
- Added an explicit upstream options/interface supporting a caller-supplied numeric IP, port, and UDP/TCP transport, plus bounded network timeouts. Truncated UDP replies are retried over TCP against the same endpoint using the remaining timeout budget. The default resolver throws `DNS_UPSTREAM_NOT_CONFIGURED`; there is no provider endpoint or implicit production resolver.
- Added a bounded LRU response cache (maximum 4,096 entries; default 512) with a configurable TTL cap (default 300 seconds), policy-revision isolation, transaction-ID substitution, and TTL aging. Only positive `NOERROR` responses without EDNS OPT data are cached; negative caching is deferred until SOA-based TTL handling is implemented.
- Added fixed-code, rate-limited logging without queried domain names or raw exception text. DNS failures notify an injected recovery sink and produce `SERVFAIL` for the failed request.
- Added a fail-open coordinator behind injected network/recovery interfaces. It requires mocked upstream/local-resolver health and allow/deny policy probes before simulated activation, retains a last-known DNS snapshot, stops the listener on failure/stop/exit, attempts restore, and reports degraded/unprotected state when verification or restore fails. It has no Windows adapter implementation and is not wired to the service.
- Added C# self-tests for parser validation, policy allow/block/default-deny, DNS responses, upstream timeout, caching and eviction, revision isolation, recovery/failure states, configurable/unconfigured upstream, and live loopback UDP/TCP request handling.

## Security and reliability review

The source review found and fixed these confirmed issues:

- The upstream UDP adapter previously returned truncated (`TC=1`) answers directly. It now retries the same query over TCP against the explicitly configured endpoint. The fallback shares the request's timeout budget; TCP connect, writes, and reads consume the remaining time. Invalid transport enum values are rejected.
- Cache keys included EDNS-bearing queries and cached their response bytes. Such responses can contain request-specific options such as DNS Cookies, so the cache now bypasses every query with an OPT record. Negative and truncated responses remain uncached, and policy revision remains part of the cache key.
- Recovery discarded its saved DNS snapshot even when restore threw or post-restore verification failed. The snapshot is now retained until normal DNS resolution verifies successfully, allowing another recovery attempt.
- Response-name compression now rejects forward pointers and pointers into the DNS header. Existing packet bounds, jump limits, question/count checks, and response structure checks remain in force.
- Concurrency-cap events previously invoked fail-open recovery. They now emit a rate-limited `DNS_OVERLOADED` event and handle pressure per request, so local request bursts cannot use the overload path to restore system DNS settings.

Other review findings:

- Upstream failures and malformed/mismatched upstream replies are caught by the processor, logged with fixed event codes, and return `SERVFAIL` while notifying the injected fail-open sink. Queried names and raw exception text are not logged.
- Listener work is bounded to 64 UDP requests and 16 TCP connections. TCP clients have a three-second framing/read deadline and packets are capped at 4,096 bytes. Shutdown closes sockets, cancels loops, and waits up to two seconds for loops and active tasks. A task blocked in an upstream operation can outlive that wait, but its upstream timeout is bounded and cancellation prevents a later response send.
- Exhausting a concurrency slot returns a UDP `SERVFAIL` or closes the newly accepted TCP connection; the overload path does not change network state or activate recovery.
- Both transports bind only to `127.0.0.1` and reject non-loopback peers. IPv6 loopback (`::1`) is not implemented; this remains an explicit compatibility limitation.
- Recovery is an injected state machine only. It can retry restoration while its snapshot remains, but cannot recover from a process crash by itself; an external watchdog and real adapter implementation are not present. The coordinator remains disconnected from `ProtectionService`.
- DNS clients can retry TCP after receiving a truncated UDP answer. The service-side upstream TCP fallback is tested against an isolated loopback mock; no public or configured resolver was contacted.

## Files

Added for Phase 4C:

- `services/JLJWebsiteProtectionService/DnsPacketCodec.cs`
- `services/JLJWebsiteProtectionService/DnsPolicyEvaluator.cs`
- `services/JLJWebsiteProtectionService/DnsResponseCache.cs`
- `services/JLJWebsiteProtectionService/DnsUpstream.cs`
- `services/JLJWebsiteProtectionService/DnsRequestProcessor.cs`
- `services/JLJWebsiteProtectionService/DnsLoopbackListener.cs`
- `services/JLJWebsiteProtectionService/FailOpenRecovery.cs`
- `services/JLJWebsiteProtectionService/DnsFoundationSelfTests.cs`
- This report.

Updated within the Phase 4B service foundation:

- `services/JLJWebsiteProtectionService/JLJWebsiteProtectionService.csproj` includes the new source files.
- `services/JLJWebsiteProtectionService/ServiceProtocol.cs` invokes the DNS self-test suite from the existing service self-test entry point.

Files reviewed or adjusted during final Phase 4C verification:

- `services/JLJWebsiteProtectionService/DnsUpstream.cs`
- `services/JLJWebsiteProtectionService/DnsResponseCache.cs`
- `services/JLJWebsiteProtectionService/DnsPacketCodec.cs`
- `services/JLJWebsiteProtectionService/FailOpenRecovery.cs`
- `services/JLJWebsiteProtectionService/DnsRequestProcessor.cs`
- `services/JLJWebsiteProtectionService/DnsLoopbackListener.cs`
- `services/JLJWebsiteProtectionService/DnsFoundationSelfTests.cs`
- This report.

No Electron renderer/main code, SQL.js schema or data, dependencies, installer, or release configuration changed during Phase 4C.

## Validation

- `npm.cmd test`: **46 passed, 0 failed**.
- Compiled all service C# source files using the installed .NET Framework compiler and ran `--self-test`: **passed**. Output confirmed both the DNS foundation tests and existing service protocol tests passed. The compile emitted no warnings.
- Added and passed isolated UDP-truncation-to-TCP fallback, EDNS cache bypass, invalid-transport, compression-pointer rejection, recovery-retry, and overload-without-recovery tests.
- `git diff --check`: passed (Git emitted only its existing `.gitignore` line-ending advisory).
- Service project XML parse: passed.
- Confirmed DNS listener, resolver, and recovery coordinator are not referenced by `ProtectionService` startup.
- No installer/package build was run and no service process was installed or started.

The host is the previously identified Windows development build 26300, not Windows 10 Pro 22H2 build 19045. These results do not establish Windows 10 compatibility.

## Limitations and outstanding risks

- Only IPv4 loopback is implemented. IPv6 loopback behavior (`::1`) is not yet supported or tested; no listener can bind to a non-loopback address.
- The generic upstream socket adapter is implemented but has no configured endpoint and has not been exercised against a live resolver. DNS tests use fake resolvers or an isolated loopback-only UDP/TCP mock.
- Recovery tests use only mock DNS/network state. There is no real adapter snapshot, automatic fail-open recovery on a process crash, or service watchdog implementation.
- The recovery coordinator's `TryActivate` is a testable state-machine seam only; production enforcement remains disconnected and inactive.
- DNS over HTTPS/TLS, VPNs, proxies, direct-IP traffic, and browser controls are outside Phase 4C and remain unaddressed.
- The service protocol self-test still reports that OS-token impersonation must be tested under the eventual LocalService identity. Service installation/lifecycle and the exact Windows 10 target remain unverified.
- Negative DNS caching, DNSSEC/AD semantics, broader interoperability testing, and target-machine packet-level validation remain open.

Phase 4C is complete for review. Phase 4D has not started.
