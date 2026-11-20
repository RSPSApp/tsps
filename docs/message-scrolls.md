# Message scroll locs

`server/plugins/objects/MessageScrolls.plugin.js` handles `Read` on locs whose only effect is
the plain message scroll (`messagescroll`, 220). Each entry in
`server/plugins/objects/data/message-scrolls.json` lists its locs, the recordings, an optional
`readRange` and the fifteen lines.

- **Falador bank notice boards** (`fai_falador_noticeboard` 24098, `fai_falador_noticeboard2`
  24099; Falador east and west banks and their Kourend copies): Bank PIN advice. Read from up
  to 5 tiles away with a clear line, as the guide signposts are (`readRange` 5).
- **Varrock's Combat Scroll** (`fai_varrock_combat_scroll1_mirror` 5094): Ali Morrisane's
  "A Beginner's Guide to Killing Things". Normal reach: the player walks up to it.

## Capture facts (rsprox captures)

- Every read writes all fifteen `messcroll1`-`messcroll15` components, blanks included, then
  `toplevel_mainmodal_open` (2524) `[-1, -1]`, then `if_opensub` messagescroll (220) as the
  main modal. Busy (varbit 12393) goes 0 -> 1 the tick after the open and back to 0 when the
  scroll closes (241/1001398 ticks 254-256; 240/1001336 tick 3727). No animation or sound.
- Notice boards, reach: in 233/03237 the player stood at 3012,3357 and read 24099 at 3009,3356
  (3 tiles) at tick 1269, then 24098 at 3017,3358 (5 tiles) at ticks 1280, 1473 and 1484,
  without moving; each scroll opened that tick (the next for t1473). In 241/1001398 the player
  clicked 24099 from 3003,3365, walked, and the scroll opened on arriving at 3011,3357
  (tick 254).
- Combat Scroll, reach: in 232/03220 the player walked up to it each time, including from
  3251,3439 (3 tiles); in 240/1001336 it opened on arrival at 3254,3437.

## Recorded differences

- Busy 1 is sent with the open, not a tick later, as `QuestRuntime.openLongScroll` does.
- A board further than 5 tiles away is not recorded: the walk stops at 5 tiles with a clear
  line, as for the signposts. Ours.
