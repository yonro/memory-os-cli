$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Net.Http

$baseUrl = if ($env:XMEMO_BASE_URL) { $env:XMEMO_BASE_URL.TrimEnd('/') } else { 'https://xmemo.dev' }
$packageUrl = [Uri]"$baseUrl/v1/skill/package"
$installDir = if ($env:XMEMO_SKILL_DIR) { $env:XMEMO_SKILL_DIR } else { 'xmemo-skill' }
$tempDir = "$installDir.tmp.$PID"

if ($packageUrl.Scheme -ne 'https') { throw 'XMemo Skill installer requires an HTTPS XMEMO_BASE_URL.' }
if (Test-Path -LiteralPath $installDir) { throw "Destination already exists: $installDir" }
$handler = [System.Net.Http.HttpClientHandler]::new()
$handler.AllowAutoRedirect = $false
$client = [System.Net.Http.HttpClient]::new($handler)
try {
  New-Item -ItemType Directory -Path $tempDir, "$tempDir\extract" | Out-Null
  $archivePath = "$tempDir\xmemo-skill.tar.gz"
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
  & tar.exe -xzf $archivePath -C "$tempDir\extract"
  if ($LASTEXITCODE -ne 0) { throw 'Archive extraction failed.' }
  if (-not (Test-Path -LiteralPath "$tempDir\extract\scripts\xmemo-skill.mjs" -PathType Leaf)) {
    throw 'Archive does not contain xmemo-skill.'
  }
  Move-Item -LiteralPath "$tempDir\extract" -Destination $installDir
  Write-Output "Installed XMemo Skill to $installDir"
} finally {
  $client.Dispose()
  if (Test-Path -LiteralPath $tempDir) { Remove-Item -LiteralPath $tempDir -Recurse -Force }
}
