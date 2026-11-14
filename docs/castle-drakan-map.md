# Castle Drakan map

During The Blood Moon Rises, the world map orb inside Castle Drakan opens the castle's own
floor map (`castle_drakan_world_map`, interface 967) instead of the world map.
`server/plugins/quests/bmr/CastleMap.TheBloodMoonRises.js` implements it.

## Facts (rsprox captures)

From rsprox.net recording 4288 (revision 239), a full run through the castle:

- **The orb's op1.** The cache's `orbs_worldmap_op1` (script 2892) names the orb's op1
  "View Castle Map" while `in_castle_drakan_instance` (varbit 15498) is 1 and `myq6`
  (varbit 15464) is at most 82. The Gauntlet's and Sangvesti's maps use the same op.
  Clicking it opens 967 on `toplevel_pre_eoc:floater` as an overlay, with no events
  (its buttons transmit on their own). Ticks 3182, 3722, 8455, 13116 and others.
- **`in_castle_drakan_instance`** went to 1 two ticks after the player arrived in the
  castle (tick 3126), and back to 0 when they left for Sangvesti (tick 14549). Later
  visits after the quest stage passed 82 set it again, but the orb no longer offers the
  map there.
- **`castle_drakan_world_map_floor`** (varbit 15489) is the floor the map shows. The map's
  buttons set it: Dungeon 0, Ground floor 1, First floor 2, Second floor 3 (ticks 6256-6259,
  13450, 13453). The server also sets it:
  - **when the player changes floor**, on the tick they arrive. Each of the 40-odd floor
    changes in the recording matches one floor per map square of row 115 (y 7360-7423):
    | square x | tiles | plane 0 | plane 1 |
    | ---: | --- | ---: | ---: |
    | 36 | 2304-2367 | 1 | 2 |
    | 37 | 2368-2431 | 1 | |
    | 38 | 2432-2495 | 2 | |
    | 39 | 2496-2559 | 3 | |
    | 40 | 2560-2623 | 0 | |
  - **when the map opens**, to the floor the player stands on (tick 13465: 1 to 2, on
    (2312,7369,1)). Otherwise the open sends nothing more.
  - **Not** while the player walks about one floor: after Dungeon was picked on the
    ground floor (tick 6259), it stayed 0 until the next floor change (tick 8247).
- **`castle_drakan_last_floor`** (varbit 15549) is sent on the same tick as 15489, with the
  same value, on every floor change (ticks 3124, 3438, 3457, 3779, 4081 ...). It is not sent on
  the open or by the buttons. The cache's `castle_drakan_worldmap_draw_map` marks the player's
  room (`castle_drakan_last_room`) only while it equals the floor shown.
- **Closing.** Close (967:14, which Escape also triggers) closes it (ticks 3192, 3730),
  and so does the orb's op2 while it is open (tick 13466). Move (967:4) is client-side.

## Implementation

- The plugin syncs the three varbits on `onPlayerMapSquareChange` (which also fires on a plane
  change) and on login. It sends the floor only when the floor of the new tile differs from
  the old one, so a floor picked on the map stays.
- The Blood Moon Rises room graph keeps its own `castle-floor` attribute for its door and
  stair rules. It no longer sends 15489 or 15549 (the plugin sends both on each floor change):
  its floors disagree with the map's (it counts the
  sq 38 hall as floor 1; live shows it as the first floor).
- `"player:widget-action"` takes the orb's op1 (where the client offers the castle map)
  and its op2 (while the castle map is open). Every other orb click goes on to the world
  map as before.
- While the player is attacking something, op1 answers "You can't do that right now." and
  opens nothing (tick 13500, fighting a castle crow). Being hit while not attacking still
  opens the map (tick 12562 hit, 12564 opened while running off), so the check is the
  player's own combat target, not "under attack".
- `server/tests/castle-drakan-map.test.cjs` replays the recording's floor changes, opens
  and clicks.

## Not covered

- The two-tick delay before `in_castle_drakan_instance` is set. Ours: the same tick.
- The Gauntlet and Sangvesti maps.
