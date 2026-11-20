using System;
using System.Collections.Generic;
using System.Text;

namespace JLJ.WebsiteProtection
{
    internal enum DnsResponseCode
    {
        NoError = 0,
        FormatError = 1,
        ServerFailure = 2,
        Refused = 5
    }

    internal sealed class DnsQuestion
    {
        internal byte[] Request;
        internal ushort Id;
        internal ushort Flags;
        internal ushort Type;
        internal ushort Class;
        internal string Domain;
        internal int QuestionEnd;
        internal bool IsCanonicalDomain;
    }

    internal sealed class DnsResponseMetadata
    {
        internal int[] TtlOffsets;
        internal uint[] TtlValues;
        internal uint MinimumTtl;
        internal bool IsTruncated;
        internal bool HasOptRecord;
    }

    internal static class DnsPacketCodec
    {
        internal const int HeaderLength = 12;
        internal const int MaximumPacketBytes = 4096;
        private const int MaximumResourceRecords = 256;

        internal static bool TryParseQuery(byte[] packet, out DnsQuestion question)
        {
            question = null;
            if (packet == null || packet.Length < HeaderLength || packet.Length > MaximumPacketBytes) return false;
            ushort flags = ReadUInt16(packet, 2);
            if ((flags & 0x8000) != 0 || (flags & 0x7800) != 0 || (flags & 0x06ef) != 0) return false;
            if (ReadUInt16(packet, 4) != 1 || ReadUInt16(packet, 6) != 0 || ReadUInt16(packet, 8) != 0) return false;
            ushort additionalCount = ReadUInt16(packet, 10);
            if (additionalCount > 1) return false;

            int offset = HeaderLength;
            string name;
            if (!TryReadName(packet, ref offset, false, out name)) return false;
            if (offset + 4 > packet.Length) return false;
            ushort type = ReadUInt16(packet, offset);
            ushort qclass = ReadUInt16(packet, offset + 2);
            offset += 4;
            int questionEnd = offset;
            if (additionalCount == 1 && !TryReadOpt(packet, ref offset)) return false;
            if (offset != packet.Length) return false;

            bool canonical = false;
            try
            {
                if (String.IsNullOrEmpty(name)) throw new FormatException();
                string validated = PolicySnapshotValidator.CanonicalDomain(name);
                canonical = String.Equals(validated, name, StringComparison.Ordinal);
            }
            catch (FormatException) { }

            question = new DnsQuestion
            {
                Request = packet,
                Id = ReadUInt16(packet, 0),
                Flags = flags,
                Type = type,
                Class = qclass,
                Domain = name,
                QuestionEnd = questionEnd,
                IsCanonicalDomain = canonical
            };
            return true;
        }

        internal static byte[] CreateError(byte[] request, DnsResponseCode code)
        {
            if (request == null || request.Length < 2) return new byte[0];
            byte[] response = new byte[HeaderLength];
            response[0] = request[0]; response[1] = request[1];
            ushort requestFlags = request.Length >= 4 ? ReadUInt16(request, 2) : (ushort)0;
            ushort flags = (ushort)(0x8000 | (requestFlags & 0x7800) | (requestFlags & 0x0100) | (ushort)code);
            WriteUInt16(response, 2, flags);
            return response;
        }

        internal static byte[] CreateQuestionResponse(DnsQuestion question, DnsResponseCode code)
        {
            byte[] response = new byte[question.QuestionEnd];
            Buffer.BlockCopy(question.Request, 0, response, 0, response.Length);
            ushort flags = (ushort)(0x8000 | (question.Flags & 0x7900) | (ushort)code);
            WriteUInt16(response, 2, flags);
            WriteUInt16(response, 6, 0);
            WriteUInt16(response, 8, 0);
            WriteUInt16(response, 10, 0);
            return response;
        }

        internal static bool TryValidateResponse(byte[] response, DnsQuestion question, out DnsResponseMetadata metadata)
        {
            metadata = null;
            if (response == null || response.Length < HeaderLength || response.Length > MaximumPacketBytes) return false;
            if (ReadUInt16(response, 0) != question.Id) return false;
            ushort flags = ReadUInt16(response, 2);
            if ((flags & 0x8000) == 0 || (flags & 0x7800) != (question.Flags & 0x7800)) return false;
            if (ReadUInt16(response, 4) != 1) return false;

            int offset = HeaderLength;
            string responseName;
            if (!TryReadName(response, ref offset, true, out responseName) || offset + 4 > response.Length) return false;
            ushort responseType = ReadUInt16(response, offset);
            ushort responseClass = ReadUInt16(response, offset + 2);
            offset += 4;
            if (!String.Equals(responseName, question.Domain, StringComparison.Ordinal) || responseType != question.Type || responseClass != question.Class) return false;

            List<int> ttlOffsets = new List<int>();
            List<uint> ttlValues = new List<uint>();
            uint minimum = UInt32.MaxValue;
            int answerCount = ReadUInt16(response, 6);
            int authorityCount = ReadUInt16(response, 8);
            int additionalCount = ReadUInt16(response, 10);
            if (answerCount + authorityCount + additionalCount > MaximumResourceRecords) return false;
            bool sawOpt = false;
            int total = answerCount + authorityCount + additionalCount;
            for (int index = 0; index < total; index++)
            {
                string owner;
                if (!TryReadName(response, ref offset, true, out owner) || offset + 10 > response.Length) return false;
                ushort type = ReadUInt16(response, offset);
                ushort recordClass = ReadUInt16(response, offset + 2);
                int ttlOffset = offset + 4;
                uint ttl = ReadUInt32(response, ttlOffset);
                ushort length = ReadUInt16(response, offset + 8);
                offset += 10;
                if (offset + length > response.Length) return false;
                if (type == 41)
                {
                    if (sawOpt || index < answerCount + authorityCount || owner.Length != 0 || !ValidateOptData(response, offset, length)) return false;
                    sawOpt = true;
                }
                else
                {
                    ttlOffsets.Add(ttlOffset);
                    ttlValues.Add(ttl);
                    if (ttl < minimum) minimum = ttl;
                }
                offset += length;
            }
            if (offset != response.Length) return false;
            metadata = new DnsResponseMetadata
            {
                TtlOffsets = ttlOffsets.ToArray(),
                TtlValues = ttlValues.ToArray(),
                MinimumTtl = minimum == UInt32.MaxValue ? 0 : minimum,
                IsTruncated = (flags & 0x0200) != 0,
                HasOptRecord = sawOpt
            };
            return true;
        }

        private static bool TryReadOpt(byte[] packet, ref int offset)
        {
            string owner;
            if (!TryReadName(packet, ref offset, false, out owner) || owner.Length != 0 || offset + 10 > packet.Length) return false;
            if (ReadUInt16(packet, offset) != 41) return false;
            ushort length = ReadUInt16(packet, offset + 8);
            offset += 10;
            if (offset + length > packet.Length || !ValidateOptData(packet, offset, length)) return false;
            offset += length;
            return true;
        }

        private static bool ValidateOptData(byte[] packet, int offset, int length)
        {
            int end = offset + length;
            while (offset < end)
            {
                if (offset + 4 > end) return false;
                ushort itemLength = ReadUInt16(packet, offset + 2);
                offset += 4;
                if (offset + itemLength > end) return false;
                offset += itemLength;
            }
            return offset == end;
        }

        private static bool TryReadName(byte[] packet, ref int offset, bool allowPointers, out string name)
        {
            name = null;
            int cursor = offset;
            int consumedEnd = -1;
            int wireLength = 1;
            int jumps = 0;
            HashSet<int> visited = new HashSet<int>();
            List<string> labels = new List<string>();
            while (cursor < packet.Length)
            {
                byte length = packet[cursor];
                if ((length & 0xc0) == 0xc0)
                {
                    if (!allowPointers || cursor + 1 >= packet.Length || ++jumps > 16) return false;
                    int pointer = ((length & 0x3f) << 8) | packet[cursor + 1];
                    // DNS compression pointers must refer backward into already encoded data.
                    // Reject header targets and forward pointers to avoid ambiguous parses.
                    if (pointer < HeaderLength || pointer >= cursor || pointer >= packet.Length || !visited.Add(pointer)) return false;
                    if (consumedEnd < 0) consumedEnd = cursor + 2;
                    cursor = pointer;
                    continue;
                }
                if ((length & 0xc0) != 0 || length > 63) return false;
                cursor++;
                if (length == 0)
                {
                    if (consumedEnd < 0) consumedEnd = cursor;
                    offset = consumedEnd;
                    name = String.Join(".", labels.ToArray()).ToLowerInvariant();
                    return wireLength <= 255;
                }
                wireLength += length + 1;
                if (wireLength > 255 || cursor + length > packet.Length) return false;
                StringBuilder label = new StringBuilder(length);
                for (int index = 0; index < length; index++)
                {
                    byte character = packet[cursor + index];
                    if (character < 0x21 || character > 0x7e || character == (byte)'.') return false;
                    label.Append((char)character);
                }
                labels.Add(label.ToString());
                cursor += length;
            }
            return false;
        }

        internal static ushort ReadUInt16(byte[] data, int offset) { return (ushort)((data[offset] << 8) | data[offset + 1]); }
        internal static uint ReadUInt32(byte[] data, int offset) { return ((uint)data[offset] << 24) | ((uint)data[offset + 1] << 16) | ((uint)data[offset + 2] << 8) | data[offset + 3]; }
        internal static void WriteUInt16(byte[] data, int offset, ushort value) { data[offset] = (byte)(value >> 8); data[offset + 1] = (byte)value; }
        internal static void WriteUInt32(byte[] data, int offset, uint value) { data[offset] = (byte)(value >> 24); data[offset + 1] = (byte)(value >> 16); data[offset + 2] = (byte)(value >> 8); data[offset + 3] = (byte)value; }
    }
}
