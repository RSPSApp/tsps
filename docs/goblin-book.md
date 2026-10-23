# Goblin book

The item plugin handles the cache's `Goblin book` / `Read` action with the shared two-page book interface (392). The actual book is item 10999; 11000 is its banknote and 17850 its bank placeholder, whose cache actions contain no Read option. Reading keeps the book and grants no reward.

The three spreads in `server/plugins/items/data/goblin-book.js` are an original concise lore adaptation (under 180 words), not a verbatim reproduction of OSRS book text. They summarise the creation of the goblin armies, the commands of their war god, and Hopespear's prophecy. This is a deliberate content limitation; the wording and pagination differ from live OSRS.

Behavior and lore source: [OSRS Wiki: Goblin book](https://oldschool.runescape.wiki/w/Goblin_book). Cache inspection establishes the item actions and note/placeholder relationships. No generated item or drop data is changed.

Verification: `cd server && node --test tests/goblin-book.test.cjs` after building. The test reads, turns pages forward/back, closes, checks the unchanged inventory, and verifies that notes/placeholders have no Read action.
