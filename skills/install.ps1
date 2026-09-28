$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Net.Http

function Resolve-Target {
  $targetAgent = $null
  $targetWarning = $null
  $resolvedDir = $null

  $homeDir = if ($env:HOME) { $env:HOME } elseif ($env:USERPROFILE) { $env:USERPROFILE } else { (Get-Item -LiteralPath '~').FullName }
  $codexHome = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $homeDir '.codex' }
  $claudeHome = Join-Path $homeDir '.claude'

  # Rule a: XMEMO_SKILL_DIR if set (unchanged behaviour)
  if ($env:XMEMO_SKILL_DIR) {
    $resolvedDir = $env:XMEMO_SKILL_DIR
    $targetAgent = 'custom'
  }
  # Rule b: XMEMO_SKILL_AGENT=claude-code|codex (explicit)
  elseif ($env:XMEMO_SKILL_AGENT) {
    switch ($env:XMEMO_SKILL_AGENT.ToLower()) {
      'claude-code' {
        $targetAgent = 'claude-code'
        $resolvedDir = Join-Path (Join-Path $claudeHome 'skills') 'xmemo-memory'
      }
      'claude' {
        $targetAgent = 'claude-code'
        $resolvedDir = Join-Path (Join-Path $claudeHome 'skills') 'xmemo-memory'
      }
      'codex' {
        $targetAgent = 'codex'
        $resolvedDir = Join-Path (Join-Path $codexHome 'skills') 'xmemo-memory'
      }
      'openclaw' {
        [Console]::Error.WriteLine('For OpenClaw run: openclaw skills install xmemo')
        exit 1
      }
      default {
        throw "Unknown XMEMO_SKILL_AGENT: $($env:XMEMO_SKILL_AGENT) (expected: claude-code, codex)"
      }
    }
  }
  # Rule c: Auto-detect the calling agent from its documented environment
  elseif ($env:CLAUDECODE) {
    $targetAgent = 'claude-code'
    $resolvedDir = Join-Path (Join-Path $claudeHome 'skills') 'xmemo-memory'
  }
  elseif ($env:CODEX_THREAD_ID -or $env:CODEX_SESSION_ID -or $env:CODEX_HOME) {
    $targetAgent = 'codex'
    $resolvedDir = Join-Path (Join-Path $codexHome 'skills') 'xmemo-memory'
  }
  # Rule d: If exactly one of ~/.claude or ~/.codex exists, use that agent
  elseif ((Test-Path -LiteralPath $claudeHome -PathType Container) -and -not (Test-Path -LiteralPath $codexHome -PathType Container)) {
    $targetAgent = 'claude-code'
    $resolvedDir = Join-Path (Join-Path $claudeHome 'skills') 'xmemo-memory'
  }
  elseif ((Test-Path -LiteralPath $codexHome -PathType Container) -and -not (Test-Path -LiteralPath $claudeHome -PathType Container)) {
    $targetAgent = 'codex'
    $resolvedDir = Join-Path (Join-Path $codexHome 'skills') 'xmemo-memory'
  }
  # Rule e: Otherwise keep ./xmemo-skill but print a clear warning
  else {
    $targetAgent = 'standalone'
    $resolvedDir = 'xmemo-skill'
    $targetWarning = @"
Warning: Installing to ./xmemo-skill. AI agents will not automatically load the skill from this directory.
To install for a specific agent, set XMEMO_SKILL_AGENT=claude-code|codex or XMEMO_SKILL_DIR=<path>, or use:
  npx -y @xmemo/client skill install --client <id>
"@
  }

  return [PSCustomObject]@{
    InstallDir = $resolvedDir
    Agent      = $targetAgent
    Warning    = $targetWarning
  }
}

$targetInfo = Resolve-Target
$installDir = $targetInfo.InstallDir
$agent = $targetInfo.Agent

if ($targetInfo.Warning) {
  [Console]::Error.WriteLine($targetInfo.Warning)
}

if ($env:XMEMO_SKILL_RESOLVE_ONLY -eq '1') {
  Write-Output $installDir
  exit 0
}

$baseUrl = if ($env:XMEMO_BASE_URL) { $env:XMEMO_BASE_URL.TrimEnd('/') } else { 'https://xmemo.dev' }
$packageUrl = [Uri]"$baseUrl/v1/skill/package"
$tempDir = "$installDir.tmp.$PID"

if ($packageUrl.Scheme -ne 'https') { throw 'XMemo Skill installer requires an HTTPS XMEMO_BASE_URL.' }

if (Test-Path -LiteralPath $installDir) {
  if ($env:XMEMO_SKILL_FORCE -ne '1') {
    throw "Destination already exists: $installDir (set XMEMO_SKILL_FORCE=1 to replace and back up)"
  }
}

$handler = [System.Net.Http.HttpClientHandler]::new()
$handler.AllowAutoRedirect = $false
$client = [System.Net.Http.HttpClient]::new($handler)
try {
  $extractDir = Join-Path $tempDir 'extract'
  New-Item -ItemType Directory -Path $tempDir, $extractDir -Force | Out-Null
  $archivePath = Join-Path $tempDir 'xmemo-skill.tar.gz'

  if ($env:XMEMO_SKILL_TEST_ARCHIVE) {
    Copy-Item -LiteralPath $env:XMEMO_SKILL_TEST_ARCHIVE -Destination $archivePath
    $downloaded = $true
  } else {
    $uri = $packageUrl
    $downloaded = $false
    for ($redirects = 0; $redirects -lt 6; $redirects++) {
      $response = $client.GetAsync($uri, [System.Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult()
      if ([int]$response.StatusCode -ge 300 -and [int]$response.StatusCode -lt 400) {
        if (-not $response.Headers.Location) { throw 'HTTPS redirect is missing a location.' }
        $nextUri = [Uri]::new($uri, $response.Headers.Location)
        $response.Dispose()
        if ($nextUri.Scheme -ne 'https') { throw 'Refusing a non-HTTPS redirect.' }
        $uri = $nextUri
        continue
      }
      if (-not $response.IsSuccessStatusCode) { throw "Download failed: HTTP $([int]$response.StatusCode)" }
      $stream = [System.IO.File]::Create($archivePath)
      try { $response.Content.CopyToAsync($stream).GetAwaiter().GetResult() } finally { $stream.Dispose(); $response.Dispose() }
      $downloaded = $true
      break
    }
    if (-not $downloaded) { throw 'Too many redirects.' }
  }

  $tarCmd = if (Get-Command 'tar.exe' -ErrorAction SilentlyContinue) { 'tar.exe' } else { 'tar' }
  & $tarCmd -xzf $archivePath -C $extractDir
  if ($LASTEXITCODE -ne 0) { throw 'Archive extraction failed.' }
  $scriptCheck = Join-Path (Join-Path $extractDir 'scripts') 'xmemo-skill.mjs'
  # Validate that archive contains scripts\xmemo-skill.mjs
  if (-not (Test-Path -LiteralPath $scriptCheck -PathType Leaf)) {
    throw 'Archive does not contain xmemo-skill.'
  }

  if (Test-Path -LiteralPath $installDir) {
    $homeDir = if ($env:HOME) { $env:HOME } elseif ($env:USERPROFILE) { $env:USERPROFILE } else { (Get-Item -LiteralPath '~').FullName }
    $backupAgent = if ($agent) { $agent } else { 'standalone' }
    $backupDir = Join-Path (Join-Path (Join-Path $homeDir '.xmemo') 'backups') (Join-Path 'skills' $backupAgent)
    $timestamp = Get-Date -Format 'yyyyMMddHHmmss'
    $leafName = Split-Path -Leaf $installDir
    $backupPath = Join-Path $backupDir "$leafName-$timestamp"
    if (-not (Test-Path -LiteralPath $backupDir)) {
      New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
    }
    Move-Item -LiteralPath $installDir -Destination $backupPath
    Write-Output "Backed up existing installation to $backupPath"
  }

  $parentDir = Split-Path -Parent $installDir
  if ($parentDir -and -not (Test-Path -LiteralPath $parentDir)) {
    New-Item -ItemType Directory -Path $parentDir -Force | Out-Null
  }
  Move-Item -LiteralPath $extractDir -Destination $installDir

  $absInstallDir = (Get-Item -LiteralPath $installDir).FullName
  $doctorScript = Join-Path (Join-Path $absInstallDir 'scripts') 'xmemo-skill.mjs'

  Write-Output "Installed XMemo Skill to $absInstallDir"
  Write-Output ""
  Write-Output "To verify the installation:"
  Write-Output "  node `"$doctorScript`" doctor --anonymous"
  Write-Output ""
  Write-Output "Restart or reload your agent to pick up the skill."
} finally {
  $client.Dispose()
  if (Test-Path -LiteralPath $tempDir) { Remove-Item -LiteralPath $tempDir -Recurse -Force }
}

