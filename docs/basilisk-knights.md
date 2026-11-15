# Basilisk Knights

Basilisk Knights (`basilisk_knight` 9293, Jormungand's Prison) fight with melee and magic.
`server/plugins/npcs/BasiliskKnights.plugin.js`, data in `server/plugins/npcs/data/basilisk-knights.json`.

## Before

The engine gives a hybrid NPC one style, and anything that can melee keeps meleeing
(`NpcDefinitionLoader.resolveAttackType`). Knights walked up and slashed, and never cast.

## Rules

From the Wiki (Basilisk Knight, Basilisk Knight/Strategies):
- **Both styles max 20.** That's the monster dump's max hit, so neither style scales it.
- **Walks in:** knights "will attempt to enter melee range once engaged in combat". Until it's
  beside the player a knight has melee's reach, so it walks to a side of the player (not a diagonal).
- **Out of melee range, magic only.** A knight that can't step closer casts from where it stands, up to
  10 tiles away (range 10 is ours). That's when its step toward the player hits scenery, or it's frozen.
  Beside the player across a wall or fence counts too: melee range needs that edge open (core's melee
  reach), so there it casts and never swings through the wall.
  It holds while neither of them moves; once one does, the knight tries to walk in again. Another NPC in
  the way isn't scenery: the knight waits to walk on.
- **Attack speed out of melee range:** the player's current attack speed, but never faster than 4 ticks.

From the rsprox capture of recording 1862 (rev 227, Leagues V, ticks 9670-10030):
- **Beside the player:** both styles, every 4 ticks. At tick 9686 the knight at 2453,10384
  (3x3) meleed a player standing east of it, meleed again at 9690, then cast at 9694.
  - The split between the styles is ours: 50/50.

## What a player sees (rec 1862)

**Melee** (`basilisk_knight_melee` 8499):
- Sounds 4199 (delay 6) and 4198 (delay 53).
- The hit shows the next tick.

**Magic** (`basilisk_knight_magic` 8500):
- **Projectile** `basilisk_knight_magic_travel` 1735: start 45, angle 2, progress 16, heights 20 and 26
  (packet values). It ends at cycle 60 up to 3 tiles from the knight's centre tile, then 6 cycles a tile
  later (63 at 4, 69 at 5, 75 at 6). That's across 1,092 casts.
- **Impact** `basilisk_knight_magic_impact` 1736: height 104, sent with the cast and delayed to the
  projectile's end. It's sent hit or miss (597 of the 603 casts at the recorder; no splash).
- **Sounds:** 4210 (delay 6) and 157 (delay 12), then 158 delayed to the projectile's end.
- **The hit** shows when the projectile lands (`Projectile.ticksToLand`: 2 ticks at 60, 3 at 63-75).

Without a mirror shield or V's shield their hits are `skills/slayer/Equipment.Slayer.js`'s (`slayer-gear.json`).

## Not covered

- **The Basilisk Sentinel** (9258, 12566), the superior: it has its own attacks (`basilisk_knight_entomb_travel`).
- **Retaliation:** the Wiki says that out of range a knight "will only retaliate with Magic whenever
  attacked by the player". Here it attacks on its own timer at the player's speed, and isn't synced to the player's attacks.
- **Sources:** the only recordings with these attacks are Leagues V (rev 227). No main-game capture yet.
