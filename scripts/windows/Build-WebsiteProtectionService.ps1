[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$project = Join-Path $repoRoot 'services\JLJWebsiteProtectionService\JLJWebsiteProtectionService.csproj'
$output = Join-Path $repoRoot 'dist\website-protection-service'
$intermediate = Join-Path $output 'obj'
$msbuild = Get-Command MSBuild.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source

if (-not $msbuild) {
    $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
    if (Test-Path -LiteralPath $vswhere) {
        $msbuild = & $vswhere -latest -products '*' -requires Microsoft.Component.MSBuild -find 'MSBuild\**\Bin\MSBuild.exe' | Select-Object -First 1
    }
}
if (-not $msbuild) { throw 'Install Visual Studio Build Tools with MSBuild and the .NET Framework 4.8.1 targeting pack.' }

& $msbuild $project /nologo /t:Build /p:Configuration=Release /p:Platform=AnyCPU "/p:OutputPath=$output" "/p:BaseIntermediateOutputPath=$intermediate"
if ($LASTEXITCODE -ne 0) { throw "Website Protection Service build failed with exit code $LASTEXITCODE. MSB3644 requires the .NET Framework 4.8.1 targeting pack." }

$serviceExe = Join-Path $output 'JLJWebsiteProtectionService.exe'
if (-not (Test-Path -LiteralPath $serviceExe -PathType Leaf)) { throw "Built executable was not found at $serviceExe." }
Write-Output "Built $serviceExe"
