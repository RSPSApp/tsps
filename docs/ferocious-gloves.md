# Ferocious gloves

`server/plugins/items/FerociousGloves.plugin.js`. The Alchemical Hydra's hydra leather becomes
ferocious gloves at the machinery in the north of the Lithkren Vault (1559,5094), and the gloves go
back to leather there.

The machine is the multiloc `ds2_lithkren_vault_machine01` (34628) on varbit 6104, Dragon Slayer II's
progress. At 215 (quest complete) it shows `ds2_lithkren_vault_machine01_complete` (33609, "Machinery",
op Investigate); before that `ds2_lithkren_vault_machine01_incomplete` (33608), with no options.

## What live does (rsprox captures)

rsprox.net index, recordings 1527, 1526 (rev 224) and 722 (rev 231):

- **Neither leather nor gloves** (1527 tick 11, 722 tick 470): a plain message box (also a `mesbox`
  chat line), "The machine seems to have a depression and various mechanisms. It looks dormant."
- **Leather, no hammer** (1526 tick 817, the hammer just dropped): a plain message box, "You need a
  hammer to use the machine."
- **Gloves** (1527 tick 19): the chat menu "Would you like to revert your ferocious gloves into hydra
  leather?" / "Yes." / "No.".
- **Leather** (1527 tick 38, 1526 tick 895): the chat menu "Are sure you want to make some ferocious
  gloves?" (live's wording) / "Yes." / "No.".
- **Yes**: `human_smithing` (898) as the menu closes; 4 ticks later `human_casting` (811) and sound
  140; 3 ticks after that the item is swapped in the same slot and shown in an object box, also a
  `mesbox` line:
  - "By feeding the tough to work leather through the machine, you manage to form a pair of gloves."
  - "By feeding the gloves through the machine, you manage to revert them into leather."

  The machine plays `fi_dkl_shield_machine_active` (7734) with the casting and
  `fi_dkl_shield_machine_inactive` (7735) at the swap (1526 ticks 901/904, 1527 ticks 25/28 and 44/47).
  Walk clicks during it (1526 ticks 899-900) are ignored: the player stays at the machine.
- **Hydra leather Inspect** (1521 ticks 1472, 2391): an object box with the leather, "This leather
  looks pretty tough to work with... Maybe the dragonkin had a way."

## Wiki

- Hydra leather, Ferocious gloves: use the leather on the machinery with a hammer, Dragon Slayer II
  needed (the vault's barriers need it too); 7 ticks; the gloves revert the same way.

## Ours

- Using the leather or gloves on the machine does what Investigate does (the Wiki says to use the
  leather on it; not captured).
- With both the leather and the gloves carried, the leather is offered.
- With nothing to feed and no hammer, the dormant line comes first.
- Preset copies of the leather or gloves get "Preset items cannot be used for this.".
