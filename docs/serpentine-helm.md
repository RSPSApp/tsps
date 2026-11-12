# Serpentine helm

The charged serpentine, tanzanite and magma helms share their passive effects and
scale handling. Item names and charged/uncharged variants were checked against
the current cache.

## Evidence and corrected behaviour

The [Serpentine helm](https://oldschool.runescape.wiki/w/Serpentine_helm) Wiki page,
checked 26 October 2026, specifies the following:

- The basic venom chance is 1/6 for non-poisoned **melee** attacks. Ordinary ranged
  and magic attacks no longer inherit it.
- Poisoned weapons and the noxious halberd have a 50% chance. The abyssal tentacle
  is a poison-inflicting weapon according to the
  [Poison](https://oldschool.runescape.wiki/w/Poison) page.
- Recolours are cosmetic: both now receive immunity, venom procs and combat upkeep,
  and retain their colour on depletion, charging and uncharging.
- Combat costs ten scales initially and every ninety ticks. Being attacked also
  consumes scales when retaliation is off.
- Uncharging returns unused scales. An existing scale stack can receive the refund
  even when every inventory slot is occupied; insufficient capacity preserves charges.

The [Buy 50, Item Changes and QoL update](https://oldschool.runescape.wiki/w/Update:Buy_50,_Item_Changes_and_QoL)
explicitly includes poisoned arrows and bolts in the 50% chance, excludes the
emerald bolt enchantment, and requires positive damage against an NPC. The handler
reads the worn projectile: the ammunition slot when the weapon fires from it (a bow or
crossbow, `Ammunition.firesFromAmmoSlot`), otherwise the weapon itself (a thrown weapon,
a chinchompa or a self-ammo bow such as the crystal bow). A (p) arrow or bolt counts by
its own name; the combat ammunition reports it as its plain variant.
A poisoned melee weapon does not grant this bonus to a manually cast spell.

The [Trident of the Swamp](https://oldschool.runescape.wiki/w/Trident_of_the_Swamp)
and [enhanced trident](https://oldschool.runescape.wiki/w/Trident_of_the_Swamp_%28e%29)
pages establish the toxic trident family and its guaranteed NPC venom with the
helm. The name-based weapon classification includes enhanced and ornamented forms.

## Verification and limits

Regression coverage in `serpentine-helm.test.cjs` exercises the registered hit
handler with controlled rolls, attack types, ammunition, weapon variants and both
recolours. It also checks defensive upkeep, charge depletion and refund capacity.
`poison-orb.test.cjs` continues to check immunity without curing existing affliction.

Live server checks covered charging, Check, equipping and combat with recoloured
helms, including magma depletion to its uncharged variant and a full-inventory refund
from 1 scale to 21 scales while all 28 slots stayed occupied. Probability boundaries
are verified by deterministic tests rather than inferred from a short live fight.

Rsprox recording **1074** shows scales used on an uncharged magma helm. On the
next server tick, it becomes charged and reports
`Scales: <col=007f00>11,000 (100.0%)</col>`. The original inventory packets show
12,373 scales becoming 1,373: 11,000 were consumed. Charge feedback now uses this
total-and-percentage format. The existing tick-aligned item-use dispatch supplies
the next-tick response; no additional action delay is added.

Other message branches, animation timing, varbits and interface packet parity
remain unverified because the available helm actions do not establish them.
Bank charge configuration and mutagen application are separate interactions outside this passive-effect fix.
