# Bloodbark armour

The bloodbark armour's extra healing on Blood spells.

- The effect is `server/plugins/combat/effects/BloodbarkArmour.EquipmentEffects.js`, registered by
  `server/plugins/combat/EquipmentEffects.plugin.js`. It listens to the core's
  `magic:hit-effects` (records the caster's Hitpoints) and `magic:hit-effects-applied` (tops the
  base heal up to the scaled one).
- `bloodSpellHeal(event)` there is the one Blood spell heal formula. The blood ancient sceptre's
  overheal (`server/plugins/items/AncientSceptre.plugin.js`) uses it too, so the armour's extra
  heal also runs past the Hitpoints level with that sceptre, whichever handler runs first.
- The helm, body and legs' +1% magic damage each was already right in the item data (cache params),
  and the full set's Equipment effects text is in `server/plugins/interface/data/equipment-set-texts.json`.

## Sources

- [Bloodbark armour](https://oldschool.runescape.wiki/w/Bloodbark_armour) (fetched for this page):
  "each piece of armour increases the amount that blood spells heal by 2% of the damage dealt.
  When the full set of armour is equipped, blood spells will heal the caster's Hitpoints for a
  total of 35%"; with an Ancient sceptre 38.5%, with the Zuriel staff 52.5%; no effect with the
  Sanguinesti staff. The per-piece value went from 1.5% to 2% on 21 June 2023.
- Mod Ash (3 February 2023, cited on that page): "The 1/4 calculation rounds down first. After
  that, the result is scaled up by the bloodbark effect".
- No rsprox capture or index row shows it: it changes only the heal amount, with no message,
  animation or packet of its own.

## Behaviour

- A Blood Rush/Burst/Blitz/Barrage hit heals floor(damage × 0.25 × the Ancient effect
  multiplier), then the armour scales that by (25 + 2 × pieces) / 25, rounded down. 40 damage
  with the full set heals floor(10 × 1.4) = 14; 15 damage heals floor(3 × 1.4) = 4.
- Pieces are counted by name in the head, body, legs, hands and feet slots.
- The heal stops at the Hitpoints level (a boost above it is kept), except with the blood
  ancient sceptre, which overheals to 110% as before.
- Zuriel's staff (`ZurielsStaff.plugin.js`) raises the effect multiplier by 50%, so the set heals
  52.5% with it: 40 damage heals floor(15 × 1.4) = 21.
- The scale applies only while EquipmentEffects has registered this module; with that plugin off,
  the blood ancient sceptre's overheal uses the plain heal.
