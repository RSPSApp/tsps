# Scenery searches that find nothing

`server/plugins/objects/ScenerySearch.plugin.js` answers Search on plain scenery that holds
nothing. Haystacks, crates and boxes are named handlers. Bookcases, old bookshelves, the Varrock
book shelves and the plain sacks are `{ fallback: true }` handlers, so any quest's, area's or
minigame's own handler for the same name answers first.

## Bookcases and book shelves

From rsprox captures (38 searches in 21 recordings, revisions 227-242) and the Wiki (Bookcase):

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
  read."; the Wiki's wording is used.
- Ours: each line equally likely (nothing gives the weights).

## Sacks

The plain sacks (loc `sacks`; recordings local 1000075, 1001339) send "There's nothing
interesting in these sacks." on arrival. Other "Sacks" locs (the Digsite's sample sacks, for
example) are left to their own handlers.
