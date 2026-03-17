param(
  [string]$Port = "",
  [string]$TokenFile = "",
  [switch]$NoRun
)

$ErrorActionPreference = "Stop"

$backendDir = Resolve-Path (Join-Path $PSScriptRoot "..")
$repoRoot = Resolve-Path (Join-Path $backendDir "..")
$envFile = Join-Path $backendDir ".env"

function Unquote-EnvValue {
  param(
    [Parameter(Mandatory = $false)][string]$Value
  )

  $text = "$Value".Trim()
  if ($text.Length -ge 2) {
    $first = $text.Substring(0, 1)
    $last = $text.Substring($text.Length - 1, 1)
    if (($first -eq '"' -and $last -eq '"') -or ($first -eq "'" -and $last -eq "'")) {
      return $text.Substring(1, $text.Length - 2)
    }
  }
  return $text
}

function Import-DotEnvFile {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath
  )

  if (-not (Test-Path -Path $FilePath -PathType Leaf)) {
    return $false
  }

  foreach ($line in Get-Content -Path $FilePath) {
    $raw = "$line"
    if ($raw -match '^\s*$') { continue }
    if ($raw -match '^\s*#') { continue }
    if ($raw -match '^\s*export\s+') {
      $raw = $raw -replace '^\s*export\s+', ''
    }
    $parts = $raw -split '=', 2
    if ($parts.Length -ne 2) { continue }
    $name = $parts[0].Trim()
    if (-not $name) { continue }
    $existing = [Environment]::GetEnvironmentVariable($name, 'Process')
    if ("$existing".Trim()) { continue }
    $value = Unquote-EnvValue $parts[1]
    [Environment]::SetEnvironmentVariable($name, $value, 'Process')
  }

  return $true
}

function Resolve-TokenFile {
  param(
    [Parameter(Mandatory = $true)][string]$RepoRoot,
    [Parameter(Mandatory = $false)][string]$ExplicitFile
  )

  $candidates = @()
  if ($ExplicitFile) {
    $explicitPath = $ExplicitFile
    if (-not [System.IO.Path]::IsPathRooted($explicitPath)) {
      $explicitPath = Join-Path $RepoRoot $explicitPath
    }
    if (-not (Test-Path -Path $explicitPath -PathType Leaf)) {
      throw "Token file not found: $explicitPath"
    }
    return (Resolve-Path $explicitPath)
  }

  $preferFiles = @("重要信息.md", "IMPORTANT.md", "IMPORTANT_INFO.md")
  foreach ($name in $preferFiles) {
    $filePath = Join-Path $RepoRoot $name
    if (Test-Path -Path $filePath -PathType Leaf) {
      $candidates += (Resolve-Path $filePath)
    }
  }

  $mdCandidates = Get-ChildItem -Path $RepoRoot -Filter "*.md" -File -ErrorAction Stop
  foreach ($md in $mdCandidates) {
    $resolved = Resolve-Path $md.FullName
    if ($candidates -contains $resolved) { continue }
    $candidates += $resolved
  }

  foreach ($file in $candidates) {
    try {
      $matched = Select-String -Path $file -Pattern "^\s*OPENNEWS_TOKEN/TWITTER_TOKEN\s*=" -Quiet -ErrorAction Stop
      if ($matched) {
        return $file
      }
    }
    catch {
      continue
    }
  }
  return $null
}

function Read-SharedToken {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath
  )
  $match = Select-String -Path $FilePath -Pattern "^\s*OPENNEWS_TOKEN/TWITTER_TOKEN\s*=\s*(.+)\s*$" | Select-Object -Last 1
  if (-not $match) {
    throw "OPENNEWS_TOKEN/TWITTER_TOKEN not found in $FilePath"
  }
  $token = $match.Matches[0].Groups[1].Value.Trim()
  if (-not $token) {
    throw "OPENNEWS_TOKEN/TWITTER_TOKEN is empty in $FilePath"
  }
  return $token
}

$envImported = Import-DotEnvFile -FilePath $envFile
$infoFile = Resolve-TokenFile -RepoRoot $repoRoot -ExplicitFile $TokenFile
$sharedToken = ""
if ($infoFile) {
  $sharedToken = Read-SharedToken -FilePath $infoFile
}

if (-not "$env:OPENNEWS_TOKEN".Trim()) {
  $env:OPENNEWS_TOKEN = $sharedToken
}
if (-not "$env:TWITTER_TOKEN".Trim()) {
  $env:TWITTER_TOKEN = $sharedToken
}
$openNewsToken = "$env:OPENNEWS_TOKEN".Trim()
$twitterToken = "$env:TWITTER_TOKEN".Trim()

if (-not $openNewsToken -and $twitterToken) {
  $openNewsToken = $twitterToken
}
if (-not $twitterToken -and $openNewsToken) {
  $twitterToken = $openNewsToken
}

if (-not $openNewsToken -or -not $twitterToken) {
  throw "No token available. Please set OPENNEWS_TOKEN/TWITTER_TOKEN in env or backend/.env, or add OPENNEWS_TOKEN/TWITTER_TOKEN=... to a markdown file in $repoRoot"
}

if ($Port) {
  $env:PORT = "$Port".Trim()
}
elseif (-not $env:PORT) {
  $env:PORT = "3399"
}

if (-not $env:KITECLAW_AUTH_DISABLED) {
  $env:KITECLAW_AUTH_DISABLED = "1"
}

$hasProxy =
  "$env:HTTP_PROXY".Trim() -or
  "$env:HTTPS_PROXY".Trim() -or
  "$env:ALL_PROXY".Trim()
if ($hasProxy -and -not "$env:NODE_USE_ENV_PROXY".Trim()) {
  $env:NODE_USE_ENV_PROXY = "1"
}

$env:OPENNEWS_TOKEN = $openNewsToken
$env:TWITTER_TOKEN = $twitterToken
if (-not $env:OPENNEWS_API_BASE) { $env:OPENNEWS_API_BASE = "https://ai.6551.io" }
if (-not $env:TWITTER_API_BASE) { $env:TWITTER_API_BASE = "https://ai.6551.io" }

Set-Location $backendDir

Write-Host "[start-backend-one] backend=$backendDir port=$($env:PORT) authDisabled=$($env:KITECLAW_AUTH_DISABLED)"
if ($infoFile) {
  Write-Host "[start-backend-one] OPENNEWS_TOKEN/TWITTER_TOKEN loaded from $([System.IO.Path]::GetFileName($infoFile))"
}
elseif ($envImported -and (Test-Path -Path $envFile -PathType Leaf)) {
  Write-Host "[start-backend-one] OPENNEWS_TOKEN/TWITTER_TOKEN loaded from backend/.env"
}
else {
  Write-Host "[start-backend-one] OPENNEWS_TOKEN/TWITTER_TOKEN loaded from environment variables"
}
Write-Host "[start-backend-one] OPENNEWS_API_BASE=$($env:OPENNEWS_API_BASE) TWITTER_API_BASE=$($env:TWITTER_API_BASE)"
if ("$env:NODE_USE_ENV_PROXY".Trim()) {
  Write-Host "[start-backend-one] NODE_USE_ENV_PROXY=$($env:NODE_USE_ENV_PROXY)"
}

if ($NoRun) {
  Write-Host "[start-backend-one] dry run only, skip npm start"
  exit 0
}

npm.cmd start
