# Reading books and papers

`server/plugins/items/ReadingBooks.plugin.js` answers **Read** on the non-quest books and papers
listed in `server/plugins/items/data/reading-books.json`. Reading takes nothing from the
inventory. An entry's shape picks the interface:

| Shape | Interface | What is sent |
|---|---|---|
| `title` + `spreads` | `book` (392) | `openBook` in `quests/QuestRuntime.js`: the reading animation, busy, title, 15 + 15 lines a spread, next/previous buttons |
| `longscroll` | `longscroll` (625) | `toplevel_mainmodal_open` (2524), the modal, then `longscroll_setup` (418) with the title and the whole text |
| `handwriting` | e.g. `messagescroll_handwriting_2` (95) | every `messagescrollN_hw` line in order, blanks included, then 2524 and the modal |

The scrolls play no animation; only the book viewer does.

## Slepe Sisterhood papers (rsprox captures, rev 231)

| Item | Interface | Recording |
|---|---|---|
| The Turncloak (22416) | book, 3 spreads | 391, tick 4919 |
| Explosive Discovery (22418) | book, 2 spreads | 391, tick 6657 |
| Bloody grimoire (22420) | book "Bloody Grimoire", 4 spreads | 391, ticks 2967 and 2982 |
| Elixir of Everlasting (22422) | longscroll | 392, tick 523 |
| Deed (22426) | messagescroll_handwriting_2, 12 lines | 391, tick 4736 |

Each book was read through to the spread where live hid the next-page button. The text in the
data file is copied from those `if_settext` / `longscroll_setup` packets.

Not covered: Buried Alive (22424) has no capture of its Read, so it is not in the data yet.
The deed's scroll arrived one tick after the click in its only capture (391); ours opens it on
the click, like the long scroll (392, same tick).
