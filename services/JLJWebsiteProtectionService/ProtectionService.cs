using System;
using System.IO;
using System.ServiceProcess;
using System.Security.Principal;
using System.Threading;

namespace JLJ.WebsiteProtection
{
    internal sealed class ProtectionService : ServiceBase
    {
        internal const string ServiceNameValue = "JLJWebsiteProtectionService";
        private readonly string _stateDirectory;
        private PolicyStateStore _store;
        private ServiceStatus _status;
        private ServiceProtocol _protocol;
        private SecurePipeServer _pipe;
        private Timer _heartbeat;
        private string _ownerSid;

        internal ProtectionService()
        {
            ServiceName = ServiceNameValue;
            CanStop = true;
            CanShutdown = true;
            AutoLog = false;
            _stateDirectory = ServiceIdentityConfig.StateDirectory;
        }

        protected override void OnStart(string[] args)
        {
            _status = new ServiceStatus();
            _store = new PolicyStateStore(_stateDirectory, true);
            try
            {
                _store.Initialize();
                _ownerSid = ReadOwnerSid();
                _status.SetState("healthy", null);
                ServiceLog.Write("SERVICE_STARTED");
            }
            catch
            {
                // Service can still answer health requests; invalid state is never accepted as policy.
                _status.SetState("degraded", "STATE_UNAVAILABLE");
                ServiceLog.Write("STATE_UNAVAILABLE");
            }
            _protocol = new ServiceProtocol(_store, _status, delegate { return _ownerSid; });
            _pipe = new SecurePipeServer(_protocol, delegate { return _ownerSid; });
            _pipe.Start();
            _heartbeat = new Timer(delegate { _status.Beat(); }, null, TimeSpan.Zero, TimeSpan.FromSeconds(5));
        }

        protected override void OnStop()
        {
            ServiceLog.Write("SERVICE_STOPPING");
            if (_heartbeat != null) { _heartbeat.Dispose(); _heartbeat = null; }
            if (_pipe != null) { _pipe.Stop(); _pipe = null; }
            if (_status != null) _status.SetState("stopped", null);
            ServiceLog.Write("SERVICE_STOPPED");
        }

        protected override void OnShutdown()
        {
            OnStop();
            base.OnShutdown();
        }

        private string ReadOwnerSid()
        {
            string ownerPath = Path.Combine(_stateDirectory, "owner.sid");
            if (!File.Exists(ownerPath)) return null;
            FileInfo file = new FileInfo(ownerPath);
            if ((file.Attributes & FileAttributes.ReparsePoint) != 0) return null;
            string value = File.ReadAllText(ownerPath).Trim();
            try { return new SecurityIdentifier(value).Value; }
            catch (ArgumentException) { return null; }
        }
    }
}
