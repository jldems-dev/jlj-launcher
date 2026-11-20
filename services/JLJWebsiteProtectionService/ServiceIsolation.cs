using System;
using System.ComponentModel;
using System.Runtime.InteropServices;

namespace JLJ.WebsiteProtection
{
    internal static class ServiceIsolation
    {
        private const uint ScManagerConnect = 0x0001;
        private const uint ServiceChangeConfig = 0x0002;
        private const uint ServiceSidTypeInfo = 5;
        private const uint ServiceSidTypeRestricted = 3;

        [StructLayout(LayoutKind.Sequential)]
        private struct ServiceSidInfo { internal uint ServiceSidType; }

        [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern IntPtr OpenSCManager(string machineName, string databaseName, uint desiredAccess);
        [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern IntPtr OpenService(IntPtr manager, string serviceName, uint desiredAccess);
        [DllImport("advapi32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool ChangeServiceConfig2(IntPtr service, uint infoLevel, ref ServiceSidInfo info);
        [DllImport("advapi32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool CloseServiceHandle(IntPtr handle);

        internal static void EnableRestrictedServiceSid(string serviceName)
        {
            IntPtr manager = OpenSCManager(null, null, ScManagerConnect);
            if (manager == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
            try
            {
                IntPtr service = OpenService(manager, serviceName, ServiceChangeConfig);
                if (service == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
                try
                {
                    ServiceSidInfo info = new ServiceSidInfo { ServiceSidType = ServiceSidTypeRestricted };
                    if (!ChangeServiceConfig2(service, ServiceSidTypeInfo, ref info)) throw new Win32Exception(Marshal.GetLastWin32Error());
                }
                finally { CloseServiceHandle(service); }
            }
            finally { CloseServiceHandle(manager); }
        }
    }
}
