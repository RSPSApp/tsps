# Forthos Dungeon

Code: `server/plugins/areas/ForthosDungeon.plugin.js`, with the east Temple Door's pass-through
entry in `server/plugins/objects/Doors.plugin.js`.

## Temple Doors

Two `Temple Door`s: `hosdun_west_door` (34842, 1802,9957) and `hosdun_east_door` (34843,
1825,9973, a face-0 wall on the west edge of its tile).

Wiki (Temple Door): "Upon first visiting the dungeon, only the eastern door can be opened and
only in one direction: east." Using the temple key on the doors unlocks them for good.

rsprox captures, recording 3926 (rev 236), Open on the east door from 1824,9973:

| tick | what |
|---:|---|
| 613 | click; the player arrives on 1824,9973 |
| 614 | the player steps to 1825,9973; `inviswall` (38848) on the doorway, `hosdun_grubby_door_open` (34841, face 1) on 1824,9973; sound 62 |
| 615 | game message "The door slams shut and locks behind you." |
| 616 | `hosdun_east_door` back, the open leaf removed |

Implemented: the east door from the west side, as above. The opener is carried across and the
inviswall keeps anyone else out while it stands open.

Not implemented: the temple key (Sacred Bone Burner faith), so the east door from inside the
Spider's Den and the west door stay shut. Ours: a locked click sends nothing, since no recording
shows one.
