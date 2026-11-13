# Confliction gauntlets

Plugin: `server/plugins/combat/effects/ConflictionGauntlets.EquipmentEffects.js`, registered by
`server/plugins/combat/EquipmentEffects.plugin.js`. Stats come from the item definitions.

Sources: [OSRS Wiki, Confliction gauntlets](https://oldschool.runescape.wiki/w/Confliction_gauntlets#Passive_effect)
(citing the 23 July 2025 news post and Mod Ash), and
[Tormented bracelet, Upgrading](https://oldschool.runescape.wiki/w/Tormented_bracelet#Upgrading).

## Passive

- A missed magic attack on the player's combat target makes the next magic attack with the same
  spell on the same target roll accuracy twice. The second roll is a new attack roll against the
  same defence roll, and the attack lands if either roll beats it. This is the two-roll formula
  the Wiki gives, the same as Osmumten's fang outside the Tombs of Amascut.
- "The next" attack means only the very next one. Any magic attack on the player's own target
  replaces the stored miss: a landed attack, another spell, an ice spell on a player or an
  attack without the gauntlets all clear it, and a miss stores the new target and spell.
- A powered staff's built-in spell counts as its own spell. PoweredStaff.js keeps one spell
  object per staff, and spells are compared by object.
- A multi-target spell only does this for its primary target (the player's combat target).
  Secondary targets roll once, and their misses don't arm the passive.
- Never with a two-handed weapon (the cache's weapon + shield wear positions).
- Never for ice spells cast on players. Other spells on players get it.
- The hook is the core's `combat:accuracy-rolled` (the second roll). The miss is recorded on
  `onCombatHitDamage`, once the hit's accuracy is settled.

## Not covered

- No packet detail: the passive has no message, animation or sound, and captures can't show
  accuracy rolls.
- Ours: casting with no weapon or with a non-magic one-handed weapon still gets the passive. The
  Wiki says "one-handed magic weapons" but only rules out two-handed weapons.
- Ours: the stored miss lasts until the next magic attack on the combat target, with no time
  limit, and it is not saved on logout.
- The Tormented bracelet page says the passive never applies when the target is a player. The
  Confliction gauntlets page is more specific (only ice spells on players, with Mod Ash's quote
  on multi-target PvP casts), so that page is followed.
