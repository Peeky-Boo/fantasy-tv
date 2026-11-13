#!/bin/bash
# Fantasy TV setup for a Mac.
# Installs the Fantasy TV app on your Fire TV, lets it show over other apps, and starts it.
# After this, turn it on (and change settings) from the Fantasy TV app on the TV (Apps row).
# Usage: bash setup-mac.sh "<your Fantasy TV link>" [TV IP address]
set -u
APP_URL="${1:-}"
TV_IP="${2:-}"
DIR="$HOME/FantasyTV"
ADB_ZIP="https://dl.google.com/android/repository/platform-tools-latest-darwin.zip"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
fail() { printf '\n\033[31m%s\033[0m\n' "$*"; exit 1; }

[ -z "$APP_URL" ] && fail "Copy the full command from the Fantasy TV setup page (it includes your link)."
BASE="${APP_URL%%tv.html*}"
mkdir -p "$DIR" || fail "Couldn't make $DIR"
if [ -z "$TV_IP" ]; then
  say "What's your Fire TV's IP address? (Fire TV: Settings > My Fire TV > About > Network)"
  read -r TV_IP < /dev/tty
fi

# your choices from the setup page, passed to the app
USER_ARG=""; LEAGUE=""; STYLE="broadcast"; ALERTS="league"; SOUND="quiet"; TICKER="1"; DELAY="0"
IFS='&' read -r -a PAIRS <<< "${APP_URL#*\?}"
for kv in "${PAIRS[@]}"; do
  k="${kv%%=*}"; v="${kv#*=}"
  case "$k" in
    user) USER_ARG="$v" ;; league) LEAGUE="$v" ;; style) STYLE="$v" ;; alerts) ALERTS="$v" ;;
    sound) [ "$v" = "0" ] && SOUND="off" ;; volume) SOUND="loud" ;; ticker) TICKER="$v" ;; delay) DELAY="$v" ;;
  esac
done
[ -z "$USER_ARG" ] && fail "The link is missing your Sleeper username. Copy the command again from the setup page."

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

say "Downloading the Fantasy TV app..."
curl -fsSL -o "$DIR/FantasyTV.apk" "${BASE}kit/FantasyTV.apk" || fail "Couldn't download the app."

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

say "Installing Fantasy TV on the TV..."
"$ADB" -s "$TV_IP:5555" install -r "$DIR/FantasyTV.apk" || fail "Install failed."
"$ADB" -s "$TV_IP:5555" shell appops set app.fantasytv SYSTEM_ALERT_WINDOW allow

say "Starting Fantasy TV..."
EXTRA=(--es user "$USER_ARG" --es style "$STYLE" --es alerts "$ALERTS" --es sound "$SOUND" --es ticker "$TICKER" --es delay "$DELAY")
[ -n "$LEAGUE" ] && EXTRA+=(--es league "$LEAGUE")
"$ADB" -s "$TV_IP:5555" shell am start -n app.fantasytv/.MainActivity "${EXTRA[@]}" --ez quiet true >/dev/null \
  || fail "Couldn't start the app."

say "All done. Fantasy TV is on your TV."
echo "From now on, open 'Fantasy TV' from the Apps row on the TV and choose On when you want it."
echo "It goes off when the TV restarts. The same menu changes pop-ups, sound, scoreboard and delay."
