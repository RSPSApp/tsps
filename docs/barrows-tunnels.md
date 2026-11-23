# Barrows tunnels and brothers

How the tunnels, their doors, the brothers and the chest behave, from rsprox captures
(revisions 226-237, [rsprox.net database](https://rsprox.net/database)) and the
[Barrows strategy guide](https://oldschool.runescape.wiki/w/Barrows/Strategies). The plugin is
`server/plugins/minigames/Barrows.plugin.js`; the Prayer drain is in
[barrows-prayer.md](barrows-prayer.md).

## Doors

- A click on an open door walks the player to its near side. The next tick is one walk step
  through the doorway (no exact move). The step can be diagonal from beside the other leaf, and
  ends beyond the leaf that was clicked (227/1000436 tick 10239).
- On the step's tick each leaf becomes `inviswall` (38848) with the leaf's own shape and
  rotation. The open leaf (`barrows_door_inactive_l` 20697 / `_r` 20678) is placed on the
  wall's outer tile: west, north, east or south of the leaf for rotations 0-3. The left leaf
  turns 3 quarters and the right leaf 1 quarter from the door's rotation. Two `synth_sound`s
  play: 62, then 41.
- Two ticks later both leaves come back and the open leaves are deleted (236/03929 ticks
  378-380, 227/1000436 ticks 10236-10245, 234/03276).
- The player is not held: a click on the next tick moves them.
- Door varbits 469-484 never change while the player is in the tunnels.
- The chest room's door, still locked: spam "The door is locked with a strange puzzle.", then the
  puzzle. A right answer sends "You hear the doors' locking mechanism grind open." and doesn't
  cross. The next click does (236/03929 ticks 411-418).

## Monsters

- A crossing raises one monster next to the player's new tile on the crossing tick. In 330
  own crossings the monster never waits for the player to stop.
  - Live raises only `barrows_rat` 1679, `barrows_bloodworm` 1678 and
    `barrows_skeleton_armed` 1687 / `_unarmed` 1685, besides the brothers.
  - The Wiki gives the odds: a brother 12/128, then skeleton 52, bloodworm 32 and crypt rat 32.
    After the loot, every door raises a remaining brother.
  - Ours: the two skeletons are even.
  - These monsters persist and roam (227/1000436 #49885, ticks 10236-10710).
- Ours: the monster becomes visible one tick after the step. The world adds queued NPCs on the
  next tick.
- The 34 static monsters (`npc-spawns.json`) are separate, as live: low indices present in every
  recording, respawning about 21 ticks after death.
- The tunnels are single-way: `multiway_indicator` (4605) is never set there.

## Brothers

- The overhead line comes only from a crypt search ("You dare disturb my rest!") or the chest
  ("You dare steal from us!"). One raised at a door says nothing (226/01694 tick 9139, 227/00086
  tick 12490).
- A brother's first attack is 3 ticks after he appears.
- **Takeover:** when a brother appears, a crypt monster attacking the player stops facing them,
  and it attacks again once he is dead (20 cases, e.g. 227/01885 ticks 12108-12119). The rare
  two-attacker tick in 237/04057 (tick 8841) is not reproduced.
- **Leash:** once the player is more than 8 tiles (either axis) from where the brother rose,
  his face resets on the next tick and he is deleted the tick after (227/00086 ticks 12498-12500
  and 12507-12509, 227/1000433 ticks 17109-17111). Before that he follows the player through
  doors.
  - 227/1000433 then shows "We'll finish this later..." and 227/00086 doesn't. Ours: no line in
    the tunnels.
  - In a crypt the line follows by a tick, per the Wiki's Barrows Trivia ("This message can also
    appear if players run too far away from a brother in the crypts").
  - The crypts are too small for the leash: no tile is more than 6 from a crypt's rise tile.
- "We'll finish this later..." also follows:
  - a move from a crypt into the tunnels or another crypt with the brother alive, 3 ticks later
    (227/1000565 ticks 2829-2832);
  - a death (227/1000265 tick 5994). Ours: sent on the death's tick.
- Climbing a crypt's stairs, or teleporting to the surface, removes the brother silently.

## Chest

- The loot sends the chest count, jingle 77, one `cam_shake` (0, 5, 0, 0), the reward window,
  and closes `barrows_overlay`.
- The Wiki: "Once the chest is looted, the tunnels will shake and start to collapse, causing
  occasional damage to the player, and the arrangement of the doors and rooms will shift." The
  server re-rolls the layout as the chest is looted. Ours: the collapse hits for 1-4 every 10 ticks
  until the player leaves the tunnels; the Wiki gives no numbers.
  - **Recorded difference:** 37 loots across 227/01885, 227/1000444, 237/04057, 226/01694,
    227/1000436 and 234/03276 show neither: no damage (one player stayed 135 ticks) and no door
    varbit change before leaving. The layout is re-rolled again when the next mound is dug.
- The elite clue goes through Treasure Trails (`treasure-trails:can-receive`, `clue-item`). None
  is given when the player can hold no more of the tier. It is a scroll box once X Marks the
  Spot unlocks boxes. The Wiki's Scroll box (elite) lists the Barrows chest.

## Combat Achievements

| Task | Fails when | Failure line |
| --- | --- | --- |
| Can't Touch Me | A melee brother makes a melee swing, hit or miss (227/00550 tick 28886). The Wiki: "Using Protect from Melee to block damage will not count." | "Dharok the Wretched performed a melee attack." |
| Pray for Success | A brother damages the player (227/00550 tick 29246) | "Ahrim the Blighted damaged you." |
| Faithless Crypt Run | The tick after a brother appears, when the player has had prayer points this run (227/00550 ticks 28262-28263) | "You had more than 0 prayer points." |

The failure lines go through `combat-achievements:failed`, which applies the player's failure
notification settings.
