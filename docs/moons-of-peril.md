# Moons of Peril

The Moons of Peril (https://oldschool.runescape.wiki/w/Moons_of_Peril): the Blood, Blue and
Eclipse Moon in Neypotzli under Cam Torum, their camps and supplies, and the Lunar Chest. This
page is the research behind the implementation. It is built from rsprox captures
(https://rsprox.net/database), the OSRS Wiki (`Moons_of_Peril`, `Moons_of_Peril/Strategies`,
`Blood_Moon`, `Blue_Moon`, `Eclipse_Moon`, `Lunar_Chest`, `Neypotzli`) and the rev 241 cache.

It is one plugin, `server/plugins/bosses/MoonsOfPeril.plugin.js`, with one unit per part in
`server/plugins/bosses/moonsofperil/` and its data in `server/plugins/bosses/data/moons-of-peril.json`.
The Perilous Moons quest lets the player through the statues during its fight stages
(`moons-of-peril:can-enter`), counts each kill (`moons-of-peril:killed`, re-sent at login for a
kill whose landing a logout cut short), and opens the camps from the ritual stage on
(`moons-of-peril:camps-open`).

## Layout

| File | What it owns |
| --- | --- |
| `Common.MoonsOfPeril.js` | The data, tick helpers, tiles relative to a Moon, the per-player sends (varbits, sounds, map animations, locs and projectiles only that player sees), the HUD and portal, the dead Moons. |
| `Cycle.MoonsOfPeril.js` | Each arena's shared Moon (never moves, its hitpoints locked), the threat circle, the loop of glyphs and specials on the world's tick, the Moons' stats. |
| `Fight.MoonsOfPeril.js` | One player's fight: their own Moon health, HUD, curse stacks and copy of the special. |
| `Attacks.MoonsOfPeril.js` | The standard attack, the off-glyph burn, Blood Moon's healing, the self-damage. |
| `Curses.MoonsOfPeril.js` | Cold and blinding. |
| `Kill.MoonsOfPeril.js` | The kill and the camp landing. |
| `Arena.MoonsOfPeril.js` | The arenas (shared `Area`s, multi-combat), statues, exit stairs, hits on the Moon, logging in, dying. |
| `Pieces.MoonsOfPeril.js` | A special's personal NPCs and locs, and the knock-back. |
| `BloodMoon` / `BlueMoon` / `EclipseMoon` `.MoonsOfPeril.js` | Each Moon's two specials. |
| `Camps.MoonsOfPeril.js` | The cooking stove, supply crates, grubs, paste and potions, and Neypotzli's resources fizzling on the way out. |
| `River.MoonsOfPeril.js` | Bream from the two river spots. |
| `Chest.MoonsOfPeril.js` | The Lunar Chest and its loot, and Eyatlalli's offerings. |
| `Scoreboard.MoonsOfPeril.js` | Eyatlalli's Scoreboard: chests opened and deaths, the player's and the world's. |
| `Commands.MoonsOfPeril.js` | `::moon <moon>`, `::moonphase <moon> <focus>`, `::moonhp <hitpoints>`, `::moonreset`, `::moondead [moon]`. |

The foods heal through `plugins/items/data/food.json` (a new `lowestOf` heal) and the moonlight
potion is one of `plugins/items/Potions.plugin.js`'s potions.

## Shared arenas, personal fights

The arenas are not instances. Each has one Moon NPC, `pmoon_boss_*_moon` (13016-13018), which
everyone in it sees. Its loop runs on the world's tick, so every fighter in an arena sees the
same glyph and the same special at the same time. Health is each player's own. The Moon keeps
its hitpoints locked; a player's hits come off their own 500 (`pmoon_boss_hp`, the boss HUD, and
the Moon's head bar on the tick they hit). A kill sets `pmoon_boss_hide_npc` for that player,
which turns the Moon into its empty form (13485-13487) for them alone. The pieces of a special
(jaguars, pools, ice blocks, ice floors, storms, braziers, clones, the shield) are each player's
own: owner-only NPCs and locs only they are sent. No recording has a second player in an arena,
so that part is a choice, not a capture. When a special takes the Moon away, it goes for everyone.

The Moons' own NPC ids have no name in the cache, so the stat loader skips them; they take
their visible forms' stats (13011-13013).

## Sources

| Recording | Revision | World | What it has |
| --- | --- | --- | --- |
| 1693 | 226 | normal | The quest's run: Blue (kill), Blood (two entries, kill), Eclipse (kill), camps built, Eyatlalli, the first chest. The only main-game recording, so damage, healing and xp come from here or the Wiki. |
| 1104 | 237 | Leagues VI | Eclipse (two runs, one kill), Blue (three kills), Blood (several entries, one kill), cooking, fishing, grubs, crates, teleports, three chest openings. |
| 3276 | 234 | Grid Master | Blood (kill, three entries) and Blue (kill) from a fresh start, chest. |
| 2278 | 228 | normal | Blood entry, Quick-escape on the exit stairs. |

Leagues and Grid Master change how hard the player hits and how much they take, so those
recordings are trusted for the bosses' side (ids, animations, graphics, projectiles, sounds,
locs, varbits, messages, the order and timing of everything) and not for damage numbers.

Coordinates below are relative to each Moon's south-west tile, which is fixed (no instance
offset in any recording):

| Moon | NPC (combat / visual multi) | Tile |
| --- | --- | --- |
| Blood Moon | 13016 `pmoon_boss_blood_moon` / 13011 | (1390, 9630, 0) |
| Blue Moon | 13017 `pmoon_boss_blue_moon` / 13013 | (1438, 9678, 0) |
| Eclipse Moon | 13018 `pmoon_boss_eclipse_moon` / 13012 | (1486, 9630, 0) |

Each Moon is 5x5, 500 hitpoints, combat 329, attack speed 6 (Wiki infobox). All three are weak to
air spells (15%) and have +500 magic and ranged defence. Their melee weaknesses differ: Blood Moon
to slash (-2 flat armour), Blue Moon to crush (-5), Eclipse Moon to stab (+6, or +4 during Clones).

## Shared fight state

Varp 4153, plus bits of 4154 and 4157, carry the fight to the HUD (`pmoon_hud`, 869):

| Varbit | Name | Captured use |
| --- | --- | --- |
| 9846 | `pmoon_boss_hp` | Boss hitpoints, sent on every change (500 on entry and after a kill). Mirrored in `hpbar_hud_hp` (6099). |
| 9847 | `pmoon_boss_in_combat` | 1 while in the arena. |
| 9848 | `pmoon_boss_current_focus` | The active sigil, 0-7 (see Sigils). 0 = new moon, 4 = full moon. |
| 9851 | `pmoon_boss_last_focus` | Follows current_focus on the next attack tick. |
| 9853 | `pmoon_boss_condition` | Curse stacks: Blue's cold, Eclipse's blinding. |
| 9854 | `pmoon_boss_blue_wearprevent` | 1 while the weapon is frozen (it can't be re-equipped). |
| 9855 / 9856 | `pmoon_boss_blue_brazier_lit_left/right` | 1 while that brazier is shrouded (out); 0 once relit. |
| 9857 | `pmoon_boss_ad_hp` | Blood: hitpoints sapped by the jaguars (25 on the special); Blue: the ice block's hitpoints (72). |
| 9858-9860 | `pmoon_boss_blood/blue/eclipse_dead` | Set on a kill, cleared when the Lunar Chest is opened. |
| 9862 | `pmoon_boss_hide_npc` | 1 while the Moon is hidden behind a stand-in (`pmoon_boss_tracking_npc`, 13009) during its death or the Weapon Freeze. |
| 9863 | `pmoon_boss_icicle_state` | Set to the broken block (1-3) when the weapon is retrieved, which turns that block into "Cracked ice"; 0 again with the next freeze. |

On entry: `multiway_indicator` 1, `hpbar_hud_basehp` 500, `hpbar_hud_boss` 1, varp `hpbar_hud_npc`
set to the Moon's id, `pmoon_boss_in_combat` 1, then `pmoon_hud` opens on the HUD overlay and
music 786 (The Moons of Ruin) plays. `gotr_overlay` (745) opens on the atmosphere layer while the
player walks in. Script 5984 runs with [52840, 12584775] for Blood and [38742, 10861264] for Blue,
and script 5985 runs when they arrive.

### The cycle

The Wiki gives the Blood Moon's loop as 156 ticks. The captures show each Moon's own segments
(data `moons.<moon>.cycle`): Blood 156 ticks, Blue 192 (its first glyph after Frost Storm lasts
24 ticks, its attacks 15 and 21 ticks in), Eclipse 187 (its first glyph after Clones lasts 17).
In general:

1. **New Moon special** (focus 0), about 50 ticks.
2. Sigils 1, 2 and 3: 12 ticks each, two attacks on each.
3. **Full Moon special** (focus 4), about 26-55 ticks depending on the Moon.
4. Sigils 5, 6 and 7, then back to the New Moon.

The Moon attacks every 6 ticks while a sigil is up. The focus moves on 3 ticks after every second
attack: the new `pmoon_boss_threat_circle` NPC (13015, spawn animation 10981) appears that tick,
and the old one is removed the next tick. Specials alternate because they sit at opposite ends
of the loop.

Entering joins the loop where it is. A fresh entry was seen at focus 0 (the New Moon special plays
straight away: Blood's jaguars on tick 5, Eclipse's rays on tick 2), and at 3 or 4 after a death
or quest step. A special that is already running is shortened to the time left (the Wiki says
"scaled to the remaining time"). For example, an Eclipse run that entered late got 22 ticks of
Searing Rays instead of 55. A few times the focus stepped forward and back on the same tick, and
the step then happened 12 ticks later. This was seen after every Eclipse Clones phase and twice
in Blue fights. The cause is unknown; **open question**.

### Sigils

The threat circle sits on one of eight 3x3 glyphs around the Moon, numbered clockwise from the
south:

| Focus | Glyph SW tile | Seen |
| --- | --- | --- |
| 0 | (+3, -2) | New moon (inferred from the ring) |
| 1 | (0, -2) | capture |
| 2 | (-2, 0) | capture |
| 3 | (-2, +3) | capture |
| 4 | (0, +5) | Full moon (inferred) |
| 5 | (+3, +5) | capture |
| 6 | (+5, +3) | capture |
| 7 | (+5, 0) | capture |

Standing off the glyph during a standard attack does 1 damage, then doubling each tick up to 16,
and adds a curse stack (Wiki). The captures don't separate these hits from the attack's own.

### Standard attack

The Moon's attack plays a combo animation, and three typeless hits land over the next two ticks.
Each hit is rolled against the player's slash defence with +100 accuracy, max 4, 8 and 20. Once
one misses, the rest miss too. Protection prayers do nothing (Wiki). The captures show the spam
message on the first landing hit, and a melee-sound pair (518-521) per hit.

| Moon | Animation | Sounds the tick before (delay) | Message |
| --- | --- | --- | --- |
| Blood | 11004 `npc_djinn_01_combo` | 8847 (27), 8887 (39), 8889 (40), 8862 (51), 8694 (75), 8702 (76), 8716 (86), 8752 (103), 8725 (104), 8762 (110) | "The Blood Moon pierces your defence and saps your vitality!" |
| Blue | 11014 `npc_djinn_03_combo` | 8922 (50), 8923 (85), 8927 (115) | "The Blue Moon pierces your defence and chills your joints!" |
| Eclipse | 11023 `npc_djinn_02_combo` | 8655 (48), 8667 (80), 8624 (103) | "The Eclipse Moon's light pierces your defence and blinds you!" |

Hits on a Moon play sound 565 (Blood), 8917 (Blue) or 8681 (Eclipse). The Moon also loses about
1 hitpoint every few ticks with no hitsplat (the Wiki's self-damage). It shows only in
`pmoon_boss_hp`.

Blood Moon heals 1x the first hit, 2x the second, and 30-50 from the third (Wiki). The heal shows
as a `fx_wardens_charging01` (2227) projectile from the player to the Moon (0-60, heights 15 to 87,
angle 135) with sound 8722, and `banshee_scream` (337) on the third hit.

### Knock-back

Every special that moves the player plays `human_troll_flyback_merge` (9799) with
`stunned_thieving` (245, slot 2, height 124), sound 3201, and an exact move over 60 cycles to the
special's tile:

- Blood Rain: a random arena tile.
- Clones: the Eclipse Moon's centre (+2, +2).
- Searing Rays: just outside the shield's start (+5, -3).
- Frost Storm: (+2, -1).

## Blood Moon

### Blood Jaguar (New Moon)

| Tick | What happens | Source |
| ---: | --- | --- |
| 0 | Moon not attackable (`enabled_ops` 0). `pmoon_boss_ad_hp` = 25. `current_focus` 0, then straight to the safe glyph (random: 3, 5 and 7 seen). Eight `fx_wardens_charging01` projectiles go from the Moon's centre to the jaguar tiles (0-50, angle 32, heights 87 to 0). Sound 8885. | capture (4 jaguar specials) |
| 1 | The old circle goes. Sound 8842. | capture |
| 2 | Eight `pmoon_boss_jaguar` (13021) spawn at (0,-4), (+3,-4), (+7,0), (+7,+3), (+3,+7), (0,+7), (-4,+3), (-4,0), facing inward, with animation 9094. Moon-phase floor locs (shape 11) go on the same tiles: `overlay_new` (+3,-4), `quarter_waxing` (0,-4), `half_waxing` (-4,0), `threequarters_waxing` (-4,+3), `full` (0,+7), `threequarter_waning` (+3,+7), `half_waning` (+7,+3), `quarter_waning` (+7,0). Each gets loc animation 10978, then 10979 a tick later. The safe glyph gets its `pmoon_boss_overlay_*` NPC (13407-13414). | capture |
| 3 | "<col=e00a19>You suddenly feel drained. A blood jaguar is shaping from your blood!</col>". The player takes up to 15 damage, which heals the Moon. Moon animation 11000 (`npc_djinn_01_magic`, delay 30) every 6 ticks from here. Projectile 2227 from the Moon to the jaguar by the safe glyph. | capture; Wiki |
| 7, then every 6 | 24 `pmoon_boss_blood_pool` locs (51046, shape 10) on the ring next to the Moon (every tile at x=-1 or +5, y=-1..+5, and at y=-1 or +5, x=-1..+5). Sounds 8783, 8729. Despawn animation after 3 ticks, removed after 5. Seven waves. | capture |
| 10, then every 6 | Jaguars attack (animation 10959, sounds 8819 and 7878). Each cleaves the two tiles in front for up to 9, and pools hit for up to 6. Jaguar damage heals the Moon 3x and pool damage 2x. A hit shows loc animation `vfx_djinn_blood_pool_attack_01` on the pool tile and projectile 2227 to the Moon. | capture; Wiki |
| - | Hitting the jaguar by the safe glyph gives back the sapped hitpoints: a heal hitsplat equal to the damage dealt, capped by `pmoon_boss_ad_hp`, which counts down to 0. At 0: "This jaguar doesn't possess any of your blood!" | capture; Wiki (up to 25) |
| ~43 | The floor locs despawn (animation 10980). Jaguars play 10960 and lose their ops. | capture |
| ~45 | Moon attackable again. The next circle spawns at glyph 1, and the focus becomes 1 eight ticks later. Jaguars are removed two ticks later. | capture |

### Blood Rain (Full Moon)

| Tick | What happens | Source |
| ---: | --- | --- |
| 0 | Moon not attackable. Focus 4. | capture (5 rains) |
| 3 | The player is knocked back to a random tile. Moon animation 11000. Area sound 8880 (delay 25, radius 20). | capture |
| 4 | `pmoon_boss_blood_fire` (51054) rings the arena: x -6..+10 at y=-6 and y=+10 (rotation 1), and y -6..+10 at x=-6 and x=+10. 64 locs, rising from the corners with loc animations `fx_fire02_spawn_idle` and `_delay_1`..`_delay_4`. | capture |
| 6 | Area sounds 8737, 8738, 8777 and 8840. | capture |
| 7-25 | Waves of 18-25 `pmoon_boss_blood_pool` on random arena tiles, almost every tick (sounds 8778, 8683). Each lasts 5 ticks. A pool hits for up to 9 and heals the Moon 2x. Standing off the pools chips the Moon (-1 hitpoint every 4 ticks). | capture; Wiki |
| 8 | The Moon plays `npc_djinn_01_teleport_idle_disappear` (11003). It is removed 2 ticks later. | capture |
| 25 | The next circle at glyph 5. | capture |
| 26 | The Moon comes back (`jump=true`) with `npc_djinn_01_teleport_idle_appear` (11002). Focus 5 five ticks later. | capture |

## Blue Moon

Arena: storms cross it from x=-10 to +14, between rows y=-6 and y=+10. Its braziers are
`pmoon_boss_brazier_left` (52992) at (-13, +1) and `pmoon_boss_brazier_right` (52993) at (+15, +1).

### Cold (curse)

`pmoon_boss_condition` grows by 2, 4 and 10 with the three hits of an attack, and by storm hits.
Crossing a threshold sends a message:

| Threshold | Message |
| --- | --- |
| First stack | spam: "The Blue Moon pierces your defence and chills your joints!" |
| ≥3 | "<col=00e6e6>The Blue Moon pierces your defence. The cold is starting to get in...</col>" |
| ≥9 | "<col=00e6e6>The Blue Moon pierces your defence. Your joints are starting to lock up...</col>" |
| ≥18, on the next attack | "<col=00e6e6>Your joints lock up as you go to attack. The cold is too much to bear!</col>". The attack is cancelled, spotanim 502 (slot 2, height 60) plays on the player, and stacks drop by 16 (18 to 2 in every capture; the Wiki says 18). |

Stacks fall by 2 every 5 ticks (Wiki), and relighting both braziers clears them.

### Weapon Freeze (Full Moon)

| Tick | What happens | Source |
| ---: | --- | --- |
| 0 | Focus 4, then the target block's index (1 or 2 seen). `blue_wearprevent` 1. `ad_hp` 72. The Moon is not attackable. | capture (7 freezes) |
| 2 | `hide_npc` 1. Three ice blocks spawn at the same tiles every time: `pmoon_boss_icicle_1` (13022) at (-4,0), `_2` (13023) at (+5,-2) and `_3` (13024) at (+3,+7). Each has a blocking floor loc (`overlay_new_blocking`, `quarter_waxing_blocking`, `half_waxing_blocking`), and each plays area sound 8914. A stand-in tracking NPC shows spotanim 2785 (`pmoon_boss_fake_blue_magic`). | capture |
| 4 | The weapon leaves the hands: `combat_weapon_category` becomes 0, then "Category: Unarmed". Spam "<col=00e6e6>Your weapon freezes over. You're forced to let go!</col>". Player animation 3170, spotanim 2754. Projectile 2756 (0-90, angle 150) from the player to the target block, and the block plays 11031 after 90 cycles. Sound 8918. Until the weapon is retrieved every block shows as "Frozen weapons" (13025). | capture |
| 5-8 | The stand-in fades (2787). The Moon disappears (11012) and is removed. | capture |
| 8, then every 8 | Ice floor waves: map animations `vfx_djinn_ice_floor_spawn_01`, then `_idle_01` (delay 30) and `_attack_01` (delay 90), on 27-132 tiles in crosses around the blocks. Area sounds 8925 and 8909 (delay 70) at each block. A shard hit does light damage. | capture; Wiki |
| - | Punching the target block (unarmed, animation 422) does 8 per hit (9 at rev 226, hitsplat 43) off `ad_hp` (sound 8919). At 0: `icicle_state` set to that block, `wearprevent` 0, "You retrieve your weapon from within the cracked ice.", the weapon category comes back, the block cracks (11032), sounds 8921 and 3284. Clicking again: "You've already retrieved your weapon!" | capture |
| 9-51 | The Moon loses about 7-8 hitpoints every 8 ticks while away. | capture |
| 51 | All blocks explode (11035, sound 8924) and are removed a tick later. The circle returns at glyph 5. | capture |
| 55 | The Moon comes back (`jump=true`, 11011). Focus 4, then 5. | capture |

Not breaking the block in time does up to 28 damage. With no weapon equipped, the player takes 3-15
damage and still has to break the block. Logging out leaves the weapon with Eyatlalli (Wiki).

### Frost Storm (New Moon)

| Tick | What happens | Source |
| ---: | --- | --- |
| 0 | Focus 0. Moon not attackable. Area sound 8926 (radius 10, size 15). | capture (4 storms) |
| 1 | `pmoon_boss_blue_fire` (51053) along the north and south edges (32 locs, corner-first fire animations). | capture |
| 2- | `pmoon_boss_winter_storm` NPCs (13027) spawn at the north or south edge (y=+10/+11 facing south, y=-6/-7 facing north), each with spawn animation 10970 and area sound 8900. They walk straight across one tile a tick and despawn at the far side (10972). Several spawn per tick, at random columns between x=-10 and +14. | capture |
| 3 | The player is knocked back to (+2, -1). Moon animation 11007, spotanim 2783 (delay 30, height 255). Projectile 2780 from the Moon to (-12, +2) and (+16, +2) (80-150, heights 830 to 50). | capture |
| 7 | Both braziers out: `brazier_lit_left` and `_right` 1. Sound 8903. | capture |
| every 10 | The Moon heals 10 per shrouded brazier (heal hitsplat). | capture; Wiki (5 times, up to 100) |
| - | A storm hit does light damage and adds cold. The player is forced to walk for 2 ticks. | capture; Wiki |
| - | Brazier op1: player animation 811 (`human_casting`) and sound 8913. A tick later: spam "You dispel the blue moon's shroud over the brazier causing it to re-ignite!" and the varbit goes to 0. Lighting the second one sets condition to 0 with "Lighting the final brazier fills you with warmth, removing some of your cold buildup." | capture |
| ~50 | Focus 1. Moon attackable 6 ticks later. The north/south fire is removed on the next attack (30 `loc_del`). | capture |

## Eclipse Moon

### Blinding (curse)

`pmoon_boss_condition` grows with standard attacks (2, then +1, +14, +5 seen) and much faster from
Searing Rays (+9 a ray). It falls by 2 every 5 ticks. Blinded attacks glance: max hit -12 (-8 in
Clones), with a chance that reaches 100% at 100 stacks (Wiki).

### Clones (Full Moon)

| Tick | What happens | Source |
| ---: | --- | --- |
| 0 | Focus 4. Moon not attackable, animation 11017 (`npc_djinn_02_magic`). `pmoon_boss_small_threat_circle` loc at the centre (+2, +2). | capture (5 phases) |
| 2 | The player is knocked to the centre (+2, +2) and bound there. | capture; Wiki |
| 4-6 | The Moon disappears (11021) and is removed. | capture |
| 10 | Clones (`pmoon_boss_eclipse_clone`, 13019, 5x5, no ops) start: five waves of three, a clone every 2 ticks, waves 9 ticks apart (10, 12, 14, 19, 21, 23, ...). Each spawns 3 tiles from the Moon's tile in one of eight directions ((±3, 0), (0, ±3), (±3, ±3)), facing the centre, with animation 11019. | capture |
| +3 after each spawn | The clone attacks (11022). Facing it parries: the player's attack lands on the Moon (sound 8681) with 100% accuracy, and the player takes 0. The clone leaves (11021) and is removed. | capture; Wiki |
| ~55 | The circle returns at glyph 5. The Moon comes back (`jump=true`, 11020) facing it. | capture |

Only melee damages the Moon during Clones. Combat Achievement "The Clone Zone" fails with "You have
failed <col=06600c>The Clone Zone</col>: You attacked the main Eclipse Moon."

### Searing Rays (New Moon)

| Tick | What happens | Source |
| ---: | --- | --- |
| 0 | Focus 0. Moon not attackable, facing the shield, animation 11017. `pmoon_boss_eclipse_moon_shield` (13020, 2x2) spawns at (+5, -2) with animation 10973 and area sound 8678. | capture (5 phases) |
| 2 | The player is knocked to (+5, -3), behind the shield. `pmoon_boss_eclipse_pathing_blocker` (51049) at (-2, -2). | capture |
| 10 | The shield walks the ring around the Moon, one tile a tick, counter-clockwise: west along y=-2 to (-2, -2), north to (-2, +5), east to (+5, +5), south to (+5, -2). It pauses about 3 ticks at each corner and turns to face the next leg. | capture |
| every 3 from 10 | A ray: Moon animation 11018 with spotanim 2784 (delay 5), sound 8645. A tick later, projectile 2781 (20-50, heights 152 to 50) hits the shield if the player is behind it. Otherwise it hits the player (20-60, heights 152 to 17, sound 8638) for minor damage and about +9 blinding. | capture; Wiki |
| ~49 | The circle returns at glyph 1 and the Moon is attackable. The shield despawns (10975, area sound 8630) and the blocker is removed. | capture |

## A kill

Same for all three:

| Tick | What happens |
| ---: | --- |
| 0 | `pmoon_boss_hp` 0, `<moon>_dead` 1, `hide_npc` 1. A tracking NPC on the Moon's tile faces the player and plays the death spotanim: 2789 Blood, 2790 Blue, 2788 Eclipse. |
| 4 | Player animation 388 (delay 15) with hitsplat 44 for 129-161 (purpose unknown; **open question**). |
| 5 | `pmoon_hud` closes, `gotr_overlay` opens with script 5984 [52841, 1355188], sound 7928. |
| 6 | `hide_npc` 0. The tracking NPC is removed. |
| 7 | HUD varbits back to 0, `pmoon_boss_hp` 500, `condition` 0. The player is moved to a camp by its cooking stove, and the next zone's NPCs load. |

Where the player lands depends on which Moons are already dead (Wiki):

| Kill | Lands at |
| --- | --- |
| Eclipse first | Earthbound Cavern, or Streambound if Blood is already dead |
| Blue first | Ancient Prison, or Streambound if Blood is already dead |
| Blood first | Earthbound Cavern, or Ancient Prison if Blue is already dead |

Captured landings: Blue kill (+74, +14) from the Blue Moon, Eclipse kill (+26, +62) from the
Eclipse Moon, Blood kill (-39, -48) from the Blood Moon.

The Combat Achievement messages seen were Perilous Dancer, Betrayal, The Clone Zone and Fortified.
They complete or fail through the existing combat-achievements plugin.

Dying with the Moon: the player leaves with 1 hitpoint and the kill counts (Wiki). A normal death
sends unprotected items to a grave outside, and anything left on the arena floor is lost.

## Entering and leaving

| Thing | What happens | Source |
| --- | --- | --- |
| Statue (`pmoon_entry_statue_blood/blue/eclipse`, 51372-51374, Use) | The first time, a mesbox: "You are about to enter a dangerous area. <col=#f#>Items dropped within the arena may be irretrievable.</col>". Then face, sound 7928, `gotr_overlay` with script 5984 (the Moon's colours), the arena join (above), and the move to the arena two ticks later. | capture (13 attempts) |
| Exit stairs (`pmoon_boss_exit_stairs`, 53003; Quick-escape / Escape) | Leaves the arena. Quick-escape is the default since 3 April 2024 (Wiki). | capture (rev 228, 4 attempts); Wiki |
| Tunnels (`pmoon_telebox`, `_3x3`, `_diagonal`, `_cave`, 51375-51378, Pass-through) | `fade_overlay` [0, 255, 0, 0, 15], the boss HUD cleared, the move about 2 ticks later with spam "You follow a long and winding tunnel before emerging on the other side.", then fade back in [0, 0, 0, 255, 15], `busy` 1 meanwhile, and music 785 (Lost to Time). Destinations from captures: (1439, 9509, 1), (1440, 9615, 1), (1423, 9615, 1), (1513, 9596, 0), (1510, 9675, 0), (1355, 9538, 0). | capture (126 attempts) |

## Camps and supplies

`Camps.MoonsOfPeril.js` and `River.MoonsOfPeril.js`, data `supplies`, `river` and `neypotzli`.
The quest keeps the crates, saplings and river for its own steps until the player reaches the
Moons (stage 27); from then on, and after the quest, they are this plugin's. Moss lizards and
moonlight moths stay with the Hunter plugin.

| Thing | What happens | Source |
| --- | --- | --- |
| Cooking stove (`pmoon_range`, 51362) Cook, or raw bream / moss lizard used on it | One action a tick until none are left: `human_cooking_walkmerge_norestart`, sound 2577. 30 Cooking; bream 45 xp and never burns, "Your cooking knowledge allows you to cook two fish at once!" for a second; a lizard 60 xp and up to two extra cuts ("Your cooking knowledge allows you to cut extra meat from the lizard!": estimate). "You haven't got anything to cook." | capture (90 attempts); Wiki |
| Cooking stove, Make-cuppa | `human_eat` (829), sound 2401, "You drink the tea and find yourself feeling energised!" (spam), full run energy. | capture (10 attempts) |
| Supply crates (`pmoon_supply_crate`, 51371) | The Fishing, Hunting and Herblore kits hand over the tools the player lacks, and two vials of water every time, in an object box: "You take a knife and a big net from the crates.", "You take some rope and a butterfly net from the crates.", "You take a pestle and mortar and some vials of water from the crates."; `human_pickuptable_walkmerge`, sound 2582. Take-from asks which kit (estimate: no response was captured). | capture |
| Grubby sapling (`pmoon_grub_sapling`, 51365) Collect-from | Two ticks after arriving: sound 7925, a moonlight grub; sometimes two, "Your hunting knowledge allows you to find an extra grub."; "Your inventory is too full to hold any more grubs." | capture |
| Pestle and mortar on a grub | `human_herbing_grind_restart`, sound 2608 (delay 25), paste; sometimes two grubs at once, "Your herblore knowledge allows you to crush an extra grub." | capture |
| Paste on a vial of water | 38 Herblore: `human_herbing_vial` (363), sound 2608, a Moonlight potion of 2 doses, or 3 / 4 with "Your potion making knowledge allows you to squeeze out an extra dose!" / "...two extra doses!" (no xp, Wiki). | capture (11 makes) |
| River fishing (`river_fishing_spot` 62193 at (1501, 9698) and (1521, 9689)) | 20 Fishing and a big fishing net. Fish sets `river_fishing_is_fishing` (15454), `river_fishing_dir` (15453) to the middle lane and plays `human_largenet_looping`; the spot and the stream's click zones (`river_fishing_clickzone` 62191) turn into "Stream" tiles to Align-net in, which sets the lane without walking. Fish (`pmoon_fish`, spotanim 2799) swim down a random lane every 2 ticks in two legs (90 and 80 cycles); one reaching the net's lane is a raw bream (3 xp), a second on a skilling roll (7-35 xp by level, Wiki) with "You manage to catch an additional fish!". Walking, a full inventory or 30 seconds without a click stop it. | capture (rev 237's click zones); Wiki; the rev 241 locs and varbits; lane timing and the roll's odds: estimates |
| Food | `food.json`: cooked bream heals the lower of Cooking/3 and Fishing/3, to the nearest ("You eat the bream.", capture); cooked moss lizard the lower of Cooking/3 and Hunter/2, rounded down. | Wiki; capture |
| Moonlight potion (`Potions.plugin.js`) | Prayer: the greater of 7 + 25% Prayer and 7 + 30% Herblore (none below 38 Herblore). Attack, Strength, Defence: 3 + 10% from 33 Herblore, 5 + 15% from 45 / 55 / 66; Defence 7 + 20% from 70, held like a divine potion's for five minutes without its damage. | Wiki |
| Leaving Neypotzli | Bream, moss lizards, grubs and paste go and moonlight potions turn into vials of water: "The resources from Neypotzli fizzle to dust as they are severed from its magic." Checked on every map square crossed and at login. Neypotzli is the caverns (x 1344-1535, y 9536-9727, plane 0) and the antechamber (x 1408-1471, y 9600-9663, plane 1). | capture; Wiki |

## Lunar Chest

`Chest.MoonsOfPeril.js`, data `chest` and `eyatlalli`. `chest_sun01_default01` (51346) at
(1512, 9579), Claim:

| Tick | What happens |
| ---: | --- |
| 1 | Every `<moon>_dead` varbit back to 0. "Your Lunar Chest count is: <col=ff0000>N</col>." through Combat Achievements' "Moons of Peril" kill count (varp `total_pmoon_chests`, 4186). The loc shows `chest_sun01_open01` (51347) to the player. `pmoon_rewardinv` (847) is filled and `pmoon_reward` (868) opens as a modal, with sound 2655 and `interface_inv_init` on `reward_inv` (868:5, "Withdraw-1" / "Withdraw-all", ops 1, 2, 10). |
| - | Withdraw-1 / Withdraw-all ("You take the items from the chest." once it is empty). `bank_all` (868:20): "You deposit your items into the bank." Uniques and loot go to the collection log as they are rolled. Loot left in the chest waits for the next Claim. |

With nothing subdued: "You need to subdue at least one of the Moons before you can claim a
reward." (estimate).

Loot (Wiki):

- Each Moon subdued is a 1/56 roll for a piece of its set, never one already given until the set
  is complete (kept per player).
- Only if no unique hits: 1, 3 or 6 standard rolls for 1, 2 or 3 Moons, on a weight-30 table:
  atlatl dart 72-120 (5), blessed bone shards 160-179 (2), wyrmling bones (noted) 42-54 (1),
  sun-kissed bones (noted) 6-12 (3), swamp tar 79-119 (4), water orb (noted) 30-45 (2),
  supercompost (noted) 6-12 (3), soft clay (noted) 15-25 (3), grimy harralander (noted) 12-18 (3),
  grimy irit leaf (noted) 12-18 (1), maple seed 1-2 (2), yew seed 1 (1).
- Sets:
  - Blood: dual macuahuitl and Blood Moon helm, chestplate, tassets.
  - Blue: Blue Moon spear and helm, chestplate, tassets.
  - Eclipse: Eclipse atlatl and Eclipse Moon helm, chestplate, tassets.

Eyatlalli (Wiki): a Moon armour piece used on her asks "Sacrifice your <item>?" and, on Yes, is a
1/50 chance at any of the twelve pieces, the same one too, with no duplicate protection;
sulphurous essence used on her is 50 Runecraft xp each. The dialogue and messages are estimates.

Her Scoreboard (Wiki, Eyatlalli) is op3 of the post-quest Eyatlalli: the shrine spawn is
`pmoon_eyatlalli_postquest` (12868) at (1523, 9578, 0) facing west, as rsprox 237/01104 and
234/03276 show it, which the client shows as `pmoon_eyatlalli_vis_postquest` (12870, Talk-to and
Scoreboard) while varbit `pmoon_eyatlalli_vis` is 1. Every recording with it at 1 has the quest
done (`pmoon_quest` 36: 237/01104 at login, 234/03276 later in the session), and nothing else reads
it, so Perilous Moons sends 1 once the quest is complete (it used to send 1 only during the quest)
and again on completion. The Wiki's two 12869 pins at the shrine are a lasting skip in
`npc-spawn-sync.json`, so the Wiki sync leaves them out. The board opens `perilous_moons_scoreboard` (870): the player's Lunar Chest count (the
chest's own) and deaths in a Moon's arena, then the world's, kept in
`data/saves/moons-of-peril-scoreboard.json`. No recording reads it; numbers are written as the
other boss boards' recordings show them.

## Our choices and estimates

Where neither a capture nor the Wiki gives the value, the data marks it `estimate`:

- The off-glyph burn doubles from 1 within each attack (the Wiki says "up to 16" without saying
  over how long).
- The Moon's self-damage after each attack: its health / 125, at least 1, fitted to the captured
  `pmoon_boss_hp` (during Weapon Freeze: health / 31 every 8 ticks).
- Ice-floor strikes up to 10, unparried clone strikes up to 15, storm hits up to 8, ray hits up
  to 10. Storms appear about once a tick, at each column's open ends.
- Statue messages for a Moon already subdued ("You have already subdued the Blood Moon. Claim your
  reward from the Lunar Chest first.") and before the quest ("You need to have completed Perilous
  Moons to face the Moons."), the frozen weapon's equip refusal and its return at login.
- A storm's forced walk (Wiki: 2 ticks) and the Moonfire / pathing-blocker locs' collision are
  only client-side; the server lets the player walk through them.
- Blinding's glance takes 12 (8 in Clones) off the hit's damage rather than its max hit.

## Status

Built and checked with the agent MCP:

- **The fights:** entry (gate, warning, portal, landing on the active glyph), the loop, standard
  attacks with curses, all six specials, kills and camp landings, the exit stairs.
- **The camps:** the stove (cooking, tea), the crates' kits, grubs, crushing, potion making and
  drinking, river fishing, the fizzle on leaving.
- **The reward room:** claiming, the loot, withdrawing and banking, the kill count, Eyatlalli's
  sacrifice and essence.

Bloodrager: the dual macuahuitl rolls two splats with the maximum divided between them; a missed first ordinary splat makes the second miss. Each accurate splat with the full Blood Moon set (including broken armour) has a 33% chance to bring the next attack one tick earlier, capped at one tick per attack. Blood Infusion rolls each splat independently with 25% more accuracy and maximum hit and guarantees that effect if either is accurate. The engine uses one tick between splats for both NPC and player targets; player-target spacing follows the general equipment description and is not capture-verified. The effect is evaluated when the attack is launched; exact retail proc timing has not been captured here.

Left for later: the Frostweaver and Eclipse armour and weapon set effects.

## Open questions

- Hitsplat 44 on the player four ticks after a kill (129-161): find out what it shows.
- Why the focus sometimes steps and steps back on the same tick (modelled as those glyphs lasting longer).
- How a special's pieces look to a second player in the same arena (no recording has one).
- River fishing in rev 241: how often fish come and how lanes are chosen (the captures are rev 237's click zones).
- Weapon-freeze punch damage: 9 at rev 226, 8 at 234-237.
