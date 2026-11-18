# Vardorvis

Vardorvis after Desert Treasure II (https://oldschool.runescape.wiki/w/Vardorvis), solo, normal and awakened, built from rsprox captures (https://rsprox.net/database), the OSRS Wiki and the cache. It is one plugin, `server/plugins/bosses/Vardorvis.plugin.js`, with one unit per part in `server/plugins/bosses/vardorvis/` and its data in `plugins/bosses/data/vardorvis.json`. The quest's own fight (NPC 12224) stays in `DesertTreasureII.Quest.js`.

Captures: recordings 3285 (rev 234, 16 normal kills and an awakened attempt) and 3344 (rev 235, about 73 normal and 33 awakened kills, most too quick for his specials). Both were recorded on Grid Master event worlds, where the player's damage is boosted, so the kills are short. The boss's own packets look like the main game's, but treat the frequencies below with that in mind.

## Layout

| File | What it owns |
| --- | --- |
| `Common.Vardorvis.js` | The data, the saved attributes, the hit helpers (styled strikes through prayer, typeless damage, lifesteal). |
| `Site.Vardorvis.js` | The ritual site: the instance, the way in (and the awakener's orb), the way out, logging out inside, the grave. |
| `Fight.Vardorvis.js` | A fight: his spawn, the first hit, the attack clock, the axe timer, stat scaling, the HUD, the kill and respawn. |
| `Barrier.Vardorvis.js` | The tendril barrier round the arena. |
| `Axes.Vardorvis.js` | The Large Tendrils, their axes and the bleed. |
| `Head.Vardorvis.js` | The head gaze and the prayer lock it leaves. |
| `Dash.Vardorvis.js` | The darting spikes. |
| `Strangle.Vardorvis.js` | The strangle and its spore overlay. |
| `CombatAchievements.Vardorvis.js` | His kill count and the tasks judged at the kill. |
| `Commands.Vardorvis.js` | `::vardorvishp <hp>` and `::vardorvisforce <axes\|head\|dash\|strangle>` for testing. |

## The way in

The rocks at 1118,3428 are loc 49495, a multiloc on varbit 15125 `dt2_stranglewood`. From 37 they show Climb-over (48740). Live sends 56 once the quest is done, and the quest plugin now does too, so the rocks open as soon as Desert Treasure II is complete (Wiki: the post-quest fight is available after the quest).

- Carrying an awakener's orb (28334): "Consume the awakener's orb to awaken Vardorvis?" with Yes./No. Yes uses up the orb and makes this fight the awakened one.
- Then, as captured:
  - Tick 0: "You enter the ritual site." over the fade out (script 948 on overlay 174), without a continue.
  - +1: the minimap off.
  - +2: the move in to 1119,3428. Vardorvis appears on 1128,3417 facing north-west with his rise (10345), and the rocks behind become `vardorvis_exit` (47603, Leave).
  - +4: the fade back in, with the message again (to continue).
  - +6: the fade overlay closes.
- The instance copies 5x5 chunks from chunk 139,425 (the same area the quest uses).

The way out (Leave on the rocks, or a Tendril's Quick-escape while the rocks are sealed: Wiki) clears the boss HUD at once and runs the same fade without a message, back to 1117,3428. A teleport, a death or a logout ends the instance. A player saved inside logs in outside the rocks, and a death's grave goes there too.

## The fight

All ticks below count from the first hit to land on him (a miss counts too).

| Tick | What |
| --- | --- |
| 0 | The barrier rises, the rocks are sealed (`vardorvis_exit_noop`), the fight timer starts, and he runs at the player (2 tiles a tick). |
| 1, 6, 11, ... | His attack slots, every 5 ticks. |
| 14 | The first axe set (awakened: 9), then every 13 ticks (8 once he's at or below a third of his hitpoints, and always when awakened). |

He isn't aggressive. The HUD comes up a tick after he appears.

- **Slash** (10340): 32 to 43 as his hitpoints fall (46 to 61 awakened, Wiki), landing a tick later. Protect from Melee lets a quarter through (Wiki). He heals half of every slash, with heal hitsplat 6 (captured).
- **Stats:** Strength rises from 270 to 360 and Defence falls from 215 to 145 in step with his hitpoints (awakened: 391 to 522 and 268 to 181, Wiki).
- **Specials** start below 570 hitpoints (1,140 awakened).

### The barrier

The 13x13 arena's edge (1123 to 1135, 3412 to 3424, 48 tiles) rises from the south-east corner, both ways round, 2 client cycles a tile: spotanims 2516 short, 2517 medium, 2518 tall.

- Each tile blocks at once (`invisible_type8_blocking`). The Tendril loc (47599 to 47601) stands there one tick later, or two for tiles whose spike is delayed 30 or more cycles.
- Each side is the same 13 tendrils: short, tall, short, medium, short, tall, short, tall, short, medium, short, tall, short.
- Sounds 7088 and 3906.
- A tick after the kill's rocks open, every tile becomes `invisible_type8_nonblocking` with the matching fall spotanim (2513 to 2515) and sound 7155.

### Swinging axes

How many Large Tendrils (12225) rise (Wiki):

| Hitpoints | Normal | Awakened |
| --- | --- | --- |
| Above 690 (awakened: 1,380) | 1 | 2 |
| From 231 (awakened: 462) | 2, sometimes 3 | 3, sometimes 4 |
| Below that | 3 | 4 |

The chance of the extra axe is 0.6, from the captured sets.

- They rise on the arena's eight edge quadrants (3x3, south-west tiles in the data), facing the centre, with anim 10364 and sound 7078. A tick later they wind up (10365).
- Three ticks after rising they go, and each throws its axe:
  - The axe (12227, 3x3, anim 10366) appears two tiles in from its tendril.
  - An axe stub (12229, 10336) plays on the tendril's spot for a tick.
  - The axe moves 2, 2, 2 and 1 tiles a tick (glides, `exact_move`) and is gone the tick after its last step.
- **When an axe hits** (fitted to every captured cut): each tick, before it moves, an axe cuts whoever stands under its 3x3, once per axe. Up to 35 (96 awakened, Wiki), half through Protect from Melee. Awakened, the throw also cuts whoever stands on the tendril's own quadrant, without bleed (Wiki).
- **The bleed** starts with "<col=ff3045>You have started bleeding!" and sounds 7081 and 7083. Then 3 (5 awakened) with hitsplat 67:
  - Standing still: every 5 ticks, the first 6 ticks after the cut, three in all over 16 ticks.
  - Moving: hits come sooner. Approximated as a hit the tick after any step.
  - It carries on after leaving the arena (Wiki).

### The head gaze

With one of his slashes a head (12226) rises on a tile within 3 of him, clear of him and the player, and faces the player.

- It plays scream spotanim 2550 and sound 3539 (a magic head: 277), with the message "<col=ff289d>Vardorvis' head gazes upon you...</col>".
- Projectile 2521: start 15, end 90, angle 8, heights 124 to 96. The impact spotanim 2552 goes on the player at once (slot 2, delay 90, height 124).
- Three ticks later the head goes and the projectile lands with sound 4015, blocked or not. Unless the player has Protect from Missiles on (or he's dead), their protection prayers switch off with "You've been injured and can't use protection prayers!" and 10 Prayer drains (Wiki).
- For 3 ticks (Wiki) turning a protection prayer back on is refused: "You've been injured and can't use that prayer!".
- Awakened, it can be magic instead (2520, scream 2549, impact 2551; Protect from Magic). Below half his hitpoints two come, one of each, a tick apart in either order. Both are captured (recording 3285's awakened attempt).

### The darting spikes

In place of an attack he darts, one dart a tick: one above 500 hitpoints, two above 130, three below (Wiki).

- Each dart lands him beside the player, on the opposite side each time (west/east or north/south, captured), gliding there with his dash (10341) and area sound 7154.
- Each dart cracks 3 to 5 tiles round the player (warning spotanim 2510, delays 3/6/9/12 cycles). On the first dart the player's own tile is cracked, at delay 6.
- Three ticks later those tiles erupt (2512, sound 7145, area sound 7109 at delay 30). A player on one takes up to 25 (40 awakened, Wiki) and he heals half.
- He slashes the tick after his last dart.

### The strangle

- He rears up (10342, sound 565). Two ticks later he holds the player (10343, sound 7099) with "<col=ff3045>Vardorvis entangles you in some tendrils!</col>".
- The player is rooted with spore spotanims (2523, then 2524 per click) and plays 10166 each tick. Overlay 833 opens on 161:1 and script 1816 runs with the spore count.
- Varp 3942 (varbits `vardorvis_qte_1..6`) holds the standing spores. Spore N is component 12 − N.
- Clearing them all ends it at once ("<col=229628>You manage to escape from the tendrils.</col>").
- Otherwise, 5 ticks after the overlay opens (3 awakened, Wiki) the tendrils tighten: "<col=ff3045>The tendrils tighten around you, damaging you in the process!</col>", with block anim 424 and heavy damage (Wiki: about 25, 40 awakened; rolled from 60% of that to all of it).
- Either way script 1823 runs, he lets go (10344, sound 2414) and the overlay closes a tick later.
- A kill's first strangle has 4 spores, each one after that one more, up to 6 (Wiki). Attack slots that fall during it are skipped.

### Which special when (inferred)

The timings of each attack are captured. The choice between them isn't, and is fitted to recording 3285's 16 kills:

- **Strangle** (chance 0.25 each time, about 44% an axe cycle; never twice in a row; below 570):
  - When an axe set falls due, the strangle may take its place, at his next attack slot.
  - At an attack slot with the axes due within 3 ticks, it may come there and then.
  - Either way the axes follow 8 ticks after the strangle.
- **Head gaze:** one per axe set (below 570). It rides with the first slash at least 5 ticks after the axes, or 2 ticks after an axe set that followed a strangle.
- **Dash:** from 30 ticks into the fight, at most every 15 ticks, at a slot with no head pending (chance 0.6; data `dash.firstTicks`, `dash.chance`).

All four kills that lived 31 ticks had: strangle at tick 16, axes at 24, head at 26, dash at 31. The model can reproduce that sequence, but only when its rolls land that way; it isn't forced.

### The kill

- Death anim 10346 (npc-combat-defs).
- Four ticks later:
  - The kill count: "Your Vardorvis kill count is: N." through Combat Achievements (varp 3970), or awakened "Your Vardorvis (Awakened) kill count is: N." (varp 3971).
  - "Fight duration: m:ss" against the personal best, timed from the first hit.
  - Then the Combat Achievement tasks.
  - The loot on his tile (NpcDrops) and the rocks open.
- A tick later the barrier falls.
- At twelve the HUD clears. At nineteen he rises again on his spot (normal: an awakened fight is one kill).

## The scoreboard

The Ancient Tablet by the rocks (`vardorvis_scoreboard` 49476 at 1116,3426) shows by varbit
`dt2_scoreboards` (DesertTreasureScoreboards.plugin.js sets 1 after the quest):
`vardorvis_scoreboard_vis` (47597) with Read, or at 2 `vardorvis_scoreboard_vis_awakened` (47598)
with Read and Read (Awakened). Both open interface `vardorvis_scoreboard` (832): the reader's kill
count, deaths and best time, then the world's (Wiki, Ancient Tablet (Vardorvis), which gives the
normal and awakened figures separately; the labels and "Vardorvis Statistics" title are the cache's).
Read shows the normal fight, Read (Awakened) the awakened one, titled "Vardorvis (Awakened)
Statistics" (the Wiki's awakened screenshot hasn't been checked for it). The kill counts and best
times are the kill messages' own; a death in the ritual site while his fight is on counts for that
fight (as the Leviathan's), heard through onPlayerDefeated, which every death reaches. The world's numbers are kept in
`data/saves/vardorvis-scoreboard.json`. Like the other DT2 boards it reads only after Desert
Treasure II, and a click that kept the map loc's null name still reads (Site.Leviathan.js). Nothing
sets `dt2_scoreboards` to 2 yet (all four awakened bosses killed), so Read (Awakened) only shows once
that is added. No recording opens the tablet (rsprox 235/03344 clicks it and walks on). It writes as
the other DT2 boards do (docs/leviathan-normal-evidence.md): the server's own counts read
"N (recorded)" and a missing time "No recorded best"; times are m:ss.cc as the Araxxor recording.

## Combat Achievements

Vardorvis is counted by event (`data/monsters.json` countedByEvent), so the kill-count message comes before the tasks, as live sends it.

- `CombatAchievements.Vardorvis.js` judges the three speed tasks (under 1:15, 1:05, 0:55, off a slayer task) and Vardorvis Sleeper (an awakened kill).
- Adept and Master finish from the count.
- "Kill Awakened Vardorvis." no longer reads as a plain kill-count task: "awakened" is now a condition word in `Data.CombatAchievements.js`, which also keeps the other DT2 bosses' Sleeper tasks from completing on a normal kill.

## Data fixes

- `npc-combat-defs.json` gets 12223 (attack 10340, block -1, death 10346, spawn 10345, `deathTicks` 4, `respawn` 0).
- `npc-spawns.json`:
  - The open-world post-quest Vardorvis (12223) becomes the statue the capture shows there, `vardorvis_base` (12427, direction north-west, no wander). Before, a live, fightable boss stood outside any instance.
  - A "Large Tendril" spawn at 1123,3417, a fight NPC taken from the Wiki's location list, is removed.

## Awakened

The awakened kill follows the same fight with the Wiki's awakened values, plus three rules:

- **Unique table:** the tradeable unique stage rolls at 3/136 instead of 1/136 (Wiki: "3/136 for awakened variant"). `Fight.Vardorvis.js` answers `npc-drops:chance` with a `tradeable_uniques` stage rule ×3; the rule matches an ordered stage by its key, not an item name.
- **Stat drains:** the awakened spawn is immune (`boss.setStatDrainImmune(awakened)`), as the Wiki says and as the Leviathan already does.
- **Slayer:** an awakened kill gives no task credit (Wiki, 3 August 2023 update: "Slayer tasks no longer apply to the Awakened version"). `slayer:target-eligible` answers false for the awakened fight, which also keeps its equipment task bonuses off.

The Ancient blood ornament kit is still not in yet: the Wiki drops it only when Vardorvis is defeated in the awakened encounter **last of the four**, and the other three awakened modes are not enabled.

## Not in yet

- **Loot quantities:** the Wiki writes Vardorvis' standard drops as `quantity=130,195`, the normal amount and the perfect kill's. osrsreboxed-db's drop dumper drops the comma, so `npc-drops.json` holds 130195 coal. The same happens for the other three DT2 bosses. It needs fixing in the dumper (`_parse_quantity`), then a fresh dump.
- **Perfect kills** (50% more standard loot, Perfect Vardorvis), Budget Cutter and Axe Enthusiast.
- **Quick-escape:** has no capture. It takes the same way out as Leave.

## Testing

The agent MCP, with `::infhp`, `::quest desert_treasure_ii complete` and a whip:

1. Climb over the rocks: the fade, the minimap, the HUD (1683 12223, 6099/6100 700, 12401 1), the exit Leave.
2. Attack: the barrier (48 rise spotanims), slashes and lifesteal.
3. `::vardorvishp 400`, then `::vardorvisforce axes|head|dash|strangle`:
   - Axes: three axes cross, and the bleed starts.
   - Strangle: the overlay with varp 3942 = 15, then escape by clicking 833:11..8, or the tighten.
   - Dash: three darts west/east/west below 130, with the spikes.
   - Head: the lockout message.
4. The kill: the kill count, the time and the speed tasks in that order, the barrier's fall, the HUD clear at 12, the respawn at 19.
5. Awakened with an orb: 1400 hitpoints, two heads below half, axes up to 96, the awakened count and Vardorvis Sleeper.
6. Leave, a logout inside and a death inside: the grave appears at 1117,3428.
7. The tablet at 1116,3426 after the quest: Read opens 832; a kill and a death inside reach
   `data/saves/vardorvis-scoreboard.json`. `node --test tests/vardorvis-scoreboard.test.cjs`.
