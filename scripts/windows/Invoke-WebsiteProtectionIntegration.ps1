[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('Preflight', 'Install', 'Verify', 'PipeOwner', 'PipeStandardUser', 'PipeConcurrent', 'Lifecycle', 'Uninstall')]
    [string]$Action,

    [string]$ServiceExe,
    [string]$OwnerSid,
    [string]$ExpectedOwnerSid,
    [string]$DisposableConfirmation,
    [int]$ConcurrentClients = 12,
    [string]$ResultsDirectory = (Join-Path $env:TEMP 'JLJWebsiteProtectionPhase4D')
)

$ErrorActionPreference = 'Stop'
$serviceName = 'JLJWebsiteProtectionService'
$stateDirectory = Join-Path $env:ProgramData 'JLJGamingHouse\WebsiteProtection'
$confirmationText = 'I CONFIRM THIS IS A DISPOSABLE WINDOWS 10 PRO 22H2 TEST MACHINE'
$mutatingActions = @('Install', 'PipeOwner', 'Lifecycle', 'Uninstall')

function Assert-TargetOS {
    $build = [Environment]::OSVersion.Version.Build
    $currentBuild = Get-ItemPropertyValue 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion' 'CurrentBuildNumber' -ErrorAction Stop
    $edition = Get-ItemPropertyValue 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion' 'EditionID' -ErrorAction Stop
    if ([int]$currentBuild -ne 19045 -or $build -ne 19045) { throw "Expected Windows build 19045; found OSVersion=$build, CurrentBuildNumber=$currentBuild." }
    if ($edition -notin @('Professional', 'ProfessionalN')) { throw "Expected Windows 10 Pro; found EditionID=$edition." }
    if (-not [Environment]::Is64BitOperatingSystem) { throw 'Expected a 64-bit Windows installation.' }
    $releaseKey = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\NET Framework Setup\NDP\v4\Full' -ErrorAction Stop
    if ([int]$releaseKey.Release -lt 533320) { throw ".NET Framework 4.8.1 or later is required; detected release key $($releaseKey.Release)." }
}

function Assert-Administrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'Run this action from an elevated PowerShell session on the disposable test machine.'
    }
}

function Assert-DisposableConfirmation {
    if ($DisposableConfirmation -cne $confirmationText) {
        throw "Mutating actions require -DisposableConfirmation '$confirmationText'."
    }
}

function Get-DnsConfigurationSnapshot {
    $rows = Get-DnsClientServerAddress -ErrorAction Stop | Sort-Object InterfaceIndex, AddressFamily |
        ForEach-Object { '{0}|{1}|{2}' -f $_.InterfaceIndex, $_.AddressFamily, ([string]::Join(',', $_.ServerAddresses)) }
    return [string]::Join("`n", $rows)
}

function Get-ServiceSidValue {
    $serviceBytes = [Text.Encoding]::Unicode.GetBytes($serviceName.ToUpperInvariant())
    $sha1 = [Security.Cryptography.SHA1]::Create()
    try { $hash = $sha1.ComputeHash($serviceBytes) } finally { $sha1.Dispose() }
    $parts = for ($index = 0; $index -lt 5; $index++) {
        [BitConverter]::ToUInt32($hash, $index * 4).ToString([Globalization.CultureInfo]::InvariantCulture)
    }
    return 'S-1-5-80-' + ($parts -join '-')
}

function Assert-ProtectedAcl([string]$Path, [string[]]$ExpectedSids) {
    if (-not (Test-Path -LiteralPath $Path)) { throw "Expected protected path is missing: $Path" }
    $acl = Get-Acl -LiteralPath $Path
    if (-not $acl.AreAccessRulesProtected) { throw "ACL inheritance is enabled on $Path." }
    $allowed = @()
    foreach ($rule in $acl.Access) {
        if ($rule.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow) { continue }
        $sid = $rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
        if (($rule.FileSystemRights -band [Security.AccessControl.FileSystemRights]::FullControl) -eq [Security.AccessControl.FileSystemRights]::FullControl) {
            $allowed += $sid
        }
    }
    foreach ($sid in $ExpectedSids) {
        if ($sid -notin $allowed) { throw "Expected FullControl for SID $sid on $Path." }
    }
    foreach ($forbidden in @('S-1-1-0', 'S-1-5-11', 'S-1-5-32-545')) {
        if ($forbidden -in $allowed) { throw "Unexpected broad FullControl grant to SID $forbidden on $Path." }
    }
}

function Invoke-PipeProbe([string]$Role, [int]$Concurrency = 1) {
    if (-not $ExpectedOwnerSid) { throw 'Supply -ExpectedOwnerSid for named-pipe tests.' }
    $source = Join-Path $PSScriptRoot 'WebsiteProtectionPipeProbe.cs'
    $compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
    $webExtensions = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\System.Web.Extensions.dll'
    if (-not (Test-Path $source) -or -not (Test-Path $compiler) -or -not (Test-Path $webExtensions)) { throw 'The pipe probe source or .NET Framework compiler is missing.' }
    New-Item -ItemType Directory -Path $ResultsDirectory -Force | Out-Null
    $probeExe = Join-Path $ResultsDirectory 'WebsiteProtectionPipeProbe.exe'
    & $compiler /nologo /target:exe "/out:$probeExe" "/r:$webExtensions" $source
    if ($LASTEXITCODE -ne 0) { throw "Pipe probe compilation failed with exit code $LASTEXITCODE." }
    & $probeExe $Role $ExpectedOwnerSid $Concurrency
    if ($LASTEXITCODE -ne 0) { throw "Pipe probe failed with exit code $LASTEXITCODE." }
}

function Get-InstallUtilPath {
    $installUtil = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\InstallUtil.exe'
    if (-not (Test-Path $installUtil)) { throw "InstallUtil.exe was not found at $installUtil." }
    return $installUtil
}

if ($Action -ne 'Preflight') { Assert-TargetOS }
if ($Action -in $mutatingActions) {
    Assert-DisposableConfirmation
    Assert-Administrator
}

switch ($Action) {
    'Preflight' {
        Assert-TargetOS
        Write-Output 'Preflight passed: Windows 10 Pro 22H2 x64 build 19045 and .NET Framework 4.8.1+.'
        Write-Output "Service SID: $(Get-ServiceSidValue)"
        Write-Output "ProgramData path: $stateDirectory"
        break
    }

    'Install' {
        if (-not $ServiceExe -or -not (Test-Path -LiteralPath $ServiceExe)) { throw 'Supply -ServiceExe pointing to the reviewed test service executable.' }
        if (-not $OwnerSid) { throw 'Supply -OwnerSid for the test owner account.' }
        if (Get-Service -Name $serviceName -ErrorAction SilentlyContinue) { throw 'Refusing to install over an existing service registration. Restore a clean disposable VM snapshot first.' }
        if (Test-Path -LiteralPath $stateDirectory) { throw 'Refusing to reuse existing ProgramData state. Restore a clean disposable VM snapshot first.' }
        $null = New-Object Security.Principal.SecurityIdentifier($OwnerSid)
        $beforeDns = Get-DnsConfigurationSnapshot
        $installUtil = Get-InstallUtilPath
        & $installUtil "/ownerSid=$OwnerSid" $ServiceExe
        if ($LASTEXITCODE -ne 0) { throw "InstallUtil failed with exit code $LASTEXITCODE." }
        $afterDns = Get-DnsConfigurationSnapshot
        if ($beforeDns -cne $afterDns) { throw 'DNS adapter configuration changed during installation; stop and investigate.' }
        Write-Output 'Install completed. Verify with -Action Verify; this script does not start the service.'
        break
    }

    'Verify' {
        $service = Get-CimInstance Win32_Service -Filter "Name='$serviceName'" -ErrorAction Stop
        if (-not $service) { throw 'The service is not installed.' }
        if ($service.StartName -notmatch '(?i)LocalService') { throw "Unexpected service identity: $($service.StartName)." }
        if ($service.StartMode -ne 'Auto') { throw "Unexpected service start mode: $($service.StartMode)." }
        $sidOutput = (& sc.exe qsidtype $serviceName 2>&1 | Out-String)
        if ($LASTEXITCODE -ne 0 -or $sidOutput -notmatch '(?i)RESTRICTED') { throw "Restricted service SID is not confirmed. sc.exe output: $sidOutput" }
        $serviceSid = Get-ServiceSidValue
        Assert-ProtectedAcl $stateDirectory @('S-1-5-18', 'S-1-5-19', 'S-1-5-32-544', $serviceSid)
        Assert-ProtectedAcl (Join-Path $stateDirectory 'owner.sid') @('S-1-5-18', 'S-1-5-19', 'S-1-5-32-544', $serviceSid)
        Write-Output ("Service identity={0}; state={1}; startMode={2}; serviceSid={3}" -f $service.StartName, $service.State, $service.StartMode, $serviceSid)
        Write-Output 'Protected ProgramData directory and owner.sid ACL checks passed.'
        break
    }

    'PipeOwner' {
        if (-not $ExpectedOwnerSid) { $ExpectedOwnerSid = $OwnerSid }
        Invoke-PipeProbe 'owner' 1
        break
    }

    'PipeStandardUser' {
        Invoke-PipeProbe 'standard' 1
        break
    }

    'PipeConcurrent' {
        Invoke-PipeProbe 'concurrent' $ConcurrentClients
        break
    }

    'Lifecycle' {
        $beforeDns = Get-DnsConfigurationSnapshot
        $service = Get-Service -Name $serviceName -ErrorAction Stop
        if ($service.Status -ne 'Running') { Start-Service -Name $serviceName; (Get-Service -Name $serviceName).WaitForStatus('Running', [TimeSpan]::FromSeconds(30)) }
        Stop-Service -Name $serviceName
        (Get-Service -Name $serviceName).WaitForStatus('Stopped', [TimeSpan]::FromSeconds(30))
        Start-Service -Name $serviceName
        (Get-Service -Name $serviceName).WaitForStatus('Running', [TimeSpan]::FromSeconds(30))
        $afterDns = Get-DnsConfigurationSnapshot
        if ($beforeDns -cne $afterDns) { throw 'DNS adapter configuration changed during service lifecycle testing.' }
        Write-Output 'Start/stop/restart test passed; DNS adapter configuration was unchanged.'
        break
    }

    'Uninstall' {
        if (-not $ServiceExe -or -not (Test-Path -LiteralPath $ServiceExe)) { throw 'Supply -ServiceExe pointing to the installed test service executable.' }
        $beforeDns = Get-DnsConfigurationSnapshot
        $service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
        if ($service -and $service.Status -ne 'Stopped') {
            Stop-Service -Name $serviceName
            (Get-Service -Name $serviceName).WaitForStatus('Stopped', [TimeSpan]::FromSeconds(30))
        }
        $installUtil = Get-InstallUtilPath
        & $installUtil /u $ServiceExe
        if ($LASTEXITCODE -ne 0) { throw "InstallUtil uninstall failed with exit code $LASTEXITCODE." }
        if (Get-Service -Name $serviceName -ErrorAction SilentlyContinue) { throw 'The service registration remains after InstallUtil uninstall.' }
        $afterDns = Get-DnsConfigurationSnapshot
        if ($beforeDns -cne $afterDns) { throw 'DNS adapter configuration changed during uninstall.' }
        Write-Output 'Uninstall completed. ProgramData state is intentionally preserved for inspection.'
        break
    }
}
