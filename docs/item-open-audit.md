# Inventory "Open" audit (issue #1765)

Rev 241 cache: 624 items have an inventory Open option. Each one was run through every registered
item-action hook, with all plugins loaded, to see whether anything responds.

## Fixed

`server/plugins/items/OpenableItems.plugin.js` with `plugins/items/data/openable-items.json`,
replacing `RunePacks.plugin.js`.

- **[Item packs](https://oldschool.runescape.wiki/w/Item_pack):** all 37 on the Wiki, including the
  issue's bait and feather packs. Contents are noted unless already stackable.
- **Rolled or fixed contents, from their Wiki pages:** Casket (405; Tempoross and Pirate's Treasure keep their own),
  Oyster, Bag full of gems, Hallowed sack, Spoils of War (with the 1/400 Lil' Creator), Hunter kit,
  Dossier.
- **`item-gameplay.json`:** Open items with no Wear or Wield option carried legacy equipment types
  (mostly `FULL_HELMET`), which send a click with no plugin handler to the equip fallback in
  `ItemActionPacketListener`. 80 rows, notes included, are now `NONE`. This file is the old
  server-owned export, not an osrsreboxed-db import (`rune-packs-and-stray-dogs.md`).

### What the captures show

[rsprox recordings](https://rsprox.net/database), read from the click (`If3Button` on 149:0, op 2) to
the server's reply:

| Item | Recordings (rev) | Reply |
| --- | --- | --- |
| Packs | 3275, 3276 (234), 3271 (234) | Sound 3616, no message. 100 feathers (314), bait (313), noted vials of water (228), noted eye of newt (222), rune stacks. Fills the pack's slot unless it joins a stack |
| Casket | 1858 (227), 1102 (237) | Sound 52. "You open the casket. Inside you find some coins." / "... an uncut sapphire." in chat and an item box (193) |
| Oyster | 1102 (237) | "You open the oyster shell.", no box. The pearl (411) or shell (409) takes the oyster's slot |
| Dossier | 3386 (235) | Sound 6765. "You open the dossier and find contract of sensory clouding inside!" in chat and an item box. Contracts arrive unstacked, the first in the dossier's slot |

Each pack open takes its own click: 525 clicks to 521 sounds in 3276, 19 to 19 in 3271. The Wiki's
automatic opening of the rest doesn't appear, so it isn't implemented.

The archive has no recording of a bag full of gems, Hallowed sack, Spoils of War or Hunter kit being
opened, and none of a soft clay, sandworm or shark lure pack at all.

### Edge cases

| Case | Behaviour | Source |
| --- | --- | --- |
| Too few spaces for loot | Keeps the item: "You don't have enough inventory space to open that. You need at least N spaces." in chat and an item box. N is the worst roll, counting the item's own slot: 1 Casket, 1 Oyster, 6 Bag full of gems, 11 Hallowed sack, 3 Spoils of War, 9 Hunter kit, 3 Dossier | Wording: recording 4234, on an item the recording doesn't identify. N per item is derived from the tables, not captured |
| Full bag, pack or Casket or Oyster | Opens; the reward takes its slot | Slot behaviour from captures; full bag not captured |
| Pack at a stack limit, or stacks that don't fit | Keeps the pack: "You don't have enough inventory space." | Line from recording 3275, where it refuses other actions |
| Reward stack over the limit | The rest lands under the player (`forceAdd`) | Matches Yama's lockbox; not captured |
| A dialogue is open | Closed by the click, including on a refusal | Oyster click closing the casket box, recording 1102 |
| Entrana main island | Hunter kit: "Some forms of Hunter gear are not appreciated by the monks." Spoils of War: "You can't open this on Entrana." Item kept | Wiki; the Spoils line is ours, as the Wiki gives none |
| Dossier from 100 Yama victories | The first one gives the rite, unless one was already received. A rolled rite becomes 15-18 chasm teleport scrolls once received. A refused open doesn't use up the guarantee | [Wiki](https://oldschool.runescape.wiki/w/Rite_of_vile_transference), via `Dossier.Yama.js` |
| Collection log | Rewards are logged by unnoted id: uncut onyx, chasm teleport scroll, rite | Wiki (onyx); cache log contents |

### Not confirmed by a capture

- Casket wording for rewards other than coins and an uncut sapphire ("a"/"an" plus the lowercase
  name), and Dossier wording for chasm teleport scrolls and the rite (same line as the contracts).
- Bag full of gems, Hallowed sack, Spoils of War, Hunter kit: contents come from the Wiki. They play
  no sound and show no message when they open.

### Known differences from OSRS

- Dossier: reading the rite isn't built, so having received one stands in for the Wiki's "owned or
  used" (`yama:rite-received`). A rite that is destroyed stays received. A player who received the
  rite before 100 victories gets ordinary rolls from then on; the Wiki doesn't say whether their first
  dossier after 100 is forced to scrolls.
- Elemental rune pack: the Wiki's pack table says 50 of each rune and the cache examine says 100.
  The table is used; nothing sells this pack here.

## Not bugs

The audit probe can't see past these hooks' own checks, so they appear unhandled in a raw run.

- Looting bag: `LootingBag.plugin.js`.
- Herb sack and Seed box: `Guild.Farming.js`.

## Still does nothing on Open

**Players can get these today:**

| Item | Source | What it needs |
| --- | --- | --- |
| Ore pack 27693 (Volcanic Mine) | Petrified Pete's shop | The Wiki only estimates its ore mix, up to 3,300 points' worth |
| Heavy casket | Clue rewards | Behaviour not researched |
| Master scroll book (empty) | Clue rewards | Scroll storage interface |
| Jar of Swamp | Zulrah drop | The Wiki describes no contents; needs a capture |

**Nothing in the game hands these out yet:**

- Storage or an interface: Bolt pouch, Master scroll book, Extradimensional bag, Silklined herb sack,
  Reagent pouch, Chugging barrel, Dizana's max cape, Knapsack, meat and fur pouches, gem pouch family.
- Loot tables on the Wiki, not added because they can't be reached: Simple, Elaborate and Ornate
  lockbox, Cache of runes, Castle wars supply crate, potion packs, Hunters' loot sack (supplies),
  Nasty surprise, Trinket of advanced weaponry, Free to play starter pack.
- Quest, event or discontinued items: Airtight pot, Nitrous oxide, Catspeak amulet(e), Bone seeds,
  Documents, Box of chocolate strawberries, Deadman starter pack, Bounty crate 24329, Bounty supply
  crate 30576, Capt' arnav's chest, Icy chest, Egg box, Lockbox 33761, Mysterious book.
- Clue steps: 223 `Casket (easy/medium/hard/elite)` and `Puzzle box` ids that no plugin gives out.

## Verification

After building the server, run from `server`:

```sh
node --test tests/openable-items.test.cjs tests/rune-packs.test.cjs
```

Run live through the agent MCP (no client): both issue packs; full bags; stack limits; refusals at
one space short and opening at exactly enough; a box closed by the next click; Entrana; coins over
the limit landing on the ground; three clicks on one pack in a tick giving one pack's contents; five
packs queued in a tick; packs refusing Wear and still dropping; rewards surviving a relog; Tempoross's
casket keeping its own handler. Sounds and the real client's rendering weren't checked live.
