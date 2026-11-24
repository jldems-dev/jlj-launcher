using System;
using System.Runtime.InteropServices;
using Microsoft.Win32;
using Microsoft.Win32.SafeHandles;

public static class DriveAccessPolicy
{
    private const string Explorer = @"Software\Microsoft\Windows\CurrentVersion\Policies\Explorer";
    private const string Value = "NoViewOnDrive";
    private const string RollbackValue = "Rollback";
    private const string DeleteValue = "**Del.NoViewOnDrive";
    private static readonly Guid GroupPolicyClass = new Guid("EA502722-A23D-11D1-A7D3-0000F87571E3");

    [ComImport, Guid("7E37D5E7-263D-45CF-842B-96A95C63E46C"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IGroupPolicyObject2
    {
        // Preserve the native slot order for inherited IGroupPolicyObject methods.
        void New();
        void OpenDSGPO();
        void OpenLocalMachineGPO();
        void OpenRemoteMachineGPO();
        void Save(int machine, int add, ref Guid extension, ref Guid snapIn);
        void Delete();
        void GetName();
        void GetDisplayName();
        void SetDisplayName();
        void GetPath();
        void GetDSPath();
        void GetFileSysPath();
        void GetRegistryKey(uint section, out IntPtr key);
        void GetOptions();
        void SetOptions();
        void GetGpoType();
        void GetMachineName();
        void GetPropertySheetPages();
        void OpenLocalMachineGPOForPrincipal([MarshalAs(UnmanagedType.LPWStr)] string sid, uint flags);
        void GetRegistryKeyPath();
    }

    public sealed class State
    {
        public string configured { get; set; }
        public int? configuredMask { get; set; }
        public int? effectiveMask { get; set; }
        public int? savedMask { get; set; }
        public bool canRollback { get; set; }
        public bool verified { get; set; }
        internal string[] Snapshot;
    }

    private static string EncodeMask(int? mask)
    {
        return mask.HasValue ? mask.Value.ToString(System.Globalization.CultureInfo.InvariantCulture) : "";
    }

    private static int? DecodeMask(string text)
    {
        if (text.Length == 0) return null;
        int mask;
        if (!int.TryParse(text, out mask) || mask < 0 || mask > 0x03ffffff)
            throw new InvalidOperationException("The drive policy backup contains an invalid mask.");
        return mask;
    }

    private static bool Matches(State state, string configured, int? mask)
    {
        return state.configured == configured && state.configuredMask == mask;
    }

    private static void SaveMask(RegistryKey key, int? mask)
    {
        if (mask.HasValue)
            key.SetValue(Value, mask.Value, RegistryValueKind.DWord);
        else
            key.DeleteValue(Value, false);
    }

    private static int? ReadMask(RegistryKey key, string name)
    {
        object value = key == null ? null : key.GetValue(name);
        if (value == null) return null;
        if (key.GetValueKind(name) != RegistryValueKind.DWord || !(value is int) ||
            (int)value < 0 || (int)value > 0x03ffffff)
            throw new InvalidOperationException(name + " has an invalid drive mask.");
        return (int)value;
    }

    private static State Inspect(RegistryKey root, string sid)
    {
        var state = new State();
        using (var policy = root.OpenSubKey(Explorer))
        {
            state.configuredMask = ReadMask(policy, Value);
            bool disabled = policy != null && policy.GetValue(DeleteValue) != null;
            if (disabled && state.configuredMask.HasValue)
                throw new InvalidOperationException("The current user Local Group Policy contains conflicting drive settings.");
            state.configured = disabled ? "disabled" : state.configuredMask.HasValue ? "enabled" : "unconfigured";
        }
        using (var effective = Registry.CurrentUser.OpenSubKey(Explorer))
            state.effectiveMask = ReadMask(effective, Value);
        using (var saved = Registry.LocalMachine.OpenSubKey(SavedKey(sid)))
        {
            state.savedMask = ReadMask(saved, Value);
            string snapshot = saved == null ? null : saved.GetValue(RollbackValue) as string;
            if (snapshot != null)
            {
                state.Snapshot = snapshot.Split('|');
                // The previous customer-based version did not capture a live HKCU value.
                if (state.Snapshot.Length == 7)
                    state.canRollback = Matches(state, state.Snapshot[3], DecodeMask(state.Snapshot[4])) &&
                        (state.effectiveMask == DecodeMask(state.Snapshot[5]) ||
                         state.effectiveMask == DecodeMask(state.Snapshot[6]));
            }
        }
        return state;
    }

    private static string SavedKey(string sid)
    {
        return @"SOFTWARE\JLJLauncher\DriveAccess\" + sid;
    }

    private static int ResolveEnableMask(State before, int? initialMask)
    {
        int? existing = before.configured == "disabled"
            ? before.savedMask ?? before.effectiveMask
            : before.effectiveMask ?? before.savedMask;
        int? mask = before.configuredMask ?? existing ?? initialMask;
        if (!mask.HasValue)
            throw new InvalidOperationException("No drive selection is available. Select drives before enabling the policy.");
        return mask.Value;
    }

    public static State Run(string sid, string action, int? initialMask)
    {
        string desired = null;
        int? mask = null;
        int? savedMask = null;
        int? effectiveMask = null;
        var gpo = (IGroupPolicyObject2)Activator.CreateInstance(Type.GetTypeFromCLSID(GroupPolicyClass, true));
        try
        {
            bool readOnly = action == "status";
            gpo.OpenLocalMachineGPOForPrincipal(sid, readOnly ? 3u : 1u);
            IntPtr handle;
            gpo.GetRegistryKey(1, out handle);
            using (var root = RegistryKey.FromHandle(new SafeRegistryHandle(handle, true)))
            {
                var before = Inspect(root, sid);
                if (readOnly) return before;

                if (action == "rollback")
                {
                    if (!before.canRollback)
                        throw new InvalidOperationException("The current policy differs from the last JLJ change or there is no backup.");
                    desired = before.Snapshot[0];
                    mask = DecodeMask(before.Snapshot[1]);
                    savedMask = DecodeMask(before.Snapshot[2]);
                    effectiveMask = DecodeMask(before.Snapshot[5]);
                }
                else
                {
                    desired = action == "enable" ? "enabled" : "disabled";
                    mask = action == "enable" ? (int?)ResolveEnableMask(before, initialMask) : null;
                    effectiveMask = mask;
                    if (Matches(before, desired, mask) && before.effectiveMask == effectiveMask)
                    {
                        before.verified = true;
                        return before;
                    }
                    savedMask = action == "disable" ? before.configuredMask ?? before.effectiveMask ?? before.savedMask : before.savedMask;
                    using (var saved = Registry.LocalMachine.CreateSubKey(SavedKey(sid)))
                    {
                        string snapshot = string.Join("|", before.configured, EncodeMask(before.configuredMask),
                            EncodeMask(before.savedMask), desired, EncodeMask(mask),
                            EncodeMask(before.effectiveMask), EncodeMask(effectiveMask));
                        saved.SetValue(RollbackValue, snapshot, RegistryValueKind.String);
                        // Preserve the selection even if Windows saves the policy and the launcher exits.
                        SaveMask(saved, savedMask);
                    }
                }

                using (var policy = root.CreateSubKey(Explorer))
                {
                    if (desired == "enabled")
                        policy.SetValue(Value, mask.Value, RegistryValueKind.DWord);
                    else
                        policy.DeleteValue(Value, false);
                    if (desired == "disabled")
                        policy.SetValue(DeleteValue, " ", RegistryValueKind.String);
                    else
                        policy.DeleteValue(DeleteValue, false);
                }
                var extension = new Guid("35378EAC-683F-11D2-A89A-00C04FBBCFA2");
                var snapIn = new Guid("0F6B957E-509E-11D1-A7CC-0000F87571E3");
                gpo.Save(0, 1, ref extension, ref snapIn);
            }
        }
        finally
        {
            Marshal.FinalReleaseComObject(gpo);
        }
        // Check the GPO before updating HKCU, then reread the live value.
        var savedPolicy = Run(sid, "status", null);
        if (!Matches(savedPolicy, desired, mask))
            throw new InvalidOperationException("Windows did not save the requested drive policy. Refresh status before retrying.");
        using (var effective = Registry.CurrentUser.CreateSubKey(Explorer))
            SaveMask(effective, effectiveMask);
        var verified = Run(sid, "status", null);
        if (!Matches(verified, desired, mask) || verified.effectiveMask != effectiveMask)
            throw new InvalidOperationException("Windows did not confirm the requested live registry value. Refresh status before retrying.");
        verified.verified = true;
        if (action == "rollback")
        {
            using (var saved = Registry.LocalMachine.CreateSubKey(SavedKey(sid)))
            {
                SaveMask(saved, savedMask);
                saved.DeleteValue(RollbackValue, false);
            }
            verified.savedMask = savedMask;
            verified.canRollback = false;
        }
        return verified;
    }
}
