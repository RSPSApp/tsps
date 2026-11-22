# Doors that never open

`server/plugins/objects/LockedDoors.plugin.js` answers Open on these doors with their recorded
locked line; the door stays shut. The table is `server/plugins/objects/data/locked-doors.json`.

The Doors plugin pairs a closed "Open" loc with closed id + 1 when that is a same-model
"Close" loc. Two locked doors fit the rule (`prisonbarsdoor_locked` 9563 -> `prisonbarsdoor_open`
9564, `frisb_abode_door_locked` 21341 -> `frisb_abode_door_open` 21342), so they swung open, and
`fortis_door_l_locked` (55096) opened as well. LockedDoors claims them through Doors'
`door:toggle` request before any pair is looked up.

From rsprox captures:

| Loc | Where | Live | Recordings |
| --- | --- | --- | --- |
| `prisonbarsdoor_locked` (Cell door) | Port Sarim jail cells, 3012,3189 and 3012,3195 | chat "The door is securely locked.", synth 2402, the player turns to the door; on arrival (the click itself when already beside it) | rec 323 (rev 230) ticks 4202, 4897, 4900 |
| `fortis_door_l_locked` (Door) | Civitas illa Fortis, 1500,3223 | the player walks to 1500,3222; the tick after arrival a message box "The door is locked." with synth 2402 | rec 1695 (rev 226) tick 2556 |
| `frisb_abode_door_locked` (Door) | Neitiznot houses, 2347,3801 | chat "The door is locked.", no sound, the player turns to the door | local 1000321 (rev 227, a Leagues world) tick 11928 |

Ours: `fortis_door_r_locked` (55097), the other leaf of the Civitas door, answers as the left
one; no capture clicks it. The Wiki gives no locked-door line for any of them.
