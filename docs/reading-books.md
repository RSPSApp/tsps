# Reading books and scrolls

`server/plugins/items/ReadingBooks.plugin.js` handles `Read` on books and scrolls whose only
effect is showing their text. Reading changes nothing in the inventory.

- **Books** (`data/reading-books.json`) open the two-page book (392) through
  `QuestRuntime.openBook`: busy (varbit 12393) set, `human_readbook` (1350), one spread per
  page turn. The Construction guide, the Glassblowing book, the Archaeologist's diary and the
  Rotten diary (`myq6_rotten_diary`, titled "Mouldy Diary", two spreads).
- **Scrolls** (`data/reading-scrolls.json`) open the long scroll (625) through
  `QuestRuntime.openLongScroll`. The Castle Drakan Poem scroll (`castle_drakan_poem_scroll`) and
  the Elixir of Everlasting. An entry with `handwriting` instead names a handwritten scroll
  interface (the Crombwick deed: `messagescroll_handwriting_2`, 95): every `messagescrollN_hw`
  line is written in order, blanks included, then 2524 and the modal. Neither plays an animation.

## Capture facts (rsprox captures)

Recording 4288 (rev 239):

- Poem scroll, Read (tick 3136): busy 0 -> 1, `toplevel_mainmodal_open` (2524) `[-1, -1]`,
  `if_opensub` longscroll (625) as the main modal, then `longscroll_setup` (418) with an
  empty title and 19 lines joined by `<br>`. No player animation. Closing it (tick 3140):
  busy 1 -> 0 and the modal closes.
- Poem scroll, drop (tick 3124): when the castle loads the dining room, live adds one poem
  scroll at (2337, 7365, 0). The Blood Moon Rises plugin puts it there whenever the player
  enters the ground-floor dining room at stage 40 without carrying it. Live shows only the one
  drop and pickup; putting it back on a later visit is ours.
- Rotten diary, Read (tick 19991): `human_readbook`, book 392 titled "Mouldy Diary", pages 1-2
  then 3-4 (`human_readbook_turnright` on the turn), the next-page button hidden on the last
  spread.

The rotten diary is found in the Darkwood forest, which tsps does not have yet, so it is only
read from an item that is already in the inventory.

## Slepe Sisterhood papers (rsprox captures, rev 231)

| Item | Interface | Recording |
|---|---|---|
| The Turncloak (22416) | book, 3 spreads | 391, tick 4919 |
| Explosive Discovery (22418) | book, 2 spreads | 391, tick 6657 |
| Bloody grimoire (22420) | book "Bloody Grimoire", 4 spreads | 391, ticks 2967 and 2982 |
| Elixir of Everlasting (22422) | longscroll | 392, tick 523 |
| Deed (22426) | messagescroll_handwriting_2, 12 lines | 391, tick 4736 |

Each book was read through to the spread where live hid the next-page button. The text in the
data files is copied from those `if_settext` / `longscroll_setup` packets.

The Elixir uses the shared long scroll, so it sets busy (12393) as the rev 239 poem scroll capture
does; the rev 231 Elixir capture (392 tick 523) sends no busy, which is the only difference.

Not covered: Buried Alive (22424) has no capture of its Read, so it is not in the data yet.
The deed's scroll arrived one tick after the click in its only capture (391); ours opens it on
the click, like the long scroll (392, same tick).
