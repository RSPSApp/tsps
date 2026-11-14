# Tar Swamp rubber cap mushroom

`server/plugins/world/TarSwampMushroom.plugin.js`. Fossil Island's rubber cap mushroom
(loc 30606, north-west of the Tar Swamp at 3663, 3809) throws the player to the mud pit in the
swamp's centre. Nine bittercap mushrooms in the pit first (the Mushy Bed) soften the landing.

## As live OSRS plays it

From the rsprox capture database, recording 711 (rev 231):

| Tick | What happens |
| --- | --- |
| 617, 769 | Mud pit Fill without 9 bittercaps: "You'll need 9 Bittercap mushrooms to fill the pit." |
| 919 | Fill with them: 9 bittercaps go, varbits `fossil_activity_mushroombed` (251) and `fossil_mushroom_bed` (5809) to 1, `farming_pick_mushroom` (2292), sound 2432, object box "You fill the pit with Bittercap mushrooms." with the bittercap |
| 81, 215 | Jump on with no bed: "That might damage you A LOT if you proceed." with "I'll take the risk of the damage." / "I'd better not in that case." |
| 221-244 | Taking the risk: the jump below, no bed graphic, and at the drop "Ow!", a 48 hit and sound 519 (delay 20) |
| 1186-1209 | With the bed made: the jump straight away, with spotanim 1410 and `fossil_mushroom_bed` back to 0 on landing |

The jump, in ticks from the click on the risk or the arrival at the mushroom:

| Tick | |
| --- | --- |
| +1 | lifted to level 1 on the tile they stand on |
| +5 | spotanim `fossil_mushroom_bounce` (1411), `quest_lunar_ejector_thrown` (4365), sound 1694 |
| +9 | at the pit, (3687, 3756, 1) |
| +11 | `quest_lunar_landing_on_face` (4367), sound 1695; on the bed also spotanim `fossil_mushroom_bed_fade` (1410) |
| +20 | two tiles west, (3685, 3756, 1) |
| +23 | down to (3685, 3756, 0) |

The OSRS Wiki (Mushy Bed) gives the damage without the bed as between 40 and 50; the capture's
48 is in that range. `fossil_mushroom_bed` drives the pit's multiloc (31426: Mud pit with Fill,
or the Mushy Bed), so the plugin keeps it per player and sends it again at login, with
`fossil_activity_mushroombed`, which the capture sets on the first fill and never clears.

## Ours

- The +20 two-tile step is a move in one tick; the capture shows it as one movement update.
- Clicks during the jump are ignored (none were recorded).
