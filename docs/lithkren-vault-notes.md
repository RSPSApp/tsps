# Lithkren Vault notes

Seven old notes lie around the Lithkren Vault (Dragon Slayer II). Each one is found next to a
loc, reads in the note interface, and all seven combine into the **Lithkren vault notes** book.

Code: `server/plugins/items/LithkrenVaultNotes.plugin.js` (locs, Read, combine), with the note
texts in `server/plugins/items/data/lithkren-vault-notes.json`. The book's Read is a
`ReadingBooks` entry (`server/plugins/items/data/reading-books.json`).
Tests: `server/tests/lithkren-vault-notes.test.cjs`.

## Where each note is

| Loc (gameval) | Name, option | Note | Line |
|---|---|---|---|
| `lithkren_vault_machine_notes` (1592,5064) | Machinery, Inspect | `ds2_lithkren_notes_1` | next to the machinery |
| `lithkren_vault_machine_notes_2` (1540,5064) | Machinery, Inspect | `ds2_lithkren_notes_2` | next to the machinery |
| `lithkren_vault_machine_notes_3` (1593,5084) | Ancient Machinery, Inspect | `ds2_lithkren_notes_3` | next to the machinery |
| `lithkren_vault_machine_notes_4` (1556,5064) | Incubator, Inspect | `ds2_lithkren_notes_4` | next to the incubator |
| `lithkren_vault_machine_notes_5` (1570,5067) | Incubator, Inspect | `ds2_lithkren_notes_5` | next to the incubator |
| `lithkren_vault_machine_notes_6` (1573,5094) | Machinery, Inspect | `ds2_lithkren_notes_6` | next to the machinery |
| `lithkren_vault_crate_notes` (1548,5101) | Stone crate, Search | `ds2_lithkren_notes_7` | in the crate |

## What live sends (rsprox captures)

From the rsprox.net index, recording 722 (rev 231) and 1528 (rev 224):

- **Finding a note** (722 ticks 12, 439, 450, 480, 505, 511, 1260; 1528 tick 9): the player
  faces the loc, then sound 2582, the note added, and an item box (zoom 400) with
  "You find some notes next to the machinery." / "...next to the incubator." / "You find some
  notes in the crate."; the same line is also sent as a mesbox message.
- **Again, with the note carried** (722 tick 17, 1528 tick 19): only the game message
  "You inspect the incubator, but find nothing of interest." (or "the machinery"; the crate's is
  "You search the crate, but find nothing of interest.", also rec 722).
- **Read on a note** (722 ticks 586-1281): interface 291 opens as the main modal with its
  twelve `note:line1-12` texts; no animation.
- **Combining** (722 tick 1434): one note used on another, with all seven carried: varbit
  `ds2_lithkren_notes` (12134) 0 -> 1, the seven notes removed, the book in the first freed
  slot, an item box "You combine the notes into a makeshift book." (also a mesbox message).
  Recording 723 sends the varbit at login.
- **Read on the book** (722 ticks 1717-1723): `human_readbook`, book 392 titled
  "Lithkren Lab Notes", five spreads (pages 1-10), notes in the order 6, 1, 3, 5, 2, 4, 7.

## Ours

- A banked note, or an owned book (carried or banked), also counts as having the note.
- A full inventory gets the core "not enough space" line.
- Notes used on each other without all seven fall through to the core default, which sends
  nothing; no capture shows that case.
- No quest check: the Wiki says four of the seven need Dragon Slayer II, but not which.
  Passing the vault's inner barriers (`docs/ds2-barriers.md`) already needs the quest.
- Reclaiming a lost book from a POH bookcase is not covered.
