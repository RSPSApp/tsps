# Spade: digging where nothing is buried

`plugins/items/Spade.plugin.js` plays `human_dig` (830) and synth 1470 for every spade's Dig, and leaves the click open so
treasure trails, Barrows, quest digs and sailing schematics can answer it. When none of them claims it, a fallback
(`api.onItemAction(name, actions, { fallback: true })`, run after every other item-action handler) sends
"Nothing interesting happens.".

rsprox.net captures, obj `spade` op2: the sequence, the synth and that game message arrive on the click tick in 12 of the
19 recordings with plain digs, e.g. 1698 (rev 226) tick 6941, 1067 (rev 235) tick 209, 3931 (rev 236) tick 4075.

Content that owns a dig claims it either by returning true from its own `onItemAction("Spade", { Dig })` (Barrows, most
quests) or by vetoing the click in `onCanUseItem` (treasure trails, X Marks the Spot, Pirate's Treasure, Ghosts Ahoy);
both keep the fallback quiet.
