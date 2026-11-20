using System;
using System.IO;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Security.Cryptography;
using System.Text;

namespace JLJ.WebsiteProtection
{
    internal static class ServiceIdentityConfig
    {
        internal static SecurityIdentifier ServiceSid
        {
            get
            {
                byte[] name = Encoding.Unicode.GetBytes(ProtectionService.ServiceNameValue.ToUpperInvariant());
                byte[] digest;
                using (SHA1 sha = SHA1.Create()) digest = sha.ComputeHash(name);
                uint[] parts = new uint[5];
                for (int index = 0; index < parts.Length; index++) parts[index] = BitConverter.ToUInt32(digest, index * 4);
                return new SecurityIdentifier("S-1-5-80-" + String.Join("-", Array.ConvertAll(parts, part => part.ToString(System.Globalization.CultureInfo.InvariantCulture))));
            }
        }

        internal static string StateDirectory
        {
            get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "JLJGamingHouse", "WebsiteProtection"); }
        }

        internal static void ProvisionOwnerSid(string ownerSidText)
        {
            SecurityIdentifier owner = new SecurityIdentifier(ownerSidText);
            Directory.CreateDirectory(StateDirectory);
            DirectoryInfo directory = new DirectoryInfo(StateDirectory);
            if ((directory.Attributes & FileAttributes.ReparsePoint) != 0) throw new IOException("Service state path cannot be a reparse point");
            DirectorySecurity directorySecurity = CreateDirectorySecurity();
            directory.SetAccessControl(directorySecurity);

            string target = Path.Combine(StateDirectory, "owner.sid");
            string temporary = target + "." + Guid.NewGuid().ToString("N") + ".tmp";
            try
            {
                using (FileStream output = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None, 256, FileOptions.WriteThrough))
                {
                    byte[] bytes = new UTF8Encoding(false).GetBytes(owner.Value + Environment.NewLine);
                    output.Write(bytes, 0, bytes.Length);
                    output.Flush(true);
                }
                FileSecurity fileSecurity = CreateFileSecurity();
                File.SetAccessControl(temporary, fileSecurity);
                if (File.Exists(target)) File.Replace(temporary, target, null, true);
                else File.Move(temporary, target);
            }
            finally { if (File.Exists(temporary)) File.Delete(temporary); }
        }

        internal static DirectorySecurity CreateDirectorySecurity()
        {
            DirectorySecurity security = new DirectorySecurity();
            security.SetAccessRuleProtection(true, false);
            FileSystemRights rights = FileSystemRights.FullControl;
            InheritanceFlags inheritance = InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit;
            security.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null), rights, inheritance, PropagationFlags.None, AccessControlType.Allow));
            security.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(WellKnownSidType.LocalServiceSid, null), rights, inheritance, PropagationFlags.None, AccessControlType.Allow));
            security.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid, null), rights, inheritance, PropagationFlags.None, AccessControlType.Allow));
            security.AddAccessRule(new FileSystemAccessRule(ServiceSid, rights, inheritance, PropagationFlags.None, AccessControlType.Allow));
            return security;
        }

        internal static FileSecurity CreateFileSecurity()
        {
            FileSecurity security = new FileSecurity();
            security.SetAccessRuleProtection(true, false);
            FileSystemRights rights = FileSystemRights.FullControl;
            security.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null), rights, AccessControlType.Allow));
            security.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(WellKnownSidType.LocalServiceSid, null), rights, AccessControlType.Allow));
            security.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid, null), rights, AccessControlType.Allow));
            security.AddAccessRule(new FileSystemAccessRule(ServiceSid, rights, AccessControlType.Allow));
            return security;
        }
    }
}
