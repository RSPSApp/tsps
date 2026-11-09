# Wilderness teleport levers

`server/plugins/objects/Levers.plugin.js` handles the levers that teleport in and out of the deep
Wilderness, by loc gameval:

| Lever | Option | Lands on | Line on landing |
| --- | --- | --- | --- |
| `edgeville_wildy_lever` (Edgeville, 3090,3475) | Pull | 3154,3924 (Deserted Keep) | `... and teleport into the Wilderness.` |
| `wildinlever` (East Ardougne, 2561,3311) | Pull | 3154,3924 (inferred, see below) | `... and teleport into the Wilderness.` |
| `wildoutlever` (Deserted Keep, 3153,3923) | Pull / Ardougne | 2562,3311 (East Ardougne) | `... and teleport out of the Wilderness.` |
| `wildoutlever` | Edgeville | 3090,3475 | `... and teleport out of the Wilderness.` |
| `magearena_lever_to_cellar` (3090,3956) | Pull | 2539,4712 | `... and teleport into the mage's cave.` |
| `magearena_lever_from_cellar` (2539,4712) | Pull | 3090,3956 | `... and teleport out of the mage's cave.` |

The Mage Arena's own pair (`magearena_lever_in`/`_out`) is in
`plugins/minigames/magearena/Levers.MageArena.js`. Other plugins can still teleport without a
lever's pull through the `lever:teleport` event.

## A pull, as captured

From rsprox captures (recordings 454, 457 and 4155 for the Mage Arena bank levers, 1444, 3275 and
4155 for the Edgeville lever, 1444 for the Keep lever). The player walks onto the lever's own tile
(the levers are straight wall decorations, shapes 4 and 5, which are operated from their tile) and
faces the wall it is mounted on (rotation 0 west, 3 south). The pull comes a tick after the
warning's option is picked (1444) and two ticks after arriving on the tile (454, 1444); from the
pull:

| Tick | What happens |
| --- | --- |
| 0 | `macro_lever_switch_down`, "You pull the lever...", varbit `busy` 1 (rev 238) |
| +1 | synth 2400 (the lever), the lever becomes its down loc for everyone |
| +2 | `human_castteleport` with `teleport_casting` at height 92, synth 200 |
| +5 | the teleport, the landing line, varbit `busy` 0 (rev 238), the lever back up |

The down loc is `ikov_leverdown` for the Edgeville and Keep levers (1444) and
`magearena_lever_down` for the bank pair (454); every one of these levers uses the same up and down
models, so the East Ardougne lever (no recording) uses `ikov_leverdown`. Bystanders see it come
back up four ticks after it went down (1487, 1506, 1630, 454). It comes back up even when the pull
is cut short.

The usual teleport checks (teleblock) run before the pull, unchanged.

## The Keep lever's options

The Keep lever is a multiloc on varbit `wildoutlever_vis`: 0 shows "Pull" (loc 9472), 1 shows
"Ardougne", "Edgeville", "Swap-options" (9738) and 2 the same with Edgeville first (46438). Its
"Pull" goes to East Ardougne (recording 1444; Wiki
[Deserted Keep](https://oldschool.runescape.wiki/w/Deserted_Keep) and
[Lever (Deserted Keep)](https://oldschool.runescape.wiki/w/Lever_(Deserted_Keep))); Edgeville
needs the easy Wilderness Diary. Live sets the varbit when a player lands in the Keep (1 in
recording 1444, 2 in 4155), so the plugin sets it to 1 on landing from the Edgeville lever when the
easy Wilderness Diary is done.

## The Edgeville warning

Recording 1444: a message box, "<col=7f0000>Warning!</col> The lever will teleport you deep into
the <col=7f0000>Wilderness</col>.", then the options "Yes, I'm brave.", "Eeep! The Wilderness... No
thank you." and "Yes, and don't show this warning again." under "Are you sure you wish to pull
it?". The third sets varbit `wilderness_lever_blockwarning_standard` and is remembered
(`levers:skip-wilderness-warning`); in recording 4155 the lever is pulled with no warning at all.

## The East Ardougne lever

No recording holds a pull of `wildinlever`. The Wiki
([Lever (Ardougne)](https://oldschool.runescape.wiki/w/Lever_(Ardougne))) says it lands by the
Keep's lever and gives "You pull the lever..." and "... and teleport into the Wilderness.", so it
uses the Edgeville lever's captured landing tile (3154,3924), sequence and warning. The tile and
the warning are inferred, not captured. Landing completes the easy Ardougne Diary task "Use the
Ardougne Lever to teleport to the Wilderness." and, as from Edgeville, sets the Keep lever's look.

## Not covered

- The Keep lever's Edgeville tile: no recording shows it; it keeps the tile this server used before.
- Swap-options (no recording of what it sends), the High Risk world warning, and the King Black
  Dragon lair lever (no recording).
