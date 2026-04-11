param(
  [string]$InnoCompilerPath = '',
  [string]$AppVersion = '1.0.0'
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = (Resolve-Path (Join-Path $scriptDir '..\..\..')).Path
$releaseRoot = Join-Path $repoRoot 'release'
$appRelease = Join-Path $releaseRoot 'jarvis-ai'
$installerOut = Join-Path $releaseRoot 'installer'
$issPath = Join-Path $scriptDir 'JarvisAI.iss'

function Copy-CleanDirectory {
  param(
    [string]$Source,
    [string]$Destination,
    [string[]]$Exclude = @()
  )

  if (-not (Test-Path $Destination)) {
    New-Item -ItemType Directory -Force -Path $Destination | Out-Null
  }

  Get-ChildItem -LiteralPath $Source -Force | ForEach-Object {
    if ($Exclude -contains $_.Name) { return }
    $target = Join-Path $Destination $_.Name
    if ($_.PSIsContainer) {
      Copy-CleanDirectory -Source $_.FullName -Destination $target -Exclude $Exclude
    } else {
      Copy-Item -LiteralPath $_.FullName -Destination $target -Force
    }
  }
}

Write-Host 'Building frontend assets...'
Push-Location $repoRoot
try {
  & npm.cmd run build
} finally {
  Pop-Location
}

if (Test-Path $appRelease) {
  Remove-Item -LiteralPath $appRelease -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $appRelease, $installerOut | Out-Null

Write-Host 'Copying backend runtime...'
Copy-CleanDirectory -Source (Join-Path $repoRoot 'backend') -Destination (Join-Path $appRelease 'backend') -Exclude @(
  'database.sqlite',
  'database.sqlite-shm',
  'database.sqlite-wal'
)

Write-Host 'Copying frontend build...'
New-Item -ItemType Directory -Force -Path (Join-Path $appRelease 'frontend') | Out-Null
Copy-CleanDirectory -Source (Join-Path $repoRoot 'frontend\dist') -Destination (Join-Path $appRelease 'frontend\dist')

Write-Host 'Copying launcher and environment template...'
Copy-Item -LiteralPath (Join-Path $repoRoot '.env.example') -Destination (Join-Path $appRelease '.env.example') -Force
Copy-Item -LiteralPath (Join-Path $repoRoot 'deploy\windows\launcher\start-jarvis.ps1') -Destination (Join-Path $appRelease 'start-jarvis.ps1') -Force
Copy-Item -LiteralPath (Join-Path $repoRoot 'deploy\windows\launcher\start-jarvis.cmd') -Destination (Join-Path $appRelease 'start-jarvis.cmd') -Force

$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
if ($nodeCommand) {
  Write-Host 'Bundling local Node runtime...'
  $runtimeDir = Join-Path $appRelease 'runtime'
  New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null
  Copy-Item -LiteralPath $nodeCommand.Source -Destination (Join-Path $runtimeDir 'node.exe') -Force
} else {
  Write-Warning 'Node.js was not found on this machine. The installed launcher will require Node.js 20 or newer.'
}

if (-not $InnoCompilerPath) {
  $candidate = Join-Path $env:LOCALAPPDATA 'Programs\Inno Setup 6\ISCC.exe'
  if (Test-Path $candidate) {
    $InnoCompilerPath = $candidate
  }
}

if (-not $InnoCompilerPath -or -not (Test-Path $InnoCompilerPath)) {
  Write-Host ''
  Write-Host 'Release bundle is ready, but Inno Setup was not found.'
  Write-Host "Bundle: $appRelease"
  Write-Host 'Install Inno Setup 6, then rerun with -InnoCompilerPath pointing to ISCC.exe.'
  exit 0
}

Write-Host 'Compiling installer...'
& $InnoCompilerPath "/DAppSource=$appRelease" "/DAppVersion=$AppVersion" $issPath
if ($LASTEXITCODE -ne 0) {
  throw "Inno Setup failed with exit code $LASTEXITCODE."
}

Write-Host ''
Write-Host "Installer ready: $(Join-Path $installerOut 'JarvisAI-Setup.exe')"
