# Crystal armour (helm, body, legs) and crystal recolours

Code: `plugins/items/CrystalArmour.plugin.js` (charges, Check, shards, Revert, set bonus),
`plugins/items/CrystalShards.js` (the shard prompt, shared with the crystal weapons),
`plugins/items/CrystalRecolour.plugin.js` (Elven Clan crystals), `plugins/items/CrystalSinging.plugin.js` (creation).
Tests: `tests/crystal-armour.test.cjs`, `tests/crystal-recolour.test.cjs`, `tests/crystal-singing.test.cjs`.

## Rules (OSRS Wiki: Crystal_equipment, Crystal_helm, Crystal_body, Crystal_legs, Elven_signet, Celestial_signet)

- Pieces start at 2,500 charges; each crystal shard adds 100, up to 20,000. One charge per successful hit received.
- At 0 charges a piece becomes its inactive form and loses its stats and set effect until shards are added. The
  inactive piece's options are Wear, Revert, Drop, so it can still be worn.
- Set effect with the crystal bow or bow of Faerdhinen: helm 5% / 2.5%, body 15% / 7.5%, legs 10% / 5% (accuracy / damage).
- A worn elven signet or celestial signet: "offers a 10% chance to not use a charge when using crystal equipment".
- Revert returns the seeds (1 / 3 / 2); the charges and any recolour are lost.
- Recolours: one Elven Clan crystal per piece, used up. Armour's own colour is Meilyr's, the corrupted weapons' Hefin's,
  and those crystals turn a recoloured item back.

## Live behaviour (rsprox captures)

- Check, inventory or worn: `Your crystal helm has 215 charges remaining.` / `Your crystal body has 20,000 charges
  remaining.` / `Your crystal legs has 150 charges remaining.` (game message, thousands separator; 1059, 1159).
- Shards on a piece (or on the bow of Faerdhinen): count prompt `How many shards do you wish to add? (0 - N)`, N the
  shards that reach 20,000 rounded up (215 charges -> 198, 2,500 -> 175, bow at 3,689 -> 164). The shards go after
  the answer and the item is set to min(20,000, charges + 100 x count); no chat message (1059, 1159).
- The Iorwerth pieces Check and take shards as the base pieces do (1059).
- Clan crystal on a piece or corrupted weapon: chat menu `Are you sure you wish to recolour your Crystal helm?`
  (Yes / No). Yes: animation `human_xbow_enchant_arrowtip`, sound 144, the item turns into the clan's id in its slot,
  the crystal goes, and an item box of the new item and the crystal says `You use the crystal to colour your Crystal
  helm.` Charges are kept (the body Checks 20,000 afterwards). Seen for helm, body, legs, Blade of Saeldor (c) and Bow
  of Faerdhinen (c) with the Crystal of Iorwerth (1159, Leagues VI).
- Singing a piece at the bowl: an item box with an armour seed shows the piece's warning, then `Are you sure you wish
  to proceed?` (`Yes.` / `Yes, and don't ask again.` / `No.`). Yes sings it (sound 8); five ticks later an item box of
  the piece says `With the help of the crystal bowl, you sing a beautiful song and shape the crystals.` (1159).

## Wiki and capture differences

- None found for the parts above; the Wiki gives no messages for Check, shards or recolours.

## Not covered

- Recolouring an inactive piece, a piece already in that colour or a Deadman piece: no capture or Wiki
  text; allowed, as for an active piece in the inventory.
- `Your crystal armour has run out of charges.`, `Your crystal armour cannot hold any more charges.` and the Revert
  messages are ours; no capture or Wiki text. Whether Revert asks first is unknown.
- Whether the shard prompt's maximum drops to the shards held when fewer: no capture; ours keeps the room and takes
  at most the shards held.
- Whether the signet's 10% is one roll per hit or per piece: ours rolls per piece. Whether an uncharged celestial
  signet keeps the effect: the Wiki doesn't say; ours keeps it, as the crystal tools do.
- Singing without Song of the Elves shows the bowl's no-materials statement, as for the other quest recipes; the
  earlier armour-only quest line was ours.
- The `worn_items_crystal_armour` varbit live sends with worn pieces, Configure-Charges in the bank, Conwenna and
  Reese, and death handling.
- Line breaks in the recolour item box: live breaks long names (`Bow of faerdhinen<br>(c).`); ours sends one line.
