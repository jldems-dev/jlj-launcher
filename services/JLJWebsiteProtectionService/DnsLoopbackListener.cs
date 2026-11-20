using System;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;

namespace JLJ.WebsiteProtection
{
    // This class never accepts a bind address: it binds only IPv4 loopback. It is not started by
    // ProtectionService in Phase 4C, and the default upstream is deliberately unconfigured.
    internal sealed class DnsLoopbackListener : IDisposable
    {
        private readonly DnsRequestProcessor _processor;
        private readonly int _requestedPort;
        private readonly SemaphoreSlim _tcpSlots = new SemaphoreSlim(16, 16);
        private readonly SemaphoreSlim _udpSlots = new SemaphoreSlim(64, 64);
        private readonly object _clientsGate = new object();
        private readonly List<Task> _clientTasks = new List<Task>();
        private UdpClient _udp;
        private TcpListener _tcp;
        private CancellationTokenSource _stop;
        private Task _udpLoop;
        private Task _tcpLoop;

        internal DnsLoopbackListener(DnsRequestProcessor processor, int port)
        {
            if (processor == null) throw new ArgumentNullException("processor");
            _processor = processor;
            if (port < 0 || port > 65535) throw new ArgumentOutOfRangeException("port");
            _requestedPort = port;
        }

        internal int Port { get; private set; }
        internal bool IsRunning { get { return _stop != null && !_stop.IsCancellationRequested; } }
        internal IPAddress BoundAddress { get { return IPAddress.Loopback; } }

        internal void Start()
        {
            if (IsRunning) return;
            _stop = new CancellationTokenSource();
            try
            {
                _udp = new UdpClient(AddressFamily.InterNetwork);
                _udp.Client.Bind(new IPEndPoint(IPAddress.Loopback, _requestedPort));
                Port = ((IPEndPoint)_udp.Client.LocalEndPoint).Port;
                _tcp = new TcpListener(IPAddress.Loopback, Port);
                _tcp.Start(16);
                if (!IPAddress.IsLoopback(((IPEndPoint)_udp.Client.LocalEndPoint).Address)
                    || !IPAddress.IsLoopback(((IPEndPoint)_tcp.LocalEndpoint).Address))
                    throw new InvalidOperationException("DNS listener must be bound to loopback only");
                _udpLoop = Task.Run(() => UdpLoop(_stop.Token));
                _tcpLoop = Task.Run(() => TcpLoop(_stop.Token));
            }
            catch
            {
                Stop();
                throw;
            }
        }

        internal void Stop()
        {
            if (_stop != null) _stop.Cancel();
            try { if (_udp != null) _udp.Close(); } catch { }
            try { if (_tcp != null) _tcp.Stop(); } catch { }
            try { Task.WaitAll(new[] { _udpLoop, _tcpLoop }, TimeSpan.FromSeconds(2)); } catch { }
            Task[] clients;
            lock (_clientsGate) clients = _clientTasks.ToArray();
            try { if (clients.Length > 0) Task.WaitAll(clients, TimeSpan.FromSeconds(2)); } catch { }
            lock (_clientsGate) _clientTasks.Clear();
            _udp = null; _tcp = null; _udpLoop = null; _tcpLoop = null;
            if (_stop != null) { _stop.Dispose(); _stop = null; }
        }

        public void Dispose() { Stop(); }

        private async Task UdpLoop(CancellationToken token)
        {
            while (!token.IsCancellationRequested)
            {
                UdpReceiveResult received;
                try { received = await _udp.ReceiveAsync().ConfigureAwait(false); }
                catch (ObjectDisposedException) { return; }
                catch (SocketException) { if (token.IsCancellationRequested) return; else continue; }
                if (!IPAddress.IsLoopback(received.RemoteEndPoint.Address)) continue;
                if (!_udpSlots.Wait(0))
                {
                    _processor.ReportOverload();
                    byte[] busy = DnsPacketCodec.CreateError(received.Buffer, DnsResponseCode.ServerFailure);
                    try { await _udp.SendAsync(busy, busy.Length, received.RemoteEndPoint).ConfigureAwait(false); } catch { }
                    continue;
                }
                Track(Task.Run(() => HandleUdpRequest(received, token)));
            }
        }

        private async Task TcpLoop(CancellationToken token)
        {
            while (!token.IsCancellationRequested)
            {
                TcpClient client;
                try { client = await _tcp.AcceptTcpClientAsync().ConfigureAwait(false); }
                catch (ObjectDisposedException) { return; }
                catch (SocketException) { if (token.IsCancellationRequested) return; else continue; }
                if (!IPAddress.IsLoopback(((IPEndPoint)client.Client.RemoteEndPoint).Address) || !_tcpSlots.Wait(0))
                {
                    _processor.ReportOverload();
                    client.Close();
                    continue;
                }
                Track(Task.Run(async () =>
                {
                    try { await HandleTcpClient(client, token).ConfigureAwait(false); }
                    catch { }
                    finally { client.Close(); _tcpSlots.Release(); }
                }));
            }
        }

        private async Task HandleUdpRequest(UdpReceiveResult received, CancellationToken token)
        {
            try
            {
                byte[] response = received.Buffer.Length <= DnsPacketCodec.MaximumPacketBytes
                    ? _processor.Handle(received.Buffer) : DnsPacketCodec.CreateError(received.Buffer, DnsResponseCode.FormatError);
                if (response.Length == 0 || token.IsCancellationRequested) return;
                await _udp.SendAsync(response, response.Length, received.RemoteEndPoint).ConfigureAwait(false);
            }
            catch { }
            finally { _udpSlots.Release(); }
        }

        private void Track(Task task)
        {
            lock (_clientsGate)
            {
                _clientTasks.RemoveAll(item => item.IsCompleted);
                _clientTasks.Add(task);
            }
        }

        private async Task HandleTcpClient(TcpClient client, CancellationToken token)
        {
            using (NetworkStream stream = client.GetStream())
            using (CancellationTokenSource timeout = CancellationTokenSource.CreateLinkedTokenSource(token))
            {
                timeout.CancelAfter(TimeSpan.FromSeconds(3));
                byte[] prefix = new byte[2];
                if (!await ReadExactly(stream, prefix, 0, 2, timeout.Token).ConfigureAwait(false)) return;
                int length = DnsPacketCodec.ReadUInt16(prefix, 0);
                if (length < DnsPacketCodec.HeaderLength || length > DnsPacketCodec.MaximumPacketBytes) return;
                byte[] query = new byte[length];
                if (!await ReadExactly(stream, query, 0, length, timeout.Token).ConfigureAwait(false)) return;
                byte[] response = _processor.Handle(query);
                if (response.Length == 0 || response.Length > DnsPacketCodec.MaximumPacketBytes) return;
                DnsPacketCodec.WriteUInt16(prefix, 0, (ushort)response.Length);
                await stream.WriteAsync(prefix, 0, 2, timeout.Token).ConfigureAwait(false);
                await stream.WriteAsync(response, 0, response.Length, timeout.Token).ConfigureAwait(false);
                await stream.FlushAsync(timeout.Token).ConfigureAwait(false);
            }
        }

        private static async Task<bool> ReadExactly(Stream stream, byte[] buffer, int offset, int count, CancellationToken token)
        {
            while (count > 0)
            {
                int read = await stream.ReadAsync(buffer, offset, count, token).ConfigureAwait(false);
                if (read <= 0) return false;
                offset += read;
                count -= read;
            }
            return true;
        }
    }
}
