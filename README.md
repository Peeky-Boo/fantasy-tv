# Fantasy TV

Sleeper fantasy football alerts over whatever is playing on a Fire TV: touchdowns, sacks,
big plays, field goals and lead changes, with a live league scoreboard in the corner.

**Set it up:** open the setup page (`index.html`), type your Sleeper username and follow the steps.

How it works:
- `tv.html` runs on the TV inside [PiPup](https://github.com/mhoogenbosch/PiPup), a free open-source
  overlay app. It reads Sleeper's public API every 30 seconds. No server, no account, no laptop on game day.
- Points are Sleeper's own, so they follow your league's scoring rules. The change in each
  player's stat line says what happened ("34-yd TD catch", "Sack").
- `?simulate=last` replays last week's real scores as if live, for testing.
- `kit/` holds the one-off setup scripts for Mac and Windows that install PiPup on the TV.

A fan project, not made by or connected to Sleeper or the NFL. Player photos are loaded from Sleeper.
Sounds are real stadium recordings from Pixabay (Pixabay Content License), credited in `sounds/CREDITS.txt`.
