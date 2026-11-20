using System;
using System.Collections.Generic;
using System.Configuration.Install;
using System.IO;
using System.IO.Pipes;
using System.Linq;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.ServiceProcess;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using Microsoft.Win32.SafeHandles;

namespace JLJ.WebsiteProtection
{
    internal sealed class ServiceStatus
    {
        private readonly object _gate = new object();
        private string _state = "starting";
        private string _lastError;
        private DateTime _heartbeatUtc = DateTime.UtcNow;
        internal string State { get { lock (_gate) return _state; } }
        internal string LastError { get { lock (_gate) return _lastError; } }
        internal DateTime HeartbeatUtc { get { lock (_gate) return _heartbeatUtc; } }
        internal void SetState(string state, string error)
        {
            lock (_gate) { _state = state; _lastError = error; _heartbeatUtc = DateTime.UtcNow; }
        }
        internal void Beat() { lock (_gate) _heartbeatUtc = DateTime.UtcNow; }
    }

    internal sealed class ProtocolFault : Exception
    {
        internal string Code;
        internal ProtocolFault(string code) : base(code) { Code = code; }
    }

    internal sealed class ServiceProtocol
    {
        private sealed class CachedReply
        {
            internal string RequestHash;
            internal string Response;
        }

        private readonly PolicyStateStore _store;
        private readonly ServiceStatus _status;
        private readonly Func<string> _getOwnerSid;
        private readonly Action<string> _log;
        private readonly object _cacheGate = new object();
        private readonly Dictionary<string, CachedReply> _cache = new Dictionary<string, CachedReply>(StringComparer.Ordinal);
        private readonly Queue<string> _cacheOrder = new Queue<string>();

        internal ServiceProtocol(PolicyStateStore store, ServiceStatus status, Func<string> getOwnerSid)
            : this(store, status, getOwnerSid, ServiceLog.Write)
        {
        }

        internal ServiceProtocol(PolicyStateStore store, ServiceStatus status, Func<string> getOwnerSid, Action<string> log)
        {
            _store = store; _status = status; _getOwnerSid = getOwnerSid; _log = log ?? delegate { };
        }

        internal string Handle(string message, string callerSid)
        {
            IDictionary<string, object> request = null;
            string requestId = String.Empty;
            string cacheKey = null;
            string requestHash = null;
            try
            {
                request = StrictJsonParser.Parse(message) as IDictionary<string, object>;
                if (request == null) throw new ProtocolFault("MALFORMED_REQUEST");
                object id;
                if (request.TryGetValue("requestId", out id) && id is string) requestId = (string)id;
                Guid parsedRequestId;
                if (!Guid.TryParseExact(requestId, "D", out parsedRequestId)) throw new ProtocolFault("MALFORMED_REQUEST");
                if (String.IsNullOrEmpty(callerSid) || callerSid == "S-1-5-7") throw new ProtocolFault("UNAUTHENTICATED");
                requestHash = HashText(message);
                cacheKey = callerSid + "|" + requestId;
                string duplicate;
                if (TryGetCached(cacheKey, requestHash, out duplicate)) return duplicate;
                IDictionary<string, object> response = Process(request, callerSid);
                string serialized = new JavaScriptSerializer().Serialize(response);
                Cache(cacheKey, requestHash, serialized);
                return serialized;
            }
            catch (ProtocolFault fault) { return ErrorResponse(requestId, fault.Code); }
            catch (InvalidOperationException exception)
            {
                string code = exception.Message;
                if (!IsErrorCode(code)) code = "REQUEST_FAILED";
                return ErrorResponse(requestId, code);
            }
            catch (FormatException) { return ErrorResponse(requestId, "MALFORMED_REQUEST"); }
            catch { return ErrorResponse(requestId, "REQUEST_FAILED"); }
        }

        private IDictionary<string, object> Process(IDictionary<string, object> request, string callerSid)
        {
            RequireExactFields(request, "protocolVersion", "requestId", "operation", "body");
            if (ReadLong(request, "protocolVersion") != PolicySnapshotValidator.ProtocolVersion) throw new ProtocolFault("PROTOCOL_MISMATCH");
            string requestId = ReadString(request, "requestId");
            Guid parsedRequestId;
            if (!Guid.TryParseExact(requestId, "D", out parsedRequestId)) throw new ProtocolFault("MALFORMED_REQUEST");
            string operation = ReadString(request, "operation");
            IDictionary<string, object> body = ReadObject(request, "body");
            IDictionary<string, object> result;

            switch (operation)
            {
                case "GetCapabilities":
                    RequireExactFields(body);
                    result = Capabilities();
                    break;
                case "GetStatus":
                    RequireExactFields(body);
                    result = Status();
                    break;
                case "ValidatePolicy":
                    RequireExactFields(body, "policy");
                    ValidatedPolicy candidate = ValidatePolicy(body["policy"]);
                    result = new Dictionary<string, object>
                    {
                        { "valid", true }, { "policyRevision", candidate.Revision }, { "sha256", candidate.Sha256 },
                        { "revisionAvailable", _store.CanApply(candidate) }, { "enforcementActive", false }
                    };
                    if (!(bool)result["revisionAvailable"]) throw new ProtocolFault("STALE_REVISION");
                    break;
                case "ApplyPolicy":
                    RequireOwner(callerSid);
                    RequireExactFields(body, "policy");
                    ValidatedPolicy toApply = ValidatePolicy(body["policy"]);
                    bool changed = _store.Apply(toApply);
                    _status.SetState("healthy", null);
                    _log(changed ? "POLICY_ACCEPTED" : "POLICY_DUPLICATE");
                    result = new Dictionary<string, object>
                    {
                        { "accepted", true }, { "duplicate", !changed }, { "policyRevision", toApply.Revision },
                        { "sha256", toApply.Sha256 }, { "mode", "monitoring" }, { "enforcementActive", false }
                    };
                    break;
                case "RestoreLastKnownGood":
                    RequireOwner(callerSid);
                    RequireExactFields(body);
                    ValidatedPolicy restored = _store.RestoreLastKnownGood();
                    _status.SetState("healthy", null);
                    _log("POLICY_RESTORED");
                    result = new Dictionary<string, object>
                    {
                        { "restored", true }, { "policyRevision", restored.Revision }, { "sha256", restored.Sha256 },
                        { "mode", "monitoring" }, { "enforcementActive", false }
                    };
                    break;
                default: throw new ProtocolFault("INVALID_OPERATION");
            }

            return new Dictionary<string, object>
            {
                { "protocolVersion", PolicySnapshotValidator.ProtocolVersion }, { "requestId", requestId },
                { "success", true }, { "body", result }
            };
        }

        private ValidatedPolicy ValidatePolicy(object raw)
        {
            ValidatedPolicy policy;
            try { policy = PolicySnapshotValidator.Validate(raw); }
            catch (FormatException) { throw new ProtocolFault("INVALID_POLICY"); }
            if (!_store.CanApply(policy)) throw new ProtocolFault("STALE_REVISION");
            return policy;
        }

        private void RequireOwner(string callerSid)
        {
            string ownerSid = _getOwnerSid();
            if (String.IsNullOrEmpty(ownerSid) || !String.Equals(ownerSid, callerSid, StringComparison.Ordinal))
                throw new ProtocolFault("UNAUTHORIZED");
        }

        private IDictionary<string, object> Capabilities()
        {
            return new Dictionary<string, object>
            {
                { "serviceVersion", "1.0.0" }, { "protocolVersion", PolicySnapshotValidator.ProtocolVersion },
                { "operations", new[] { "GetCapabilities", "GetStatus", "ValidatePolicy", "ApplyPolicy", "RestoreLastKnownGood" } },
                { "maximumMessageBytes", PolicySnapshotValidator.MaximumMessageBytes },
                { "maximumRules", PolicySnapshotValidator.MaximumRules }, { "policyMode", "monitoring" },
                { "enforcementActive", false }, { "resolverConfigured", false }
            };
        }

        private IDictionary<string, object> Status()
        {
            return new Dictionary<string, object>
            {
                { "serviceVersion", "1.0.0" }, { "protocolVersion", PolicySnapshotValidator.ProtocolVersion },
                { "state", _status.State }, { "heartbeatUtc", _status.HeartbeatUtc.ToString("o") },
                { "lastErrorCode", _status.LastError }, { "lastAcceptedRevision", _store.CurrentRevision },
                { "lastAcceptedSha256", _store.CurrentHash }, { "mode", "monitoring" },
                { "enforcementActive", false }, { "resolverConfigured", false }
            };
        }

        private static IDictionary<string, object> Error(string requestId, string code)
        {
            return new Dictionary<string, object>
            {
                { "protocolVersion", PolicySnapshotValidator.ProtocolVersion }, { "requestId", requestId },
                { "success", false }, { "error", code }
            };
        }

        private static string ErrorResponse(string requestId, string code)
        {
            if (!IsErrorCode(code)) code = "REQUEST_FAILED";
            try { return new JavaScriptSerializer().Serialize(Error(requestId, code)); }
            catch { return "{\"protocolVersion\":1,\"requestId\":\"\",\"success\":false,\"error\":\"REQUEST_FAILED\"}"; }
        }

        private bool TryGetCached(string key, string requestHash, out string response)
        {
            lock (_cacheGate)
            {
                CachedReply entry;
                if (!_cache.TryGetValue(key, out entry)) { response = null; return false; }
                if (!String.Equals(entry.RequestHash, requestHash, StringComparison.Ordinal)) throw new ProtocolFault("DUPLICATE_REQUEST_ID");
                response = entry.Response;
                return true;
            }
        }

        private void Cache(string key, string hash, string response)
        {
            lock (_cacheGate)
            {
                if (_cache.ContainsKey(key)) return;
                _cache.Add(key, new CachedReply { RequestHash = hash, Response = response });
                _cacheOrder.Enqueue(key);
                while (_cacheOrder.Count > 256) _cache.Remove(_cacheOrder.Dequeue());
            }
        }

        private static string HashText(string value)
        {
            using (var sha = System.Security.Cryptography.SHA256.Create())
            {
                byte[] digest = sha.ComputeHash(Encoding.UTF8.GetBytes(value));
                return BitConverter.ToString(digest).Replace("-", "").ToLowerInvariant();
            }
        }

        private static bool IsErrorCode(string value) { return !String.IsNullOrEmpty(value) && value.Length <= 64 && value.All(c => (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_'); }
        private static void RequireExactFields(IDictionary<string, object> value, params string[] expected)
        {
            HashSet<string> keys = new HashSet<string>(expected, StringComparer.Ordinal);
            if (value.Count != keys.Count || value.Keys.Any(key => !keys.Contains(key))) throw new ProtocolFault("MALFORMED_REQUEST");
        }
        private static long ReadLong(IDictionary<string, object> value, string key)
        {
            object item;
            if (!value.TryGetValue(key, out item) || !(item is long)) throw new ProtocolFault("MALFORMED_REQUEST");
            return (long)item;
        }
        private static string ReadString(IDictionary<string, object> value, string key)
        {
            object item;
            if (!value.TryGetValue(key, out item) || !(item is string)) throw new ProtocolFault("MALFORMED_REQUEST");
            return (string)item;
        }
        private static IDictionary<string, object> ReadObject(IDictionary<string, object> value, string key)
        {
            object item;
            IDictionary<string, object> result;
            if (!value.TryGetValue(key, out item) || (result = item as IDictionary<string, object>) == null) throw new ProtocolFault("MALFORMED_REQUEST");
            return result;
        }
    }

    internal sealed class SecurePipeServer : IDisposable
    {
        internal const string PipeName = "\\\\.\\pipe\\JLJWebsiteProtection.v1";
        private const int MaximumInstances = 8;
        private const uint PipeAccessDuplex = 0x00000003;
        private const uint FirstPipeInstance = 0x00080000;
        private const uint PipeTypeByte = 0x00000000;
        private const uint PipeWait = 0x00000000;
        private const uint RejectRemoteClients = 0x00000008;
        private readonly ServiceProtocol _protocol;
        private readonly Func<string> _getOwnerSid;
        private readonly Action<string> _log;
        private readonly Func<NamedPipeServerStream, string> _resolveCallerSid;
        private volatile bool _running;
        private Thread _worker;
        private readonly object _pipeGate = new object();
        private NamedPipeServerStream _activePipe;

        [StructLayout(LayoutKind.Sequential)]
        private struct NativeSecurityAttributes
        {
            public int Length;
            public IntPtr SecurityDescriptor;
            [MarshalAs(UnmanagedType.Bool)] public bool InheritHandle;
        }

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern SafePipeHandle CreateNamedPipe(string name, uint openMode, uint pipeMode,
            uint maxInstances, uint outputBufferSize, uint inputBufferSize, uint defaultTimeout,
            ref NativeSecurityAttributes securityAttributes);

        internal SecurePipeServer(ServiceProtocol protocol, Func<string> getOwnerSid)
            : this(protocol, getOwnerSid, ServiceLog.Write)
        {
        }

        internal SecurePipeServer(ServiceProtocol protocol, Func<string> getOwnerSid, Action<string> log)
            : this(protocol, getOwnerSid, log, null)
        {
        }

        internal SecurePipeServer(ServiceProtocol protocol, Func<string> getOwnerSid, Action<string> log, Func<NamedPipeServerStream, string> resolveCallerSid)
        {
            _protocol = protocol; _getOwnerSid = getOwnerSid; _log = log ?? delegate { };
            _resolveCallerSid = resolveCallerSid ?? GetCallerSid;
        }

        internal void Start()
        {
            _running = true;
            _worker = new Thread(ServerLoop) { IsBackground = true, Name = "JLJ website protection pipe" };
            _worker.Start();
        }

        internal void Stop()
        {
            _running = false;
            lock (_pipeGate)
            {
                if (_activePipe != null) try { _activePipe.Dispose(); } catch { }
            }
            if (_worker != null && !_worker.Join(TimeSpan.FromSeconds(3))) _log("PIPE_STOP_TIMEOUT");
            _worker = null;
        }

        public void Dispose() { Stop(); }

        private void ServerLoop()
        {
            while (_running)
            {
                NamedPipeServerStream pipe = null;
                try
                {
                    pipe = CreateServerPipe();
                    lock (_pipeGate) _activePipe = pipe;
                    pipe.WaitForConnection();
                    if (!_running) break;
                    string message;
                    try { message = ReadMessageWithTimeout(pipe, TimeSpan.FromSeconds(5)); }
                    catch { _log("PIPE_READ_ERROR"); throw; }
                    // Windows impersonates the client associated with the last pipe message read.
                    string callerSid;
                    try { callerSid = _resolveCallerSid(pipe); }
                    catch { _log("PIPE_IDENTITY_ERROR"); throw; }
                    string response = _protocol.Handle(message, callerSid);
                    byte[] bytes = new UTF8Encoding(false, true).GetBytes(response + "\n");
                    if (bytes.Length > PolicySnapshotValidator.MaximumMessageBytes) throw new InvalidDataException("Response exceeded protocol limit");
                    pipe.Write(bytes, 0, bytes.Length);
                    pipe.Flush();
                }
                catch (IOException) { if (_running) { _log("PIPE_IO_ERROR"); Thread.Sleep(1000); } }
                catch { if (_running) { _log("PIPE_REQUEST_ERROR"); Thread.Sleep(1000); } }
                finally
                {
                    lock (_pipeGate) if (Object.ReferenceEquals(_activePipe, pipe)) _activePipe = null;
                    if (pipe != null) pipe.Dispose();
                }
            }
        }

        private NamedPipeServerStream CreateServerPipe()
        {
            PipeSecurity security = CreatePipeSecurity(_getOwnerSid());
            byte[] descriptor = security.GetSecurityDescriptorBinaryForm();
            IntPtr descriptorPointer = Marshal.AllocHGlobal(descriptor.Length);
            try
            {
                Marshal.Copy(descriptor, 0, descriptorPointer, descriptor.Length);
                NativeSecurityAttributes attributes = new NativeSecurityAttributes
                {
                    Length = Marshal.SizeOf(typeof(NativeSecurityAttributes)),
                    SecurityDescriptor = descriptorPointer,
                    InheritHandle = false
                };
                SafePipeHandle handle = CreateNamedPipe(PipeName, PipeAccessDuplex | FirstPipeInstance, PipeTypeByte | PipeWait | RejectRemoteClients,
                    MaximumInstances, PolicySnapshotValidator.MaximumMessageBytes, PolicySnapshotValidator.MaximumMessageBytes, 0, ref attributes);
                if (handle == null || handle.IsInvalid) throw new IOException("Could not create the local service pipe", Marshal.GetExceptionForHR(Marshal.GetHRForLastWin32Error()));
                return new NamedPipeServerStream(PipeDirection.InOut, false, false, handle);
            }
            finally { Marshal.FreeHGlobal(descriptorPointer); }
        }

        internal static PipeSecurity CreatePipeSecurity(string ownerSidText)
        {
            PipeSecurity security = new PipeSecurity();
            security.SetAccessRuleProtection(true, false);
            security.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null), PipeAccessRights.FullControl, AccessControlType.Allow));
            security.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(WellKnownSidType.LocalServiceSid, null), PipeAccessRights.FullControl, AccessControlType.Allow));
            security.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid, null), PipeAccessRights.FullControl, AccessControlType.Allow));
            security.AddAccessRule(new PipeAccessRule(ServiceIdentityConfig.ServiceSid, PipeAccessRights.FullControl, AccessControlType.Allow));
            security.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(WellKnownSidType.BuiltinUsersSid, null), PipeAccessRights.ReadWrite, AccessControlType.Allow));
            if (!String.IsNullOrEmpty(ownerSidText))
            {
                try { security.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(ownerSidText), PipeAccessRights.ReadWrite, AccessControlType.Allow)); }
                catch (ArgumentException) { }
            }

            return security;
        }

        private static string GetCallerSid(NamedPipeServerStream pipe)
        {
            string sid = null;
            pipe.RunAsClient(delegate
            {
                using (WindowsIdentity identity = WindowsIdentity.GetCurrent(true))
                    if (identity != null && identity.User != null) sid = identity.User.Value;
            });
            return sid;
        }

        private static string ReadMessage(Stream stream)
        {
            using (MemoryStream buffer = new MemoryStream())
            {
                while (buffer.Length <= PolicySnapshotValidator.MaximumMessageBytes)
                {
                    int next = stream.ReadByte();
                    if (next < 0) throw new EndOfStreamException();
                    if (next == '\n')
                    {
                        byte[] bytes = buffer.ToArray();
                        if (bytes.Length > 0 && bytes[bytes.Length - 1] == '\r') Array.Resize(ref bytes, bytes.Length - 1);
                        return new UTF8Encoding(false, true).GetString(bytes);
                    }
                    buffer.WriteByte((byte)next);
                }
                throw new InvalidDataException("Request exceeded protocol limit");
            }
        }

        private static string ReadMessageWithTimeout(Stream stream, TimeSpan timeout)
        {
            Task<string> read = Task.Factory.StartNew(() => ReadMessage(stream), CancellationToken.None,
                TaskCreationOptions.LongRunning, TaskScheduler.Default);
            if (!read.Wait(timeout))
            {
                try { stream.Dispose(); } catch { }
                try { read.Wait(TimeSpan.FromSeconds(1)); } catch { }
                throw new System.TimeoutException("Pipe request timed out");
            }
            return read.GetAwaiter().GetResult();
        }
    }

    internal static class ServiceProtocolSelfTests
    {
        internal static void RunPipeIntegrationOnly()
        {
            string temporary = Path.Combine(Path.GetTempPath(), "JLJWebsitePipeTest-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(temporary);
            try
            {
                string ownerSid = WindowsIdentity.GetCurrent().User.Value;
                PolicyStateStore store = new PolicyStateStore(temporary, false);
                store.Initialize();
                ServiceProtocol protocol = new ServiceProtocol(store, new ServiceStatus(), delegate { return ownerSid; }, delegate { });
                TestLocalPipe(protocol, ownerSid);
                Console.WriteLine("Local named-pipe impersonation integration passed.");
            }
            finally { try { Directory.Delete(temporary, true); } catch { } }
        }

        internal static void Run()
        {
            string temporary = Path.Combine(Path.GetTempPath(), "JLJWebsiteServiceTest-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(temporary);
            try
            {
                string ownerSid = WindowsIdentity.GetCurrent().User.Value;
                PolicyStateStore store = new PolicyStateStore(temporary, false);
                store.Initialize();
                ServiceStatus status = new ServiceStatus();
                ServiceProtocol protocol = new ServiceProtocol(store, status, delegate { return ownerSid; }, delegate { });
                ValidatedPolicy first = SamplePolicy(1, "approved.example");
                ValidatedPolicy second = SamplePolicy(2, "approved.example");

                ExpectFormatException(delegate { StrictJsonParser.Parse("{\"x\":1,\"x\":2}"); }, "duplicate JSON keys");
                ExpectFormatException(delegate { PolicySnapshotValidator.Validate(SamplePolicy(1, "127.0.0.1").ToDictionary()); }, "invalid IP rule");
                PolicySnapshotValidator.Validate(first.ToDictionary());
                if (!String.Equals(first.Sha256, "952584643e438221ac305f41a83f18db5bc0d1e5c3fbfd5b3fccae07c5161cde", StringComparison.Ordinal))
                    throw new InvalidOperationException("Cross-language canonical policy hash vector did not match");
                IDictionary<string, object> badHash = first.ToDictionary();
                badHash["sha256"] = new String('0', 64);
                ExpectFormatException(delegate { PolicySnapshotValidator.Validate(badHash); }, "invalid checksum");

                string unauthorized = protocol.Handle(Request("ApplyPolicy", PolicyBody(first), "00000000-0000-4000-8000-000000000010"), "S-1-5-21-999-999-999-1002");
                AssertError(unauthorized, "UNAUTHORIZED", "unauthorized caller");
                string standardUserSid = "S-1-5-32-545";
                AssertError(protocol.Handle(Request("ApplyPolicy", PolicyBody(first), "00000000-0000-4000-8000-000000000013"), standardUserSid), "UNAUTHORIZED", "standard user cannot apply policy");
                AssertError(protocol.Handle(Request("RestoreLastKnownGood", new Dictionary<string, object>(), "00000000-0000-4000-8000-000000000014"), standardUserSid), "UNAUTHORIZED", "standard user cannot restore policy");
                AssertSuccess(protocol.Handle(Request("ValidatePolicy", PolicyBody(first), "00000000-0000-4000-8000-000000000015"), standardUserSid), "standard user can validate without mutation");
                if (store.CurrentRevision != -1) throw new InvalidOperationException("Standard user policy operations changed stored state");
                AssertError(protocol.Handle(Request("GetStatus", new Dictionary<string, object>(), "00000000-0000-4000-8000-000000000011", 2), ownerSid), "PROTOCOL_MISMATCH", "protocol negotiation");
                AssertError(protocol.Handle("{\"protocolVersion\":1,\"requestId\":\"00000000-0000-4000-8000-000000000012\",\"operation\":\"GetStatus\",\"operation\":\"GetStatus\",\"body\":{}}", ownerSid), "MALFORMED_REQUEST", "duplicate request fields");
                string applyRequest = Request("ApplyPolicy", PolicyBody(first), "00000000-0000-4000-8000-000000000020");
                IDictionary<string, object> parsedApply = StrictJsonParser.Parse(applyRequest) as IDictionary<string, object>;
                if (parsedApply == null || parsedApply.Count != 4 || !(parsedApply["protocolVersion"] is long)) throw new InvalidOperationException("Self-test apply request schema did not parse");
                IDictionary<string, object> parsedBody = parsedApply["body"] as IDictionary<string, object>;
                if (parsedBody == null || parsedBody.Count != 1) throw new InvalidOperationException("Self-test apply request body did not parse: " + parsedApply["body"].GetType().FullName);
                PolicySnapshotValidator.Validate(parsedBody["policy"]);
                AssertSuccess(protocol.Handle(applyRequest, ownerSid), "atomic policy acceptance");
                AssertSuccess(protocol.Handle(Request("ApplyPolicy", PolicyBody(first), "00000000-0000-4000-8000-000000000020"), ownerSid), "duplicate request replay");
                AssertError(protocol.Handle(Request("ApplyPolicy", PolicyBody(second), "00000000-0000-4000-8000-000000000020"), ownerSid), "DUPLICATE_REQUEST_ID", "request ID collision");
                AssertError(protocol.Handle(Request("ApplyPolicy", PolicyBody(SamplePolicy(0, "approved.example")), "00000000-0000-4000-8000-000000000021"), ownerSid), "STALE_REVISION", "stale policy revision");
                AssertSuccess(protocol.Handle(Request("ApplyPolicy", PolicyBody(second), "00000000-0000-4000-8000-000000000022"), ownerSid), "higher revision acceptance");

                PolicyStateStore restarted = new PolicyStateStore(temporary, false);
                restarted.Initialize();
                if (restarted.CurrentRevision != 2 || restarted.CurrentHash != second.Sha256) throw new InvalidOperationException("Restart recovery failed");
                AssertSuccess(protocol.Handle(Request("RestoreLastKnownGood", new Dictionary<string, object>(), "00000000-0000-4000-8000-000000000023"), ownerSid), "last-known-good restore");

                PipeSecurity acl = SecurePipeServer.CreatePipeSecurity(ownerSid);
                AssertPipeAcl(acl, ownerSid);
                AssertProtectedDirectoryAcl(ServiceIdentityConfig.CreateDirectorySecurity());
                AssertProtectedFileAcl(ServiceIdentityConfig.CreateFileSecurity());
                AssertServiceInstallerConfiguration();

                TestLocalPipe(protocol, ownerSid);
                DnsFoundationSelfTests.Run();
                Console.WriteLine("Service protocol self-tests passed (schema, caller impersonation, owner authorization, state, ACL, installer configuration, local pipe transport). LocalService lifecycle still needs target-machine testing.");
            }
            finally { try { Directory.Delete(temporary, true); } catch { } }
        }

        private static ValidatedPolicy SamplePolicy(long revision, string domain)
        {
            PolicyRule rule = new PolicyRule { Domain = domain, Action = "allow", Enabled = true, IncludeSubdomains = true };
            return new ValidatedPolicy { Revision = revision, Rules = new List<PolicyRule> { rule }.AsReadOnly(), Sha256 = PolicySnapshotValidator.ComputeChecksum(revision, new List<PolicyRule> { rule }) };
        }

        private static string Request(string operation, object body, string id, int version = 1)
        {
            return new JavaScriptSerializer().Serialize(new Dictionary<string, object>
            {
                { "protocolVersion", version }, { "requestId", id }, { "operation", operation }, { "body", body }
            });
        }

        private static IDictionary<string, object> PolicyBody(ValidatedPolicy policy)
        {
            return new Dictionary<string, object> { { "policy", policy.ToDictionary() } };
        }

        private static void AssertSuccess(string response, string label)
        {
            IDictionary<string, object> value = StrictJsonParser.Parse(response) as IDictionary<string, object>;
            if (value == null || !value.ContainsKey("success") || !Object.Equals(value["success"], true)) throw new InvalidOperationException("Self-test failed: " + label + " (" + response + ")");
        }

        private static void AssertError(string response, string expected, string label)
        {
            IDictionary<string, object> value = StrictJsonParser.Parse(response) as IDictionary<string, object>;
            object error;
            if (value == null || !value.TryGetValue("error", out error) || !String.Equals(error as string, expected, StringComparison.Ordinal))
                throw new InvalidOperationException("Self-test failed: " + label);
        }

        private static void ExpectFormatException(Action action, string label)
        {
            try { action(); }
            catch (FormatException) { return; }
            throw new InvalidOperationException("Self-test failed: " + label);
        }

        private static void TestLocalPipe(ServiceProtocol protocol, string ownerSid)
        {
            List<string> events = new List<string>();
            // Use the production caller SID resolver so RunAsClient reads the connecting
            // process token instead of injecting a test identity.
            SecurePipeServer server = new SecurePipeServer(protocol, delegate { return ownerSid; }, events.Add);
            server.Start();
            try
            {
                using (NamedPipeClientStream client = new NamedPipeClientStream(".", "JLJWebsiteProtection.v1", PipeDirection.InOut,
                    PipeOptions.None, TokenImpersonationLevel.Impersonation))
                {
                    client.Connect(3000);
                    string request = Request("GetCapabilities", new Dictionary<string, object>(), "00000000-0000-4000-8000-000000000030");
                    byte[] bytes = new UTF8Encoding(false).GetBytes(request + "\n");
                    client.Write(bytes, 0, bytes.Length);
                    client.Flush();
                    string response = ReadLine(client);
                    AssertSuccess(response, "local named-pipe request");
                }
                using (NamedPipeClientStream oversized = new NamedPipeClientStream(".", "JLJWebsiteProtection.v1", PipeDirection.InOut, PipeOptions.None))
                {
                    oversized.Connect(3000);
                    byte[] tooLarge = new byte[PolicySnapshotValidator.MaximumMessageBytes + 1];
                    for (int index = 0; index < tooLarge.Length; index++) tooLarge[index] = (byte)' ';
                    try { oversized.Write(tooLarge, 0, tooLarge.Length); oversized.Flush(); }
                    catch (IOException) { /* The server closed an over-limit request. */ }
                    try
                    {
                        int unexpected = oversized.ReadByte();
                        if (unexpected >= 0) throw new InvalidOperationException("Oversized pipe request was not rejected");
                    }
                    catch (IOException) { /* Closed with no response, as required. */ }
                }
            }
            catch (Exception error) { throw new InvalidOperationException("Local pipe self-test failed: " + String.Join(",", events.ToArray()), error); }
            finally { server.Stop(); }
        }

        private static void AssertPipeAcl(PipeSecurity security, string ownerSid)
        {
            if (!security.AreAccessRulesProtected) throw new InvalidOperationException("Named-pipe ACL must not inherit access rules");
            AuthorizationRuleCollection rules = security.GetAccessRules(true, false, typeof(SecurityIdentifier));
            bool ownerCanConnect = false;
            bool usersCanConnect = false;
            HashSet<string> principals = new HashSet<string>(StringComparer.Ordinal);
            foreach (AuthorizationRule item in rules)
            {
                PipeAccessRule rule = item as PipeAccessRule;
                if (rule == null || rule.AccessControlType != AccessControlType.Allow) continue;
                string sid = ((SecurityIdentifier)rule.IdentityReference).Value;
                principals.Add(sid);
                if (sid == ownerSid && (rule.PipeAccessRights & PipeAccessRights.ReadWrite) == PipeAccessRights.ReadWrite) ownerCanConnect = true;
                if (sid == "S-1-5-32-545" && (rule.PipeAccessRights & PipeAccessRights.ReadWrite) == PipeAccessRights.ReadWrite) usersCanConnect = true;
            }
            if (!ownerCanConnect || !usersCanConnect || !principals.Contains("S-1-5-18")
                || principals.Contains("S-1-1-0") || principals.Contains("S-1-5-11"))
                throw new InvalidOperationException("Named-pipe ACL principal or access check failed");
        }

        private static void AssertProtectedDirectoryAcl(DirectorySecurity security)
        {
            if (!security.AreAccessRulesProtected) throw new InvalidOperationException("ProgramData ACL must not inherit access rules");
            HashSet<string> allowed = AllowedFilesystemSids(security.GetAccessRules(true, false, typeof(SecurityIdentifier)));
            AssertFilesystemPrincipals(allowed, "ProgramData directory");
        }

        private static void AssertProtectedFileAcl(FileSecurity security)
        {
            if (!security.AreAccessRulesProtected) throw new InvalidOperationException("Owner SID file ACL must not inherit access rules");
            HashSet<string> allowed = AllowedFilesystemSids(security.GetAccessRules(true, false, typeof(SecurityIdentifier)));
            AssertFilesystemPrincipals(allowed, "Owner SID file");
        }

        private static HashSet<string> AllowedFilesystemSids(AuthorizationRuleCollection rules)
        {
            HashSet<string> allowed = new HashSet<string>(StringComparer.Ordinal);
            foreach (AuthorizationRule item in rules)
            {
                FileSystemAccessRule rule = item as FileSystemAccessRule;
                if (rule != null && rule.AccessControlType == AccessControlType.Allow)
                    allowed.Add(((SecurityIdentifier)rule.IdentityReference).Value);
            }
            return allowed;
        }

        private static void AssertFilesystemPrincipals(HashSet<string> allowed, string label)
        {
            if (!allowed.Contains("S-1-5-18") || !allowed.Contains("S-1-5-19")
                || !allowed.Contains("S-1-5-32-544") || !allowed.Contains(ServiceIdentityConfig.ServiceSid.Value)
                || allowed.Contains("S-1-5-32-545") || allowed.Contains("S-1-1-0") || allowed.Contains("S-1-5-11"))
                throw new InvalidOperationException(label + " ACL principal check failed");
        }

        private static void AssertServiceInstallerConfiguration()
        {
            ProjectInstaller installer = new ProjectInstaller();
            bool localService = false;
            bool automaticStartup = false;
            foreach (Installer item in installer.Installers)
            {
                ServiceProcessInstaller process = item as ServiceProcessInstaller;
                ServiceInstaller service = item as ServiceInstaller;
                if (process != null) localService = process.Account == ServiceAccount.LocalService;
                if (service != null) automaticStartup = service.StartType == ServiceStartMode.Automatic
                    && service.ServiceName == ProtectionService.ServiceNameValue;
            }
            if (!localService || !automaticStartup)
                throw new InvalidOperationException("Service installer identity or startup configuration check failed");
        }

        private static string ReadLine(Stream stream)
        {
            using (MemoryStream buffer = new MemoryStream())
            {
                while (buffer.Length < PolicySnapshotValidator.MaximumMessageBytes)
                {
                    int next = stream.ReadByte();
                    if (next < 0) break;
                    if (next == '\n') return Encoding.UTF8.GetString(buffer.ToArray());
                    buffer.WriteByte((byte)next);
                }
                throw new InvalidDataException("Self-test response was incomplete");
            }
        }
    }
}
