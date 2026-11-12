# Blue Moon spear: Break Shackles

Source: the OSRS Wiki page for the Blue Moon spear (`https://oldschool.runescape.wiki/w/Blue_moon_spear`).
No live capture of the special attack is indexed, so the numbers below are Wiki facts, not packet captures.

- Costs 50% special attack energy and needs the full Blue Moon armour set.
- The swing removes every binding effect on the target. The Wiki does not tie this to the hit landing,
  so the plugin clears it on the swing.
- Each tick of binding removed adds 1.5% accuracy and 1.5% damage. The damage bonus stops at 112.5%
  (75 ticks); the accuracy bonus has no cap.
- An unbound target gets neither bonus, and a swing that finds nothing to remove clears nothing.

Implementation: `server/plugins/combat/specials/BlueMoonSpear.SpecialAttack.js` reads the target's
freeze timer when the swing starts, clears it, and feeds the ticks it held into the special's
`traitsFor` rolls until the hit resolves (the same pattern as the dragon hasta's Unleash).
Test: `server/tests/blue-moon-spear-special.test.cjs`.

Frostweaver (`server/plugins/combat/Frostweaver.plugin.js`, Wiki: Blue Moon armour, set effects): in the
full Blue Moon armour (broken pieces count) with the spear (28988 or 29849, the two with equipment
data), a committed Bind, Snare, Entangle or Ancient ice cast has a 20% chance, and an Arceuus grasp 50%,
to queue one instant ordinary melee hit, whether or not the spell bound. Details and limits:
- The trigger is the paid cast, not its landing (the Wiki says "successful cast"; a splash still triggers).
- The target must be within melee reach, diagonals included (`CombatRange.beside`, same floor); a cast
  from range gives no attack (the Wiki's wording only makes sense in melee reach: inference).
- The Wiki says the attack "can be performed automatically by enabling it in the combat options menu". The
  cache has that button (combat tab widget 593 child 37 "Toggle set effect"; CS2 4907 shows "Set Effect (On)"
  only while varbit 9870 is 1). The plugin handles the click through the interface-action hook, keeps the choice
  in a saved attribute and sends varbit 9870 (also at login), so the label matches. It starts Off, the varbit's
  zero default (inference: the Wiki implies opt-in; not captured). The client's button is shared by the Moons
  sets, but only Frostweaver reads it here (Bloodrager and Eclipse stay always on). Whether the button is
  visible to a player was not checked. Hitting over small fences and walls is not implemented.
- An armed special is neither used nor spent. XP follows the ordinary melee hit path as read from CombatFactory (the
  player's current melee fighting style), not verified in play; no attack animation or graphic is sent; whether a zero-delay hit lands on the cast's
  tick is not verified. Not captured in game; Wiki-only.
Test: `server/tests/frostweaver-set-effect.test.cjs`.

Not implemented: the Yama / Verzik "indefinitely bound" handling, and a message for using the special
without the armour.
