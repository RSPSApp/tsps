# Osmumten's fang

Plugin: `server/plugins/combat/effects/OsmumtensFang.EquipmentEffects.js` (passive) and
`server/plugins/combat/specials/OsmumtensFang.SpecialAttack.js` (Eviscerate).

Source: [OSRS Wiki, Osmumten's fang](https://oldschool.runescape.wiki/w/Osmumten%27s_fang).

## Passive (normal attacks)

- **Damage:** a successful hit deals 15% to 85% of the max hit instead of 0 to max. Verified on
  a level 99 account with no gear bonuses besides the fang (max hit 28): hits were 4 to 23.
- **Accuracy:** with a stab-bonus style, outside the Tombs of Amascut the player's accuracy is
  rolled a second time against the same defence roll, and the hit lands if either beats it.
  Inside the raid the whole check, defence included, is rolled again.
- The second roll is the core event `combat:accuracy-rolled` (attack and defence rolls, the
  result in `accurate`), fired by every accuracy roll. The damage range uses `combat:hit-rolled`.

## Eviscerate

Unchanged: 25% energy, 1.5x accuracy, 15% to 100% of the max hit. The Wiki does not say whether
the extra roll applies to the special; it is applied here because the special is a stab attack.

## Checked against rsprox captures

`facts osmumtens_fang --weapon` shows the attack animation, sound and a hit on the tick after
the attack. The captures' hit values mix targets and cannot show the damage range, so the range
comes from the Wiki.
