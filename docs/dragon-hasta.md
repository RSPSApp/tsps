# Dragon hasta: Unleash

Source: [Dragon hasta](https://oldschool.runescape.wiki/w/Dragon_hasta) on the OSRS Wiki. The
capture index has no recorded dragon hasta attacks, so nothing here is capture-backed.

- Unleash spends all the special attack energy the player has (at least the 5% minimum).
- Every 5% of energy spent adds 5% accuracy and 2.5% damage: full energy doubles the attack
  roll and multiplies the maximum hit by 1.5.
- The attack always rolls against the target's stab defence and ignores a player's Protect from
  Melee (see [prayer-piercing-specials.md](prayer-piercing-specials.md)).

## Implementation

`DragonHasta.SpecialAttack.js` registers `traitsFor`, which builds the rolls for the swing:
accuracy multiplier `1 + energy / 100` and damage multiplier `1 + energy / 200`, where `energy`
is what the swing spent. The bar is already empty when the hit rolls, so the amount is kept in a
`WeakMap` from `start` until the hit's after-effects run.

Covered by `server/tests/melee-special-weapons.test.cjs` (energy 100, 60 and 5).
Not checked: a monster-side sample of hit sizes through the running server.
