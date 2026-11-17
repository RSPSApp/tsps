# Barrows equipment set effects

The set effects of the six Barrows brothers' equipment, worn by players (and used by the
brothers themselves where the same check applies). The set effects are in
`server/plugins/items/BarrowsEquipment.plugin.js`; Dharok's Wretched Strength is in
`server/plugins/combat/effects/DharoksArmour.EquipmentEffects.js`.

Sources: the OSRS Wiki pages for each set, fetched for this page:
[Verac's armour](https://oldschool.runescape.wiki/w/Verac%27s_armour),
[Dharok's armour](https://oldschool.runescape.wiki/w/Dharok%27s_armour),
[Ahrim's robes](https://oldschool.runescape.wiki/w/Ahrim%27s_robes),
[Karil's armour](https://oldschool.runescape.wiki/w/Karil%27s_armour),
[Torag's armour](https://oldschool.runescape.wiki/w/Torag%27s_armour) and
[Guthan's armour](https://oldschool.runescape.wiki/w/Guthan%27s_armour). The rsprox captures
(https://rsprox.net/database) have no recorded attacks with Verac's flail or Dharok's greataxe,
and a capture would only show the resulting hitsplats anyway.

## Effects

| Set | Effect | Where |
| --- | --- | --- |
| Verac's | Defiler: a melee attack has a 25% chance to hit for certain and through protection prayers. Against monsters that hit does 1 extra damage, so it is never 0 and can be 1 above the normal max hit. | `onCombatHitRoll` marks the hit, `onCombatHitDamage` adds the 1 when the target is an NPC |
| Dharok's | Wretched Strength: the damage modifier `1 + (Max HP - Current HP) / 100 x Max HP / 100` "is applied to a player's hit after the damage roll". The roll uses the ordinary max hit, and the rolled hit is scaled and rounded down. | `onCombatHitDamage`, melee only |
| Guthan's | Infestation: a successful attack has a 25% chance to heal the wearer by the damage dealt, up to their base Hitpoints (10 above with the amulet of the damned). | `onCombatHitResolved` |
| Torag's | Corruption: a successful melee hit has a 25% chance to lower a player target's run energy by 20%. No effect on NPCs. | `onCombatHitResolved` |
| Karil's | Tainted Shot: a successful ranged hit has a 25% chance to lower a player target's Agility by 20%. | `onCombatHitResolved` |
| Ahrim's | Blighted Aura: a magic attack that does not splash has a 25% chance to lower the target's Strength by 5. | `onCombatHitResolved` |

With the amulet of the damned: Verac's +7 Prayer bonus, Dharok's 25% chance to recoil 15% of
the damage taken, Guthan's overheal, Torag's Defence +1% per 1% of Hitpoints missing, Karil's 25%
chance of a second hit for half the damage, Ahrim's 25% chance of 30% more spell damage.

## Not covered

- Dharok's modifier in PvP is applied after the protection prayer reduction, because
  `onCombatHitDamage` runs after it; the Wiki does not say which comes first.
- Ahrim's Strength drain only lowers a player target's Strength. The Wiki says "the enemy's
  Strength" without saying whether it works on NPCs.

## Combat entry degradation

A genuine outgoing swing spends the first durability point on the following task tick,
including a manually cast spell whose target is cleared when casting finishes. Merely
selecting a target and approaching it does not spend durability. An incoming-only swing
still waits until its impact puts the defender in combat; a cancelled projectile does not
spend the defender's point. Continuous combat retains the existing 90-tick wear interval.

The [Barrows equipment Wiki page](https://oldschool.runescape.wiki/w/Barrows_equipment)
supplies the entry point and 90-tick interval. Retail recording 229/02600 shows target
selection at tick 2669, the first melee swing at 2671, and the degradation message and worn
item update at 2672. This is general first-use timing evidence, not a manual-magic recording.

The plugin preserves the shared combat-exit definition: a player with neither target nor
attacker has left combat once their pending outgoing first use is consumed. A later isolated
manual cast therefore starts another entry. The retail fight boundary between repeated,
unretaliated manual casts has not been independently recorded here; this fix does not add a
grace period or change manual-cast target reset and safespot behavior.
