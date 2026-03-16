param(
  [string]$Port = "",
  [string]$TokenFile = "",
  [switch]$NoRun
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$backendDir = Resolve-Path (Join-Path $scriptDir "..")
$startOneScript = Resolve-Path (Join-Path $scriptDir "start-backend-one.ps1")

function Stop-PortListeners {
  param(
    [Parameter(Mandatory = $true)][string]$TargetPort
  )

  $portNumber = 0
  if (-not [int]::TryParse($TargetPort, [ref]$portNumber)) {
    throw "Invalid port: $TargetPort"
  }

  $processIds = @()
  try {
    $processIds = Get-NetTCPConnection -LocalPort $portNumber -ErrorAction SilentlyContinue |
      Select-Object -ExpandProperty OwningProcess -Unique
  }
  catch {
    $processIds = @()
  }

  foreach ($processId in $processIds) {
    if (-not $processId) { continue }
    if ($processId -eq $PID) { continue }
    try {
      Stop-Process -Id $processId -Force -ErrorAction Stop
      Write-Host "[start-backend-fresh] stopped pid=$processId on port=$TargetPort"
    }
    catch {
      Write-Host "[start-backend-fresh] skip pid=$processId on port=$TargetPort ($($_.Exception.Message))"
    }
  }
}

$resolvedPort = if ($Port) { "$Port".Trim() } else { "3399" }

if ($NoRun) {
  & powershell.exe -ExecutionPolicy Bypass -File $startOneScript -Port $resolvedPort @(
    if ($TokenFile) { "-TokenFile"; $TokenFile }
  ) -NoRun
  exit $LASTEXITCODE
}

Stop-PortListeners -TargetPort $resolvedPort

$argumentList = @(
  "-ExecutionPolicy"
  "Bypass"
  "-File"
  $startOneScript
  "-Port"
  $resolvedPort
)

if ($TokenFile) {
  $argumentList += @("-TokenFile", $TokenFile)
}

$process = Start-Process `
  -FilePath "powershell.exe" `
  -ArgumentList $argumentList `
  -WorkingDirectory $backendDir `
  -WindowStyle Minimized `
  -PassThru

Write-Host "[start-backend-fresh] started pid=$($process.Id) port=$resolvedPort"
