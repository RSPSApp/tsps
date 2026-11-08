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

## Sources

- OSRS Wiki, fetched for this change: [Ultor ring](https://oldschool.runescape.wiki/w/Ultor_ring),
  [Bellator ring](https://oldschool.runescape.wiki/w/Bellator_ring),
  [Magus ring](https://oldschool.runescape.wiki/w/Magus_ring),
  [Venator ring](https://oldschool.runescape.wiki/w/Venator_ring): the requirement and the
  message.
- No rsprox capture of the refusal was found, so the message text is the Wiki's.
