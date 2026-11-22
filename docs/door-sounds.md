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
operations. The regression test checks the outgoing synth frames, both map
swaps and stale clicks for each family. The upper-tier `darkm_rich_door` family
and unattended auto-close audio need separate capture evidence.
