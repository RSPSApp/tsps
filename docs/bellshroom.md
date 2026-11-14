# Tar Swamp Bellshroom

`server/plugins/world/Bellshroom.plugin.js`. The Bellshroom in Fossil Island's Tar Swamp (loc
30670 `fossil_flora_swamp_bellshroom`, at 3666, 3735, south-west of the Magic Mushtree) takes
breadcrumbs and swallows the player into the small clearing to its north-west, where Charles
Charlington is. The clearing's own Bellshroom (30671 `fossil_flora_swamp_bellshroom_return`,
Exit) brings them back; that one is a loc teleport in `plugins/world/data/loc-teleports.json`
(docs/loc-teleports.md).

## As live OSRS plays it

From the rsprox capture database, recording 710 (rev 231). Ticks count from the click; the
player was already beside the Bellshroom both times.

| Tick | What happens |
| --- | --- |
| 1299 +1 | Investigate: message box "Maybe its hungry..." (the player had breadcrumbs in the pack) |
| 1393 +2 | Breadcrumbs used on it: one Breadcrumbs (`hundred_pirate_breadcrumbs`, 7515) leaves the pack |
| +4 | sound 2454 (6 loops, delay 13), loc animation `fossil_bellshroom_swallow` (7744) |
| +5 | fade out: overlay 174 on 161:1, script 948 `[0, 255, 0, 0, 15]` |
| +6 | teleport to (3656, 3750, 0), facing south (angle 0), sound 2489 |
| +7 | the player says "What just happened?"; fade in, script 948 `[0, 0, 0, 255, 50]` |
| +9 | the fade overlay closes |

The plugin's handler runs a tick after the click (as LocTeleports counts), so its task ticks are
these minus one.

The OSRS Wiki (Bellshroom) gives breadcrumbs as the way in, with no quest or skill requirement.
It writes the Investigate message as "Maybe it's hungry..."; the game sends "Maybe its hungry..."
(rec 710 tick 1300, `message_game`), and the plugin sends what the game sends.

Moved off their tile, or into or out of an instance, before the move (a teleport during the
swallow), the swallow stops there and the fade overlay closes; the crumb, eaten first, stays
eaten. Breadcrumbs used while something else holds the player's movement do nothing. Both are
ours, as LocTeleports does it (none recorded).

## Not covered

- The capture also sets varbit 15064 `sanity` 0 -> 100 on arrival and hides the HP bar HUD during
  the fade; neither is sent here (the sanity varbit's meaning isn't known from this one record).
- Ours: breadcrumbs dropped or banked between the use and the tick they are eaten end the swallow
  there (none recorded).
- The exit Bellshroom's loc animation (rec 710 tick 2216, +5) and its 15-cycle fade out come from
  LocTeleports' shared handling, which plays neither as captured.
