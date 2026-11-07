# Crystal weapon charges (Bow of Faerdhinen, Blade of Saeldor)

Code: `plugins/items/CrystalWeapon.js` (shared), `BowOfFaerdhinen.plugin.js`, `BladeOfSaeldor.plugin.js`.
Test: `tests/crystal-weapons.test.cjs`.

## Rules (OSRS Wiki: Bow_of_Faerdhinen, Blade_of_Saeldor)

- A new weapon has 10,000 charges; crystal shards add 100 each, up to 20,000.
- Every shot (bow) or swing (blade) uses one charge, whether it hits or misses; the elven signet does not save any.
- At 0 charges the weapon becomes its inactive form (no bonuses) until it is charged again; shards may be added
  before that too.
- Corruption progress: 1% is 2,000 charges used for the bow and 1,000 for the blade.
- Corrupted (c) weapons are permanent and use no charges; they are not touched here.

## Live behaviour (rsprox captures)

- Check on the bow sends `Your bow of Faerdhinen has # charges remaining, and #% progress towards corruption.`
  from revision 233 on (recordings 476, 1059); revision 226 (recording 1695) sends the shorter
  `Your bow of Faerdhinen has # charges remaining.`

## How tsps models it

- Charges and charges used are item meta (`bow-of-faerdhinen:charges`, `blade-of-saeldor:charges`). A weapon with
  no saved count is new: full if charged, empty if inactive.
- The bow spends its charge in the ranged ammo handler (once per shot); the blade in `combat:attack-started` for
  melee attacks. `combat:consume-charge` lets content spare the charge.

## Not covered

- The blade's Check text is the bow's with the blade's name; no capture of it exists.
- The messages for adding shards, and for the last charge, are not captured or on the Wiki; the shard text is ours.
- Progress counts charges used only; the Wiki also counts shards added and charges held towards corruption.
- Uncharge, Configure-Charges, singing-bowl corruption and death handling are not implemented.
