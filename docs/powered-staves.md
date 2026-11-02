# Powered staves

Powered staves cast a built-in spell, and nothing else, whatever is selected or autocast. Each cast
spends a charge, and an emptied staff turns into its uncharged version.

`server/plugins/items/PoweredStaff.js` holds what they share: the built-in spell, the combat method
(attack speed, range, Longrange's 2 extra tiles, charge use, the special step-aside) and charge
storage. Each staff's plugin keeps its own charging, Check and Uncharge.

| Staff | Plugin |
| --- | --- |
| Tridents of the seas and the swamp, and their (e) versions | `server/plugins/items/Trident.plugin.js` |
| Eye of Ayak | `server/plugins/items/EyeOfAyak.plugin.js` and `server/plugins/combat/specials/EyeOfAyak.SpecialAttack.js` |
| Accursed sceptre and (a) | `server/plugins/items/AccursedSceptre.plugin.js` and `server/plugins/combat/specials/AccursedSceptre.SpecialAttack.js` |
| Sanguinesti staff | `server/plugins/items/SanguinestiStaff.plugin.js` |
| Tumeken's shadow | `server/plugins/items/TumekensShadow.plugin.js` |
| Warped sceptre | `server/plugins/items/WarpedSceptre.plugin.js` ([warped-sceptre.md](warped-sceptre.md)) |
| Bone staff | `server/plugins/items/ratboneweapons/Staff.RatBoneWeapons.js` ([scurrius.md](scurrius.md)) |

Gameplay rules come from the OSRS Wiki. Ids come from the rev 241 cache's gamevals. Visuals,
sounds, timing and messages come from rsprox captures (recording ids below).

## Timing from the captures

The captured staves (the seas trident and the Eye of Ayak) send their impact (or the splash) with
the cast. The target gets its spotanim with a delay equal to the projectile's end cycle, and an area
sound (range 10) on its tile with the same delay. A miss sends `failedspell_impact` (85, height
124) and sound 227 the same way.

The hit lands on tick `ceil(end / 30)` after the cast. The fit across every captured attempt:

| Staff | Projectile end (cycles) | Hit tick by distance 1 / 2 / 3 / 4 / 6 |
| --- | --- | --- |
| Trident of the seas (recordings 471-476, 4288) | `46 + 10 × tiles` | 2 / 3 / 3 / 3 / 4 |
| Eye of Ayak (recording 3080) | `51 + 5 × (tiles − 1)` | 2 / 2 / 3 / 3 / – |

This is one tick later at one tile than the Wiki's magic hit delay, `1 + floor((1 + d) / 3)`. The
older staves still use that formula. At one tile the Eye of Ayak's projectile ends at 51, the cycle
it starts on. The server never sends a one-cycle flight, so it ends at 53.

## Tridents

| | Seas | Swamp |
| --- | --- | --- |
| Magic to wield | 75 | 78 |
| Max hit (Wiki) | `floor(Magic / 3) − 5`, at least 1 | `floor(Magic / 3) − 2`, at least 4 |
| Attack | 4 ticks, 7 tiles (9 on Longrange) | the same |
| Charges | 2,500; (e) 20,000 | 2,500; (e) 20,000 |
| A charge | death rune, chaos rune, 5 fire runes, 10 coins | death rune, chaos rune, 5 fire runes, Zulrah's scale |
| Uncharge returns | the runes (not the coins) | the runes and scales |
| Venom | – | 1 in 4 damaging hits (always with a serpentine helm, against NPCs) |

The seas trident's cast (rsprox, revisions 233-239):
- Animation `human_castwave_staff_walkmerge` (11430).
- `slayer_tots_casting` (1251, height 92) and synth sound 178.
- `slayer_tots_projectile` (1252): start 51, angle 16, progress 64, heights 92 → 60.
- `slayer_tots_impact` (1253, height 92) and area sound 1460.

Its messages:
- Check: "Your Trident of the seas has N charges."
- After a cast leaves a multiple of 100 (2,400 and 2,200 seen): "Your Trident of the seas has N charges left."

The swamp trident isn't captured. It casts the same way with `toxic_tots_casting` / `_projectile` /
`_impact` (665 / 1040 / 1042), and its messages say "Trident of the swamp".

The (o) ornament versions aren't handled yet.

## Eye of Ayak

From the Wiki:
- Max hit `floor(Magic / 3) − 6`, 83 Magic.
- 3 ticks, 6 tiles (8 on Longrange).
- 50,000 charges, one a cast. Each charge is a demon tear, or two death runes and a chaos rune.
- It holds one kind at a time. Uncharging returns all of it.

The cast (rsprox 3080, revision 231):
- Animation `human_eye_of_ayak_normal` (12397).
- `vfx_ayak_player_normal_spotanim` (3366) and synth sound 178.
- `vfx_ayak_normal_projectile` (3367): start 51, angle 16, progress 64, heights 172 → 124.
- `vfx_ayak_normal_impact` (3368, height 124) and area sound 1460.
- When the hit lands: synth sound 3533.
- Charges show in varbit `charges_eye_of_ayak_quantity` (16623).

Charging (rsprox 3080):
- Demon tears on it ask "How many charges do you wish to add? (0 - N)".
- Then: "The Eye of Ayak has been charged with demon tears. It currently has N charges." With runes: "...charged with runes...".
- Refusals:
  - "The Eye of Ayak is charged with runes, and thus can only be charged with more runes. You must fully uncharge it to use demon tears." (and the demon-tear version)
  - "You need at least one chaos rune and two death runes or one demon tear in order to charge the Eye of Ayak."
  - "The Eye of Ayak cannot hold any more charges."
- Uncharge asks "Fully uncharge the Eye of Ayak?" (Yes. / No.), then says "You uncharge the Eye of Ayak."

Not captured: the Check text and the rune prompt's wording (it reuses the tear prompt).

**Soul Rend** (Wiki):
- 50% energy, 2× accuracy and 1.3× the built-in spell's max hit.
- An attack every 5 ticks.
- A damaging hit lowers the target's Magic Defence by the damage dealt, never below 0. The drain lasts while the NPC lives.

As captured:
- Animation `human_eye_of_ayak_special` (12394).
- `vfx_ayak_player_special_spotanim` (3364).
- `vfx_ayak_impact_special_spotanim` (3365) on the target at once.
- No projectile.
- Synth sounds 10313, 10322, 10319 and 10311 (delays 21, 81, 108, 122).
- The hit lands 5 ticks later with sound 3533.

It spends one of the staff's charges.

## Accursed sceptre

From the Wiki (and Thammaron's sceptre for the ether rules):
- Max hit `floor(Magic / 3) − 6`, 70 Magic.
- 4 ticks, 7 tiles (9 on Longrange).
- Revenant ether: the first 1,000 are a deposit that activates it, then up to 16,000 are charges, one a cast.
- Emptied, it keeps the deposit and stays activated.
- Uncharging returns every ether, deposit included.
- **Swap** turns it into the (a) version, which autocasts spellbook spells and has no built-in spell.
- Either version, charged, gives +50% magic accuracy and damage against NPCs in the Wilderness, and each attack there spends a charge.

Messages (rsprox 1703, 3126, 3994, 4096, 4101):
- Ether on it asks "How many ether would you like to add? (0 - N)" and sets the busy varbit.
- "You use 1,000 ether to activate the weapon."
- "You add a further N revenant ether to your weapon, giving it a total of N charges." (on activation), or "You add N revenant ether…" later.
- Check: "Your sceptre has N charges left powering it."
- Empty: "There is not enough revenant ether left powering your sceptre."

No capture shows its built-in spell. It uses the powered staff cast (11430) and Thammaron's
projectile (`spells_thammaron01_travel01`, 2340), with no impact graphic.

**Condemn** (Wiki):
- 50% energy and a charge.
- 1.5× accuracy and max hit.
- A successful hit drains Defence and Magic by 15%. Drains don't stack: a target only goes down to 85% of its base level.

It plays `human_special_accursed` (9961) with the built-in spell's projectile. Not captured.

## Magic specials' damage

`DamageFormulas.sourceHitBounds` applies a magic special's `damageMultiplier` (or its stages) to
the spell's max hit, as melee and ranged specials already were. Soul Rend's 1.3 and Condemn's 1.5
use it. The other magic specials declare 1, or use a `maximumHitSource` of their own.
