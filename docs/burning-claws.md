# Burning claws

Plugin: `server/plugins/combat/specials/BurningClaws.SpecialAttack.js` (Burning barrage).
Facts come from the OSRS Wiki page <https://oldschool.runescape.wiki/w/Burning_claws>; no rsprox
recording of the special attack exists, so this part is not capture-verified.

- **Energy:** 35%. The Wiki records the rise from 30% in the 22 July 2026 update.
- **Hitsplats:** three, from the first of three accuracy rolls that lands. Roll 1 deals 75%-175% of the
  max hit split 25/25/50, roll 2 50%-150% split 50/50/0 and roll 3 25%-125% split 0/0/100, each
  rounded down; the tables are the `firstSuccessfulAccuracyDamageRanges` traits.
- **All three rolls miss:** 0, 1 or 2 damage (20/40/40%). Core's default all-miss pattern gives it.
- **Burn:** every hitsplat of a landed branch burns with 15% (roll 1), 30% (roll 2) or 45% (roll 3).
  A burn deals 10 damage over 40 ticks, one damage every 4 ticks, and a target carries at most five
  burns at once. A full miss never burns. `PendingHit.getFirstSuccessfulRangeIndex()` tells a
  plugin which roll landed (-1 for a full miss).

## Creation

Plugin: `server/plugins/items/BurningClaws.plugin.js`. Using one Burning claw (`bone_claw`, a
Tormented Demon drop) on another makes Burning claws (`bone_claws`). rsprox captures 1756
(rev 227, tick 7068) and 3327 (rev 235, tick 78) show the same response:

- On the click tick both claws leave the inventory and the Burning claws go into the first free
  slot (slot 4 after using 5 on 4 in 1756; slot 6 after using 14 on 18 in 3327).
- Sequence `human_crafting_bone_claws` (11142) on the player, and `synth_sound` 2694 with delay 8.
- The objectbox (193) with `bone_claws` at zoom 400 and "You bring the two claws together and
  combine them.", with "Click here to continue".

No skill level is needed (Wiki: Burning claws, Creation). A claw used on its own slot gets no
response (1756 tick 5549). The Wiki recipe lists 4 ticks; both captures swap on the click tick, so
the server does too.

## Not done

- The swipe sound (`burning_claws_swipe_01`, id 9316 on the Wiki) is not played: the Wiki gives no
  loop, delay or volume for it.
- The Wiki does not say whether a burn can start from a hitsplat that rolled 0, so every hitsplat of
  a landed branch rolls.
