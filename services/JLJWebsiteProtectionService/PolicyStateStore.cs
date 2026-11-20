using System;
using System.Collections.Generic;
using System.IO;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using System.Web.Script.Serialization;

namespace JLJ.WebsiteProtection
{
    internal sealed class PolicyStateStore
    {
        private readonly object _gate = new object();
        private readonly string _directory;
        private readonly bool _setAcl;
        private ValidatedPolicy _current;

        internal PolicyStateStore(string directory, bool setAcl)
        {
            _directory = directory;
            _setAcl = setAcl;
        }

        internal string StatePath { get { return Path.Combine(_directory, "last-known-good.json"); } }

        internal void Initialize()
        {
            lock (_gate)
            {
                EnsureDirectory();
                if (!File.Exists(StatePath)) return;
                string json = File.ReadAllText(StatePath, Encoding.UTF8);
                IDictionary<string, object> envelope = StrictJsonParser.Parse(json) as IDictionary<string, object>;
                if (envelope == null || envelope.Count != 1 || !envelope.ContainsKey("snapshot")) throw new FormatException("Invalid protected policy state");
                _current = PolicySnapshotValidator.Validate(envelope["snapshot"]);
            }
        }

        internal ValidatedPolicy Current
        {
            get { lock (_gate) return _current; }
        }

        internal long CurrentRevision
        {
            get { lock (_gate) return _current == null ? -1 : _current.Revision; }
        }

        internal string CurrentHash
        {
            get { lock (_gate) return _current == null ? null : _current.Sha256; }
        }

        internal bool CanApply(ValidatedPolicy policy)
        {
            lock (_gate)
            {
                if (_current == null || policy.Revision > _current.Revision) return true;
                return policy.Revision == _current.Revision && String.Equals(policy.Sha256, _current.Sha256, StringComparison.Ordinal);
            }
        }

        // Returns true only when a new revision was committed. Exact duplicate delivery is idempotent.
        internal bool Apply(ValidatedPolicy policy)
        {
            lock (_gate)
            {
                if (_current != null && policy.Revision < _current.Revision) throw new InvalidOperationException("STALE_REVISION");
                if (_current != null && policy.Revision == _current.Revision)
                {
                    if (String.Equals(policy.Sha256, _current.Sha256, StringComparison.Ordinal)) return false;
                    throw new InvalidOperationException("STALE_REVISION");
                }
                WriteAtomically(policy);
                _current = policy;
                return true;
            }
        }

        internal ValidatedPolicy RestoreLastKnownGood()
        {
            lock (_gate)
            {
                if (!File.Exists(StatePath)) throw new InvalidOperationException("NO_LAST_KNOWN_GOOD");
                IDictionary<string, object> envelope = StrictJsonParser.Parse(File.ReadAllText(StatePath, Encoding.UTF8)) as IDictionary<string, object>;
                if (envelope == null || envelope.Count != 1 || !envelope.ContainsKey("snapshot")) throw new FormatException("Invalid protected policy state");
                ValidatedPolicy restored = PolicySnapshotValidator.Validate(envelope["snapshot"]);
                if (_current != null && restored.Revision < _current.Revision) throw new InvalidOperationException("STALE_REVISION");
                _current = restored;
                return restored;
            }
        }

        private void EnsureDirectory()
        {
            Directory.CreateDirectory(_directory);
            DirectoryInfo directory = new DirectoryInfo(_directory);
            if ((directory.Attributes & FileAttributes.ReparsePoint) != 0) throw new IOException("Protected service directory cannot be a reparse point");
            if (!_setAcl) return;

            DirectorySecurity security = new DirectorySecurity();
            security.SetAccessRuleProtection(true, false);
            SecurityIdentifier system = new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null);
            SecurityIdentifier localService = new SecurityIdentifier(WellKnownSidType.LocalServiceSid, null);
            SecurityIdentifier administrators = new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid, null);
            FileSystemRights rights = FileSystemRights.FullControl;
            InheritanceFlags inheritance = InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit;
            security.AddAccessRule(new FileSystemAccessRule(system, rights, inheritance, PropagationFlags.None, AccessControlType.Allow));
            security.AddAccessRule(new FileSystemAccessRule(localService, rights, inheritance, PropagationFlags.None, AccessControlType.Allow));
            security.AddAccessRule(new FileSystemAccessRule(administrators, rights, inheritance, PropagationFlags.None, AccessControlType.Allow));
            security.AddAccessRule(new FileSystemAccessRule(ServiceIdentityConfig.ServiceSid, rights, inheritance, PropagationFlags.None, AccessControlType.Allow));
            directory.SetAccessControl(security);
        }

        private void WriteAtomically(ValidatedPolicy policy)
        {
            EnsureDirectory();
            string temporary = StatePath + "." + Guid.NewGuid().ToString("N") + ".tmp";
            string json = new JavaScriptSerializer().Serialize(new Dictionary<string, object> { { "snapshot", policy.ToDictionary() } });
            byte[] bytes = new UTF8Encoding(false).GetBytes(json);
            if (bytes.Length > PolicySnapshotValidator.MaximumMessageBytes) throw new InvalidOperationException("MESSAGE_TOO_LARGE");
            try
            {
                using (FileStream output = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None, 4096, FileOptions.WriteThrough))
                {
                    output.Write(bytes, 0, bytes.Length);
                    output.Flush(true);
                }
                if (File.Exists(StatePath)) File.Replace(temporary, StatePath, null, true);
                else File.Move(temporary, StatePath);
            }
            finally
            {
                if (File.Exists(temporary)) File.Delete(temporary);
            }
        }
    }
}
