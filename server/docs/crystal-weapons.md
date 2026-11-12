# Crystal weapon charges (Bow of Faerdhinen, Blade of Saeldor)

Code: `plugins/items/CrystalWeapon.js` (shared), `CrystalShards.js` (the shard prompt), `BowOfFaerdhinen.plugin.js`,
`BladeOfSaeldor.plugin.js`. Recolouring the corrupted weapons: `docs/crystal-armour.md`.
Test: `tests/crystal-weapons.test.cjs`.

## Rules (OSRS Wiki: Bow_of_Faerdhinen, Blade_of_Saeldor)

- A new weapon has 10,000 charges; crystal shards add 100 each, up to 20,000.
- Every shot (bow) or swing (blade) uses one charge, whether it hits or misses; the elven signet does not save any.
- At 0 charges the weapon becomes (after the shot or swing that spent the last charge, which still uses the charged bonuses) its inactive form (no bonuses) until it is charged again; shards may be added
  before that too.
- Corruption progress: 1% is 2,000 charges used for the bow and 1,000 for the blade.
- Corrupted (c) weapons are permanent and use no charges; they are not touched here.

## Live behaviour (rsprox captures)

- Check on the bow sends `Your bow of Faerdhinen has # charges remaining, and #% progress towards corruption.`
  from revision 233 on (recordings 476, 1059); revision 226 (recording 1695) sends the shorter
  `Your bow of Faerdhinen has # charges remaining.`
- Shards on the bow open the count prompt `How many shards do you wish to add? (0 - N)`, N rounded up to reach
  20,000 (bow at 3,689: 164; 164 added left it at exactly 20,000), and send no chat message (1059).
- A shot that leaves a multiple of 500 charges sends `<col=ff0000>Your bow of Faerdhinen has 4000 charges
  remaining.</col>` (no thousands separator): 6000 (1694), 5500 (2960), 5000 (3032), 4500 (377), 4000 (3455).

## How tsps models it

- Charges and charges used are item meta (`bow-of-faerdhinen:charges`, `blade-of-saeldor:charges`). A weapon with
  no saved count is new: full if charged, empty if inactive.
- The bow spends its charge in the ranged ammo handler (once per shot); the blade in `combat:attack-started` for
  melee attacks. `combat:consume-charge` lets content spare the charge.

## Not covered

- The blade's Check text is the bow's with the blade's name; no capture of it exists.
- The blade's shard prompt and red reminder are the bow's with the blade's name; no blade capture exists.
- The red reminder above 6,000 charges is not captured; ours sends it at every multiple of 500.
- The message for the last charge is not captured or on the Wiki; `Your <weapon> cannot hold any more charges.` is ours.
- Progress counts charges used only; the Wiki also counts shards added and charges held towards corruption.
- Uncharge, Configure-Charges, singing-bowl corruption and death handling are not implemented.
