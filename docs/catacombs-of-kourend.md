# Catacombs of Kourend

`server/plugins/areas/CatacombsOfKourend.plugin.js` handles the way in and out through the statue
of King Rada I in Kourend Castle's courtyard (loc 27785 at 1634, 3671, 5×5).

## From rsprox captures

Ticks count from the player's arrival at the statue.

| Option | Captured |
| --- | --- |
| Investigate | +1 faces the statue; +2 `human_pickupfloor` (827) and "You investigate what looks like hinges on the plaque and find it opens."; +3 "You climb down the hole." and the fade out; +5 moved to (1666, 10050, 0); +7 the fade in |
| Read | +2 `human_use_wom_telecope` (2171); +3 the long scroll (interface 625, script 418) "Kourend the Magnificent" |

## The other exits (#4256)

Four corner vines and the Giants' Den vine climb out. The first climb of each opens its way back in
for that player: a multiloc on the surface (or in the Forthos Dungeon / Giants' Den) shows a
`Boulder` or `Strange wall` until its varbit is 1, then a `Hole` or `Strange passage` with Enter.
The varbits share varp 1345 (`cata_trans`); the plugin keeps the opened ones in
`catacombs-of-kourend:exits` and sends them again at login.

| Exit (Wiki) | Vine (cache) | Varbit | Way back in | Up to | Back down to |
| --- | --- | --- | --- | --- | --- |
| Demon's Run, NE | `zeah_cata_exit_04` (28898) at 1719, 10102 | `cata_hole3` (5089) | Hole, `cata_hole3_multi` at 1696, 3865 (west of the dense essence mine) | 1696, 3864 | 1719, 10101 |
| Dragon's Den, NW | `zeah_cata_exit_01` (28895) at 1617, 10102 | `cata_hole4` (5090) | Hole, `cata_hole4_multi` at 1563, 3791 (north of The Deeper Lode) | 1562, 3791 | 1617, 10101 |
| Reeking Cove, SW | `zeah_cata_exit_02` (28896) at 1650, 9986 | `cata_hole2` (5088) | Hole, `cata_hole2_multi` at 1470, 3653 (north-west of the Shayzien bank) | 1469, 3653 | 1650, 9987 |
| The Shallows, SE | `zeah_cata_exit_03` (28897) at 1726, 9993 | `cata_hole1` (5087) | Strange passage, `cata_hole1_multi` at 1804, 9967 (Forthos Dungeon) | 1803, 9968 | 1726, 9994 |
| Giants' Den | `zeah_cata_exit_giants_den` (42350) at 1639, 10047 | `cata_hole_giants_den` (12341) | Strange passage, `cata_hole_giants_den_multi` at 1462, 9878 | 1461, 9879 | 1639, 10046 |

From rsprox captures (recording 3024, rev 231, the Giants' Den vine): arrival +1 faces the vine,
+2 `human_reachforladder` (828) and `cata_hole_giants_den` 0→1, +3 the move to (1461, 9879). No
fade, no message. The Giants' Den vine plays from `loc-teleports.json` (docs/loc-teleports.md); the
plugin opens its passage on `loc-teleports:arrived`, a tick after the captured varbit. The corner
vines play the same steps.

## Multi-combat

Two `multi-combat` zones in `server/data/definitions/world.json` cover the Catacombs (x 1600-1791,
y 9984-10111) except the brutal dragons' north-west corner (x 1600-1639, y 10067-10111), which is
single-combat.

The border comes from rsprox captures: the `multiway_indicator` varbit (4605) as players walked in
and out of the corner. It is off across x 1613-1635, y 10067-10097, and on from x 1640 and south of
y 10067. The varbit follows a move by a tick, so the border is accurate to a tile.

## Ours

- **Exit tiles and the way back in:** no capture or Wiki tile for the corner vines' tops or any
  Enter; the tiles are Shortest Path's transports. Enter on a hole kneels (`human_pickupfloor`, as
  the statue's hole does) and moves a tick later; a strange passage moves a tick later with no
  animation.
- **The vine ladder:** the one beside the landing (loc 28894 at 1666, 10051) climbs back to the
  statue's east side (1639, 3673). Nothing was captured for it: the ladder animation (828), the
  tile and the fade are ours.

## Prayer restore

Bones buried here, or crushed by a bonecrusher, give back their Prayer points (Wiki: bones 1, big
bones 2, dragon bones 4; every bone's value is in `server/plugins/skills/data/bones.json`). The
plugin answers Prayer's `prayer:bone-restore` for x 1600-1791, y 9984-10111; a dragonbone necklace
gives the same points and never adds to them. See [prayer-bones.md](prayer-bones.md).

## Skotizo

The altar in the centre (28900) takes a dark totem to Skotizo's lair, and the Catacombs' monsters
drop the totem pieces and ancient shards: see [skotizo.md](skotizo.md).

## Not built

- Nothing the exits need; no first-unlock message was captured, so none is sent.
