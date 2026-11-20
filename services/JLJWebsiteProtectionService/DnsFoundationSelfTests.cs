using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace JLJ.WebsiteProtection
{
    internal static class DnsFoundationSelfTests
    {
        private sealed class FakeUpstream : IDnsUpstreamResolver
        {
            internal int Calls;
            internal Func<byte[], byte[]> Response;
            internal bool ThrowsTimeout;
            public byte[] Resolve(byte[] query, TimeSpan timeout)
            {
                Interlocked.Increment(ref Calls);
                if (ThrowsTimeout) throw new TimeoutException("test timeout");
                return Response(query);
            }
        }

        private sealed class RecordingLogger : IDnsDecisionLogger
        {
            internal readonly List<string> Events = new List<string>();
            public void Record(string code) { lock (Events) Events.Add(code); }
        }

        private sealed class MockRecoveryState : IDnsNetworkRecoveryState
        {
            internal byte[] Current = new byte[] { 10, 0, 0, 1 };
            internal bool VerifyWorks = true;
            internal bool ThrowOnRestore;
            internal int Captures;
            internal int LoopbackChanges;
            internal int Restores;
            public byte[] CaptureDnsConfiguration() { Captures++; return (byte[])Current.Clone(); }
            public void PointDnsToLoopback() { LoopbackChanges++; Current = new byte[] { 127, 0, 0, 1 }; }
            public void RestoreDnsConfiguration(byte[] snapshot)
            {
                Restores++;
                if (ThrowOnRestore) throw new IOException("test restore failure");
                Current = (byte[])snapshot.Clone();
            }
            public bool VerifyNormalDnsResolution() { return VerifyWorks; }
        }

        private sealed class MockJournal : IRecoveryJournal
        {
            internal readonly List<string> Entries = new List<string>();
            public void Record(string state, string reasonCode) { Entries.Add(state + ":" + reasonCode); }
        }

        internal static void Run()
        {
            TestPacketValidationAndPolicy();
            TestBlockAndDefaultDeny();
            TestCacheTtlRevisionAndBound();
            TestUpstreamFailureFailOpen();
            TestRecoveryFailureStates();
            TestLoopbackUdpAndTcp();
            TestUpstreamUdpTruncationFallsBackToTcp();
            TestExplicitUpstreamConfiguration();
            Console.WriteLine("DNS foundation self-tests passed (packet parsing, policy, REFUSED/SERVFAIL, TTL cache, revision isolation, recovery mocks, loopback UDP/TCP).");
        }

        private static void TestPacketValidationAndPolicy()
        {
            ValidatedPolicy policy = BuildPolicy(4,
                Rule("approved.example", "allow", true, true),
                Rule("blocked.approved.example", "block", true, true),
                Rule("disabled.example", "allow", false, true));
            DnsPolicyDecision allowed = DnsPolicyEvaluator.Evaluate("child.approved.example", policy);
            Assert(allowed.Allowed && allowed.Reason == "allowed-by-rule", "enabled allow rule with subdomains");
            Assert(!DnsPolicyEvaluator.Evaluate("blocked.approved.example", policy).Allowed, "matching block rule wins");
            Assert(!DnsPolicyEvaluator.Evaluate("a.blocked.approved.example", policy).Allowed, "parent block denies subdomains");
            Assert(!DnsPolicyEvaluator.Evaluate("a.disabled.example", policy).Allowed, "disabled allow does not grant access");
            Assert(!DnsPolicyEvaluator.Evaluate("notapproved.example", policy).Allowed, "label boundary and default deny");
            Assert(!DnsPolicyEvaluator.Evaluate("127.0.0.1", policy).Allowed, "IP literal is denied");

            DnsQuestion question;
            Assert(DnsPacketCodec.TryParseQuery(BuildQuery(0x1234, "approved.example", 1, true), out question), "valid EDNS query parses");
            Assert(question.IsCanonicalDomain && question.Domain == "approved.example", "canonical qname parsed");
            Assert(!DnsPacketCodec.TryParseQuery(new byte[] { 0x12, 0x34, 0x01 }, out question), "truncated DNS header rejected");
            byte[] wrongCounts = BuildQuery(1, "approved.example", 1, false);
            DnsPacketCodec.WriteUInt16(wrongCounts, 4, 2);
            Assert(!DnsPacketCodec.TryParseQuery(wrongCounts, out question), "multiple questions rejected");
            Assert(!DnsPacketCodec.TryParseQuery(BuildMalformedOptQuery(), out question), "malformed EDNS option rejected");
            byte[] pointerLoop = BuildQuery(2, "approved.example", 1, false);
            pointerLoop[12] = 0xc0; pointerLoop[13] = 0x0c;
            Assert(!DnsPacketCodec.TryParseQuery(pointerLoop, out question), "compressed query name rejected safely");
            byte[] forwardPointerResponse = BuildAResponse(BuildQuery(4, "approved.example", 1, false), 60);
            int answerOffset = forwardPointerResponse.Length - 16;
            forwardPointerResponse[answerOffset] = 0xc0;
            forwardPointerResponse[answerOffset + 1] = (byte)(answerOffset + 2);
            DnsPacketCodec.TryParseQuery(BuildQuery(4, "approved.example", 1, false), out question);
            DnsResponseMetadata invalidResponseMetadata;
            Assert(!DnsPacketCodec.TryValidateResponse(forwardPointerResponse, question, out invalidResponseMetadata),
                "forward response compression pointer rejected");
            byte[] formError = DnsPacketCodec.CreateError(new byte[] { 0x12, 0x34 }, DnsResponseCode.FormatError);
            Assert(DnsPacketCodec.ReadUInt16(formError, 0) == 0x1234 && (DnsPacketCodec.ReadUInt16(formError, 2) & 0x000f) == 1,
                "malformed query receives FORMERR response");
        }

        private static void TestBlockAndDefaultDeny()
        {
            ValidatedPolicy policy = BuildPolicy(2, Rule("approved.example", "allow", true, true), Rule("blocked.approved.example", "block", true, true));
            FakeUpstream upstream = NewUpstream();
            RecordingLogger logger = new RecordingLogger();
            DnsRequestProcessor processor = NewProcessor(policy, upstream, new DnsResponseCache(), null, logger);
            byte[] blocked = processor.Handle(BuildQuery(1, "blocked.approved.example", 1, false));
            byte[] unknown = processor.Handle(BuildQuery(2, "unknown.example", 1, false));
            Assert((DnsPacketCodec.ReadUInt16(blocked, 2) & 0x000f) == 5, "explicit block returns DNS REFUSED");
            Assert((DnsPacketCodec.ReadUInt16(unknown, 2) & 0x000f) == 5, "unknown domain returns DNS REFUSED");
            Assert(upstream.Calls == 0, "denied names never reach upstream");
            Assert(logger.Events.Contains("DNS_POLICY_BLOCK"), "sanitized block decision code recorded");
        }

        private static void TestCacheTtlRevisionAndBound()
        {
            long now = DateTime.UtcNow.Ticks;
            int calls = 0;
            FakeUpstream upstream = new FakeUpstream { Response = query => { Interlocked.Increment(ref calls); return BuildAResponse(query, 60); } };
            ValidatedPolicy policy = BuildPolicy(1, Rule("approved.example", "allow", true, true), Rule("second.example", "allow", true, true));
            DnsResponseCache cache = new DnsResponseCache(1, 300, () => now);
            DnsRequestProcessor processor = NewProcessor(policy, upstream, cache, null, new RecordingLogger());
            processor.Handle(BuildQuery(10, "approved.example", 1, false));
            now += 2 * TimeSpan.TicksPerSecond;
            byte[] hit = processor.Handle(BuildQuery(11, "approved.example", 1, false));
            Assert(calls == 1, "second identical query served from cache");
            Assert(DnsPacketCodec.ReadUInt16(hit, 0) == 11, "cache substitutes the current DNS transaction ID");
            DnsQuestion hitQuestion;
            DnsResponseMetadata hitMeta;
            Assert(DnsPacketCodec.TryParseQuery(BuildQuery(11, "approved.example", 1, false), out hitQuestion)
                && DnsPacketCodec.TryValidateResponse(hit, hitQuestion, out hitMeta) && hitMeta.MinimumTtl == 58,
                "cached DNS TTL decreases with elapsed time");

            processor.Handle(BuildQuery(12, "second.example", 1, false));
            Assert(cache.Count == 1, "cache remains within configured bound");
            processor.Handle(BuildQuery(13, "approved.example", 1, false));
            Assert(calls == 3, "least-recently-used entry is evicted at capacity");

            ValidatedPolicy newRevision = BuildPolicy(2, Rule("approved.example", "allow", true, true), Rule("second.example", "allow", true, true));
            DnsRequestProcessor revisionProcessor = NewProcessor(() => newRevision, upstream, cache, null, new RecordingLogger());
            revisionProcessor.Handle(BuildQuery(14, "approved.example", 1, false));
            Assert(calls == 4, "policy revision change cannot reuse an old cache entry");

            now += 61 * TimeSpan.TicksPerSecond;
            revisionProcessor.Handle(BuildQuery(15, "approved.example", 1, false));
            Assert(calls == 5, "expired cache entry is requeried upstream");

            DnsResponseCache negativeCache = new DnsResponseCache();
            byte[] negative = BuildAResponse(BuildQuery(16, "approved.example", 1, false), 60);
            DnsPacketCodec.WriteUInt16(negative, 2, 0x8183);
            DnsQuestion negativeQuestion;
            DnsResponseMetadata negativeMetadata = null;
            Assert(DnsPacketCodec.TryParseQuery(BuildQuery(16, "approved.example", 1, false), out negativeQuestion)
                && DnsPacketCodec.TryValidateResponse(negative, negativeQuestion, out negativeMetadata), "negative response fixture parses");
            negativeCache.Store(BuildQuery(16, "approved.example", 1, false), negative, negativeMetadata, 1);
            Assert(negativeCache.Count == 0, "negative response is not cached without SOA TTL handling");

            DnsResponseCache ednsCache = new DnsResponseCache();
            byte[] ednsQuery = BuildQuery(17, "approved.example", 1, true);
            byte[] ednsResponse = BuildAResponse(ednsQuery, 60);
            DnsQuestion ednsQuestion;
            DnsResponseMetadata ednsMetadata = null;
            Assert(DnsPacketCodec.TryParseQuery(ednsQuery, out ednsQuestion)
                && DnsPacketCodec.TryValidateResponse(ednsResponse, ednsQuestion, out ednsMetadata), "EDNS response fixture parses");
            ednsCache.Store(ednsQuery, ednsResponse, ednsMetadata, 1);
            Assert(ednsCache.Count == 0, "queries with client-specific EDNS data are not cached");

            byte[] optResponse = Append(BuildAResponse(BuildQuery(18, "approved.example", 1, false), 60),
                new byte[] { 0, 0, 41, 4, 208, 0, 0, 0, 0, 0, 0 });
            DnsPacketCodec.WriteUInt16(optResponse, 10, 1);
            byte[] plainQuery = BuildQuery(18, "approved.example", 1, false);
            DnsQuestion plainQuestion;
            DnsResponseMetadata optMetadata = null;
            Assert(DnsPacketCodec.TryParseQuery(plainQuery, out plainQuestion)
                && DnsPacketCodec.TryValidateResponse(optResponse, plainQuestion, out optMetadata)
                && optMetadata.HasOptRecord, "response OPT fixture is identified");
            ednsCache.Store(plainQuery, optResponse, optMetadata, 1);
            Assert(ednsCache.Count == 0, "responses containing OPT data are not cached even for plain queries");
        }

        private static void TestUpstreamFailureFailOpen()
        {
            MockRecoveryState network = new MockRecoveryState();
            MockJournal journal = new MockJournal();
            int stopped = 0;
            FailOpenRecoveryCoordinator recovery = new FailOpenRecoveryCoordinator(network, journal, () => stopped++);
            Assert(recovery.TryActivate(() => true, () => true, () => true), "mocked upstream, local resolver and policy probes permit simulated activation");
            Assert(network.LoopbackChanges == 1 && recovery.State == "active", "mock network state points to loopback");

            FakeUpstream upstream = NewUpstream();
            upstream.ThrowsTimeout = true;
            RecordingLogger logger = new RecordingLogger();
            DnsRequestProcessor processor = NewProcessor(BuildPolicy(1, Rule("approved.example", "allow", true, true)),
                upstream, new DnsResponseCache(), recovery, logger);
            processor.ReportOverload();
            Assert(recovery.State == "active" && network.Restores == 0 && logger.Events.Contains("DNS_OVERLOADED"),
                "request overload is logged without triggering fail-open recovery");
            byte[] response = processor.Handle(BuildQuery(21, "approved.example", 1, false));
            Assert((DnsPacketCodec.ReadUInt16(response, 2) & 0x000f) == 2, "upstream timeout returns SERVFAIL for this request");
            Assert(recovery.State == "degraded" && stopped == 1 && network.Restores == 1, "upstream failure stops listener and restores mocked DNS");
            Assert(BytesEqual(network.Current, new byte[] { 10, 0, 0, 1 }), "original mocked DNS configuration restored");
            Assert(journal.Entries.Contains("degraded:UPSTREAM_FAILURE"), "recovery record contains only sanitized error code");
        }

        private static void TestRecoveryFailureStates()
        {
            MockRecoveryState network = new MockRecoveryState { VerifyWorks = false };
            MockJournal journal = new MockJournal();
            FailOpenRecoveryCoordinator recovery = new FailOpenRecoveryCoordinator(network, journal, delegate { });
            Assert(!recovery.TryActivate(() => false, () => true, () => true) && network.Captures == 0, "unhealthy upstream never changes DNS state");
            Assert(!recovery.TryActivate(() => true, () => true, () => false) && network.Captures == 0, "failed allow/deny probes never change DNS state");
            Assert(recovery.TryActivate(() => true, () => true, () => true), "healthy mock can activate");
            recovery.OnUnexpectedServiceExit();
            Assert(recovery.State == "unprotected" && network.Restores == 1, "simulated unexpected service exit restores and verifies DNS");

            MockRecoveryState verifyRetryState = new MockRecoveryState { VerifyWorks = false };
            FailOpenRecoveryCoordinator verifyRetry = new FailOpenRecoveryCoordinator(verifyRetryState, new MockJournal(), delegate { });
            Assert(verifyRetry.TryActivate(() => true, () => true, () => true), "verification retry mock activates");
            verifyRetry.OnDnsFailure("UPSTREAM_FAILURE");
            Assert(verifyRetry.State == "unprotected" && verifyRetryState.Restores == 1,
                "failed post-restore DNS verification retains the recovery snapshot");
            verifyRetryState.VerifyWorks = true;
            verifyRetry.OnDnsFailure("RECOVERY_RETRY");
            Assert(verifyRetry.State == "degraded" && verifyRetryState.Restores == 2,
                "normal DNS verification can complete on a later recovery attempt");

            MockRecoveryState failedRestore = new MockRecoveryState { ThrowOnRestore = true };
            FailOpenRecoveryCoordinator failed = new FailOpenRecoveryCoordinator(failedRestore, new MockJournal(), delegate { });
            Assert(failed.TryActivate(() => true, () => true, () => true), "second recovery mock activates");
            failed.OnDnsFailure("UPSTREAM_FAILURE");
            Assert(failed.State == "unprotected", "failed restore is reported unprotected");
            failedRestore.ThrowOnRestore = false;
            failed.OnDnsFailure("RECOVERY_RETRY");
            Assert(failed.State == "degraded" && failedRestore.Restores == 2, "failed restore retains snapshot for a later recovery retry");
        }

        private static void TestLoopbackUdpAndTcp()
        {
            ValidatedPolicy policy = BuildPolicy(1, Rule("approved.example", "allow", true, true));
            DnsRequestProcessor processor = NewProcessor(policy, NewUpstream(), new DnsResponseCache(), null, new RecordingLogger());
            using (DnsLoopbackListener listener = new DnsLoopbackListener(processor, 0))
            {
                listener.Start();
                Assert(listener.BoundAddress.Equals(IPAddress.Loopback) && IPAddress.IsLoopback(listener.BoundAddress), "listener binds IPv4 loopback only");

                using (UdpClient client = new UdpClient(new IPEndPoint(IPAddress.Loopback, 0)))
                {
                    client.Client.ReceiveTimeout = 3000;
                    byte[] query = BuildQuery(31, "approved.example", 1, false);
                    client.Send(query, query.Length, new IPEndPoint(IPAddress.Loopback, listener.Port));
                    Task<UdpReceiveResult> receiving = client.ReceiveAsync();
                    Assert(receiving.Wait(TimeSpan.FromSeconds(3)), "UDP loopback response arrived before timeout");
                    UdpReceiveResult received = receiving.GetAwaiter().GetResult();
                    Assert(received.Buffer != null && DnsPacketCodec.ReadUInt16(received.Buffer, 0) == 31, "UDP loopback DNS request answered");
                }

                using (TcpClient client = new TcpClient(AddressFamily.InterNetwork))
                {
                    client.ReceiveTimeout = 3000;
                    client.SendTimeout = 3000;
                    client.Connect(IPAddress.Loopback, listener.Port);
                    using (NetworkStream stream = client.GetStream())
                    {
                        byte[] query = BuildQuery(32, "approved.example", 1, false);
                        byte[] prefix = new byte[2];
                        DnsPacketCodec.WriteUInt16(prefix, 0, (ushort)query.Length);
                        stream.Write(prefix, 0, 2); stream.Write(query, 0, query.Length); stream.Flush();
                        ReadExactly(stream, prefix, 0, 2);
                        int responseLength = DnsPacketCodec.ReadUInt16(prefix, 0);
                        byte[] response = new byte[responseLength];
                        ReadExactly(stream, response, 0, response.Length);
                        Assert(DnsPacketCodec.ReadUInt16(response, 0) == 32, "TCP loopback DNS request answered");
                    }
                }
                listener.Stop();
                Assert(!listener.IsRunning, "loopback DNS listener stops cleanly");
            }
        }

        private static void TestExplicitUpstreamConfiguration()
        {
            bool failedUnconfigured = false;
            try { new UnconfiguredDnsUpstreamResolver().Resolve(BuildQuery(1, "approved.example", 1, false), TimeSpan.FromSeconds(1)); }
            catch (DnsUpstreamNotConfiguredException) { failedUnconfigured = true; }
            Assert(failedUnconfigured, "upstream provider remains unset by default");
            Assert(new DnsUpstreamOptions(IPAddress.Parse("192.0.2.1"), 5353, DnsUpstreamTransport.Udp).Endpoint.Port == 5353,
                "upstream endpoint is explicitly configurable without selecting a provider");
            bool invalidTransportRejected = false;
            try { new DnsUpstreamOptions(IPAddress.Loopback, 53, (DnsUpstreamTransport)99); }
            catch (ArgumentOutOfRangeException) { invalidTransportRejected = true; }
            Assert(invalidTransportRejected, "invalid upstream transport is rejected");
        }

        private static void TestUpstreamUdpTruncationFallsBackToTcp()
        {
            using (UdpClient udpServer = new UdpClient(new IPEndPoint(IPAddress.Loopback, 0)))
            {
                int port = ((IPEndPoint)udpServer.Client.LocalEndPoint).Port;
                TcpListener tcpServer = new TcpListener(IPAddress.Loopback, port);
                tcpServer.Start(1);
                int tcpCalls = 0;
                Task udpTask = Task.Run(() =>
                {
                    IPEndPoint peer = null;
                    byte[] query = udpServer.Receive(ref peer);
                    byte[] truncated = BuildAResponse(query, 60);
                    DnsPacketCodec.WriteUInt16(truncated, 2, 0x8380);
                    udpServer.Send(truncated, truncated.Length, peer);
                });
                Task tcpTask = Task.Run(() =>
                {
                    using (TcpClient client = tcpServer.AcceptTcpClient())
                    using (NetworkStream stream = client.GetStream())
                    {
                        byte[] prefix = new byte[2];
                        ReadExactly(stream, prefix, 0, 2);
                        int queryLength = DnsPacketCodec.ReadUInt16(prefix, 0);
                        byte[] query = new byte[queryLength];
                        ReadExactly(stream, query, 0, query.Length);
                        byte[] response = BuildAResponse(query, 60);
                        DnsPacketCodec.WriteUInt16(prefix, 0, (ushort)response.Length);
                        stream.Write(prefix, 0, prefix.Length);
                        stream.Write(response, 0, response.Length);
                        Interlocked.Increment(ref tcpCalls);
                    }
                });
                try
                {
                    byte[] query = BuildQuery(41, "approved.example", 1, false);
                    SocketDnsUpstreamResolver resolver = new SocketDnsUpstreamResolver(
                        new DnsUpstreamOptions(IPAddress.Loopback, port, DnsUpstreamTransport.Udp));
                    byte[] response = resolver.Resolve(query, TimeSpan.FromSeconds(3));
                    DnsQuestion question;
                    DnsResponseMetadata metadata;
                    Assert(DnsPacketCodec.TryParseQuery(query, out question)
                        && DnsPacketCodec.TryValidateResponse(response, question, out metadata)
                        && !metadata.IsTruncated && tcpCalls == 1,
                        "truncated upstream UDP response is retried over TCP");
                    Assert(udpTask.Wait(TimeSpan.FromSeconds(3)) && tcpTask.Wait(TimeSpan.FromSeconds(3)), "mock upstream transports complete");
                }
                finally
                {
                    udpServer.Close();
                    tcpServer.Stop();
                }
            }
        }

        private static DnsRequestProcessor NewProcessor(ValidatedPolicy policy, FakeUpstream upstream, DnsResponseCache cache,
            IDnsFailureSink failureSink, RecordingLogger logger)
        {
            return NewProcessor(() => policy, upstream, cache, failureSink, logger);
        }

        private static DnsRequestProcessor NewProcessor(Func<ValidatedPolicy> getPolicy, IDnsUpstreamResolver upstream,
            DnsResponseCache cache, IDnsFailureSink failureSink, IDnsDecisionLogger logger)
        {
            return new DnsRequestProcessor(getPolicy, upstream, cache, failureSink, logger, TimeSpan.FromSeconds(1));
        }

        private static FakeUpstream NewUpstream()
        {
            return new FakeUpstream { Response = query => BuildAResponse(query, 60) };
        }

        private static PolicyRule Rule(string domain, string action, bool enabled, bool includeSubdomains)
        {
            return new PolicyRule { Domain = domain, Action = action, Enabled = enabled, IncludeSubdomains = includeSubdomains };
        }

        private static ValidatedPolicy BuildPolicy(long revision, params PolicyRule[] rules)
        {
            Array.Sort(rules, (a, b) => String.CompareOrdinal(a.Domain, b.Domain));
            List<PolicyRule> items = new List<PolicyRule>(rules);
            return PolicySnapshotValidator.Validate(new ValidatedPolicy
            {
                Revision = revision,
                Rules = items.AsReadOnly(),
                Sha256 = PolicySnapshotValidator.ComputeChecksum(revision, items)
            }.ToDictionary());
        }

        private static byte[] BuildQuery(ushort id, string domain, ushort type, bool addOpt)
        {
            List<byte> bytes = new List<byte>();
            bytes.Add((byte)(id >> 8)); bytes.Add((byte)id);
            bytes.Add(0x01); bytes.Add(0x00);
            bytes.Add(0); bytes.Add(1); bytes.Add(0); bytes.Add(0); bytes.Add(0); bytes.Add(0);
            bytes.Add(0); bytes.Add((byte)(addOpt ? 1 : 0));
            foreach (string label in domain.Split('.'))
            {
                byte[] labelBytes = Encoding.ASCII.GetBytes(label);
                bytes.Add((byte)labelBytes.Length); bytes.AddRange(labelBytes);
            }
            bytes.Add(0); bytes.Add((byte)(type >> 8)); bytes.Add((byte)type); bytes.Add(0); bytes.Add(1);
            if (addOpt)
            {
                bytes.Add(0); bytes.Add(0); bytes.Add(41); bytes.Add(4); bytes.Add(208);
                bytes.AddRange(new byte[] { 0, 0, 0, 0, 0, 0 });
            }
            return bytes.ToArray();
        }

        private static byte[] BuildMalformedOptQuery()
        {
            byte[] query = BuildQuery(3, "approved.example", 1, false);
            query[11] = 1;
            return Append(query, new byte[] { 0, 0, 41, 4, 208, 0, 0, 0, 0, 0, 4, 0, 1 });
        }

        private static byte[] BuildAResponse(byte[] query, uint ttl)
        {
            DnsQuestion question;
            if (!DnsPacketCodec.TryParseQuery(query, out question)) throw new InvalidDataException("Bad test query");
            byte[] response = new byte[question.QuestionEnd + 16];
            Buffer.BlockCopy(query, 0, response, 0, question.QuestionEnd);
            DnsPacketCodec.WriteUInt16(response, 2, 0x8180);
            DnsPacketCodec.WriteUInt16(response, 6, 1);
            DnsPacketCodec.WriteUInt16(response, 8, 0);
            DnsPacketCodec.WriteUInt16(response, 10, 0);
            int offset = question.QuestionEnd;
            response[offset++] = 0xc0; response[offset++] = 0x0c;
            DnsPacketCodec.WriteUInt16(response, offset, question.Type); offset += 2;
            DnsPacketCodec.WriteUInt16(response, offset, 1); offset += 2;
            DnsPacketCodec.WriteUInt32(response, offset, ttl); offset += 4;
            DnsPacketCodec.WriteUInt16(response, offset, 4); offset += 2;
            response[offset++] = 1; response[offset++] = 2; response[offset++] = 3; response[offset] = 4;
            return response;
        }

        private static byte[] Append(byte[] left, byte[] right)
        {
            byte[] result = new byte[left.Length + right.Length];
            Buffer.BlockCopy(left, 0, result, 0, left.Length);
            Buffer.BlockCopy(right, 0, result, left.Length, right.Length);
            return result;
        }

        private static void ReadExactly(Stream stream, byte[] buffer, int offset, int count)
        {
            while (count > 0)
            {
                int read = stream.Read(buffer, offset, count);
                if (read <= 0) throw new EndOfStreamException();
                offset += read; count -= read;
            }
        }

        private static bool BytesEqual(byte[] first, byte[] second)
        {
            if (first == null || second == null || first.Length != second.Length) return false;
            for (int index = 0; index < first.Length; index++) if (first[index] != second[index]) return false;
            return true;
        }

        private static void Assert(bool condition, string label)
        {
            if (!condition) throw new InvalidOperationException("DNS self-test failed: " + label);
        }
    }
}
