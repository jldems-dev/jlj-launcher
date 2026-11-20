using System;
using System.IO;

namespace JLJ.WebsiteProtection
{
    internal static class ServiceLog
    {
        private static readonly object Gate = new object();
        private static string LogPath
        {
            get
            {
                string programData = Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData);
                return Path.Combine(programData, "JLJGamingHouse", "WebsiteProtection", "service.log");
            }
        }

        // Only fixed event codes and timestamps are written. Request content, domains, paths,
        // caller names, credentials, and exception text are intentionally excluded.
        internal static void Write(string code)
        {
            if (String.IsNullOrEmpty(code) || code.Length > 48) return;
            foreach (char character in code)
                if (!(Char.IsLetterOrDigit(character) || character == '-' || character == '_')) return;
            try
            {
                lock (Gate)
                {
                    string directory = Path.GetDirectoryName(LogPath);
                    // Installation provisions and ACL-protects this directory. Do not create
                    // it from a failure path with inherited/default permissions.
                    if (!Directory.Exists(directory)) return;
                    File.AppendAllText(LogPath, DateTime.UtcNow.ToString("o") + " " + code + Environment.NewLine);
                }
            }
            catch { /* Diagnostics must not prevent the service from remaining available. */ }
        }
    }
}
