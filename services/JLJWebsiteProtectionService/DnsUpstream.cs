using System;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Diagnostics;

namespace JLJ.WebsiteProtection
{
    internal enum DnsUpstreamTransport
    {
        Udp,
        Tcp
    }

    internal sealed class DnsUpstreamOptions
    {
        internal readonly IPEndPoint Endpoint;
        internal readonly DnsUpstreamTransport Transport;

        internal DnsUpstreamOptions(IPAddress address, int port, DnsUpstreamTransport transport)
        {
            if (address == null || port < 1 || port > 65535) throw new ArgumentException("A numeric upstream address and valid port are required");
            if (!Enum.IsDefined(typeof(DnsUpstreamTransport), transport)) throw new ArgumentOutOfRangeException("transport");
            Endpoint = new IPEndPoint(address, port);
            Transport = transport;
        }
    }

    internal interface IDnsUpstreamResolver
    {
        byte[] Resolve(byte[] query, TimeSpan timeout);
    }

    internal sealed class DnsUpstreamNotConfiguredException : IOException
    {
        internal DnsUpstreamNotConfiguredException() : base("DNS_UPSTREAM_NOT_CONFIGURED") { }
    }

    internal sealed class UnconfiguredDnsUpstreamResolver : IDnsUpstreamResolver
    {
        public byte[] Resolve(byte[] query, TimeSpan timeout) { throw new DnsUpstreamNotConfiguredException(); }
    }

    // This generic socket adapter accepts an explicit endpoint and transport. It selects no
    // provider and is not constructed or activated by the service in Phase 4C.
    internal sealed class SocketDnsUpstreamResolver : IDnsUpstreamResolver
    {
        private readonly DnsUpstreamOptions _options;
        internal SocketDnsUpstreamResolver(DnsUpstreamOptions options)
        {
            if (options == null) throw new ArgumentNullException("options");
            _options = options;
        }

        public byte[] Resolve(byte[] query, TimeSpan timeout)
        {
            if (query == null || query.Length < DnsPacketCodec.HeaderLength || query.Length > DnsPacketCodec.MaximumPacketBytes)
                throw new InvalidDataException("DNS_QUERY_INVALID");
            if (timeout < TimeSpan.FromMilliseconds(100) || timeout > TimeSpan.FromSeconds(10)) throw new ArgumentOutOfRangeException("timeout");
            if (_options.Transport == DnsUpstreamTransport.Udp)
            {
                Stopwatch elapsed = Stopwatch.StartNew();
                byte[] udpResponse = ResolveUdp(query, timeout);
                if (IsMatchingTruncatedResponse(udpResponse, query))
                {
                    TimeSpan remaining = timeout - elapsed.Elapsed;
                    if (remaining <= TimeSpan.Zero) throw new TimeoutException("DNS_UPSTREAM_TIMEOUT");
                    return ResolveTcp(query, remaining);
                }
                return udpResponse;
            }
            return ResolveTcp(query, timeout);
        }

        private static bool IsMatchingTruncatedResponse(byte[] response, byte[] query)
        {
            if (response == null || response.Length < DnsPacketCodec.HeaderLength || query.Length < 4) return false;
            ushort flags = DnsPacketCodec.ReadUInt16(response, 2);
            return response[0] == query[0] && response[1] == query[1]
                && (flags & 0x8000) != 0 && (flags & 0x0200) != 0;
        }

        private byte[] ResolveUdp(byte[] query, TimeSpan timeout)
        {
            AddressFamily family = _options.Endpoint.Address.AddressFamily;
            using (Socket socket = new Socket(family, SocketType.Dgram, ProtocolType.Udp))
            {
                int milliseconds = (int)timeout.TotalMilliseconds;
                socket.SendTimeout = milliseconds;
                socket.ReceiveTimeout = milliseconds;
                socket.Connect(_options.Endpoint);
                socket.Send(query);
                byte[] buffer = new byte[DnsPacketCodec.MaximumPacketBytes + 1];
                int received = socket.Receive(buffer);
                if (received < DnsPacketCodec.HeaderLength || received > DnsPacketCodec.MaximumPacketBytes) throw new InvalidDataException("DNS_UPSTREAM_RESPONSE_INVALID");
                Array.Resize(ref buffer, received);
                return buffer;
            }
        }

        private byte[] ResolveTcp(byte[] query, TimeSpan timeout)
        {
            Stopwatch elapsed = Stopwatch.StartNew();
            using (TcpClient client = new TcpClient(_options.Endpoint.Address.AddressFamily))
            {
                IAsyncResult connecting = client.BeginConnect(_options.Endpoint.Address, _options.Endpoint.Port, null, null);
                bool connected;
                System.Threading.WaitHandle connectWait = connecting.AsyncWaitHandle;
                using (connectWait) connected = connectWait.WaitOne(Remaining(timeout, elapsed));
                if (!connected) throw new TimeoutException("DNS_UPSTREAM_TIMEOUT");
                client.EndConnect(connecting);
                using (NetworkStream stream = client.GetStream())
                {
                    byte[] prefix = new byte[2];
                    DnsPacketCodec.WriteUInt16(prefix, 0, (ushort)query.Length);
                    stream.WriteTimeout = RemainingMilliseconds(timeout, elapsed);
                    stream.Write(prefix, 0, prefix.Length);
                    stream.WriteTimeout = RemainingMilliseconds(timeout, elapsed);
                    stream.Write(query, 0, query.Length);
                    ReadExactly(stream, prefix, 0, 2, timeout, elapsed);
                    int length = DnsPacketCodec.ReadUInt16(prefix, 0);
                    if (length < DnsPacketCodec.HeaderLength || length > DnsPacketCodec.MaximumPacketBytes) throw new InvalidDataException("DNS_UPSTREAM_RESPONSE_INVALID");
                    byte[] response = new byte[length];
                    ReadExactly(stream, response, 0, response.Length, timeout, elapsed);
                    return response;
                }
            }
        }

        private static void ReadExactly(Stream stream, byte[] buffer, int offset, int count, TimeSpan timeout, Stopwatch elapsed)
        {
            while (count > 0)
            {
                stream.ReadTimeout = RemainingMilliseconds(timeout, elapsed);
                int read = stream.Read(buffer, offset, count);
                if (read <= 0) throw new EndOfStreamException("DNS_UPSTREAM_RESPONSE_TRUNCATED");
                offset += read;
                count -= read;
            }
        }

        private static TimeSpan Remaining(TimeSpan timeout, Stopwatch elapsed)
        {
            int milliseconds = RemainingMilliseconds(timeout, elapsed);
            return TimeSpan.FromMilliseconds(milliseconds);
        }

        private static int RemainingMilliseconds(TimeSpan timeout, Stopwatch elapsed)
        {
            double remaining = timeout.TotalMilliseconds - elapsed.Elapsed.TotalMilliseconds;
            if (remaining <= 0) throw new TimeoutException("DNS_UPSTREAM_TIMEOUT");
            return Math.Max(1, (int)Math.Ceiling(remaining));
        }
    }
}
