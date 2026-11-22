# Scenery searches that find nothing

`server/plugins/objects/ScenerySearch.plugin.js` answers Search on plain scenery that holds
nothing. Haystacks, crates and boxes are named handlers. Bookcases, old bookshelves, the Varrock
book shelves and the plain sacks are `{ fallback: true }` handlers, so any quest's, area's or
minigame's own handler for the same name answers first.

## Bookcases and book shelves

From rsprox captures (38 searches in 21 recordings, revisions 227-242) and the Wiki (Transcript:Bookcase):

- Locs named "Bookcase" or "Old Bookshelf", and two of the "Shelf" locs
  (`fai_varrock_shelf_books`, `fai_varrock_shelves_books`). Other "Shelf" locs are kitchen
  and shop shelves.
- "You search the books..." as a spam message, then one of three game messages, picked at
  random on each search. One loc gives different lines on different searches.
  - "None of them look very interesting."
  - "You find nothing to interest you."
  - "You don't find anything you'd ever want to read."
- From revision 239 on (recordings 4282, local 1001726, 1002048, 1002053), both messages arrive
  on the same tick, two ticks after the player reaches the shelf. Up to revision 233 the second
  message came two ticks after the first.
- Recorded difference: every recording has "You don't find anything that you'd ever want to
  read."; the Wiki's wording (Transcript:Bookcase) is used.
- Ours: each line equally likely (nothing gives the weights).

## Sacks

The plain sacks (loc `sacks`; recordings local 1000075, 1001339) send "There's nothing
interesting in these sacks." on arrival. Other "Sacks" locs (the Digsite's sample sacks, for
example) are left to their own handlers.

## Crates and boxes

From rsprox captures (rsprox.net index, revisions 227-242). The Wiki's Crate page quotes no
line for an empty crate ("searching crates does not have a purpose"), so the recordings decide.
Each line is a game message on arrival (most recordings: one tick after the last step), except
where a message box is noted. The lines are in `server/plugins/objects/data/crate-search.json`.

- "Crate" and "Crates" locs: "You search the crate but find nothing." The plural "Crates" locs
  say "crate" too (`sarim_crate3`, `fai_barbarian_small_crates`, `fairy_crate_2`,
  `aide_small_crates`). Recordings: 333, 381, 391, 424, 465, 480, 482, 672, 1047, 1858, 3032,
  3174, 3181, 3202, 3211, 3219, 3792, local 1000329, 1000410, 1001331, 1001457.
- "Boxes" locs: "There is nothing interesting in these boxes." Recordings: 86, 331, 333, 370,
  469, 2972, 3169, 3177, 3219, local 1000344, 1001339, 1001800, 1002175.
- Locs with their own line:
  - `fai_falador_boxes`, `fai_falador_small_crates`: "You search the crates but find nothing."
    (3237).
  - `fai_varrock_large_crate`, `fai_varrock_small_crates`: "You search the crate, but find
    nothing of note." (local 1002185, 1001682, revisions 241-242). The small crates said the
    default line in revision 232 (3219); the newer wording is used.
  - `fai_varrock_large_crates`: "You search the crates but find nothing of value." (3218).
  - `elid_crate`: "You search the crate but find nothing of note."; `elid_crates`,
    `elid_crates_2`, `elid_small_crates`: "You search the crates but find nothing of note.";
    `elid_boxes`: "You search the boxes but find nothing of note." (333, 3168).
  - The Wizards' Tower, in a message box: `fai_wiztower_crate2` "Nothing of interest in there -
    just some old books."; `fai_wiztower_crate3` and `fai_wiztower_boxes` "Nothing of interest
    in there - just some moth-eaten, dusty robes." (3202).
  - `pog_crate`: "You search the crate, but find nothing of note." (local 1001457).
  - `shayzien_crate_01_dark_op`: "This crate is locked." (1049).
  - Unhandled quest-area crates, their empty case only, in a message box:
    `castle_drakan_tinderbox_crate`, `castle_drakan_searchable_crate` (4288) and
    `dt2_digsite_pickaxe_crate` (3229) "You search the crate, but find nothing of interest.";
    `godwars_crate` "There is nothing in the crate." (local 1000491). What they give when not
    empty is not done here.
- Ours: a single "Box" loc keeps "You search the box, but find nothing of interest." (no
  capture).
- Left to other handlers: quest crates (Goblin Village, Myreque, Waterfall Quest, ...), the
  Motherlode Mine crates and clue-step crates.
- `grim_basement_crate_many` ("Boxes"): "You search the boxes but find nothing." (3246, 36
  searches). Not done: in the same recording some searches find leather gloves, a cabbage,
  thread or a needle instead; nothing gives the odds.
