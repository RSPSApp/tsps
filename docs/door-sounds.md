# Door sounds

## Darkmeyer

Opening the lower- and middle-tier map doors in Darkmeyer plays `A_DOOR_OPEN` (36).
Closing them plays `A_DOOR_CLOSE` (35). Both are private synths sent to the player
who uses the door, on the same tick as the loc swap.

| Cache door family | Open | Close |
| --- | --- | --- |
| `darkm_poor_door_closed` / `darkm_poor_door_open` (39372 / 39373) | Recording 3053, click 479, swap and synth 481 at (3599, 3323, 0) | Recording 3053, click, swap and synth 483 |
| `darkm_middle_door_closed` / `darkm_middle_door_open` (39406 / 39408) | Recording 3050, click 380, swap and synth 381 at (3605, 3358, 0) | Recording 3050, click, swap and synth 383 |

Private recording local 1000270 also shows the middle-tier open synth on tick 9436
and close synth on tick 9440. The Wiki documents access to Darkmeyer. The sound
IDs and their placement in the interaction come from the rsprox captures.
[Darkmeyer on the OSRS Wiki](https://oldschool.runescape.wiki/w/Darkmeyer),
[rsprox capture database](https://rsprox.net/database).

The shared door plugin chooses the click sound from the closed loc ID for both
operations. The regression test checks that each map swap and the actor's synth
reach their recipients on the same tick, and that stale clicks are silent.

Recording 3052 shows an unattended middle-tier close. At (3619, 3381, 0), the
Open click at tick 7073 produces the loc swap and synth at tick 7075. The reverse
swap at tick 7574 has no door sound for the nearby recorder. The server still
sends positioned sound 60 on that timed close. Audio for the upper-tier
`darkm_rich_door` family and unattended lower-tier closes still needs captures.
[rsprox capture database](https://rsprox.net/database).

## Fremennik Isles doors

`Doors.plugin.js` keys these sounds by closed loc in the same click-sound table
(`DOOR_CLICK_SOUNDS`), used by single and double doors. A side with no recording keeps
the generic door sound. From rsprox captures:

| Door | Where | Live | Recordings |
| --- | --- | --- | --- |
| `fris_palisade_door_l` / `_r` (21507 / 21505) | Neitiznot palisade gate, 2328,3805 / 2328,3804 (face 2) | Open: both closed leaves go, synth 36. The clicked leaf opens as `fris_palisade_door_open_r` and its partner as `fris_palisade_door_open_l`, whichever leaf was clicked; 2329,3805 always gets rotation 1 and 2329,3804 rotation 3 | `door_l`: rec 2722 (rev 229) tick 75, rec 3027 (rev 231) tick 8896; `door_r`: rec 3027 ticks 6880, 7466, 10387 |
| `frisd_town_wall_door` (21399) | Jatizso town wall, 2407,3806 | Open: `frisd_town_wall_door_open` on the tile north, synth 71 | rec 3027 ticks 3760, 4738 |

The `_l` leaves are mirrored in the cache (`isRotated`) and the `_r` ones are not. Before this
change, every leaf opened as its own id + 1, so a click on `door_l` showed the leaves that live
shows for a `door_r` click. Both doors also played the generic 62.

Not covered: neither door has a recorded Close made by the player. The palisade Close windows
(rec 3027 tick 8871, rec 90 tick 9134) were cut off by the next click, and the gate shut with
no synth to the recorder. So both still play the generic close sound (60). Ours.

## Nicedoor double doors

Some double doors use `nicedoor_open` (81) and `nicedoor_close` (80) instead of the
plain door pair (62/60). The shared door plugin lists them in `DOOR_CLICK_SOUNDS` and picks
them from either closed leaf's ID.

| Cache door family | Open | Close | How it is sent |
| --- | --- | --- | --- |
| Arceuus `archeuus_door_double_left/right_*` (turquoise 28456/28460, green 28457/28461, red 28458/28462, blue 28459/28463) | Private recordings local 1001998 ticks 1222-1223 and 1335-1336 (blue, (1718, 3727-3728, 0)), local 1000453 ticks 9679-9681 (green, (1642, 3805-3806, 0)) | Recording 2297 ticks 448-457 (turquoise, (1632-1633, 3817, 0)) | Area sound, range 1, on the clicked leaf's tile |
| Goblin outpost `goblin_outpost_poordoor_double_inner` / `_doubler_inner` (12446 / 12448) | Private recording local 1001339 click 301, swap and synth 302 at (2957-2958, 3509, 0); recording 3243 | local 1001339 click 308, swap and synth 309 | Private synth to the player using the door |

The Arceuus leaves of one colour are four loc IDs apart, so the consecutive-ID pairing
cannot find them. The plugin lists the four colour pairs, and any left leaf partners any right
leaf: the map mixes colours in two doorways (blue left beside green right at (1678, 3784-3785, 0),
opened as one pair in recording 1702 tick 767; turquoise left beside red right at (1678, 3802-3803, 0)). Both leaves turn on their own tiles
into their `_open` locs: the right leaf turns one step clockwise and the left leaf one step
anticlockwise, as recorded. The red set has no recording. It shares model 30746 and the ID layout of
the other three, so the plugin treats it the same way.
