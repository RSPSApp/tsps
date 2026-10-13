# Catacombs of Kourend

`server/plugins/areas/CatacombsOfKourend.plugin.js` handles the way in and out through the statue
of King Rada I in Kourend Castle's courtyard (loc 27785 at 1634, 3671, 5×5).

## From rsprox captures

Ticks count from the player's arrival at the statue.

| Option | Captured |
| --- | --- |
| Investigate | +1 faces the statue; +2 `human_pickupfloor` (827) and "You investigate what looks like hinges on the plaque and find it opens."; +3 "You climb down the hole." and the fade out; +5 moved to (1666, 10050, 0); +7 the fade in |
| Read | +2 `human_use_wom_telecope` (2171); +3 the long scroll (interface 625, script 418) "Kourend the Magnificent" |

## Multi-combat

Two `multi-combat` zones in `server/data/definitions/world.json` cover the Catacombs (x 1600-1791,
y 9984-10111) except the brutal dragons' north-west corner (x 1600-1639, y 10067-10111), which is
single-combat.

The border comes from rsprox captures: the `multiway_indicator` varbit (4605) as players walked in
and out of the corner. It is off across x 1613-1635, y 10067-10097, and on from x 1640 and south of
y 10067. The varbit follows a move by a tick, so the border is accurate to a tile.

## Ours

- **The vine ladder:** the one beside the landing (loc 28894 at 1666, 10051) climbs back to the
  statue's east side (1639, 3673). Nothing was captured for it: the ladder animation (828), the
  tile and the fade are ours.

## Not built

- **The other exits:** the four corner vine ladders (Wiki: Demon's Run, Dragon's Den, Reeking
  Cove, The Shallows).
- **The surface holes** those exits unlock, and the links to the Forthos Dungeon and the Giants'
  Den.
