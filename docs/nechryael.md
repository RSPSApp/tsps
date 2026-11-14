# Nechryael death spawns

`server/plugins/npcs/Nechryael.plugin.js` lets nechryael (8, 11) and greater nechryael (7278,
11240) summon death spawns (10). Tests: `server/tests/nechryael.test.cjs`.

## From rsprox captures

Recordings 90 (rev 227, Slayer Tower top floor), 3314 (rev 235) and 4092 (rev 237) on rsprox.net.
All recorded on Leagues worlds; the summon itself is the same monster script.

- A summon takes the place of an attack: the nechryael plays `demons_bringdead` (1529) instead of
  `demons_attack` (1528) and the player takes no hit from it that turn.
- Every summon plays synth sound 2418 (37 of 37 in recording 4092).
- Each summon adds one death spawn, on one of the eight tiles beside the player (all eight seen).
- A `demon_spawn_portal` (333) map anim, height 92, plays with it: on the spawn's tile in 44 of
  105 single summons in recording 90, otherwise on a tile beside it. We play it on the spawn's
  tile.
- The death spawn plays `demon_spawn_attack` (1540) on the tick it appears (or the next), then
  every 4 ticks.
- A death spawn nobody kills is removed 99 ticks after it appeared (95 of 95 uncut lifetimes in
  recording 90, 35 of 35 in 4092).

## From the Wiki

- [Nechryael](https://oldschool.runescape.wiki/w/Nechryael): up to two death spawns per
  nechryael; none while the nechryael can't attack the player (safespotted).
- [Death spawn](https://oldschool.runescape.wiki/w/Death_spawn): max hit 2, 100% prayer
  penetration; in single-way combat it attacks a player who is fighting its nechryael; auto
  retaliate doesn't target it; it doesn't stop a logout; it stops attacking a player more than 7
  tiles away; it leaves after a minute.

## Ours

- The summon chance. No source states it: below the two-spawn cap, recordings 90, 3314 and
  4092 show 163 summons in 986 attacks (16.5%), so one attack in six.
- The tile: a random open, unoccupied tile of the eight beside the player. With none free the
  nechryael attacks normally.

## Not covered

- Wiki: the player can't attack a death spawn while fighting its nechryael in single-way combat.
  With the spawn always multi, they can; no capture shows the refusal.
- Wiki: the spawn's hits don't interrupt a home teleport.
