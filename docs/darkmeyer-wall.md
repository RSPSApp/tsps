# Darkmeyer wall shortcut

Darkmeyer's eastern wall into Slepe is an Agility shortcut you build yourself
([Wiki: Wall (Darkmeyer)](https://oldschool.runescape.wiki/w/Wall_(Darkmeyer)?oldid=14997920),
[Long rope](https://oldschool.runescape.wiki/w/Long_rope?oldid=15290229)).

- **Plugin:** `server/plugins/areas/DarkmeyerWall.plugin.js` attaches the ropes.
- **Climbs:** the two `Wall (Darkmeyer, ...)` entries in `server/plugins/skills/data/agility-shortcuts.json`.
- **Test:** `server/tests/darkmeyer-wall.test.cjs`.

## The walls

Two walls stand side by side, with a tile on top between them:

| Wall | Multiloc | Placed at | Varbit | Ends |
| --- | --- | --- | --- | --- |
| Inner | `darkm_outer_wall_2h_shortcut` (39542): 39169 without a rope, 39168 "Wall" (Climb) with one | (3668, 3375) | `darkm_shortcut_inner` (10449) | (3667, 3375) Darkmeyer side, (3670, 3375) on top |
| Outer | `darkm_outer_wall_3h_shortcut` (39541): 39167 without a rope, 39166 "Wall" (Climb) with one | (3671, 3375) | `darkm_shortcut_outer` (10450) | (3670, 3375) on top, (3673, 3375) Slepe side |

## What the captures show

rsprox captures 362 (rev 230, normal world) and 1862 (rev 227, Leagues V):

- **Long rope on a wall without one:** on arrival the player faces the wall and plays
  `human_pickuptable` (inner wall, rec 362 tick 3550) or `human_pickupfloor` (outer wall, rec 362
  tick 3951, rec 1862 tick 18633). The rope leaves the inventory, the wall's varbit goes 0 to 1, and
  a message box says "You attach the rope to the wall.". The varbit stays set for good.
- **Long rope on a wall that has one:** "Nothing interesting happens." (rec 362 tick 3786), the
  game's line for an item used on a loc nothing handles; the rope stays.
- **Climb:** face the way they're going, then up with `human_reachforladder` (828) or down with
  `human_pickupfloor` (827), and the move to the far end a tick later. No sound, message or
  animation reset (rec 362 ticks 3829, 4036, 4042, 4234, 4237; rec 1862 ticks 18629-18641).

The Wiki gives the rest: Climb needs 63 Agility (boosts work) and gives no experience, and attaching
a rope needs no Agility.

## Not covered

- **Ours:** the refusal below 63 Agility is the shortcuts' generic "You need an Agility level of at
  least 63 ..." line; no capture has one.
- **Ours:** a rope can be attached from either side of a wall. The captures attach the inner one from
  Darkmeyer and the outer one from the top.
- The Darkmeyer wall jump to the master clue STASH (86 Agility), for which the Wiki says this
  shortcut is a prerequisite.
