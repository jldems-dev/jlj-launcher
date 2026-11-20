using System;
using System.Collections.Generic;
using System.Security.Cryptography;

namespace JLJ.WebsiteProtection
{
    internal sealed class DnsResponseCache
    {
        private sealed class Entry
        {
            internal byte[] Response;
            internal int[] TtlOffsets;
            internal uint[] TtlValues;
            internal long StoredAtTicks;
            internal long ExpiresAtTicks;
            internal LinkedListNode<string> Node;
        }

        private readonly object _gate = new object();
        private readonly int _maximumEntries;
        private readonly uint _maximumTtlSeconds;
        private readonly Func<long> _utcTicks;
        private readonly Dictionary<string, Entry> _entries = new Dictionary<string, Entry>(StringComparer.Ordinal);
        private readonly LinkedList<string> _lru = new LinkedList<string>();

        internal DnsResponseCache(int maximumEntries = 512, uint maximumTtlSeconds = 300, Func<long> utcTicks = null)
        {
            if (maximumEntries < 1 || maximumEntries > 4096) throw new ArgumentOutOfRangeException("maximumEntries");
            if (maximumTtlSeconds < 1 || maximumTtlSeconds > 86400) throw new ArgumentOutOfRangeException("maximumTtlSeconds");
            _maximumEntries = maximumEntries;
            _maximumTtlSeconds = maximumTtlSeconds;
            _utcTicks = utcTicks ?? (() => DateTime.UtcNow.Ticks);
        }

        internal int Count { get { lock (_gate) return _entries.Count; } }

        internal bool TryGet(byte[] query, long policyRevision, out byte[] response)
        {
            response = null;
            if (!IsCacheableQuery(query)) return false;
            string key = CacheKey(query, policyRevision);
            lock (_gate)
            {
                Entry entry;
                if (!_entries.TryGetValue(key, out entry)) return false;
                long now = _utcTicks();
                if (now >= entry.ExpiresAtTicks)
                {
                    Remove(key, entry);
                    return false;
                }
                uint elapsed = (uint)Math.Max(0, (now - entry.StoredAtTicks) / TimeSpan.TicksPerSecond);
                response = (byte[])entry.Response.Clone();
                response[0] = query[0];
                response[1] = query[1];
                for (int index = 0; index < entry.TtlOffsets.Length; index++)
                {
                    uint ttl = entry.TtlValues[index] > elapsed ? entry.TtlValues[index] - elapsed : 0;
                    DnsPacketCodec.WriteUInt32(response, entry.TtlOffsets[index], ttl);
                }
                _lru.Remove(entry.Node);
                entry.Node = _lru.AddLast(key);
                return true;
            }
        }

        internal void Store(byte[] query, byte[] response, DnsResponseMetadata metadata, long policyRevision)
        {
            if (!IsCacheableQuery(query) || response == null || metadata == null || metadata.MinimumTtl == 0
                || metadata.IsTruncated || metadata.HasOptRecord) return;
            ushort flags = response.Length >= 4 ? DnsPacketCodec.ReadUInt16(response, 2) : (ushort)0;
            int responseCode = flags & 0x000f;
            // Cache only positive NOERROR responses. Negative caching needs SOA-derived
            // minimum TTL handling; do not infer it from arbitrary authority records.
            if (responseCode != 0) return;
            uint ttlCap = Math.Min(metadata.MinimumTtl, _maximumTtlSeconds);
            if (ttlCap == 0) return;

            byte[] stored = (byte[])response.Clone();
            uint[] values = (uint[])metadata.TtlValues.Clone();
            for (int index = 0; index < metadata.TtlOffsets.Length; index++)
            {
                values[index] = Math.Min(values[index], _maximumTtlSeconds);
                DnsPacketCodec.WriteUInt32(stored, metadata.TtlOffsets[index], values[index]);
            }
            string key = CacheKey(query, policyRevision);
            long now = _utcTicks();
            Entry entry = new Entry
            {
                Response = stored,
                TtlOffsets = (int[])metadata.TtlOffsets.Clone(),
                TtlValues = values,
                StoredAtTicks = now,
                ExpiresAtTicks = now + (long)ttlCap * TimeSpan.TicksPerSecond
            };

            lock (_gate)
            {
                Entry existing;
                if (_entries.TryGetValue(key, out existing)) Remove(key, existing);
                entry.Node = _lru.AddLast(key);
                _entries.Add(key, entry);
                while (_entries.Count > _maximumEntries)
                {
                    string oldest = _lru.First.Value;
                    Remove(oldest, _entries[oldest]);
                }
            }
        }

        internal void Clear()
        {
            lock (_gate) { _entries.Clear(); _lru.Clear(); }
        }

        private void Remove(string key, Entry entry)
        {
            _entries.Remove(key);
            _lru.Remove(entry.Node);
        }

        private static string CacheKey(byte[] query, long policyRevision)
        {
            using (SHA256 sha = SHA256.Create())
            {
                byte[] keyData = new byte[8 + query.Length - 2];
                for (int index = 0; index < 8; index++) keyData[index] = (byte)(policyRevision >> (56 - index * 8));
                Buffer.BlockCopy(query, 2, keyData, 8, query.Length - 2);
                byte[] hash = sha.ComputeHash(keyData);
                return BitConverter.ToString(hash).Replace("-", "");
            }
        }

        private static bool IsCacheableQuery(byte[] query)
        {
            // EDNS options may carry client-specific data such as DNS Cookies or ECS.
            // Do not reuse a response across requests when the query contains an OPT record.
            return query != null && query.Length >= DnsPacketCodec.HeaderLength
                && DnsPacketCodec.ReadUInt16(query, 10) == 0;
        }
    }
}
