param(
  [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Get-AppRoot {
  $scriptDir = Split-Path -Parent $MyInvocation.ScriptName
  if (Test-Path (Join-Path $scriptDir 'backend\server.js')) {
    return $scriptDir
  }
  return (Resolve-Path (Join-Path $scriptDir '..\..')).Path
}

function Test-JarvisReady {
  param([string]$Url)
  try {
    $response = Invoke-WebRequest -Uri "$Url/api/health" -UseBasicParsing -TimeoutSec 2
    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
}

$appRoot = Get-AppRoot
$backendDir = Join-Path $appRoot 'backend'
$envPath = Join-Path $appRoot '.env'
$exampleEnvPath = Join-Path $appRoot '.env.example'
$nodePath = Join-Path $appRoot 'runtime\node.exe'

if (-not (Test-Path $envPath) -and (Test-Path $exampleEnvPath)) {
  Copy-Item -LiteralPath $exampleEnvPath -Destination $envPath
}

if (-not (Test-Path $nodePath)) {
  $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
  if (-not $nodeCommand) {
    throw 'Node.js was not found. Install Node.js 20 or newer, then launch JARVIS again.'
  }
  $nodePath = $nodeCommand.Source
}

$port = if ($env:PORT) { $env:PORT } else { '3001' }
$baseUrl = "http://localhost:$port"
$env:NODE_ENV = 'production'
$env:JARVIS_SERVE_FRONTEND = 'true'
$env:JARVIS_STARTUP_COMMAND = "`"$PSHOME\powershell.exe`" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$PSCommandPath`""

if (-not (Test-JarvisReady $baseUrl)) {
  Start-Process -FilePath $nodePath -ArgumentList @('backend\server.js') -WorkingDirectory $appRoot -WindowStyle Hidden
}

for ($attempt = 0; $attempt -lt 40; $attempt += 1) {
  if (Test-JarvisReady $baseUrl) { break }
  Start-Sleep -Milliseconds 500
}

if ($NoBrowser) {
  return
}

$edge = Get-Command msedge.exe -ErrorAction SilentlyContinue
if ($edge) {
  Start-Process -FilePath $edge.Source -ArgumentList @("--app=$baseUrl", '--new-window')
} else {
  Start-Process $baseUrl
}
