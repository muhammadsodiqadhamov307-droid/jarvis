param(
  [string]$ServerUrl = 'https://jarvis12345.duckdns.org'
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$appRoot = Split-Path -Parent $MyInvocation.ScriptName
$nodePath = Join-Path $appRoot 'runtime\node.exe'
$agentPath = Join-Path $appRoot 'agent\windows\jarvis-agent.js'

if (-not (Test-Path $nodePath)) {
  $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
  if (-not $nodeCommand) {
    throw 'Node.js was not found. Install Node.js 20 or newer, then launch the JARVIS Computer Agent again.'
  }
  $nodePath = $nodeCommand.Source
}

if (-not (Test-Path $agentPath)) {
  throw "JARVIS Computer Agent is missing: $agentPath"
}

$escapedRoot = [regex]::Escape($appRoot)
$existing = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
  Where-Object {
    $_.CommandLine -and
    $_.CommandLine -match 'jarvis-agent\.js' -and
    $_.CommandLine -match $escapedRoot
  } |
  Select-Object -First 1

if ($existing) {
  return
}

$env:JARVIS_SERVER_URL = $ServerUrl
Start-Process -FilePath $nodePath -ArgumentList @('agent\windows\jarvis-agent.js') -WorkingDirectory $appRoot -WindowStyle Hidden
