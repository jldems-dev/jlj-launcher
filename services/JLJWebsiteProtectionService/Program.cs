using System;
using System.ServiceProcess;

namespace JLJ.WebsiteProtection
{
    internal static class Program
    {
        private static void Main(string[] args)
        {
            if (args.Length == 1 && String.Equals(args[0], "--self-test", StringComparison.Ordinal))
            {
                try { ServiceProtocolSelfTests.Run(); }
                catch (Exception error) { Console.Error.WriteLine(error.GetType().Name + ": " + error.Message); Environment.ExitCode = 1; }
                return;
            }
            if (args.Length == 1 && String.Equals(args[0], "--pipe-self-test", StringComparison.Ordinal))
            {
                try { ServiceProtocolSelfTests.RunPipeIntegrationOnly(); }
                catch (Exception error) { Console.Error.WriteLine(error.GetType().Name + ": " + error.Message); Environment.ExitCode = 1; }
                return;
            }
            ServiceBase.Run(new ServiceBase[] { new ProtectionService() });
        }
    }
}
