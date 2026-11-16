param([Parameter(Mandatory=$true)][string]$ExtensionId)
$ErrorActionPreference = 'Stop'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# Locate Node.js binary
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) {
  $candidates = @(
    "$env:ProgramFiles\nodejs\node.exe",
    "${env:ProgramFiles(x86)}\nodejs\node.exe",
    "$env:LOCALAPPDATA\Programs\node\node.exe"
  )
  foreach ($c in $candidates) {
    if (Test-Path $c) { $node = $c; break }
  }
}

if (-not $node) {
  Write-Error "Node.js 18 or newer was not found. Please install Node.js from https://nodejs.org/ and restart your terminal."
  exit 1
}

# Run the unified installer (generates linkresurrector-host.bat for Windows Chromium compatibility)
& $node "$scriptDir\install.mjs" $ExtensionId
