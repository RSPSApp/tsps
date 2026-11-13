# Desert Treasure II ancient rings

`server/plugins/items/AncientRings.plugin.js`. The Ultor, Bellator, Magus and Venator rings
have no passive effect, only equipment bonuses, but each refuses to be worn until the player has
killed the boss whose vestige it is made from. Without the kill the ring stays in the inventory
and the player gets "The ring slips off your finger. The power within it seems unfamiliar."
Full Desert Treasure II completion is not required.

| Ring | Boss killed at least once |
| --- | --- |
| Ultor ring | Vardorvis |
| Bellator ring | The Whisperer |
| Magus ring | Duke Sucellus |
| Venator ring | The Leviathan |

The kill is read from the Combat Achievements kill count (`combat-achievements:count`), so any
kill this server credits to the boss counts. Player bots are not gated.

Every cache variant is gated: the untradeable 25485-25488, the tradeable rings players buy
(28307 Ultor, 28310 Venator, 28313 Magus, 28316 Bellator and their other variants) and the
equippable untradeable Magus/Ultor 33180-33183.

## Sources

- OSRS Wiki, fetched for this change: [Ultor ring](https://oldschool.runescape.wiki/w/Ultor_ring),
  [Bellator ring](https://oldschool.runescape.wiki/w/Bellator_ring),
  [Magus ring](https://oldschool.runescape.wiki/w/Magus_ring),
  [Venator ring](https://oldschool.runescape.wiki/w/Venator_ring): the requirement and the
  message.
- No rsprox capture of the refusal was found, so the message text is the Wiki's.
- rsprox capture 3432 (rev 235) shows the Berserker -> Ultor ring being made; see below.

## Making the rings

`server/plugins/items/AncientRingCrafting.plugin.js`. Messages, menus, sounds, animations and XP
are from capture 3432 (a Berserker/Ultor run); the other three rings use the same flow with their
own items.

| Step | What | Requirement | XP |
| --- | --- | --- | --- |
| 1 | Chisel on a Fremennik ring (Berserker, Archers, Warrior, Seers) makes its icon | 80 Crafting, Desert Treasure II complete | 400 Crafting |
| 2 | Peer the Seer (Rellekka), with an icon carried, teaches how to combine icons with vestiges. Once per player | none | none |
| 3 | Icon on its vestige, with 500 blood runes, makes the upgraded icon | 90 Magic, 80 Crafting (boostable) | 400 Magic |
| 4 | At a furnace (Smelt), the upgraded icon, 3 chromium ingots and a ring mould make the ring | 90 Magic, 80 Crafting | 2,500 Crafting |

Before Desert Treasure II is complete, the chisel does nothing with a Fremennik ring (no refusal message is recorded or on the Wiki).

| Ring | Fremennik ring | Vestige | Result (tradeable) |
| --- | --- | --- | --- |
| Ultor | Berserker | Ultor | 28307 |
| Venator | Archers | Venator | 28310 |
| Bellator | Warrior | Bellator | 28316 |
| Magus | Seers | Magus | 28313 |

Each confirmation is an item box, then a Yes./No. menu; nothing is used before Yes. Before Peer has
taught it, an icon on a vestige says "You're not quite sure how to combine those. Perhaps a Fremennik
could help." Inspect on an icon or vestige gives the captured hint. The vestiges and chromium ingots
come from the four bosses' drop tables.

Not captured, so worded from the Wiki's requirements: the level-requirement refusals.
The 400/2,500 XP are the Wiki's values; capture 3432's 15x larger deltas are its Grid Master XP boost.
Peer's own menu while an icon is carried is the generated "with a ring icon" transcript, which does
not repeat his other options (banking, predictions).
Imbued Fremennik rings are not accepted (the Wiki lists only the plain rings).
