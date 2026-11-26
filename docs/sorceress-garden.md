# Sorceress's Garden

The minigame lives in `server/plugins/minigames/SorceresssGarden.plugin.js` with its units in
`server/plugins/minigames/sorceressgarden/`.

## House shelves (beer glasses)

`Shelves.SorceresssGarden.js`: the four shelves (loc 21794, "Shelves", Search) on each floor of
the Sorceress's house give the empty beer glasses that sq'irkjuice is brewed into.

- rsprox captures, recording 3169 (four searches at 3319,3137,0): "You search the shelves ..."
  on the tick the player arrives, then three ticks later the find message and one beer glass in
  the backpack. Every search gives another glass; no animation or sound is sent.
- Wiki (Shelves (Sorceress's house)): "taking 4 ticks" (click to glass) and the messages
  `You search the shelves ...` and `... and among the strange paraphernalia, you find an empty
  beer glass.`
- Recorded difference: the recording's second message reads "...and among" with no space; the
  server uses the Wiki's text.
- Moving away during the search cancels it (the task is keyed to the player).
- Ours: with a full backpack the search ends with "You don't have enough inventory space." and
  no glass; neither source covers it.
