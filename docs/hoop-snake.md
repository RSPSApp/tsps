# Hoop Snakes

Hoop Snakes (npc 7802) live in Fossil Island's Tar Swamp. A player stuns one, picks the
stunned snake up, and then rolls or releases the hoop snake item (21624).
`server/plugins/npcs/HoopSnake.plugin.js` does this.

## Captured (rsprox captures 708, 709, 710, 3038 rev 231; 3215 rev 232)

| action | what live sends |
| --- | --- |
| Stun, non-crush style | "You need to use a blunt attack to stun the snake." (game message) on arrival (3038, 709) |
| Stun, miss | "The movement of the snake causes you to miss." (game message) on arrival, with no animation (708, 710) |
| Stun, hit | on arrival: transformation to `fossil_hoopsnake_stunned` (7803) and spotanim `stunned` (80). No player animation. The snake stands still |
| stun wears off | 10 ticks later, if nobody picked it up: telejump back to its spawn tile with seq -1, a Hoop Snake again (708 ticks 294 -> 304, 882 -> 892) |
| Pick-up | `human_pickupfloor` (827), synth sound 2582 (delay 10), the NPC is deleted, +1 `fossil_hoopsnake` (21624) (709 66; 708 2237, 2360, 3115, 3466) |
| respawn | 17 ticks after the pick-up, at its spawn tile (709 66 -> 83; 708 2237 -> 2254, 2360 -> 2377, 3115 -> 3132, 3466 -> 3483) |
| Roll | chat menu "Roll the hoop snake forward?" with "Yes." and "No." |
| Roll, Yes | `human_pickupfloor` (827), the item is removed, `map_projanim` 1408 from the player's tile to the tile 7 squares ahead in the direction they face: start 0, end 105, angle 127, progress 0, heights 0 (708 1866, 2249, 2464, 3150, 3475; 709 82; 710 434). One roll went 7 squares on both axes (708 3475) |
| Release | "You let the snake go." (game message), and the item is removed (708 2367, 3215 657) |

The recordings have 11 stuns and 17 misses in 28 blunt attempts.

## From the Wiki

[Hoop Snake](https://oldschool.runescape.wiki/w/Hoop_Snake): a stun lasts about 10 ticks.
Stunning needs the player to be unarmed or to use a crush style, and it can fail. "Crush attack
bonus does not seem to have a noticeable impact on success rates". The snake respawns after 17
ticks.
[Hoop snake (item)](https://oldschool.runescape.wiki/w/Hoop_snake_(item)): Roll and Release. The
snake can be rolled anywhere, not only on Fossil Island. With a full inventory, the item "can
appear on the ground".

## Ours

- A stun succeeds 40% of the time (11 of 28 in the recordings). The Wiki gives no rate.
- The blunt check comes first, so a non-crush style never stuns.
- With a full inventory, the hoop snake is dropped where the snake lay.
- A player who has never faced a direction (just logged in, not moved yet) rolls it south.

## Not built

- A rolled snake stunning the Tar Monsters it hits. The recordings show tar monsters turning
  passive (`fossil_tarmonster_passive`, 7805) after a roll at them. The Tar Swamp's tar monsters
  have no plugin yet.
