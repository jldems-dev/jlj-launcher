using System;
using System.Collections.Generic;
using System.Text.RegularExpressions;

namespace JLJ.WebsiteProtection
{
    internal interface IDnsDecisionLogger
    {
        void Record(string eventCode);
    }

    internal sealed class SafeDnsDecisionLogger : IDnsDecisionLogger
    {
        private readonly object _gate = new object();
        private readonly Dictionary<string, long> _lastLogged = new Dictionary<string, long>(StringComparer.Ordinal);
        private readonly long _minimumIntervalTicks;
        private readonly Func<long> _utcTicks;
        private static readonly HashSet<string> AllowedCodes = new HashSet<string>(new[]
        {
            "DNS_INVALID_QUERY", "DNS_POLICY_BLOCK", "DNS_POLICY_ALLOW", "DNS_CACHE_HIT", "DNS_UPSTREAM_FAILURE", "DNS_OVERLOADED"
        }, StringComparer.Ordinal);

        internal SafeDnsDecisionLogger(TimeSpan? minimumInterval = null, Func<long> utcTicks = null)
        {
            _minimumIntervalTicks = (long)(minimumInterval ?? TimeSpan.FromSeconds(10)).Ticks;
            _utcTicks = utcTicks ?? (() => DateTime.UtcNow.Ticks);
        }

        public void Record(string eventCode)
        {
            if (!AllowedCodes.Contains(eventCode) || !Regex.IsMatch(eventCode, "^[A-Z0-9_]{1,48}$")) return;
            lock (_gate)
            {
                long now = _utcTicks();
                long last;
                if (_lastLogged.TryGetValue(eventCode, out last) && now - last < _minimumIntervalTicks) return;
                _lastLogged[eventCode] = now;
            }
            ServiceLog.Write(eventCode);
        }
    }

    internal sealed class DnsRequestProcessor
    {
        private readonly Func<ValidatedPolicy> _getPolicy;
        private readonly IDnsUpstreamResolver _upstream;
        private readonly DnsResponseCache _cache;
        private readonly IDnsFailureSink _failureSink;
        private readonly IDnsDecisionLogger _logger;
        private readonly TimeSpan _upstreamTimeout;

        internal DnsRequestProcessor(Func<ValidatedPolicy> getPolicy, IDnsUpstreamResolver upstream,
            DnsResponseCache cache, IDnsFailureSink failureSink, IDnsDecisionLogger logger, TimeSpan upstreamTimeout)
        {
            if (getPolicy == null) throw new ArgumentNullException("getPolicy");
            _getPolicy = getPolicy;
            _upstream = upstream ?? new UnconfiguredDnsUpstreamResolver();
            _cache = cache ?? new DnsResponseCache();
            _failureSink = failureSink;
            _logger = logger;
            if (upstreamTimeout < TimeSpan.FromMilliseconds(100) || upstreamTimeout > TimeSpan.FromSeconds(10)) throw new ArgumentOutOfRangeException("upstreamTimeout");
            _upstreamTimeout = upstreamTimeout;
        }

        internal byte[] Handle(byte[] packet)
        {
            DnsQuestion question;
            if (!DnsPacketCodec.TryParseQuery(packet, out question))
            {
                Log("DNS_INVALID_QUERY");
                return DnsPacketCodec.CreateError(packet, DnsResponseCode.FormatError);
            }
            if (!question.IsCanonicalDomain || question.Class != 1 || question.Type == 251 || question.Type == 252)
            {
                Log("DNS_POLICY_BLOCK");
                return DnsPacketCodec.CreateQuestionResponse(question, DnsResponseCode.Refused);
            }

            ValidatedPolicy policy;
            try { policy = _getPolicy(); }
            catch
            {
                Log("DNS_UPSTREAM_FAILURE");
                NotifyFailure("POLICY_UNAVAILABLE");
                return DnsPacketCodec.CreateQuestionResponse(question, DnsResponseCode.ServerFailure);
            }
            if (policy == null) return DnsPacketCodec.CreateQuestionResponse(question, DnsResponseCode.Refused);

            DnsPolicyDecision decision = DnsPolicyEvaluator.Evaluate(question.Domain, policy);
            if (!decision.Allowed)
            {
                Log("DNS_POLICY_BLOCK");
                return DnsPacketCodec.CreateQuestionResponse(question, DnsResponseCode.Refused);
            }
            Log("DNS_POLICY_ALLOW");

            byte[] cached;
            if (_cache.TryGet(packet, policy.Revision, out cached))
            {
                Log("DNS_CACHE_HIT");
                return cached;
            }

            try
            {
                byte[] response = _upstream.Resolve(packet, _upstreamTimeout);
                DnsResponseMetadata metadata;
                if (!DnsPacketCodec.TryValidateResponse(response, question, out metadata)) throw new InvalidOperationException("DNS_UPSTREAM_RESPONSE_INVALID");
                _cache.Store(packet, response, metadata, policy.Revision);
                return response;
            }
            catch
            {
                Log("DNS_UPSTREAM_FAILURE");
                NotifyFailure("UPSTREAM_FAILURE");
                return DnsPacketCodec.CreateQuestionResponse(question, DnsResponseCode.ServerFailure);
            }
        }

        private void NotifyFailure(string code)
        {
            if (_failureSink == null) return;
            try { _failureSink.OnDnsFailure(code); } catch { }
        }

        internal void ReportOverload()
        {
            // Queue pressure is handled per request. It must not trigger fail-open recovery,
            // which would let a local client disable protection by exhausting the bounded slots.
            Log("DNS_OVERLOADED");
        }

        private void Log(string code)
        {
            if (_logger == null) return;
            try { _logger.Record(code); } catch { }
        }
    }
}
