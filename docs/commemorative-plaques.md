# Commemorative plaques (cba_plaque)

`server/plugins/world/CommemorativePlaques.plugin.js`. Two "Read" locs open interface
`cba_plaque` with fixed text, taken from rsprox captures:

| Loc | Where | Title | Recording |
|---|---|---|---|
| `cba_trophy_2013` "Clan Cup Trophy" (7127) | Giants' Plateau, 3390 3151 | Old School Clan Cup Winners | 3172 (rev 232), tick 2870 |
| `crackclue_2022_noticeboard` "Noticeboard" (46240) | Falador, 3050 3354 | Crack the Clue III | 3237 (rev 233), tick 1876 |

On the tick the player arrives, live sends `toplevel_mainmodal_open` [-1, -1], opens the modal,
sets `cba_plaque:title`, then runs `killdeathratio_init` (498) with the left (names) and right
(what they won) columns. The Close button, `cba_plaque:com_6`, closes it on the click tick
(recording 3172, tick 3042).

Wiki: [Clan Cup Trophy](https://oldschool.runescape.wiki/w/Clan_Cup_Trophy) ("can be read to see
all the winners of the various Clan Cup events"; members: No) and
[Crack the Clue III](https://oldschool.runescape.wiki/w/Crack_the_Clue_III).
