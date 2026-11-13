# Fantasy TV setup for Windows.
# Puts PiPup (the free overlay app) on your Fire TV, lets it show pop-ups over other apps,
# starts your alerts, and leaves a "Start Fantasy TV" file on your Desktop for later.
# Run from the command on the Fantasy TV setup page (it sets $AppUrl and $TvIp first).
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
function Say($m) { Write-Host ""; Write-Host $m -ForegroundColor Cyan }
function Fail($m) { Write-Host ""; Write-Host $m -ForegroundColor Red; Read-Host "Press Enter to close"; exit 1 }

if (-not $AppUrl) { Fail "Copy the full command from the Fantasy TV setup page (it includes your link)." }
if (-not $TvIp) { $TvIp = Read-Host "What's your Fire TV's IP address? (Fire TV: Settings > My Fire TV > About > Network)" }
$Dir = Join-Path $env:USERPROFILE 'FantasyTV'
New-Item -ItemType Directory -Force -Path $Dir | Out-Null

$Adb = (Get-Command adb -ErrorAction SilentlyContinue).Source
if (-not $Adb) {
  $Adb = Join-Path $Dir 'platform-tools\adb.exe'
  if (-not (Test-Path $Adb)) {
    Say "Downloading Android platform-tools from Google (about 15 MB)..."
    $zip = Join-Path $Dir 'platform-tools.zip'
    Invoke-WebRequest 'https://dl.google.com/android/repository/platform-tools-latest-windows.zip' -OutFile $zip
    Expand-Archive -Force $zip -DestinationPath $Dir
  }
}
$Apk = Join-Path $Dir 'PiPup.apk'
if (-not (Test-Path $Apk)) {
  Say "Downloading PiPup v0.31.0 (about 8 MB)..."
  Invoke-WebRequest 'https://github.com/mhoogenbosch/PiPup/releases/download/v0.31.0/PiPup.apk' -OutFile $Apk
}

Say "Connecting to the Fire TV at $TvIp..."
Write-Host ">>> LOOK AT THE TV: if it asks 'Allow USB debugging?', tick 'Always allow' and choose OK." -ForegroundColor Yellow
$target = "$($TvIp):5555"
$ok = $false
for ($i = 0; $i -lt 20; $i++) {
  & $Adb connect $target | Out-Null
  $state = (& $Adb -s $target get-state 2>$null)
  if ($state -match 'device') { $ok = $true; break }
  Start-Sleep 3
}
if (-not $ok) { Fail "Couldn't connect. On the TV: Settings > My Fire TV > Developer options > ADB debugging ON. Same Wi-Fi as this PC? Then run the command again." }

Say "Installing PiPup on the TV..."
& $Adb -s $target install -r $Apk
& $Adb -s $target shell appops set nl.rogro82.pipup SYSTEM_ALERT_WINDOW allow
& $Adb -s $target shell appops set nl.rogro82.pipup REQUEST_INSTALL_PACKAGES allow 2>$null
& $Adb -s $target shell am start -n nl.rogro82.pipup/.MainActivity | Out-Null
Start-Sleep 5
& $Adb -s $target shell input keyevent KEYCODE_HOME

$body = @{ id = 'fantasy-tv'; duration = 0; position = 4; padding = 0; borderWidth = 0; fullscreen = $true;
           backgroundColor = '#00000000';
           media = @{ web = @{ uri = $AppUrl; width = 1920; height = 1080; transparent = $true; muted = ($AppUrl -match 'sound=0') } } } | ConvertTo-Json -Depth 5 -Compress
$startPs1 = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Start Fantasy TV.ps1'
@"
# Puts Fantasy TV back on the TV (needed after the TV restarts).
try { Invoke-RestMethod -Method Post -Uri 'http://$($TvIp):7979/notify' -ContentType 'application/json' -Body '$body' -TimeoutSec 10 | Out-Null; Write-Host 'Fantasy TV is on.' }
catch { Write-Host "The TV didn't answer. Is it on, and is PiPup installed?" }
Start-Sleep 3
"@ | Set-Content -Encoding UTF8 $startPs1
$startBat = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Start Fantasy TV.bat'
"@powershell -NoProfile -ExecutionPolicy Bypass -File `"$startPs1`"" | Set-Content -Encoding ASCII $startBat

$stopPs1 = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Stop Fantasy TV.ps1'
@"
# Takes Fantasy TV (and its corner scoreboard) off the TV. Start Fantasy TV brings it back.
try { Invoke-RestMethod -Method Post -Uri 'http://$($TvIp):7979/cancel?id=fantasy-tv' -TimeoutSec 10 | Out-Null; Write-Host 'Fantasy TV is off.' }
catch { Write-Host "The TV didn't answer. Is it on?" }
Start-Sleep 3
"@ | Set-Content -Encoding UTF8 $stopPs1
"@powershell -NoProfile -ExecutionPolicy Bypass -File `"$stopPs1`"" | Set-Content -Encoding ASCII (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Stop Fantasy TV.bat')

Say "Starting Fantasy TV..."
Start-Sleep 2
& powershell -NoProfile -ExecutionPolicy Bypass -File $startPs1
Say "All done. Fantasy TV should now be on your TV."
Write-Host "If the TV restarts, double-click 'Start Fantasy TV' on your Desktop (or use the phone shortcut)."
Read-Host "Press Enter to close"
