param(
  [string]$ChromePath = "",
  [string]$Root = "C:\DealerPilot\sessions",
  [string]$BackendUrl = "https://1987dealerpilot.com",
  [string]$ExtensionRoot = "C:\DealerPilot\dealerpilot"
)

$ErrorActionPreference = "Stop"

if (-not $ChromePath) {
  $candidates = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "$env:ProgramFiles(x86)\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
  )
  $ChromePath = $candidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
}

if (-not $ChromePath -or -not (Test-Path -LiteralPath $ChromePath)) {
  throw "Chrome executable was not found. Pass -ChromePath explicitly."
}

$messengerExtension = Join-Path $ExtensionRoot "chrome-extension-messenger"
$publisherExtension = Join-Path $ExtensionRoot "chrome-extension"
if (-not (Test-Path -LiteralPath $messengerExtension)) {
  throw "Messenger extension directory was not found: $messengerExtension"
}

$sessions = @(
  @{ Name = "dealer-1"; DealerId = 1; Port = 9222 },
  @{ Name = "lucky-mazda"; DealerId = 2; Port = 9223 }
)

New-Item -ItemType Directory -Force -Path $Root | Out-Null
$extensionList = "$messengerExtension,$publisherExtension"

foreach ($session in $sessions) {
  $profile = Join-Path $Root $session.Name
  New-Item -ItemType Directory -Force -Path $profile | Out-Null
  $arguments = @(
    "--user-data-dir=$profile",
    "--remote-debugging-port=$($session.Port)",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-session-crashed-bubble",
    "--load-extension=$extensionList",
    "https://www.facebook.com/marketplace/inbox"
  )
  Start-Process -FilePath $ChromePath -ArgumentList $arguments | Out-Null
  Write-Output "Started $($session.Name): dealerId=$($session.DealerId), sessionId=$($session.Name), port=$($session.Port)"
}

Write-Output "Backend: $BackendUrl"
Write-Output "Open each extension popup once and save its dealer ID, session ID, and backend URL."
