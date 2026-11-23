# Hydras

Hydra combat (Mount Karuulm's Karuulm Slayer Dungeon, 95 Slayer). Implemented in
`server/plugins/npcs/Hydras.plugin.js`, with its values in `server/plugins/npcs/data/hydras.json`.
The Alchemical Hydra is a different NPC with its own plugin.

## Sources

- OSRS Wiki, [Hydra](https://oldschool.runescape.wiki/w/Hydra): Magic and Ranged, max hit 22,
  attack speed 6. Hydras "start off with a random combat style" and switch "after three attacks,
  regardless if they hit or not". The middle head "can also spit poison at three random tiles (one
  at the player's location, two elsewhere)". That "is used on every twelfth attack and does not
  count towards the three attacks". The count isn't reset by leaving combat. The initial splat is
  3x3, and standing on a pool deals 4 poison damage every two ticks, or 1 to 2 with poison immunity.
  The infobox lists it as poisonous through its special attack only.
- rsprox captures, recordings 1000480 (rev 227, ticks 2357-2363, 3822-3828, 13012-13022,
  13290-13296; other players fighting hydras) and 1000143 (rev 227, tick 215: the spit).

## What live sends

| | Magic | Ranged | Spit |
| --- | --- | --- | --- |
| Animation | `hydra_lesser_attack_magic` 8262 | `hydra_lesser_attack_ranged` 8261 | `hydra_lesser_attack_special` 8263 |
| Projectile | `hydraboss_magic_proj` 1662, heights 30/16 | `hydraboss_ranged_proj` 1663, heights 30/31 | `hydraboss_pools_proj` 1644 to each of three tiles, heights 30/16 |
| Flight | start 30, end 40 + 5 a tile from the hydra's south-west tile | the same | start 30, end 60 + 10 a tile from the launch tile |
| Sound | area sound 4083 on the target tile, delay = flight end | 4120, the same | 4135 on each tile, range 5 |
| Hit | the flight's whole ticks (2 for a 60-cycle flight) | the same | none of its own |

- Every flight starts on the hydra's centre tile (its south-west tile + 1,1; it is 3x3). The 9
  basic flights recorded all end at 40 + 5 a tile: 45 at 1, 55 at 3, 60 at 4, 65 at 5, 95 at 11,
  100 at 12. The Alchemical Hydra's flights follow the same rule.
- The spit: angle 0 and progress 64 for every flight. The splash graphic (`hydraboss_pools_splash`
  1645) is sent on each tile at the flight's end. Each blob lands (`hydraboss_pools_landing_*`)
  floor(end / 30) ticks later and settles (`hydraboss_pools_landed_*`) the tick after. The two
  other blobs fell within 3 tiles of the first.

## Choices ("Ours")

- The pool's lifetime: 13 ticks, the time the Alchemical Hydra's pools (the same graphics) were
  recorded to hurt for. The settled graphic itself plays for 16 ticks (seq 8287). No source shows
  a player standing in a lesser hydra's pool.
- The 3x3 splat's damage: the Wiki gives its area but no number. It deals the pool's damage (4, or
  1 to 2 with poison immunity) once, on landing.
- The spit deals poison damage (a green hitsplat) but does not poison the player. The Wiki gives
  no starting poison damage.
- The other two tiles are any distinct tiles within 3 of the player's. The landing graphic's
  angle variant is random, as in the Alchemical Hydra plugin.
- Reach: 10 tiles. No source states it; recording 1000480 has shots from 10 tiles of its footprint.
- Poison immunity is an antipoison's protection, or content saying no to a poison
  (`combat:status-apply`).
