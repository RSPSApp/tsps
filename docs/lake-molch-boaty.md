# Lake Molch's Boaty

`server/plugins/world/LakeMolchBoaty.plugin.js`, data in
`server/plugins/world/data/lake-molch-boaty.json`, tests in
`server/tests/lake-molch-boaty.test.cjs`.

Boaty (loc 33614, op Board) rows between the three Lake Molch docks and Molch Island, where
Alry runs aerial fishing. The cache places it at four docks (`yarn dump:loc 33614`):

| Stop | Boaty | Landing | Source of the landing |
|---|---|---|---|
| Molch Island | 1368,3640 | 1369,3639 | rsprox capture database rec 1692, tick 328 |
| Molch | 1343,3645 | 1341,3645 | rec 1692, tick 435 |
| Battlefront | 1383,3662 | 1384,3665 | Ours: not captured; the tile `server/plugins/agent/data/transports.json` gives (it matches both captured landings) |
| Shayzien | 1405,3611 | 1408,3612 | the tile the player walked to before boarding there (rec 1692, tick 322) |

## What live sends (rsprox captures, rec 1692, revision 226)

- **Board** (ticks 320-322 and 426-429): the chat menu "Where would you like to go?" with the
  other three stops, always in the order Molch Island, Molch, Battlefront, Shayzien, then
  Cancel. From Shayzien: `Molch Island|Molch|Battlefront|Cancel`; from Molch Island:
  `Molch|Battlefront|Shayzien|Cancel`.
- **A stop picked** (tick 324/325 and 432): the mesbox "You travel to <stop>." with no
  continue, and fade_overlay (174) with script 948 `[0, 255, 0, 0, 50]`.
- **Three ticks later** (328, 435): the player is at the landing and 948 `[0, 0, 0, 255, 50]`
  fades back in.
- **Two ticks after that** (330, 437): the messagebox and the fade overlay close.

No fare or requirement (OSRS Wiki, Lake Molch).

## Not covered

- What Cancel sends was not captured; ours just closes the menu.
- The Battlefront landing (see the table).
