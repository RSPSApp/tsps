# Tumeken's shadow

`server/plugins/items/TumekensShadow.plugin.js`: its combat, its passive and its charges. It used to live in the Tombs of Amascut plugin, but it's a weapon used everywhere; the raid only answers whether the player is inside the tombs.

## Behaviour (Wiki)

- **Its definition**: +35 magic attack, +20 magic defence and +1 prayer (the cache's item params, docs/item-bonuses.md), two-handed, 85 Magic to wield. It uses the powered staff's styles (`POWERED_STAFF`, cache weapon category 24: Accurate, Accurate, Longrange).
- **It casts only its built-in spell:** max hit floor(Magic / 3) + 1, every 5 ticks, from 8 tiles (10 on Longrange), one charge a cast, with the usual damage-based Magic experience. The hit lands as the projectile arrives.
- **Its passive** multiplies the worn gear's magic attack and magic damage bonuses by 3, or by 4 inside the Tombs of Amascut. Magic damage is capped at 100%.
- **It can't be used against players.**
- **Charges:** two soul runes and five chaos runes a charge, up to 20,000. Using either rune on it adds as many charges as the inventory affords; Check shows them; Uncharge returns every rune. The last charge turns it into the uncharged staff.

## The cast (rsprox captures)

From the [rsprox.net capture database](https://rsprox.net/database): attacks with the shadow equipped, all 11 recordings (Leagues worlds, the only ones with it; these are the weapon's own effects). On the tick of the attack:

| | Captured | tsps |
| --- | --- | --- |
| Animation | `toa_sot_cast_b` (9493) | 9493 |
| Caster graphic | `tumekens_shadow_casting` (2125) | 2125 |
| Sound | 6410 | 6410 (before: none) |
| Projectile | `tumekens_shadow_travel` (2126): start cycle 56, end 72 + 10 a tile | the same |
| Projectile arc | angle 32, progress 40 | the same (before: 16 and 64, the engine's defaults) |
| Projectile heights | 250 → 124 | 62 → 31, which tsps sends ×4: 248 → 124 |

The impact graphic is `tumekens_shadow_impact` (2127). The cast sound is the spell's own (`castSound` on `CombatNormalSpell`), since a built-in staff spell has no spellbook id for `MagicCombatMethod`'s sound table.

## The tombs

The passive's ×4 needs to know whether the player is in the tombs, which is the raid's knowledge. The shadow emits `toa:in-tombs` with `{ player, inside: false }`; the Tombs of Amascut plugin (`Raid.TombsOfAmascut.js`) sets `inside` when the player is in the tombs region. Without that plugin it stays ×3.

## Simplifications

- It refuses every player target rather than only those outside minigames.
- Accurate's invisible +3 Magic isn't applied.
- No impact sound: the captures show none consistently.
