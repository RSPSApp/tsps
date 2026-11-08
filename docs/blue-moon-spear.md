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

Not implemented: the Frostweaver passive (a free melee attack after bind, ice or grasp spells with
the full set), the Yama / Verzik "indefinitely bound" handling, and a message for using the special
without the armour.
