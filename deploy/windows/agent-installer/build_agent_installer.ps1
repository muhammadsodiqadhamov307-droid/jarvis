param(
  [string]$InnoCompilerPath = '',
  [string]$AppVersion = '1.0.1'
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = (Resolve-Path (Join-Path $scriptDir '..\..\..')).Path
$releaseRoot = Join-Path $repoRoot 'release'
$agentRelease = Join-Path $releaseRoot 'jarvis-computer-agent'
$installerOut = Join-Path $releaseRoot 'installer'
$issPath = Join-Path $scriptDir 'JarvisComputerAgent.iss'

function Copy-CleanDirectory {
  param(
    [string]$Source,
    [string]$Destination
  )

  if (-not (Test-Path $Destination)) {
    New-Item -ItemType Directory -Force -Path $Destination | Out-Null
  }

  Get-ChildItem -LiteralPath $Source -Force | ForEach-Object {
    $target = Join-Path $Destination $_.Name
    if ($_.PSIsContainer) {
      Copy-CleanDirectory -Source $_.FullName -Destination $target
    } else {
      Copy-Item -LiteralPath $_.FullName -Destination $target -Force
    }
  }
}

if (Test-Path $agentRelease) {
  Remove-Item -LiteralPath $agentRelease -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $agentRelease, $installerOut | Out-Null

Write-Host 'Copying agent runtime files...'
New-Item -ItemType Directory -Force -Path (Join-Path $agentRelease 'agent\windows') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $agentRelease 'backend') | Out-Null
Copy-Item -LiteralPath (Join-Path $repoRoot 'agent\windows\jarvis-agent.js') -Destination (Join-Path $agentRelease 'agent\windows\jarvis-agent.js') -Force
Copy-Item -LiteralPath (Join-Path $repoRoot 'agent\windows\package.json') -Destination (Join-Path $agentRelease 'agent\windows\package.json') -Force
Copy-Item -LiteralPath (Join-Path $repoRoot 'backend\desktop.js') -Destination (Join-Path $agentRelease 'backend\desktop.js') -Force
Copy-Item -LiteralPath (Join-Path $repoRoot 'deploy\windows\agent-launcher\start-agent.ps1') -Destination (Join-Path $agentRelease 'start-agent.ps1') -Force
Copy-Item -LiteralPath (Join-Path $repoRoot 'deploy\windows\agent-launcher\start-agent.cmd') -Destination (Join-Path $agentRelease 'start-agent.cmd') -Force

$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
if ($nodeCommand) {
  Write-Host 'Bundling local Node runtime...'
  $runtimeDir = Join-Path $agentRelease 'runtime'
  New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null
  Copy-Item -LiteralPath $nodeCommand.Source -Destination (Join-Path $runtimeDir 'node.exe') -Force
} else {
  Write-Warning 'Node.js was not found on this machine. The installed agent will require Node.js 20 or newer.'
}

if (-not $InnoCompilerPath) {
  $candidate = Join-Path $env:LOCALAPPDATA 'Programs\Inno Setup 6\ISCC.exe'
  if (Test-Path $candidate) {
    $InnoCompilerPath = $candidate
  }
}

if (-not $InnoCompilerPath -or -not (Test-Path $InnoCompilerPath)) {
  Write-Host ''
  Write-Host 'Agent release bundle is ready, but Inno Setup was not found.'
  Write-Host "Bundle: $agentRelease"
  Write-Host 'Install Inno Setup 6, then rerun with -InnoCompilerPath pointing to ISCC.exe.'
  exit 0
}

Write-Host 'Compiling agent installer...'
& $InnoCompilerPath "/DAppSource=$agentRelease" "/DAppVersion=$AppVersion" $issPath
if ($LASTEXITCODE -ne 0) {
  throw "Inno Setup failed with exit code $LASTEXITCODE."
}

Write-Host ''
Write-Host "Installer ready: $(Join-Path $installerOut 'JarvisComputerAgent-Setup.exe')"
