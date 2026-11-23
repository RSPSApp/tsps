# Doors that never open

`server/plugins/objects/LockedDoors.plugin.js` answers Open on these doors with their recorded
locked line (a chat message, a message box, or an NPC's chathead line); the door stays shut. The table is `server/plugins/objects/data/locked-doors.json`.

The Doors plugin pairs a closed "Open" loc with closed id + 1 when that is a same-model
"Close" loc. Two locked doors fit the rule (`prisonbarsdoor_locked` 9563 -> `prisonbarsdoor_open`
9564, `frisb_abode_door_locked` 21341 -> `frisb_abode_door_open` 21342), so they swung open, and
`fortis_door_l_locked` (55096) opened as well. LockedDoors claims them through Doors'
`door:toggle` request before any pair is looked up.

From rsprox captures:

| Loc | Where | Live | Recordings |
| --- | --- | --- | --- |
| `prisonbarsdoor_locked` (Cell door) | Port Sarim jail cells, 3012,3189 / 3012,3192 / 3012,3195 | chat "The door is securely locked.", synth 2402, the player turns to the door. Answered from either side, the wall's end tiles too: idle at 3012,3196 the reply comes on the click tick (face south); from 3012,3187 one step to 3012,3188, the reply the next tick (face north) | rec 323 (rev 230) ticks 4202, 4897, 4900 |
| `fortis_door_l_locked` (Door) | Civitas illa Fortis, 1500,3223 | the player walks to 1500,3222; the tick after arrival a message box "The door is locked." with synth 2402 | rec 1695 (rev 226) tick 2556 |
| `frisb_abode_door_locked` (Door) | Neitiznot houses, 2345,3807 / 2347,3801 / 2352,3801 | chat "The door is locked.", no sound. From 2349,3801 the player steps to 2348,3801 (the wall's end), then the reply, facing west | local 1000321 (rev 227, a Leagues world) tick 11928 |
| `hos_grape_odddoor` (Door) | Outhouses at the Fossil Island Museum Camp, 3722,3816, and the Hosidius vinery, 1817,3537 | walking up from the south the player stops at 3722,3815 and turns north; the tick after, the man inside (`hosidius_man_on_toilet`, 6776) says "Occupied!" in his chathead (chat_left 231, head animation chatang1 614) with synth 2402. The loc has no open leaf (11764 is the outhouse roof) | rec 3040 (rev 231) tick 5736; local 1000187 (rev 227) tick 4946 |

Doors routes a closed wall door across its face only, which walked the player onto the door's
tile; LockedDoors gives these doors ordinary wall reach (an object route hook added at startup,
after Doors' own) so the player stops on the recorded tile.

The same locs are also placed with no recording: `prisonbarsdoor_locked` at 2573,9705 / 9708 /
9711 and `fortis_door_l_locked` at 1375,2927 and 1397,2972; they answer the same way.
The Hosidius outhouse (the man spawned inside at 1816,3537) is unrecorded; it is the same loc and
answers the same way, as the generated npc-dialogues.json lists "Occupied!" for "Man (Hosidius)"
attempting to open the door. `fortis_door_r_locked` (55097) is not placed in the revision 242 map, so it is not listed. The
Wiki gives no locked-door line for any of them.
