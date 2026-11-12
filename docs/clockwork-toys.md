# Clockwork toys

The toy soldier, toy doll and toy mouse made at the workshop crafting table
(`plugins/skills/construction/ClockworkToys.Construction.js`).

## Live behaviour (rsprox captures)

Rev 229 recording 2598 (twelve releases, all three toys, in and out of building mode); rev 226
recording 1695 and rev 237 recording 1108 (mouse Wind outside a house).

- **Wind** swaps the toy for its wound form: spam "You wind up the soldier." / "doll" / "mouse",
  synth sound 989.
- **Release** in building mode: "You cannot release clockwork toys while in building mode.", the
  toy stays.
- **Release** otherwise: the wound toy leaves the slot, area sound 941 (range 5) at the player, and
  `poh_clockwork_recentdrop` (9450) goes 0 -> 1. It goes back to 0 78 ticks after the latest release
  (rec 2598 ticks 3829/3907, 3962/4040, 6494/6572, 6893/6971, 7378/7456).
- The NPC (`poh_toy_soldier` 2779, `poh_toy_doll` 2780, `poh_toy_mouse` 2781) is a multinpc. With the
  varbit set, its owner sees `poh_toy_*_1op` ("Toy Soldier" etc., Pick-up). Everyone else sees the 0op
  form, which has no options.
- Soldier and doll appear on the tile the player faces. The mouse appears on the player's own tile.
  The soldier and doll step every tick, with area sound 941 at the tile they leave; the doll turns and
  pauses now and then. The mouse waited 10 ticks, then ran diagonally with no step sound.
- End of the walk: the soldier plays `poh_toy_soldier_fallover` (3714) with area sound 988, and a
  tick later it is deleted. The doll is just deleted. In both cases `poh_toy_*_unwound` is added on
  that tile for 99 ticks (`despawn=99`; the doll's was removed exactly 99 ticks later). Captured walks
  lasted 3, 4, 15, 71 and 75 ticks.
- **Pick-up** deletes the NPC the same tick and puts the unwound toy in the inventory, with area
  sound 941 at the toy.

## Ours

- How long a walk lasts: uniform over 3-75 ticks, the captured range.
- When the doll turns or pauses, the mouse's directions, and turning at walls.
- A toy whose owner logs out or leaves the area goes back to their inventory.
- The full-inventory Pick-up message.
- Release outside a house works (nothing captured refuses it).
- The toy cat is not handled here. Live, it stays out a long time and keeps near its owner
  (rec 2508/2510), and those rules aren't clear from the captures.
