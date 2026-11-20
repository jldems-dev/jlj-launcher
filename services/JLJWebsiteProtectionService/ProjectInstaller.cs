using System;
using System.ComponentModel;
using System.Configuration.Install;
using System.ServiceProcess;
using System.Security.Principal;

namespace JLJ.WebsiteProtection
{
    [RunInstaller(true)]
    public sealed class ProjectInstaller : Installer
    {
        public ProjectInstaller()
        {
            BeforeInstall += ValidateOwnerSid;
            AfterInstall += ProvisionOwnerSid;
            ServiceProcessInstaller processInstaller = new ServiceProcessInstaller();
            processInstaller.Account = ServiceAccount.LocalService;

            ServiceInstaller serviceInstaller = new ServiceInstaller();
            serviceInstaller.ServiceName = ProtectionService.ServiceNameValue;
            serviceInstaller.DisplayName = "JLJ Website Protection Service";
            serviceInstaller.Description = "Stores and validates owner-approved website policy. DNS enforcement is inactive.";
            serviceInstaller.StartType = ServiceStartMode.Automatic;
            serviceInstaller.AfterInstall += delegate { ServiceIsolation.EnableRestrictedServiceSid(ProtectionService.ServiceNameValue); };

            Installers.Add(processInstaller);
            Installers.Add(serviceInstaller);
        }

        private void ValidateOwnerSid(object sender, InstallEventArgs args)
        {
            string ownerSid = Context == null ? null : Context.Parameters["ownerSid"];
            if (String.IsNullOrWhiteSpace(ownerSid)) throw new InstallException("An owner SID must be provided as /ownerSid=<Windows SID>.");
            try { new SecurityIdentifier(ownerSid); }
            catch (ArgumentException) { throw new InstallException("The owner SID is invalid."); }
        }

        private void ProvisionOwnerSid(object sender, InstallEventArgs args)
        {
            ServiceIdentityConfig.ProvisionOwnerSid(Context.Parameters["ownerSid"]);
        }
    }
}
