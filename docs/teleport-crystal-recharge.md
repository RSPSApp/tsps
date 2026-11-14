# Teleport crystal recharging (Eluned's Enchant)

`server/plugins/npcs/ElunedEnchant.plugin.js`. Eluned's right-click **Enchant** (cache: `eluned_prif`
9145, `sote_eluned_upass` 8829 and `roving_female_woodelf_2op` 8767 carry it) re-enchants every
crystal teleport seed (6103) in the inventory.

## Rules

Source: the OSRS Wiki (Teleport crystal, Crystal teleport seed, Western Provinces Diary,
Transcript:Eluned). No RSProx capture or rsprox.net index row covers a recharge.

| | |
| --- | --- |
| Fee | 750 coins for the first seed ever charged, 150 less for each one after, 150 from the fifth on |
| Crystal | Teleport crystal (3) (6100); Teleport crystal (5) (13102) once the hard Western Provinces Diary is complete |
| Seeds | all carried seeds in one go (20 June 2013 update) |
| Lines | the Wiki transcript in `npc-dialogues.json`, variant `enchant-option` |

- No seed: "You don't seem to have any crystals I can enchant. Return when you do."
- With seeds: the item box "Although you can't hear anything, your crystals have been chanted.",
  shown with the new crystal. The transcript has an empty Eluned line before it; the dialogue
  runner shows no empty lines, so it does not appear.
- The count of seeds charged is the saved attribute `teleport-crystal:recharges`.
- A Teleport crystal (5) becomes (4) when used (`MourningsEndPartI.Quest.js`, which handles the
  charged crystals' Lletya option).

## Ours

- With several seeds, each seed pays its own fee in turn (750 + 600 + ...). The Wiki gives no
  bulk price.
- With too few coins for all of them, nothing is enchanted and the game message "You need
  <fee> coins to have your crystals enchanted." is sent. No source has a line for this.
- Live probably keeps the count in varbit `mourning_eluned_chant` (810, varp 518 bits 26-28).
  Nothing here sends it, because no capture shows it.

## Not here

- Talk-to with a seed ("Hey [player name], do you need me to re-enchant your teleport crystal?")
  and the Elven Scout's copy of it. Eluned's Talk-to variant is picked by Mourning's End Part I,
  Roving Elves and Song of the Elves, and no source says which comes first.
- The charged crystals' Prifddinas and Toggle options.
