param([Parameter(Mandatory=$true)][string]$ExtensionId)
$ErrorActionPreference = 'Stop'
if ($ExtensionId -notmatch '^[a-p]{32}$') { throw 'Extension ID must contain exactly 32 characters from a through p.' }
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { throw 'Install Node.js 18 or newer, then rerun this installer.' }
$major = [int]((& $node -p 'Number(process.versions.node.split(".")[0])'))
if ($major -lt 18) { throw "Node.js 18 or newer is required (found $major)." }
$installPath = Join-Path $env:LOCALAPPDATA 'LinkResurrector\native'
if (Test-Path $installPath) { Remove-Item -Recurse -Force $installPath }
New-Item -ItemType Directory -Force -Path $installPath | Out-Null
Copy-Item -Recurse -Force (Join-Path $PSScriptRoot 'src') (Join-Path $installPath 'src')
Copy-Item -Force (Join-Path $PSScriptRoot 'native-host.js') (Join-Path $installPath 'native-host.js')
Copy-Item -Force (Join-Path $PSScriptRoot '.env.example') (Join-Path (Split-Path $installPath) '.env.example')
[System.IO.File]::WriteAllText((Join-Path $installPath 'package.json'), '{"type":"module"}', [System.Text.UTF8Encoding]::new($false))
$script = Join-Path $installPath 'native-host.js'
$manifestPath = Join-Path $installPath 'com.linkresurrector.native.json'
New-Item -ItemType Directory -Force -Path (Split-Path $manifestPath) | Out-Null
$manifest = @{ name='com.linkresurrector.native'; description='LinkResurrector on-device URL recovery helper'; path=$node; type='stdio'; args=@($script); allowed_origins=@("chrome-extension://$ExtensionId/") }
$json = $manifest | ConvertTo-Json -Depth 5
[System.IO.File]::WriteAllText($manifestPath, $json + [Environment]::NewLine, [System.Text.UTF8Encoding]::new($false))
foreach ($browser in @('Google\Chrome\NativeMessagingHosts', 'BraveSoftware\Brave-Browser\NativeMessagingHosts')) {
  $key = "HKCU:\Software\$browser\com.linkresurrector.native"
  New-Item -Path $key -Force | Out-Null
  Set-Item -Path $key -Value $manifestPath
}
Write-Output "Installed native host registration at $manifestPath. Restart Chrome or Brave to activate it."
Write-Output "Optional provider configuration template: $(Join-Path (Split-Path $installPath) '.env.example')"
