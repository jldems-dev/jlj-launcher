# Website Access Control — Phase 4A Report

> Update: Phase 4B has since been implemented; see [Phase 4B report](WEBSITE-ACCESS-CONTROL-PHASE-4B-REPORT.md). The status below records the state when Phase 4A was completed.

**Status: Phase 4A complete for review. Phase 4B has not started.** No enforcement is connected to the launcher or activated.

## Implemented

- Added a pure JavaScript policy snapshot builder and validator with protocol version 1, a required `deny` default, revision validation, strict field validation, IDNA-normalized unique rules, a 5,000-rule cap, and a 1 MiB serialized snapshot limit.
- Snapshot SHA-256 covers a deterministic compact JSON payload with ordinally sorted ASCII domains and fixed property ordering. Validation recomputes the digest; unsupported versions, extra fields, malformed rules, duplicate normalized domains, invalid digests, and oversized payloads are rejected.
- Added a compile step that validates once and returns an immutable policy used by the evaluator.
- Added whitelist-only evaluation: enabled allow rules grant access only to exact names and opted-in subdomains; unknown, disabled, and malformed names are denied. Any matching enabled block rule overrides any matching allow rule. A more-specific allow may win only if there is no matching block.

## Files changed

- Added `src/main/websiteAccess/policyEngine.js`
- Added `test/websitePolicyEngine.test.js`
- Added this report.

No existing files, databases, package files, Windows settings, service configuration, release workflow, or installer were changed in this stage.

## Tests

- Focused policy/domain tests: **12 passed, 0 failed**.
- Full `npm.cmd test`: **41 passed, 0 failed**.
- `git diff --check`: **passed**.

Coverage includes deterministic digest validation, default deny, enabled and disabled rules, optional subdomain matches, label boundaries, explicit block precedence, invalid DNS names, malformed snapshots, tampering, duplicate canonical domains, unsupported versions, and size limits.

## Limitations and risks

- This is a policy engine only. It does not resolve DNS, open sockets, communicate over named pipes, alter OS/browser settings, or persist service state.
- The current Windows build 26300 was used only as a development environment. Windows 10 Pro 22H2 compatibility has not been established.
- The upstream resolver remains unspecified. No resolver has been selected or embedded.
- Phase 4A does not address direct-IP access, VPNs, proxies, or all encrypted DNS/tunnel paths.
- The uploaded Phase 4 request ended partway through the browser-policy restoration requirements. Those requirements remain incomplete in the supplied text.

Phase 4B requires a separate review before work begins, as requested.
