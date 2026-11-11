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
full Blue Moon armour (broken pieces count) with the spear, a committed Bind, Snare, Entangle or Ancient
ice cast has a 20% chance, and an Arceuus grasp 50%, to queue one instant ordinary melee hit, whether or
not the spell bound. The trigger is the paid cast, not its landing (the Wiki says "successful cast"), and
an armed special is neither used nor spent. Not captured; the Wiki's note on attacking across diagonals
with the auto option is not implemented. Test: `server/tests/frostweaver-set-effect.test.cjs`.

Not implemented: the Yama / Verzik "indefinitely bound" handling, and a message for using the special
without the armour.
