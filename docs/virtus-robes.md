# Virtus robes

The Virtus robes' extra magic damage on Ancient Magicks spells.

- The effect is `server/plugins/combat/effects/VirtusRobes.EquipmentEffects.js`, registered by
  `server/plugins/combat/EquipmentEffects.plugin.js`. It adds to the magic damage bonus through
  `registerMagicDamageBonusModifier`, which `DamageFormulas.applyMagicDamageBonus` calls with the
  spell being cast.
- Each piece's own +2% magic damage was already right in the item data (cache params).
- The same file reports the full set's Equipment effects text (enum 3047 id 29) through the
  `equipment:effects` event, so the set left `server/plugins/interface/data/equipment-set-texts.json`.

## Sources

- [Virtus robes](https://oldschool.runescape.wiki/w/Virtus_robes) (fetched for this page): "Each
  piece of Virtus robes gives a 2% magic damage bonus for a total of 6%. When using combat spells
  from Ancient Magicks, an additional 3% magic damage is given per piece", 15% for the set. The
  per-piece base was raised from 1% to 2% on 29 May 2024; the planned set effect was scrapped.
- The Wiki DPS calculator (weirdgloop/osrs-dps-calc, `src/lib/Equipment.ts`): with an Ancient
  Magicks spell and a casting stance, `magic_str += 30` for each head, body and legs item whose
  name contains "Virtus".
- No rsprox capture or index row shows the bonus: it changes only the max hit, with no message,
  animation or packet of its own.

## Behaviour

- 30 permille per worn head/body/leg piece named Virtus (the Echo virtus pieces too), added to the
  equipment and prayer magic damage bonus before it scales the max hit, when the spell is from
  the Ancient spellbook. Standard, Lunar and Arceuus spells, and powered staves (no spell), get
  nothing extra.
- Not shown in the equipment stats' Magic damage, which know no spell (as on the Wiki, where the
  bonus is described as conditional).
- Ours: the set text shows for the plain mask, top and bottom only, as before; whether live shows
  it with Echo virtus pieces is not recorded.
