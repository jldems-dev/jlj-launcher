$ErrorActionPreference = 'Stop'
try {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $sid = $identity.User.Value
    if ($request.expectedSid -and $request.expectedSid -ne $sid) {
        throw 'Approve UAC using the same Windows account that opened JLJ Launcher.'
    }
    if ($sid -notmatch '^S-1-5-21-') {
        throw 'Open JLJ Launcher from the shared Windows account.'
    }
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    if (!$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        @{ elevationSid = $sid } | ConvertTo-Json -Compress
        return
    }

    $mutex = [Threading.Mutex]::new($false, 'Global\JLJLauncherDriveAccessPolicy')
    try { $locked = $mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $locked = $true }
    if (!$locked) { throw 'Another launcher is updating the drive access policy.' }
    Add-Type -TypeDefinition $request.source
    [DriveAccessPolicy]::Run($sid, $request.action, $request.initialMask) | ConvertTo-Json -Compress
} catch {
    @{ error = $_.Exception.GetBaseException().Message } | ConvertTo-Json -Compress
} finally {
    if ($locked) { $mutex.ReleaseMutex() }
    if ($mutex) { $mutex.Dispose() }
}
