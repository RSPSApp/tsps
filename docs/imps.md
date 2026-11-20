# Imps

`server/plugins/npcs/Imps.plugin.js`: the plain Imp (5007, gameval `imp`) disappears in a puff
of smoke and reappears a short way off.

## Sources

- [Wiki, Imp](https://oldschool.runescape.wiki/w/Imp): "Every 30–120 seconds there is a 25%
  chance for an imp to disappear into a puff of smoke and teleport a short distance away."
- rsprox captures, rev 241: local 1001018, 1001418 and 1001419 (Lumbridge), 7 teleports.

## What the recordings show

| Recording | Tick | Distance | With a hit |
| --- | ---: | ---: | --- |
| local 1001018 | 306 | 17 | no |
| local 1001418 | 1291 | 20 | no |
| local 1001418 | 2580 | 20 | yes |
| local 1001418 | 2587 | 20 | yes |
| local 1001418 | 3332 | 19 | yes |
| local 1001419 | 283 | 20 | yes |
| local 1001419 | 367 | 20 | yes |

- The imp is removed from its tile and map anim `smokepuff` (86, height 124) plays there with
  area sound 1931 (one loop, range 10). A second `smokepuff` plays on the landing tile the same
  tick. Distance is the larger of the x and y offsets between the two puffs.
- "With a hit": the tick a player's damaging hit on that imp landed (the damage-dealt varp
  changes that tick, after the imp's block animation the tick before). No hitsplat is shown,
  because the imp is gone.
- The imp drops the fight. The player keeps it as the target and runs after it (1001418,
  ticks 2580-2587, then hits it again and it teleports a second time).

## Ours

- **Chance on a hit: 1 in 6.** The Wiki doesn't mention hits. The recordings have 5 teleports
  in about 31 damaging hits on imps, some of them killing blows. The roll is made when the
  damage lands, and only if the imp survives it.
- **Idle roll:** the Wiki's 25% every 30-120 seconds (50-200 ticks, drawn uniformly). It runs
  every 10 ticks for imps a player can see; an imp nobody can see keeps its timer from when it
  was last seen.
- **Landing tile:** any loaded, unblocked, dry tile on the imp's level whose larger offset is
  17-20 tiles (the recorded range). No recording shows a wall or water landing.
- Only the plain Imp. The God Wars Dungeon imp (3134) has no recording; `imp_notele` (14207) is
  the cache's non-teleporting imp. The Champions' Challenge Imp champion has its own arena
  teleport (docs/champions-challenge.md).
