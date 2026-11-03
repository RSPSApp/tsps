# Regeneration Meter

A port of RuneLite 1.13.5's Regeneration Meter (`regenmeter`). It is on by default, as in RuneLite.

A red ring around the hitpoints orb fills up to your next hitpoint (every 100 ticks, 50 with Rapid
Heal), and a blue one around the special attack orb up to the next 10% (every 50 ticks, 25 with a
Lightbearer). Above your base hitpoints the ring empties towards the next point lost; at full
hitpoints there is no ring unless "Show at full hitpoints" is on.

As in RuneLite the timers are the client's own estimate: they start at login and restart when Rapid
Heal is switched. The server's timers run the same way (hitpoints on a 100 tick countdown from
login, restarted by Rapid Heal; special attack on a 50 tick task while below 100%), so they line up.

**Hitpoint notification** (seconds, 0 for off) sends "Your next hitpoint will regenerate soon!"
that long before the next hitpoint.

## Settings

As RuneLite, config group `regenmeter`: the two rings, "Show at full hitpoints" and the
notification.

## Differences from RuneLite

- There is no VarbitChanged or ItemContainerChanged event here: Rapid Heal and the Lightbearer are
  checked every tick, which comes to the same.
- The notification is a game message and a browser notification instead of a tray notification.
