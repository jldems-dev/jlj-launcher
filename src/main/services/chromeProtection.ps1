$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$stateKey = 'HKLM:\SOFTWARE\JLJLauncher\ChromeProtection'
$result = @{ state = 'unconfigured'; managed = $false }

function Get-Policy([switch]$Effective) {
    if ($Effective) { return [xml](Get-AppLockerPolicy -Effective -Xml) }
    return [xml](Get-AppLockerPolicy -Local -Xml)
}

function Get-PolicyFingerprint([xml]$Policy) {
    $collections = foreach ($collection in $Policy.SelectNodes('/AppLockerPolicy/RuleCollection')) {
        $rules = @($collection.ChildNodes | Where-Object NodeType -eq 'Element' |
            ForEach-Object OuterXml | Sort-Object)
        $mode = $collection.GetAttribute('EnforcementMode')
        if ($rules.Count -or ($mode -and $mode -ne 'NotConfigured')) {
            "$($collection.GetAttribute('Type'))|${mode}|$($rules -join '|')"
        }
    }
    return (@($collections | Sort-Object) -join "`n")
}

function Set-Policy([xml]$Policy) {
    $file = [IO.Path]::GetTempFileName()
    try {
        $Policy.Save($file)
        Set-AppLockerPolicy -XmlPolicy $file
    } finally {
        Remove-Item -LiteralPath $file -Force -ErrorAction SilentlyContinue
    }
}

function Get-ChromeFiles {
    $roots = @($env:ProgramFiles, ${env:ProgramFiles(x86)}) | Where-Object { $_ }
    $profiles = @(Get-ChildItem 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList' |
        Where-Object PSChildName -Like 'S-1-5-21-*' | ForEach-Object {
            [Environment]::ExpandEnvironmentVariables($_.GetValue('ProfileImagePath', ''))
        } | Where-Object { $_ })
    $registered = foreach ($hive in @('HKLM:', 'HKCU:') + @(Get-ChildItem Registry::HKEY_USERS -ErrorAction SilentlyContinue |
        Where-Object PSChildName -Match '^S-1-5-21-[0-9-]+$' | ForEach-Object PSPath)) {
        foreach ($key in @('SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe',
            'SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe')) {
            $entry = Get-Item -LiteralPath (Join-Path $hive $key) -ErrorAction SilentlyContinue
            if ($entry) { $entry.GetValue('') }
        }
    }
    $installed = @($roots | ForEach-Object { Join-Path $_ 'Google\Chrome\Application\chrome.exe' })
    $installed += @($profiles | ForEach-Object { Join-Path $_ 'AppData\Local\Google\Chrome\Application\chrome.exe' })
    $candidates = @($installed) + @($registered)
    $candidates += @(Get-Process -Name chrome -ErrorAction SilentlyContinue | ForEach-Object Path)
    foreach ($profile in $profiles) {
        foreach ($folder in @('Downloads', 'Desktop', 'AppData\Local\Temp')) {
            $directory = Join-Path $profile $folder
            $candidates += @(Get-ChildItem -LiteralPath $directory -File -ErrorAction SilentlyContinue |
                Where-Object Name -Match 'chrome.*\.(exe|msi)$' | Select-Object -First 30 |
                ForEach-Object FullName)
            $candidates += Join-Path $directory 'GoogleChromePortable\App\Chrome-bin\chrome.exe'
        }
    }
    $candidates += @($request.sample, $record.config.sample)
    foreach ($candidate in @($candidates | Where-Object { $_ } | Sort-Object -Unique)) {
        if (!(Test-Path -LiteralPath $candidate -PathType Leaf)) { continue }
        $signature = Get-AuthenticodeSignature -LiteralPath $candidate -ErrorAction SilentlyContinue
        if ($signature.Status -ne 'Valid' -or
            $signature.SignerCertificate.Subject -notmatch '(?:^|,\s*)O=Google (?:LLC|Inc\.?)(?:,|$)') { continue }
        $file = Get-Item -LiteralPath $candidate
        $product = $file.VersionInfo.ProductName
        $binary = $file.VersionInfo.OriginalFilename
        $kind = $null
        if ($file.Extension -eq '.msi') {
            $installer = New-Object -ComObject WindowsInstaller.Installer
            $database = $installer.GetType().InvokeMember('OpenDatabase', 'InvokeMethod', $null, $installer, @($file.FullName, 0))
            $view = $database.OpenView("SELECT Value FROM Property WHERE Property = 'ProductName'")
            $view.Execute()
            $row = $view.Fetch()
            if ($row -and $row.StringData(1) -eq 'Google Chrome') { $kind = 'msi' }
            $view.Close()
        } elseif ($binary -eq 'ChromeSetup.exe') {
            $kind = 'setup'
        } elseif ($product -eq 'Google Chrome') {
            if ($binary -eq 'chrome.exe') { $kind = 'browser' }
            if ($binary -in @('ChromeSetup.exe', 'setup.exe', 'mini_installer.exe', 'GoogleChromeStandaloneEnterprise.exe')) {
                $kind = 'setup'
            }
        }
        if ($kind) {
            [pscustomobject]@{ Path = $file.FullName; Kind = $kind; Installed = $file.FullName -in $installed }
        }
    }
}

function Add-Rule($Collection, [string]$Element, [string]$Name, [string]$Sid, [string]$Action) {
    $rule = $Collection.OwnerDocument.CreateElement($Element)
    $rule.SetAttribute('Id', [guid]::NewGuid().ToString())
    $rule.SetAttribute('Name', $Name)
    $rule.SetAttribute('Description', 'Managed by JLJ Launcher Chrome Protection')
    $rule.SetAttribute('UserOrGroupSid', $Sid)
    $rule.SetAttribute('Action', $Action)
    [void]$Collection.AppendChild($rule)
    return $rule
}

function Add-PathRule($Collection, [string]$FilePath, [string]$Sid, [string]$Action) {
    $rule = Add-Rule $Collection 'FilePathRule' "JLJ Chrome Protection $Action $FilePath" $Sid $Action
    $condition = $Collection.OwnerDocument.CreateElement('Conditions')
    $file = $Collection.OwnerDocument.CreateElement('FilePathCondition')
    $file.SetAttribute('Path', $FilePath)
    [void]$condition.AppendChild($file)
    [void]$rule.AppendChild($condition)
}

function Add-PublisherRules($Collection, $Files, [string]$Sid, $ExceptPaths) {
    $identities = @{}
    foreach ($file in $Files) {
        $info = Get-AppLockerFileInformation -Path $file.Path
        [xml]$generated = New-AppLockerPolicy -FileInformation $info -RuleType Publisher -User Everyone -Xml
        $condition = $generated.SelectSingleNode('//Conditions/FilePublisherCondition')
        if (!$condition -or $condition.PublisherName.Contains('*') -or
            $condition.ProductName -ne 'GOOGLE CHROME' -or
            !$condition.BinaryName -or $condition.BinaryName.Contains('*')) {
            if ($file.Kind -eq 'browser') { continue }
            [xml]$hashPolicy = New-AppLockerPolicy -FileInformation $info -RuleType Hash -User Everyone -Xml
            $hash = $hashPolicy.SelectSingleNode('//Conditions/FileHashCondition')
            if (!$hash) { throw "Windows could not generate an AppLocker identity for $($file.Path)." }
            $rule = Add-Rule $Collection 'FileHashRule' 'JLJ Chrome Protection verified installer hash' $Sid 'Deny'
            $conditions = $Collection.OwnerDocument.CreateElement('Conditions')
            [void]$conditions.AppendChild($Collection.OwnerDocument.ImportNode($hash, $true))
            [void]$rule.AppendChild($conditions)
            continue
        }
        $condition.BinaryVersionRange.SetAttribute('LowSection', '0.0.0.0')
        $condition.BinaryVersionRange.SetAttribute('HighSection', '*')
        $identities[$condition.OuterXml] = $condition
    }
    if (!$identities.Count -and $Files[0].Kind -eq 'browser') {
        throw "A verified Chrome $($Files[0].Kind) sample with a specific AppLocker publisher identity is required."
    }
    foreach ($condition in $identities.Values) {
        $rule = Add-Rule $Collection 'FilePublisherRule' "JLJ Chrome Protection $($condition.BinaryName)" $Sid 'Deny'
        $conditions = $Collection.OwnerDocument.CreateElement('Conditions')
        [void]$conditions.AppendChild($Collection.OwnerDocument.ImportNode($condition, $true))
        [void]$rule.AppendChild($conditions)
        if ($ExceptPaths.Count) {
            $exceptions = $Collection.OwnerDocument.CreateElement('Exceptions')
            foreach ($filePath in $ExceptPaths) {
                $exception = $Collection.OwnerDocument.CreateElement('FilePathCondition')
                $exception.SetAttribute('Path', $filePath)
                [void]$exceptions.AppendChild($exception)
            }
            [void]$rule.AppendChild($exceptions)
        }
    }
}

function New-AuditPolicy($Files, $Config, [string]$Sid) {
    [xml]$policy = '<AppLockerPolicy Version="1" />'
    foreach ($type in @('Exe', 'Msi', 'Appx')) {
        if ($type -eq 'Msi' -and !$Config.install) { continue }
        $collection = $policy.CreateElement('RuleCollection')
        $collection.SetAttribute('Type', $type)
        $collection.SetAttribute('EnforcementMode', 'AuditOnly')
        [void]$policy.DocumentElement.AppendChild($collection)
        if ($type -eq 'Appx') {
            $rule = Add-Rule $collection 'FilePublisherRule' 'JLJ Chrome Protection allow signed packaged apps' 'S-1-1-0' 'Allow'
            $rule.InnerXml = '<Conditions><FilePublisherCondition PublisherName="*" ProductName="*" BinaryName="*"><BinaryVersionRange LowSection="0.0.0.0" HighSection="*" /></FilePublisherCondition></Conditions>'
        } else {
            Add-PathRule $collection '*' 'S-1-1-0' 'Allow'
        }
    }

    $exe = $policy.SelectSingleNode("//RuleCollection[@Type='Exe']")
    $browser = @($Files | Where-Object Kind -eq 'browser')
    $installed = @($browser | Where-Object Installed | ForEach-Object Path)
    if ($Config.execution -and !$Config.portable) {
        if (!$installed.Count) { throw 'No verified Chrome installation was found in a standard installation directory.' }
        foreach ($filePath in $installed) { Add-PathRule $exe $filePath $Sid 'Deny' }
    }
    if ($Config.portable) {
        if (!$browser.Count) { throw 'A verified Chrome executable is required. Enter its path in the additional file field.' }
        $exceptions = @()
        if (!$Config.execution) { $exceptions = $installed }
        Add-PublisherRules $exe $browser $Sid $exceptions
    }
    if ($Config.install) {
        $setup = @($Files | Where-Object Kind -eq 'setup')
        $msi = @($Files | Where-Object Kind -eq 'msi')
        if (!$setup.Count -or !$msi.Count) {
            throw 'Installation protection requires verified Chrome EXE and MSI installer samples. Put both installers in Downloads or Desktop, then refresh.'
        }
        Add-PublisherRules $exe $setup $Sid @()
        Add-PublisherRules ($policy.SelectSingleNode("//RuleCollection[@Type='Msi']")) $msi $Sid @()
    }
    return $policy
}

function Save-Record {
    if (!(Test-Path -LiteralPath $stateKey)) { New-Item -Path $stateKey -Force | Out-Null }
    Set-ItemProperty -LiteralPath $stateKey -Name State -Value ($record | ConvertTo-Json -Depth 8 -Compress)
}

function Get-UnsupportedReason {
    $commands = @(Get-Command Get-AppLockerPolicy, Set-AppLockerPolicy -ErrorAction SilentlyContinue)
    if ($commands.Count -ne 2) {
        return 'The Windows AppLocker cmdlets are required.'
    }
    $windows = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion'
    if ([int]$windows.CurrentBuildNumber -lt 19045) {
        return 'JLJ local AppLocker management requires a supported Windows 10 or 11 build.'
    }
    $mdm = @(Get-ChildItem 'HKLM:\SOFTWARE\Microsoft\Enrollments' -ErrorAction SilentlyContinue |
        Where-Object { $_.GetValue('DiscoveryServiceFullURL') -and $_.GetValue('EnrollmentState') -eq 1 })
    if ((Get-CimInstance Win32_ComputerSystem).PartOfDomain -or $mdm.Count) {
        return 'Use centrally managed policy on domain-joined or MDM-enrolled computers.'
    }

    if ($request.action -ne 'disable') {
        $service = Get-Service AppIDSvc -ErrorAction SilentlyContinue
        if (!$service) { return 'Windows does not expose the Application Identity service (AppIDSvc).' }
        if ($service.StartType -eq 'Disabled') {
            return 'Application Identity (AppIDSvc) is disabled. Enable it in Windows Services or ask the administrator who manages this PC.'
        }
    }
}

function Start-ApplicationIdentity {
    $service = Get-Service AppIDSvc
    if ($service.Status -ne 'Running') {
        Start-Service -InputObject $service
        $service.WaitForStatus('Running', [TimeSpan]::FromSeconds(15))
    }
}

function Invoke-Protection {
    if ($request.action -in @('audit', 'status')) {
        $result.paths = @($files | ForEach-Object Path)
    }
    $result.sync = $record.sync
    $result.config = $record.config
    $result.managed = [bool]$record.expected

    $unsupported = Get-UnsupportedReason
    if ($unsupported) {
        $result.state = 'unsupported'
        $result.detail = $unsupported
        if ($unsupported -like '*cmdlets*' -or $unsupported -like '*supported Windows*' -or $unsupported -like '*does not expose*') {
            $result.detail += ' Use AppLocker on a supported Windows installation, or have an administrator evaluate App Control for Business for this PC.'
        }
        return
    }

    $local = Get-Policy
    $effective = Get-Policy -Effective
    $localFingerprint = Get-PolicyFingerprint $local
    $effectiveFingerprint = Get-PolicyFingerprint $effective
    if ($record.expected) {
        $expected = Get-PolicyFingerprint ([xml]$record.expected)
        $previous = Get-PolicyFingerprint ([xml]$record.previous)
        if ($record.pending -and ($localFingerprint -eq $previous -or $localFingerprint -eq $expected)) {
            $record.expected = $local.OuterXml
            $record.pending = $false
            if (!$localFingerprint) { $record.expected = $null }
            Save-Record
            $expected = $localFingerprint
            $result.managed = [bool]$record.expected
        }
        if ($localFingerprint -ne $expected) {
            throw 'Local AppLocker policy changed outside JLJ Launcher. Compare the current rules with the JLJ backup in HKLM\SOFTWARE\JLJLauncher\ChromeProtection before recovery.'
        }
    }

    if ($request.action -eq 'disable' -and $record.expected) {
        $desired = [xml]$record.backup
    } else {
        if ($localFingerprint -ne $effectiveFingerprint -or (!$record.expected -and $localFingerprint)) {
            $result.state = 'unsupported'
            $result.detail = 'Existing AppLocker policy requires management in Windows.'
            return
        }
        if ($request.action -eq 'audit' -and !$record.expected) {
            $desired = New-AuditPolicy $files $request $currentSid
            $record.backup = $local.OuterXml
            $record.config = $request | Select-Object sample, install, execution, portable
            $record.sid = $currentSid
        }
        if ($request.action -eq 'enable') {
            if (!$record.expected -or $local.SelectSingleNode("//RuleCollection[@Type='Exe']").EnforcementMode -ne 'AuditOnly') {
                throw 'Start and verify audit mode before enabling protection.'
            }
            if ($currentSid -ne $record.sid) {
                throw 'The saved JLJ policy targets a different Windows account. Disable it and start a new audit for the current account.'
            }
            $desired = [xml]$record.expected
            foreach ($collection in $desired.SelectNodes('/AppLockerPolicy/RuleCollection')) {
                $collection.SetAttribute('EnforcementMode', 'Enabled')
            }
        }
    }

    if ($desired) {
        if ($request.action -ne 'disable') { Start-ApplicationIdentity }
        if ((Get-PolicyFingerprint (Get-Policy)) -ne $localFingerprint) {
            throw 'Local AppLocker policy changed during the request. Refresh and try again.'
        }
        $record.previous = $local.OuterXml
        $record.expected = $desired.OuterXml
        $record.pending = $true
        Save-Record
        $result.managed = $true
        Set-Policy $desired
        $local = Get-Policy
        if ((Get-PolicyFingerprint $local) -ne (Get-PolicyFingerprint $desired)) {
            throw 'Windows did not confirm the requested local policy.'
        }
        $record.pending = $false
        if ($request.action -eq 'disable') { $record.expected = $null }
        $record.sync = [DateTime]::UtcNow.ToString('o')
        Save-Record
        $result.sync = $record.sync
        $result.config = $record.config
        $result.managed = [bool]$record.expected
        $effective = Get-Policy -Effective
        if ((Get-PolicyFingerprint $effective) -ne (Get-PolicyFingerprint $local)) {
            throw 'Windows has not confirmed the requested effective policy. Refresh status.'
        }
    }

    if ($record.expected) {
        if ($currentSid -ne $record.sid) {
            throw 'The saved JLJ policy targets a different Windows account. Disable it and start a new audit for the current account.'
        }
        $mode = $effective.SelectSingleNode("//RuleCollection[@Type='Exe']").EnforcementMode
        if ($mode -eq 'AuditOnly') {
            $result.state = 'audit'
            $result.detail = 'Review AppLocker events in Windows Event Viewer while testing Chrome and approved apps. Enforcement will apply to everyone using this Windows account. Installer hash rules cover the verified installer versions only.'
            if ((Get-Service AppIDSvc).Status -ne 'Running') {
                $result.detail += ' Application Identity is stopped. Start it and collect fresh audit events before enforcing.'
            }
        } elseif ($mode -eq 'Enabled') {
            if ((Get-Service AppIDSvc).Status -ne 'Running') {
                throw 'Windows has enabled the policy, but Application Identity (AppIDSvc) is stopped.'
            }
            $driver = Get-Service AppLockerFltr -ErrorAction SilentlyContinue
            if (!$driver -or $driver.Status -ne 'Running') {
                throw 'Windows has enabled the policy, but the AppLocker filter driver (AppLockerFltr) is not running.'
            }
            $result.state = 'enabled'
            $result.detail = "Windows confirms effective AppLocker rules for the current Windows account. Local administrators can change these rules."
        } else {
            throw 'Windows has not confirmed AppLocker enforcement.'
        }
    } elseif ($record.sync) {
        $result.state = 'disabled'
    }
    if ($result.state -in @('unconfigured', 'disabled') -and (Get-Service AppIDSvc).Status -ne 'Running') {
        $result.detail = 'Start Audit will request administrator approval and start Application Identity (AppIDSvc) if needed.'
    }
}

try {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $currentSid = $identity.User.Value
    if ($request.expectedSid -and $request.expectedSid -ne $currentSid) {
        throw 'Approve UAC using the same Windows account that opened JLJ Launcher.'
    }
    if (!$currentSid.StartsWith('S-1-5-21-') -and !$currentSid.StartsWith('S-1-12-1-')) {
        throw 'Open JLJ Launcher from the shared Windows user account.'
    }
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    if (!$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        $result.state = 'needsElevation'
        $result.detail = 'Select Refresh Status or Start Audit to approve Windows administrator access.'
        $result.elevationSid = $currentSid
        if ($request.action -eq 'status' -and !$request.elevate) {
            $result.paths = @(Get-ChromeFiles | ForEach-Object Path)
        }
        $result | ConvertTo-Json -Depth 6 -Compress
        return
    }
    $mutex = [Threading.Mutex]::new($false, 'Global\JLJLauncherChromeProtection')
    try { $ownsMutex = $mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $ownsMutex = $true }
    if (!$ownsMutex) { throw 'Another launcher is checking or updating Chrome protection.' }
    $record = @{ expected = $null; sync = $null; config = $null }
    $stored = Get-ItemPropertyValue -LiteralPath $stateKey -Name State -ErrorAction SilentlyContinue
    if ($stored) {
        $data = $stored | ConvertFrom-Json
        foreach ($property in $data.PSObject.Properties) { $record[$property.Name] = $property.Value }
    }
    $result.managed = [bool]$record.expected
    $files = @()
    if ($request.action -in @('audit', 'status')) { $files = @(Get-ChromeFiles) }
    Invoke-Protection
} catch {
    $result.state = 'error'
    $result.detail = $_.Exception.Message
} finally {
    if ($ownsMutex) { $mutex.ReleaseMutex() }
    if ($mutex) { $mutex.Dispose() }
}
$result | ConvertTo-Json -Depth 6 -Compress
