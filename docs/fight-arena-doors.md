# Fight Arena doors

Two plain doors in the Fight Arena compound (`fightarena_door1`, loc 81) are pass-through doors: Open
lets the player through and the door shuts behind them. They are entries in `PASS_THROUGH_GATES` in
`server/plugins/objects/Doors.plugin.js`. The arena's own door (`fightarena_door2`, loc 82) is the
quest's and stays in `FightArena.Quest.js`.

## What live does (rsprox captures)

| Door | Closed loc | Open swap | Sound | Restored |
|---|---|---|---|---|
| North door | `fightarena_door1` 81 at 2617,3171, rotation 1 | inviswall 38848 on the doorway (rotation 1); `inactivepoordoor` 1539 at 2617,3172 rotation 2 | 62 (`door_open`) | 2 ticks after opening |
| West door | `fightarena_door1` 81 at 2585,3141, rotation 0 | inviswall on the doorway (rotation 0); `inactivepoordoor` at 2584,3141 rotation 1 | 62 | 2 ticks after opening |

- The player steps onto the doorway tile on the tick the door opens. That is the first tick after they
  reach the tile outside it (or the click's own tick when they already stand there), so the entries set
  `operateBeforeMovement`.
- `inactivepoordoor` is nameless and has no options, so the door never stays open. Before this,
  loc 81 fell to the generic door handler, which swung it open for 500 ticks.
- Sources: the user's rsprox captures local 1001680 (rev 241), ticks 7032-7036 (north door) and
  7335-7337 (west door); local 1002138 (rev 242), ticks 11377-11380 and 11676-11678.

## Not covered

- Both recordings cross each door one way only, from the open leaf's side onto the doorway tile. Ours: the
  other direction uses the same swap, sound and timing.
