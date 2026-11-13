#!/bin/bash
# Fantasy TV setup for a Mac.
# Puts PiPup (the free overlay app) on your Fire TV, lets it show pop-ups over other apps,
# starts your alerts, and leaves a "Start Fantasy TV" file on your Desktop for later.
# Usage: bash setup-mac.sh "<your Fantasy TV link>" [TV IP address]
set -u
APP_URL="${1:-}"
TV_IP="${2:-}"
DIR="$HOME/FantasyTV"
PIPUP_URL="https://github.com/mhoogenbosch/PiPup/releases/download/v0.31.0/PiPup.apk"
ADB_ZIP="https://dl.google.com/android/repository/platform-tools-latest-darwin.zip"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
fail() { printf '\n\033[31m%s\033[0m\n' "$*"; exit 1; }

[ -z "$APP_URL" ] && fail "Copy the full command from the Fantasy TV setup page (it includes your link)."
mkdir -p "$DIR" || fail "Couldn't make $DIR"
if [ -z "$TV_IP" ]; then
  say "What's your Fire TV's IP address? (Fire TV: Settings > My Fire TV > About > Network)"
  read -r TV_IP < /dev/tty
fi

# adb: Android's official tool for talking to the TV, straight from Google
ADB=$(command -v adb || true)
if [ -z "$ADB" ]; then
  ADB="$DIR/platform-tools/adb"
  if [ ! -x "$ADB" ]; then
    say "Downloading Android platform-tools from Google (about 15 MB)..."
    curl -fsSL -o "$DIR/platform-tools.zip" "$ADB_ZIP" || fail "Download failed. Check the internet connection."
    unzip -q -o "$DIR/platform-tools.zip" -d "$DIR" || fail "Couldn't unzip platform-tools"
  fi
fi

if [ ! -s "$DIR/PiPup.apk" ]; then
  say "Downloading PiPup v0.31.0 (about 8 MB)..."
  curl -fsSL -o "$DIR/PiPup.apk" "$PIPUP_URL" || fail "Couldn't download PiPup."
fi

say "Connecting to the Fire TV at $TV_IP..."
echo ">>> LOOK AT THE TV: if it asks 'Allow USB debugging?', tick 'Always allow' and choose OK."
"$ADB" connect "$TV_IP:5555" >/dev/null 2>&1
ok=""
for i in $(seq 1 20); do
  if "$ADB" -s "$TV_IP:5555" get-state 2>/dev/null | grep -q device; then ok=1; break; fi
  "$ADB" connect "$TV_IP:5555" >/dev/null 2>&1
  sleep 3
done
[ -z "$ok" ] && fail "Couldn't connect. On the TV: Settings > My Fire TV > Developer options > ADB debugging ON. Same Wi-Fi as this Mac? Then run the command again."

say "Installing PiPup on the TV..."
"$ADB" -s "$TV_IP:5555" install -r "$DIR/PiPup.apk" || fail "Install failed."
"$ADB" -s "$TV_IP:5555" shell appops set nl.rogro82.pipup SYSTEM_ALERT_WINDOW allow
"$ADB" -s "$TV_IP:5555" shell appops set nl.rogro82.pipup REQUEST_INSTALL_PACKAGES allow >/dev/null 2>&1
"$ADB" -s "$TV_IP:5555" shell am start -n nl.rogro82.pipup/.MainActivity >/dev/null 2>&1
sleep 5
"$ADB" -s "$TV_IP:5555" shell input keyevent KEYCODE_HOME

# the one call that puts Fantasy TV on screen (same as the Desktop file and the phone shortcut)
MUTED=false; case "$APP_URL" in *sound=0*) MUTED=true;; esac
cat > "$HOME/Desktop/Start Fantasy TV.command" <<START
#!/bin/bash
# Puts Fantasy TV back on the TV (needed after the TV restarts).
curl -s -m 10 -X POST -H 'Content-Type: application/json' \\
  -d '{"id":"fantasy-tv","duration":0,"position":4,"padding":0,"borderWidth":0,"fullscreen":true,"backgroundColor":"#00000000","media":{"web":{"uri":"$APP_URL","width":1920,"height":1080,"transparent":true,"muted":$MUTED}}}' \\
  "http://$TV_IP:7979/notify" && echo "Fantasy TV is on." || echo "The TV didn't answer. Is it on, and is PiPup installed?"
sleep 3
START
cat > "$HOME/Desktop/Stop Fantasy TV.command" <<STOP
#!/bin/bash
# Takes Fantasy TV (and its corner scoreboard) off the TV. Start Fantasy TV brings it back.
curl -s -m 10 -X POST "http://$TV_IP:7979/cancel?id=fantasy-tv" >/dev/null && echo "Fantasy TV is off." || echo "The TV didn't answer. Is it on?"
sleep 3
STOP
chmod +x "$HOME/Desktop/Start Fantasy TV.command" "$HOME/Desktop/Stop Fantasy TV.command"

say "Starting Fantasy TV..."
sleep 2
"$HOME/Desktop/Start Fantasy TV.command"
say "All done. Fantasy TV should now be on your TV."
echo "If the TV restarts, double-click 'Start Fantasy TV' on your Desktop (or use the phone shortcut)."
echo "To take it off the TV (say, for a film), double-click 'Stop Fantasy TV'."
