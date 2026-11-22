# Sophanem gates

Sophanem's two entrances are pass-through gates: Open lets the player through, and the gate shuts behind
them. They are entries in `PASS_THROUGH_GATES` in `server/plugins/objects/Doors.plugin.js`.

## What live does (rsprox captures)

| Gate | Closed locs | Open swap | Sound | Restored |
|---|---|---|---|---|
| North gate | `sophanem_gate_left` 44036 at 3283,2809 and `sophanem_gate_right` 44038 at 3284,2809, rotation 1 | inviswall 38848 on both gate tiles (rotation 1); `sophanem_gate_left_inactive` 44037 at 3283,2810 rotation 0 and `sophanem_gate_right_inactive` 44039 at 3284,2810 rotation 2 | 69 (`grate_open`) | 2 ticks after opening |
| Small east gate | `sophanem_gate_small` 44040 at 3322,2761, rotation 2 | inviswall on the gate tile (rotation 2); `sophanem_gate_small_inactive` 44041 at 3323,2761 rotation 3 | 69 | 2 ticks after opening |

- The player steps across on the tick the gate opens. That is the first tick after they reach the
  tile next to it.
- The `_inactive` leaves are nameless and have no options, so the gate never stays open.
- Sources:
  - North gate: the user's rsprox capture local 1002026 (rev 242), ticks 2150-2154; rsprox.net 331
    (rev 230), ticks 1367-1372, 1680 and 1744.
  - Small east gate: rsprox.net 331, ticks 13597-13603, 14086-14089 and 16874; rsprox.net 2660 and
    2666 (rev 229).
- Crossing the north gate inward changes the music to City of the Dead. That comes from the
  region music, not from the gate.

## Not covered

- The OSRS Wiki says Sophanem needs partial progress in Icthlarin's Little Helper. Neither the Wiki
  nor any capture shows a gate refusing someone. Ours: the gates open for everyone, as they did
  before this change.
