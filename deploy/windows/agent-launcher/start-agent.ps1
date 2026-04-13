param(
  [string]$ServerUrl = 'https://jarvis12345.duckdns.org'
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$appRoot = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $PSCommandPath }
$nodePath = Join-Path $appRoot 'runtime\node.exe'
$agentPath = Join-Path $appRoot 'agent\windows\jarvis-agent.js'
$appDataRoot = if ($env:APPDATA) { $env:APPDATA } else { [Environment]::GetFolderPath('ApplicationData') }
$dataDir = Join-Path $appDataRoot 'JarvisComputerAgent'
$launcherLog = Join-Path $dataDir 'launcher.log'

New-Item -ItemType Directory -Force -Path $dataDir | Out-Null

function Write-LauncherLog {
  param([string]$Message)
  Add-Content -LiteralPath $launcherLog -Value "[$(Get-Date -Format o)] $Message"
}

if (-not (Test-Path $nodePath)) {
  $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
  if (-not $nodeCommand) {
    throw 'Node.js was not found. Install Node.js 20 or newer, then launch the JARVIS Computer Agent again.'
  }
  $nodePath = $nodeCommand.Source
}

if (-not (Test-Path $agentPath)) {
  Write-LauncherLog "Missing agent script: $agentPath"
  throw "JARVIS Computer Agent is missing: $agentPath"
}

$escapedRoot = [regex]::Escape($appRoot)
$existing = $null
try {
  $existing = Get-CimInstance Win32_Process -ErrorAction Stop |
    Where-Object {
      $_.CommandLine -and
      $_.CommandLine -match 'jarvis-agent\.js' -and
      $_.CommandLine -match $escapedRoot
    } |
    Select-Object -First 1
} catch {
  Write-LauncherLog "Process duplicate check skipped: $($_.Exception.Message)"
}

if ($existing) {
  Write-LauncherLog "Agent already running as process $($existing.ProcessId)."
  return
}

$env:JARVIS_SERVER_URL = $ServerUrl
Write-LauncherLog "Starting agent from $appRoot for $ServerUrl."
Start-Process -FilePath $nodePath -ArgumentList @('agent\windows\jarvis-agent.js') -WorkingDirectory $appRoot -WindowStyle Hidden
