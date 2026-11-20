# Drakes

Drake combat (Mount Karuulm's Karuulm Slayer Dungeon, 84 Slayer). Implemented in
`server/plugins/npcs/Drakes.plugin.js`, with its values in `server/plugins/npcs/data/drakes.json`.

## Sources

- OSRS Wiki, [Drake](https://oldschool.runescape.wiki/w/Drake): attack styles Ranged and
  "Ranged melee", max hit 15 each, attack speed 4; both are blocked by Protect from Missiles;
  drakes melee from a diagonal as well.
- rsprox captures, recording 3014 (rev 231, ticks 217-229): three shots and one swing against a
  player south of a drake.

## What live sends (recording 3014)

| | Shot | Swing |
| --- | --- | --- |
| Animation | `drake_ranged` 8276 | `drake_melee` 8275 |
| Sounds at the attack | 4136 (delay 5), 1965 (delay 20) | 4130 |
| Projectile | `drake_range_proj` 1636: start 44, end 57 + 3 a tile, heights 80/90 as sent, angle 10, progress 128 | none |
| Hit | 2 ticks after the attack (at 2, 6 and 7 tiles) | the same tick |

- The shot starts one tile from the drake's centre toward the player (its head): 1311,10236 for a
  drake at 1308,10235. The landing cycle counts tiles from there (63 at 2, 75 at 6, 78 at 7).
- From range only shots. Beside the player both: a shot at tick 221 and a swing at tick 225 from
  the same tile.

## Choices ("Ours")

- Beside the player (an edge or a corner) the swing is picked half the time. One capture shows
  one of each.
- The shot's reach is core's NPC ranged reach (6). No source states it.

## Not covered

- The volcanic breath special attack (Wiki: after seven auto-attacks, 6-8 damage four times, a
  fireball aimed at the player's tile). No capture shows it, so its graphics (`drake_burn_proj`
  1637, `drake_burn_impact` 1638 by cache name) and timing are unknown.
- The Guardian Drake superior (10400) and its stun special.
- The hot dungeon floor (boots of stone) is a separate mechanic.
