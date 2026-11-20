using System;
using System.Collections.Generic;

namespace JLJ.WebsiteProtection
{
    internal sealed class DnsPolicyDecision
    {
        internal bool Allowed;
        internal string Reason;
        internal string MatchedDomain;
        internal long PolicyRevision;
    }

    internal static class DnsPolicyEvaluator
    {
        internal static DnsPolicyDecision Evaluate(string domain, ValidatedPolicy policy)
        {
            if (policy == null) throw new ArgumentNullException("policy");
            string canonical;
            try { canonical = PolicySnapshotValidator.CanonicalDomain(domain); }
            catch (FormatException)
            {
                return new DnsPolicyDecision { Allowed = false, Reason = "invalid-domain", PolicyRevision = policy.Revision };
            }

            List<PolicyRule> matches = new List<PolicyRule>();
            foreach (PolicyRule rule in policy.Rules)
            {
                if (!rule.Enabled) continue;
                if (String.Equals(canonical, rule.Domain, StringComparison.Ordinal)
                    || (rule.IncludeSubdomains && canonical.EndsWith("." + rule.Domain, StringComparison.Ordinal)))
                    matches.Add(rule);
            }

            PolicyRule winner = MostSpecific(matches, "block");
            if (winner != null)
                return new DnsPolicyDecision { Allowed = false, Reason = "blocked-by-rule", MatchedDomain = winner.Domain, PolicyRevision = policy.Revision };
            winner = MostSpecific(matches, "allow");
            if (winner != null)
                return new DnsPolicyDecision { Allowed = true, Reason = "allowed-by-rule", MatchedDomain = winner.Domain, PolicyRevision = policy.Revision };
            return new DnsPolicyDecision { Allowed = false, Reason = "default-deny", PolicyRevision = policy.Revision };
        }

        private static PolicyRule MostSpecific(List<PolicyRule> rules, string action)
        {
            PolicyRule winner = null;
            foreach (PolicyRule rule in rules)
            {
                if (!String.Equals(rule.Action, action, StringComparison.Ordinal)) continue;
                if (winner == null || LabelCount(rule.Domain) > LabelCount(winner.Domain)) winner = rule;
            }
            return winner;
        }

        private static int LabelCount(string domain)
        {
            int count = 1;
            foreach (char character in domain) if (character == '.') count++;
            return count;
        }
    }
}
