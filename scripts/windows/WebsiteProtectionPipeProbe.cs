using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.IO.Pipes;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Threading.Tasks;
using System.Web.Script.Serialization;

internal static class WebsiteProtectionPipeProbe
{
    private const string PipeName = "JLJWebsiteProtection.v1";
    private static readonly JavaScriptSerializer Serializer = new JavaScriptSerializer();

    private static int Main(string[] args)
    {
        try
        {
            if (args.Length < 2) throw new ArgumentException("Usage: probe.exe owner|standard|concurrent <ownerSid> [concurrency]");
            string role = args[0];
            string expectedOwner = new SecurityIdentifier(args[1]).Value;
            WindowsIdentity identity = WindowsIdentity.GetCurrent();
            string currentSid = identity.User.Value;
            WindowsPrincipal principal = new WindowsPrincipal(identity);
            if (role == "owner" && currentSid != expectedOwner) throw new InvalidOperationException("Current account SID does not match the provisioned owner SID.");
            if ((role == "standard" || role == "concurrent") && currentSid == expectedOwner) throw new InvalidOperationException("Run this probe under a separate standard-user account.");
            if ((role == "standard" || role == "concurrent") && principal.IsInRole(WindowsBuiltInRole.Administrator))
                throw new InvalidOperationException("Run this probe under a Windows Standard User account, not an administrator.");

            if (role == "concurrent")
            {
                int clients = args.Length > 2 ? Int32.Parse(args[2], CultureInfo.InvariantCulture) : 12;
                if (clients < 2 || clients > 32) throw new ArgumentOutOfRangeException("concurrency", "Use between 2 and 32 clients.");
                TestConcurrentConnections(clients);
            }
            else if (role == "owner") TestOwnerOperations();
            else if (role == "standard") TestStandardUserRestrictions(expectedOwner);
            else throw new ArgumentException("Unknown role: " + role);

            Console.WriteLine("PIPE_PROBE_PASS role={0} sid={1}", role, currentSid);
            return 0;
        }
        catch (Exception error)
        {
            Console.Error.WriteLine("PIPE_PROBE_FAIL {0}: {1}", error.GetType().Name, error.Message);
            return 1;
        }
    }

    private static void TestOwnerOperations()
    {
        IDictionary<string, object> status = Body(Send("GetStatus", new Dictionary<string, object>()));
        long lastRevision = Convert.ToInt64(status["lastAcceptedRevision"], CultureInfo.InvariantCulture);
        long revision = Math.Max(0, lastRevision + 1);
        IDictionary<string, object> policy = BuildPolicy(revision);
        IDictionary<string, object> body = new Dictionary<string, object> { { "policy", policy } };

        IDictionary<string, object> applied = Body(Send("ApplyPolicy", body));
        if (!Convert.ToBoolean(applied["accepted"], CultureInfo.InvariantCulture)) throw new InvalidOperationException("Owner ApplyPolicy was not accepted.");
        IDictionary<string, object> restored = Body(Send("RestoreLastKnownGood", new Dictionary<string, object>()));
        if (!Convert.ToBoolean(restored["restored"], CultureInfo.InvariantCulture)) throw new InvalidOperationException("Owner RestoreLastKnownGood was not accepted.");
        Console.WriteLine("OWNER_OPERATIONS_PASS revision={0}", revision);
    }

    private static void TestStandardUserRestrictions(string ownerSid)
    {
        SendSuccess("GetCapabilities", new Dictionary<string, object>());
        IDictionary<string, object> status = Body(Send("GetStatus", new Dictionary<string, object>()));
        long previousRevision = Convert.ToInt64(status["lastAcceptedRevision"], CultureInfo.InvariantCulture);
        IDictionary<string, object> policy = BuildPolicy(Math.Max(0, previousRevision + 1));
        IDictionary<string, object> body = new Dictionary<string, object> { { "policy", policy } };
        SendSuccess("ValidatePolicy", body);
        ExpectError("ApplyPolicy", body, "UNAUTHORIZED");
        ExpectError("RestoreLastKnownGood", new Dictionary<string, object>(), "UNAUTHORIZED");
        IDictionary<string, object> after = Body(Send("GetStatus", new Dictionary<string, object>()));
        long currentRevision = Convert.ToInt64(after["lastAcceptedRevision"], CultureInfo.InvariantCulture);
        if (currentRevision != previousRevision) throw new InvalidOperationException("Standard-user requests changed the stored policy revision.");
        if (WindowsIdentity.GetCurrent().User.Value == ownerSid) throw new InvalidOperationException("Standard-user probe ran as the owner.");
        Console.WriteLine("STANDARD_USER_RESTRICTIONS_PASS revision={0}", currentRevision);
    }

    private static void TestConcurrentConnections(int clients)
    {
        int completed = 0;
        ConcurrentQueue<string> errors = new ConcurrentQueue<string>();
        Stopwatch elapsed = Stopwatch.StartNew();
        Parallel.For(0, clients, new ParallelOptions { MaxDegreeOfParallelism = clients }, delegate(int index)
        {
            try
            {
                for (int repeat = 0; repeat < 3; repeat++)
                {
                    SendSuccess("GetStatus", new Dictionary<string, object>());
                    System.Threading.Interlocked.Increment(ref completed);
                }
            }
            catch (Exception error) { errors.Enqueue("client-" + index + ":" + error.GetType().Name); }
        });
        elapsed.Stop();
        if (!errors.IsEmpty) throw new InvalidOperationException("Concurrent pipe requests failed: " + String.Join(",", errors.ToArray()));
        if (completed != clients * 3) throw new InvalidOperationException("Not all concurrent requests completed.");
        Console.WriteLine("PIPE_CONCURRENCY_PASS clients={0} requests={1} elapsedMs={2}", clients, completed, elapsed.ElapsedMilliseconds);
    }

    private static IDictionary<string, object> BuildPolicy(long revision)
    {
        const string domain = "integration-test.invalid";
        const string action = "allow";
        const bool enabled = true;
        const bool subdomains = false;
        string canonical = "{\"protocolVersion\":1,\"policyRevision\":" + revision.ToString(CultureInfo.InvariantCulture)
            + ",\"defaultAction\":\"deny\",\"rules\":[{\"domain\":\"" + domain
            + "\",\"action\":\"" + action + "\",\"enabled\":" + enabled.ToString().ToLowerInvariant()
            + ",\"includeSubdomains\":" + subdomains.ToString().ToLowerInvariant() + "}]}";
        string hash;
        using (SHA256 sha = SHA256.Create())
        {
            byte[] digest = sha.ComputeHash(Encoding.UTF8.GetBytes(canonical));
            StringBuilder hex = new StringBuilder(digest.Length * 2);
            foreach (byte value in digest) hex.Append(value.ToString("x2", CultureInfo.InvariantCulture));
            hash = hex.ToString();
        }
        IDictionary<string, object> rule = new Dictionary<string, object>
        {
            { "domain", domain }, { "action", action }, { "enabled", enabled }, { "includeSubdomains", subdomains }
        };
        return new Dictionary<string, object>
        {
            { "protocolVersion", 1 }, { "policyRevision", revision }, { "defaultAction", "deny" },
            { "rules", new object[] { rule } }, { "sha256", hash }
        };
    }

    private static IDictionary<string, object> Send(string operation, IDictionary<string, object> body)
    {
        IDictionary<string, object> request = new Dictionary<string, object>
        {
            { "protocolVersion", 1 }, { "requestId", Guid.NewGuid().ToString("D") },
            { "operation", operation }, { "body", body }
        };
        string message = Serializer.Serialize(request) + "\n";
        using (NamedPipeClientStream pipe = new NamedPipeClientStream(".", PipeName, PipeDirection.InOut,
            PipeOptions.None, TokenImpersonationLevel.Impersonation))
        {
            pipe.Connect(15000);
            pipe.ReadTimeout = 15000;
            pipe.WriteTimeout = 15000;
            byte[] bytes = new UTF8Encoding(false).GetBytes(message);
            pipe.Write(bytes, 0, bytes.Length);
            pipe.Flush();
            string responseText = ReadLine(pipe);
            IDictionary<string, object> response = Serializer.DeserializeObject(responseText) as IDictionary<string, object>;
            if (response == null || !response.ContainsKey("success")) throw new InvalidDataException("Malformed service response.");
            return response;
        }
    }

    private static void SendSuccess(string operation, IDictionary<string, object> body)
    {
        IDictionary<string, object> response = Send(operation, body);
        if (!Convert.ToBoolean(response["success"], CultureInfo.InvariantCulture))
            throw new InvalidOperationException("Operation " + operation + " failed: " + response["error"]);
    }

    private static IDictionary<string, object> Body(IDictionary<string, object> response)
    {
        if (!Convert.ToBoolean(response["success"], CultureInfo.InvariantCulture))
            throw new InvalidOperationException("Service returned error: " + response["error"]);
        IDictionary<string, object> body = response["body"] as IDictionary<string, object>;
        if (body == null) throw new InvalidDataException("Service response body is missing.");
        return body;
    }

    private static void ExpectError(string operation, IDictionary<string, object> body, string expected)
    {
        IDictionary<string, object> response = Send(operation, body);
        object error;
        if (!response.TryGetValue("error", out error) || !String.Equals(error as string, expected, StringComparison.Ordinal))
            throw new InvalidOperationException("Expected " + expected + " for " + operation + ".");
    }

    private static string ReadLine(Stream stream)
    {
        using (MemoryStream buffer = new MemoryStream())
        {
            while (buffer.Length <= 1024 * 1024)
            {
                int value = stream.ReadByte();
                if (value < 0) throw new EndOfStreamException("Service closed before returning a response.");
                if (value == '\n') return Encoding.UTF8.GetString(buffer.ToArray());
                buffer.WriteByte((byte)value);
            }
        }
        throw new InvalidDataException("Service response exceeded the protocol limit.");
    }
}
