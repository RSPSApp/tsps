# Darkmeyer statue

The vampyric statue in the Darkmeyer chancel (loc `darkm_altar`, 39234, at 3604,3354), just south
of the bank. `Pray-at` recharges Prayer for blood. Handled in
`server/plugins/objects/Altars.plugin.js` (`prayAtDarkmeyerStatue`).

## Sources

- The OSRS Wiki, [Statue (Darkmeyer)](https://oldschool.runescape.wiki/w/Statue_(Darkmeyer)) and
  [Darkmeyer](https://oldschool.runescape.wiki/w/Darkmeyer): all Prayer at the cost of 1-3
  Hitpoints, and unlike the locator orb or the dwarven rock cake it can kill. The museum copy
  doesn't damage.
- rsprox captures, recording 3050 (revision 231):
  - tick 61, Prayer drained: on the click's tick the spam line "The statue takes a blood
    sacrifice from you as you recharge your Prayer points.", `human_pray` (645), synth 2674 and
    Prayer to its maximum; the next tick a 1 hit (Hitpoints 99 to 98) with synth 518
    (`human_hit_1`, delay 20).
  - tick 43, full Prayer: the game message "You already have full Prayer points." and nothing else.

## What the server does

- Drained Prayer: animation 645, sound 2674, Prayer to its maximum, the Prayer drain counter reset
  (as altars do, docs/prayer-drain.md), the spam line; one tick later a red hit of 1-3 (uniform)
  with sound 518, delay 20. The hit isn't capped, so it can kill. Dead or dying players get nothing.
- Full Prayer: the game message only.
- `altars:prayed` is emitted with the restored points, as other altars do.

## Not covered

- The Old School Museum's display copy shares id 39234 (at 2985,9976). The Wiki says it doesn't
  damage, but no recording shows its message, so it is left unhandled.
- Whether the sacrifice's 1-3 is uniform: the Wiki gives only the range; ours is uniform. The one
  recorded sacrifice was 1.
