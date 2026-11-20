using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Globalization;

namespace JLJ.WebsiteProtection
{
    internal sealed class PolicyRule
    {
        internal string Domain;
        internal string Action;
        internal bool Enabled;
        internal bool IncludeSubdomains;
    }

    internal sealed class ValidatedPolicy
    {
        internal long Revision;
        internal string Sha256;
        internal IList<PolicyRule> Rules;
        internal IDictionary<string, object> ToDictionary()
        {
            List<object> rules = new List<object>();
            foreach (PolicyRule rule in Rules)
            {
                rules.Add(new Dictionary<string, object>
                {
                    { "domain", rule.Domain }, { "action", rule.Action },
                    { "enabled", rule.Enabled }, { "includeSubdomains", rule.IncludeSubdomains }
                });
            }
            return new Dictionary<string, object>
            {
                { "protocolVersion", (long)1 }, { "policyRevision", Revision }, { "defaultAction", "deny" },
                { "rules", rules }, { "sha256", Sha256 }
            };
        }
    }

    internal static class PolicySnapshotValidator
    {
        internal const int ProtocolVersion = 1;
        internal const int MaximumRules = 5000;
        internal const int MaximumMessageBytes = 1024 * 1024;
        private static readonly string[] SnapshotFields = { "protocolVersion", "policyRevision", "defaultAction", "rules", "sha256" };
        private static readonly string[] RuleFields = { "domain", "action", "enabled", "includeSubdomains" };
        private static readonly Regex LabelPattern = new Regex("^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$", RegexOptions.CultureInvariant);

        internal static ValidatedPolicy Validate(object value)
        {
            IDictionary<string, object> snapshot = RequireObject(value);
            RequireExactFields(snapshot, SnapshotFields);
            if (RequireInteger(snapshot, "protocolVersion") != ProtocolVersion) throw new FormatException("Unsupported policy protocol");
            long revision = RequireInteger(snapshot, "policyRevision");
            if (revision < 0 || revision > 9007199254740991L) throw new FormatException("Invalid policy revision");
            if (!String.Equals(RequireString(snapshot, "defaultAction"), "deny", StringComparison.Ordinal)) throw new FormatException("Policy must be whitelist-only");
            string checksum = RequireString(snapshot, "sha256");
            if (!Regex.IsMatch(checksum, "^[a-f0-9]{64}$", RegexOptions.CultureInvariant)) throw new FormatException("Invalid policy checksum");

            object rawRules;
            if (!snapshot.TryGetValue("rules", out rawRules)) throw new FormatException("Missing policy rules");
            IList<object> values = rawRules as IList<object>;
            if (values == null || values.Count > MaximumRules) throw new FormatException("Invalid policy rules");
            List<PolicyRule> rules = new List<PolicyRule>();
            HashSet<string> uniqueDomains = new HashSet<string>(StringComparer.Ordinal);
            foreach (object rawRule in values)
            {
                IDictionary<string, object> rule = RequireObject(rawRule);
                RequireExactFields(rule, RuleFields);
                string domain = RequireString(rule, "domain");
                if (!String.Equals(domain, CanonicalDomain(domain), StringComparison.Ordinal)) throw new FormatException("Policy domain is not canonical");
                string action = RequireString(rule, "action");
                if (action != "allow" && action != "block") throw new FormatException("Invalid policy action");
                bool enabled = RequireBoolean(rule, "enabled");
                bool subdomains = RequireBoolean(rule, "includeSubdomains");
                if (!uniqueDomains.Add(domain)) throw new FormatException("Duplicate policy domain");
                rules.Add(new PolicyRule { Domain = domain, Action = action, Enabled = enabled, IncludeSubdomains = subdomains });
            }
            rules.Sort(delegate(PolicyRule left, PolicyRule right) { return String.CompareOrdinal(left.Domain, right.Domain); });
            string calculated = ComputeChecksum(revision, rules);
            if (!FixedTimeEquals(checksum, calculated)) throw new FormatException("Policy checksum mismatch");
            return new ValidatedPolicy { Revision = revision, Sha256 = checksum, Rules = rules.AsReadOnly() };
        }

        internal static string ComputeChecksum(long revision, IList<PolicyRule> rules)
        {
            StringBuilder canonical = new StringBuilder();
            canonical.Append("{\"protocolVersion\":1,\"policyRevision\":");
            canonical.Append(revision.ToString(CultureInfo.InvariantCulture));
            canonical.Append(",\"defaultAction\":\"deny\",\"rules\":[");
            for (int index = 0; index < rules.Count; index++)
            {
                if (index > 0) canonical.Append(',');
                PolicyRule rule = rules[index];
                canonical.Append("{\"domain\":\"").Append(rule.Domain).Append("\",\"action\":\"").Append(rule.Action)
                    .Append("\",\"enabled\":").Append(rule.Enabled ? "true" : "false")
                    .Append(",\"includeSubdomains\":").Append(rule.IncludeSubdomains ? "true" : "false").Append('}');
            }
            canonical.Append("]}");
            using (SHA256 sha = SHA256.Create())
            {
                byte[] bytes = sha.ComputeHash(Encoding.UTF8.GetBytes(canonical.ToString()));
                StringBuilder hex = new StringBuilder(bytes.Length * 2);
                foreach (byte item in bytes) hex.Append(item.ToString("x2", CultureInfo.InvariantCulture));
                return hex.ToString();
            }
        }

        internal static string CanonicalDomain(string input)
        {
            if (String.IsNullOrEmpty(input) || input.Length > 253 || input != input.ToLowerInvariant() || input.EndsWith(".", StringComparison.Ordinal))
                throw new FormatException("Invalid canonical domain");
            IPAddress parsedAddress;
            if (IPAddress.TryParse(input, out parsedAddress)) throw new FormatException("IP addresses are not policy domains");
            string[] labels = input.Split('.');
            if (labels.Length < 2) throw new FormatException("Domain must be fully qualified");
            IdnMapping idn = new IdnMapping();
            foreach (string label in labels)
            {
                if (label.Length < 1 || label.Length > 63 || !LabelPattern.IsMatch(label)) throw new FormatException("Invalid domain label");
                if (label.StartsWith("xn--", StringComparison.Ordinal))
                {
                    try
                    {
                        string unicode = idn.GetUnicode(label);
                        if (!String.Equals(idn.GetAscii(unicode).ToLowerInvariant(), label, StringComparison.Ordinal)) throw new FormatException("Noncanonical IDN label");
                    }
                    catch (ArgumentException) { throw new FormatException("Invalid IDN label"); }
                }
            }
            return input;
        }

        private static bool FixedTimeEquals(string left, string right)
        {
            if (left.Length != right.Length) return false;
            int difference = 0;
            for (int index = 0; index < left.Length; index++) difference |= left[index] ^ right[index];
            return difference == 0;
        }

        private static IDictionary<string, object> RequireObject(object value)
        {
            IDictionary<string, object> result = value as IDictionary<string, object>;
            if (result == null) throw new FormatException("Expected JSON object");
            return result;
        }

        private static void RequireExactFields(IDictionary<string, object> value, IEnumerable<string> fields)
        {
            HashSet<string> expected = new HashSet<string>(fields, StringComparer.Ordinal);
            if (value.Count != expected.Count || value.Keys.Any(key => !expected.Contains(key))) throw new FormatException("Unexpected or missing JSON fields");
        }

        private static long RequireInteger(IDictionary<string, object> value, string key)
        {
            object item;
            if (!value.TryGetValue(key, out item) || !(item is long)) throw new FormatException("Expected integer field");
            return (long)item;
        }

        private static string RequireString(IDictionary<string, object> value, string key)
        {
            object item;
            if (!value.TryGetValue(key, out item) || !(item is string)) throw new FormatException("Expected string field");
            return (string)item;
        }

        private static bool RequireBoolean(IDictionary<string, object> value, string key)
        {
            object item;
            if (!value.TryGetValue(key, out item) || !(item is bool)) throw new FormatException("Expected boolean field");
            return (bool)item;
        }
    }
}
