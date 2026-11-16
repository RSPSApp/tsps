# Lumbridge Swamp Caves

`server/plugins/areas/Misthalin.plugin.js` handles the caves' dark hole entrance and the cave
goblin wall markers. Tests: `server/tests/swamp-cave-markers.test.cjs`, plus the dark hole case in
`server/tests/loc-teleports.test.cjs`.

## Cave goblin markers (Symbol, Look-at)

There are four locs, all named "Symbol" with a single Look-at op. Placements are from `yarn dump:loc 6921 6922 6923 6924`:

| Loc | Placements | Model shown |
| --- | --- | --- |
| `swamp_cavewall_northmarker` (6921) | 3232,9630 · 3251,9619 · 3253,9640 · 3254,9646 · 3285,9640 | 6923 |
| `swamp_cavewall_southmarker` (6922) | 3244,9646 · 3290,9620 · 3298,9629 | 6924 |
| `swamp_cavewall_eastmarker` (6923) | 3230,9613 · 3241,9609 · 3244,9639 · 3274,9622 · 3275,9639 · 3281,9618 · 3306,9612 | 6922 |
| `swamp_cavewall_westmarker` (6924) | 3243,9629 · 3254,9631 · 3271,9643 · 3295,9618 | 6927 |

From rsprox captures, each read did this. The sources are rsprox.net rec 3182 (rev 232): north at tick 2669, south at ticks 2877 and 3060, east at ticks 2192, 2535, 2559, 2570, 2591 and 2608, west at tick 2764. Also rec 3981 (rev 237), east at tick 90.

1. The player turns to the marker (face_angle 1227 from 3246,9612 to the north marker at
   3251,9619; 360 from 3246,9647 to the south marker at 3244,9646).
2. `if_setmodel cave_goblin_markers:symbol` (62:1) gets the model in the table.
3. Script `toplevel_mainmodal_open` (2524) runs with `[0, 0]`.
4. `cave_goblin_markers` (62) opens in the main modal.

No message, animation or sound follows.

It is an approach op. Most reads opened where the player stood, two to seven tiles from the
wall, without a step. In two reads the east marker was out of sight: from 3229,9608 (rec 3182
tick 2591) and from 3223,9618 (rec 3981 tick 89). There the player ran until it was in sight,
and it opened on that step. The marker tiles are blocked terrain, so a normal walk-up route can't
end on them. Within range and in sight, the plugin reads from the player's tile. From further
away it sets the shared approach range (`approachRange`), so the walk stops once the marker is
in sight. Ours: the range is 10, the engine's default approach range. No recording reads from
further than seven tiles away.
