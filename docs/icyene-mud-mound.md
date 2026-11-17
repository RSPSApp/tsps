# Icyene Graveyard mud mound and journal page

The mud mound north of the Icyene Graveyard (loc 38092 `ig_mud_patch`, "Mud mound", Search) is
handled in `server/plugins/objects/ScenerySearch.plugin.js`; the Journal page it gives (obj 24686
`ig_mud_page`, Read) is a book in `server/plugins/items/data/reading-books.json`, read by
`ReadingBooks.plugin.js`.

## Live behaviour (rsprox captures, recording 392, rev 231)

- **Search without a spade** (tick 7883): the player faces the mound, then a mesbox
  "You need a spade to do that." (messagebox, also written to the chat as a mesbox line).
- **Search with a spade** (tick 8087): the player faces the mound; on the next tick
  `human_dig`, synth sound 1470, the journal page and the ancient armour (obj 24688
  `ig_mud_armour`) into the inventory, and an `objectbox_double` with both items (zoom 400)
  reading "You find an old journal page and some ancient armour<br>in the mud. You take them both."
- **Read on the journal page** (ticks 8232, 8280): `human_readbook`, then the book (392) titled
  "Journal Page", pages 1 and 2, the 15 lines of text on the left page, the right page empty and
  both page buttons hidden.

The Wiki (Mud mound, Journal page, Ancient armour) agrees: the mound is dug with a spade and
always gives both items; the ancient armour has no use.

## Ours

No capture or Wiki source covers these, so they are our choices:

- The mound gives the pair on every search, also when the player already has them.
- With fewer than two free inventory slots it gives nothing and says "You don't have enough
  inventory space." (the haystack line in the same plugin).
- The response comes on the first tick after the click when the player is already beside the
  mound; live faces first and digs a tick later.
