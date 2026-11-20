using System;
using System.Text.RegularExpressions;

namespace JLJ.WebsiteProtection
{
    internal interface IDnsNetworkRecoveryState
    {
        byte[] CaptureDnsConfiguration();
        void PointDnsToLoopback();
        void RestoreDnsConfiguration(byte[] snapshot);
        bool VerifyNormalDnsResolution();
    }

    internal interface IRecoveryJournal
    {
        void Record(string state, string reasonCode);
    }

    internal interface IDnsFailureSink
    {
        void OnDnsFailure(string reasonCode);
    }

    internal sealed class FailOpenRecoveryCoordinator : IDnsFailureSink
    {
        private readonly object _gate = new object();
        private readonly IDnsNetworkRecoveryState _network;
        private readonly IRecoveryJournal _journal;
        private readonly Action _stopListener;
        private byte[] _snapshot;
        private string _state = "inactive";

        internal FailOpenRecoveryCoordinator(IDnsNetworkRecoveryState network, IRecoveryJournal journal, Action stopListener)
        {
            if (network == null) throw new ArgumentNullException("network");
            if (journal == null) throw new ArgumentNullException("journal");
            _network = network;
            _journal = journal;
            _stopListener = stopListener ?? delegate { };
        }

        internal string State { get { lock (_gate) return _state; } }

        // This coordinator is exercised with fakes in Phase 4C. No Windows adapter implementation
        // is supplied or connected to ProtectionService in this phase.
        internal bool TryActivate(Func<bool> upstreamHealthy, Func<bool> localResolverHealthy,
            Func<bool> allowedAndDeniedPolicyProbes)
        {
            if (upstreamHealthy == null || localResolverHealthy == null || allowedAndDeniedPolicyProbes == null)
                throw new ArgumentNullException("healthCheck");
            lock (_gate)
            {
                if (_state == "active") return true;
                bool healthy;
                try { healthy = upstreamHealthy() && localResolverHealthy() && allowedAndDeniedPolicyProbes(); }
                catch { healthy = false; }
                if (!healthy)
                {
                    _state = "inactive";
                    Record(_state, "HEALTH_CHECK_FAILED");
                    return false;
                }
                try
                {
                    byte[] captured = _network.CaptureDnsConfiguration();
                    if (captured == null || captured.Length == 0) throw new InvalidOperationException("RECOVERY_SNAPSHOT_INVALID");
                    _snapshot = (byte[])captured.Clone();
                    _network.PointDnsToLoopback();
                    if (!localResolverHealthy()) throw new InvalidOperationException("LOCAL_RESOLVER_UNHEALTHY");
                    _state = "active";
                    Record(_state, "ACTIVATED");
                    return true;
                }
                catch
                {
                    RecoverLocked("ACTIVATION_FAILED");
                    return false;
                }
            }
        }

        public void OnDnsFailure(string reasonCode)
        {
            Recover(reasonCode);
        }

        internal void OnUnexpectedServiceExit()
        {
            Recover("SERVICE_EXITED");
        }

        internal void StopGracefully()
        {
            Recover("SERVICE_STOPPED");
        }

        private void Recover(string reasonCode)
        {
            if (String.IsNullOrEmpty(reasonCode) || !Regex.IsMatch(reasonCode, "^[A-Z0-9_]{1,48}$")) reasonCode = "DNS_FAILURE";
            lock (_gate) RecoverLocked(reasonCode);
        }

        private void RecoverLocked(string reasonCode)
        {
            if ((_state == "inactive" || _state == "degraded" || _state == "unprotected") && _snapshot == null) return;
            try { _stopListener(); } catch { }
            if (_snapshot == null)
            {
                _state = "unprotected";
                Record(_state, "RECOVERY_SNAPSHOT_MISSING");
                return;
            }
            try
            {
                _network.RestoreDnsConfiguration((byte[])_snapshot.Clone());
                bool verified = _network.VerifyNormalDnsResolution();
                _state = verified ? "degraded" : "unprotected";
                Record(_state, reasonCode);
                if (verified) _snapshot = null;
            }
            catch
            {
                _state = "unprotected";
                Record(_state, "RESTORE_FAILED");
            }
        }

        private void Record(string state, string code)
        {
            try { _journal.Record(state, code); } catch { }
        }
    }
}
