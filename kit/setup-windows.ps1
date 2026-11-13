# Fantasy TV setup for Windows.
# Installs the Fantasy TV app on your Fire TV, lets it show over other apps, and starts it.
# After this, turn it on (and change settings) from the Fantasy TV app on the TV (Apps row).
# Run from the command on the Fantasy TV setup page (it sets $AppUrl and $TvIp first).
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
function Say($m) { Write-Host ""; Write-Host $m -ForegroundColor Cyan }
function Fail($m) { Write-Host ""; Write-Host $m -ForegroundColor Red; Read-Host "Press Enter to close"; exit 1 }

if (-not $AppUrl) { Fail "Copy the full command from the Fantasy TV setup page (it includes your link)." }
if (-not $TvIp) { $TvIp = Read-Host "What's your Fire TV's IP address? (Fire TV: Settings > My Fire TV > About > Network)" }
$Base = $AppUrl.Substring(0, $AppUrl.IndexOf('tv.html'))

# your choices from the setup page, passed to the app
$opt = @{ user = ''; league = ''; style = 'broadcast'; alerts = 'league'; sound = 'quiet'; ticker = '1'; delay = '0' }
foreach ($kv in $AppUrl.Split('?')[1].Split('&')) {
  $k, $v = $kv.Split('=', 2)
  switch ($k) {
    'user' { $opt.user = [Uri]::UnescapeDataString($v) } 'league' { $opt.league = $v } 'style' { $opt.style = $v }
    'alerts' { $opt.alerts = $v } 'sound' { if ($v -eq '0') { $opt.sound = 'off' } } 'volume' { $opt.sound = 'loud' }
    'ticker' { $opt.ticker = $v } 'delay' { $opt.delay = $v }
  }
}
if (-not $opt.user) { Fail "The link is missing your Sleeper username. Copy the command again from the setup page." }

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
Say "Downloading the Fantasy TV app..."
$Apk = Join-Path $Dir 'FantasyTV.apk'
Invoke-WebRequest ($Base + 'kit/FantasyTV.apk') -OutFile $Apk

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

Say "Installing Fantasy TV on the TV..."
& $Adb -s $target install -r $Apk
& $Adb -s $target shell appops set app.fantasytv SYSTEM_ALERT_WINDOW allow

Say "Starting Fantasy TV..."
$extra = @('--es', 'user', $opt.user, '--es', 'style', $opt.style, '--es', 'alerts', $opt.alerts, '--es', 'sound', $opt.sound, '--es', 'ticker', $opt.ticker, '--es', 'delay', $opt.delay)
if ($opt.league) { $extra += @('--es', 'league', $opt.league) }
& $Adb -s $target shell am start -n app.fantasytv/.MainActivity @extra --ez quiet true | Out-Null

Say "All done. Fantasy TV is on your TV."
Write-Host "From now on, open 'Fantasy TV' from the Apps row on the TV and choose On when you want it."
Write-Host "It goes off when the TV restarts. The same menu changes pop-ups, sound, scoreboard and delay."
Read-Host "Press Enter to close"
