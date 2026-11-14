# Spellbook sublists (Jewellery Enchantments)

The standard spellbook groups Lvl-1 to Lvl-7 Enchant behind one "Jewellery Enchantments" button.
`server/plugins/interface/SpellbookSublist.plugin.js` handles its "View" and the tab's "Back".

## How the tab draws it

- The varbit `spellbook_sublist` (9730, varp 2972 bits 23-25) picks what the Magic tab lists. 0 is the whole
  book.
- The tab's script 2611 reads enum 5280 by spellbook (`varbit 4070`). That gives the book's sublist enum
  (5281-5284). With the sublist varbit set, the script lists the spells of that enum's entry.
- Only the standard book has a sublist in this cache: enum 5281 maps 1 to enum 5285, the enchant spells.
  The other books' sublist enums are empty, so any value shows their whole book.
- The client never sets the varbit itself. The server sets it, and the script redraws the tab.

## From rsprox captures

- **View** (`magic_spellbook:enchant_jewellery`, 218:15; 218:12 in the rev 234-235 recordings) sets
  `spellbook_sublist` 0 → 1 on the click's tick. There's no message or other packet.
- **Back** (`magic_spellbook:back_button`, 218:4) sets it 1 → 0, also on the click's tick.
- **Casting** an enchant spell from the sublist leaves it at 1. The player stays in the sublist until Back.
- Recordings 3276 (rev 234, ticks 1417-1476 and 31190-31296), 3342 (rev 235, ticks 4600-4606), 1102,
  1135 and 4263 (rev 237), and 4211 (rev 238).

## Ours

- The sublist isn't saved, so a login shows the whole book. A spellbook switch doesn't clear it: the
  other books ignore it, and the standard book shows the sublist again on the way back. No capture
  shows either case.
