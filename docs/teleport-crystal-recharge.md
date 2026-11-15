# Teleport crystal recharging (Eluned's Enchant)

`server/plugins/npcs/ElunedEnchant.plugin.js`. Eluned's right-click **Enchant** (cache: `eluned_prif`
9145, `sote_eluned_upass` 8829 and `roving_female_woodelf_2op` 8767 carry it) re-enchants every
crystal teleport seed (6103) in the inventory.

## Rules

Sources: the OSRS Wiki (Teleport crystal, Crystal teleport seed, Western Provinces Diary,
Transcript:Eluned) and rsprox capture local 1000233 (rev 227, a Leagues V world), which has two
Enchant clicks on `eluned_prif`: one with seeds and no coins, one recharging three seeds.

| | |
| --- | --- |
| Fee | 750 coins for the first seed ever charged, 150 less for each one after, 150 from the fifth on |
| Crystal | Teleport crystal (3) (6100); Teleport crystal (5) (13102) once the hard Western Provinces Diary is complete |
| Seeds | all carried seeds in one conversation (20 June 2013 update), one a tick |
| Lines | the Wiki transcript in `npc-dialogues.json`, variant `enchant-option` |

- No seed: "You don't seem to have any crystals I can enchant. Return when you do."
- With seeds and the coins (capture, from the click): +3 her empty line as a chat box (text
  three spaces, head `chatchant1`, no "Click here to continue"); +7, +8, +9 one seed a tick
  becomes a Teleport crystal (3), each paying its own fee (150 coins each in the capture); +10 the
  item box "Although you can't hear anything, your crystals have been chanted." with the crystal.
  Ours shows the chant line when the transcript reaches the box, waits 4 ticks, enchants one seed
  a tick, and opens the box the tick after the last seed.
- With seeds and no coins (capture, +4): "I'm afraid you don't have enough money." (head
  `chatsad1`, with a continue). Nothing is enchanted.
- Closing the chant (walking off) stops it; seeds already enchanted stay enchanted.
- The count of seeds charged is the saved attribute `teleport-crystal:recharges`.
- A Teleport crystal (5) becomes (4) when used (`MourningsEndPartI.Quest.js`, which handles the
  charged crystals' Lletya option).

## Ours

- The capture shows each seed paying its own fee, but only at the 150 floor; that the fees before
  it step down per seed (750 + 600 + ...) is the Wiki's ladder applied seed by seed.
- With coins for some seeds but not all, nothing is enchanted and the no-money line is said. The
  capture only has the no-coins case.
- Live probably keeps the count in varbit `mourning_eluned_chant` (810, varp 518 bits 26-28).
  Nothing here sends it, because no capture shows it changing.

## Not here

- Talk-to with a seed ("Hey [player name], do you need me to re-enchant your teleport crystal?")
  and the Elven Scout's copy of it. Eluned's Talk-to variant is picked by Mourning's End Part I,
  Roving Elves and Song of the Elves, and no source says which comes first.
- The charged crystals' Prifddinas and Toggle options.
