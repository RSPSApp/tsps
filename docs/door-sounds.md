# Darkmeyer door sounds

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
