# Agility shortcuts: captured behaviour

The shortcuts live in `server/plugins/skills/data/agility-shortcuts.json` (format:
`server/plugins/skills/agility/README.md`). Entries with a `note` of `rsprox captures <ids>` were
rebuilt from live OSRS recordings (rsprox, revisions 223-239); the rest follow the Wiki and the map,
and say what is still a guess in `unverified`.

## Wilderness ridge exit

Normal recording `233/00451` sends the exit line at tick62 while the player is still on2998,3918,
with normal walking appearance restored. The south door opens with sound62 on tick63 and the
player crosses to2998,3916 in one compact two-tile movement with a temporary WALK traversal;
the run preference stays cached. The door returns two ticks later. There is no intervening
movement or object click between the initial north-gate operation and that final crossing.

The exit recipe plays the line before a one-tick wait, then the door and crossing together.
The runner's optional traversal override belongs only to the movement it produced. A later
native move, teleport, forced movement or private-world change cannot inherit it. The movement
remains available to every observer until the update resets, and is excluded from saves.
Entry still requires52 Agility, exit requires1, and neither crossing adds XP. Existing entry
movement and independent two-tick restoration remain unchanged.

The focused real-World regression is `server/tests/wilderness-ridge-exit-timing.test.cjs`;
the actual client-decoder round trip is `client/tests/player-sync-temporary-traversal.test.ts`.
These cover this exit sequence and generic traversal ownership, not every shortcut's animation
set or timing.

## How the captures were used

- **Per attempt, not merged:** each recording's events from the player's arrival (exact moves,
  animations, sounds, messages, teleports), tick by tick (`rsprox_index.py trace`). Merging
  attempts mixes up multi-step crossings such as the Barrows wall's run-up.
- **Normal worlds first:** Leagues and event worlds are used only where nothing else was recorded;
  the Nemus Retreat shortcuts are the only ones like that, and their `note` says so.
- **Step timing is the capture's:** the next step starts when the capture shows it, even when an
  exact move's cycles run longer (the North Iorwerth tight gap's crawl is cut short a tick in).
- **Ids by name:** every animation is resolved by its gamevals name in the rev-241 cache, not copied
  from the recording's revision. Sounds are recorded as ids only.
- **Tiles checked:** every end tile a capture moved was checked against the rev-241 collision map.
  The Varrock trellis lands on its own tile in the capture, which this map blocks, so it lands a
  tile further in.
- **XP stays the Wiki's:** some recordings are from Leagues, whose XP multipliers make the captured
  XP unreliable (the Barrows wall shows both +160 and +368 for the same crossing).
- **One direction captured:** the other mirrors it, and the entry says so in `unverified`.

## What the captures showed

| Shortcut | Captured |
| --- | --- |
| Obstacle pipes (Edgeville, Taverley, Yanille dungeons) | two 3-tile halves, each 749 from cycle 30 to 126, landing 4 ticks later with sound 2489; the second starts a tick after the first lands. The `pipe` builder does this for every pipe |
| Broken walls (Nemus Retreat) | 840 (`human_walk_crumbledwall`) over 70 cycles, sound 2453 |
| Crumbled wall (Tree Gnome Village) | rsprox captures local 1001800, 1001802, 1002235 (rev 242), all north from 2509,3252 during the battle: on arrival "The wall has been reduced to rubble. It should be possible to climb over the remains..." in a message box with a continue, and nothing else until the player continues it (5-8 ticks in the captures). On the continue, the box closes and the player crosses to 2509,3254: an exact move from cycle 30 to 100 with 840 (`human_walk_crumbledwall`, delay 30), no sound, no animation reset; BUSY clears 2 ticks later. The entry's `confirm` plays the box (Agility.plugin.js `confirmObstacle`) |
| Tunnel (Nemus Retreat) | duck, crawl, emerge: three 1-tick moves, sound 2452 |
| Trellis (Varrock) | 12091 (`human_climb_trellis`), cycles 99-112, sound 2461 twice (the second 75 cycles in) |
| Cliff rocks (Aldarin, Ice Mountain, the Great Conch, Ralos' Rise) | down with 740, up with the climbing loop (4435), facing the cliff both ways, sound 2454 looped |
| Rocks (Trollheim, Crandor, Waterbirth Island) | 1148 over 120 cycles facing the cliff, sound 2454 |
| Dry stone wall (Barrows) | two steps back (820), a step's run-up (1995), then the hurdle (1603, cycles 8-50) over the wall; sound 1936; "You jump over the wall." a tick after the hurdle starts |
| Stepping stones (Necropolis, Wilderness Chaos Temple) | a jump (741) a stone every 2 ticks, sound 2461; Necropolis says "You attempt to cross using the stepping stone(s)..." and "You successfully make it to the other side." |
| Stepping stones (Lumbridge Swamp Caves) | two leaps with 769 (`human_steppingstonejump`), cycles 58-70, "You leap across with a mighty leap!" |
| Tunnels (Asgarnian Ice Dungeon) | the long crawl (2796) and a teleport; the wyvern tunnel shows four messages over 8 ticks |
| Crevices (Waterbirth, Shaman Caves), hole (Fossil Island), cave (Meiyerditch) | the crawl animation, a tick, the message and a teleport |
| Tight gaps (North and South Iorwerth Dungeon) | squeeze in, crawl, squeeze out, a tick apart; sounds 2489 and 2490; "You squeeze through the tight gap." |
| Chain (Chasm of Fire) | one way down: "You deftly slide down the chain, leaping off before landing on the cage.", sound 2461 and a teleport to the floor below |
| Platform edge (Chasm of Fire) | one way down, from 1438,10097 on the top floor (rsprox captures 817, 819, event worlds): on arrival a 1-tile move north onto the edge, cycles 22-35, facing south (angle 0), with 827 (`human_pickupfloor`, delay 4) and sounds 2454 and 2461 (2 loops, delays 12 and 26); a tick later the spam line "You slide off the lip of the platform, landing on the one below." and the floor below (1438,10098,1). 73 Agility and 3.2 XP from the Wiki (the event-world XP is boosted) |
| Wall (Darkmeyer, inner and outer) | rsprox captures 362 (rev 230) and 1862: no sound or message; up with 828 (`human_reachforladder`), down with 827 (`human_pickupfloor`), on the other side a tick later. Each wall is a multiloc that offers Climb only once a long rope is attached ([darkmeyer-wall.md](darkmeyer-wall.md)) |
| Jutting walls (Zanaris) | a 2-tile side-step from cycle 28 to 124, sound 2489 and "You try to squeeze past.", sound 2490 five ticks later |
| Strange floor (Fremennik Slayer Dungeon) | a 2-tile run-up (1995) with sound 2464, the 2-tile hurdle (1603) a tick later, both cycles 8-50 |
| Bridge (Nature Grotto) | rsprox captures 1638 (rev 226), local 1001447, 1001455 (rev 241), 1001895, 1001899 (rev 242): the jump starts on the clicked bridge tile and lands on 3440,3331 going north or 3441,3329 going south, whichever bank tile it starts from. BUSY on at arrival; a tick later the exact move (cycles 58-70) with 769 (`human_steppingstonejump`, delay 30); sound 2461 two ticks after that; BUSY off and 15 XP four ticks after the jump, the animation left to play out. A failure moves to 3439,3330 in the swamp (cycles 58-60) with 770 (`human_wobbleandfall_l`) going north or 771 (`_r`) going south, sound 2461 a tick later, then, on the next tick, the splash (spotanim 68, delay 3) on that tile with sound 1658 and the first move out onto the far bank (3438,3331 going north, 3438,3328 going south); three ticks later the second move (3438,3332, or 3438,3327), the animation resets, the player is hit (captured 2-5; the Wiki's 1-7 is used), "You nearly drown in the disgusting swamp.", BUSY off and 2 XP. The success chart (low 60, high 252) is the Wiki's |
| Stepping stones (Karamja) | a stone a click: 769 with delay 20, cycles 48-60, sound 2461; "You attempt to balance on the stepping stone." and "You manage to make the jump." |
| Stepping stone (Pollnivneach) | onto the stone and a diagonal jump to the far bank, a jump every 2 ticks (741), sound 2461 |
| Obstacles, tunnel, plant door and holes (Fossil Island sea floor) | a face, then a 60-cycle exact move past it the tick after with 7702 (`human_swim_cavewall`) or 7704 (`human_swim_shipwall`), no message; holes: a step onto the hole, 7705 (`human_swim_hole_enter`), and two ticks later a teleport to its paired hole with 7706 (`human_swim_hole_leave`). The `loc_merge` the obstacles send is not done |
| Rocks (Shilo Village) | rock tile to rock tile, 1148 over 90 cycles facing south |
| Rock slide (Cairn Isle) | 740 over 120 cycles, delay 15, facing west (only eastward recorded) |
| Climbing rocks (Yanille, Taverley) | only the sound and messages: walks and their animations are not in the recordings, so the movement stays a guess |
| Log balance (Coal Trucks) | rsprox captures 353, local 1001512, 1001582 (rev 241), 1002239 and 1002251 (rev 242): the filterable line "You walk carefully across the slippery log..." and BUSY on, then sound 2470 (2 loops) a tick later, sound 2470 again at +4, and "... and make it safely to the other side." and BUSY off at +5. The Wiki gives 20 Agility and 8.5 XP. Recording `230/00353` shows five one-tile walk steps in each direction: west from 2603,3477 to 2598,3477 on ticks 690-694, and east back to 2603,3477 on ticks 1040-1044. |
| Log balance (Fremennik Province) | rsprox capture 359 (rev 230, both ways), local 1001623 ... 1002212 (rev 241-242, from the south), ticks from the arrival: the spam line "You attempt to walk across the slippery log.", sound 2470 (2 loops) and two tiles a tick onto the middle (2722,3594); +1 BUSY on and the roll: a success is the game message "You make it across the log without any problems.", sound 2470 again and two tiles onto the far end; +4 BUSY off and 4 XP. A failure (local 1001631, 1001653, 1001659, 1001991, 1002015, all from the south): +1 "You lose your footing and fall into the water.", the teleport to 2724,3594 with an exactmove from the middle tile (cycles 22-35, angle 1024), 2582 (`human_wobbleandfall_short_r`) and sound 2493 (10 loops); +2 the splash (spotanim 68, delay 3) on 2724,3594 with sound 1658; +3 "You're being washed down the river." and a tile a tick along 2725,3594, 2726,3595 (+4, spam "You feel like you're drowning..."), 2726,3596 (+5, spam "You finally come to shore."), 2725,3597 (+6); +7 BUSY off, 6 damage (6 in all five) and 2 XP. The appearance updates at +2 and +6 carry no render ids, so the swim render is ours, as is a failure from the north end (none recorded: the same fall, facing south). Script `fremennikLogBalance` (Fremennik.Agility.js) |
| Grapple walls (Falador, Yanille) | rsprox 4001 (rev 237, six climbs, both Falador sides and Yanille's north): BUSY on, fire and climb in one animation (1779) with its graphic (3575) and sound 2928; 5 ticks in the screen fades out (overlay 174, script 948 `0,255,0,0,50`); 7 ticks in the teleport onto the wall, the animation reset and the fade in (`0,0,0,255,50`); 2 ticks later the overlay closes and BUSY clears (rev 230, rsprox 358, took 10 ticks, with 4455/760). Yanille's grapple lands on the far one of the wall's two tiles: from the north on 2556,3073,1 (358 and 4001), from the south on 2556,3074,1 (358, tick 4606). The barehanded climbs (not recorded) land there too |
| Pillar (Ruins of Mokhaiotl) | a 3-tile jump (12196) in 27 cycles, sound 2461; a tick later varbit 16716 (`moki_agil_shortcut_side`) flips, so only the far pillar shows "Jump-to" (the runner's `varbit` step) |
| Gaps (Chasm of Fire) | two gaps (event-world recordings): the west one a 6-tile jump (12196, sound 2461) from 1440,10098 to 1446,10097; the east one two hops a tick apart, onto 1453 then 1456. The exact moves are drawn a tile or two short of the server position; the entries land where the server puts the player. The way back mirrors it |
| Zip line (Fossil Island) | one way north off the House on the Hill (rsprox captures 3156, 3157, rev 232): 2586 on arrival (delay 10); a tick later 1602 with sounds 1933 and 1934 (delay 15) and a 2-3 tile exact move north each tick to 3765,3897 (the last in 15 cycles, sound 2462); a tick later 2588 on the ground, 3765,3898,0. The first leg is drawn to 3884 while the server places the player on 3885; the entry lands where the server does |
| Mysterious pipe (Karuulm Slayer Dungeon) | rsprox captures 1521, 2952, 4001 (rev 224-237), all west to east, the player arriving on 1316,10213 south of the pipe: +1 faces it; +2 reach animation 833 (delay 10), BUSY on, the screen fades out (948, 50 cycles) and "You start the mediocre lengthed journey of clambering into the pipe..." in a message box with no continue; +3 the minimap off (6719 = 2) and "You push your body down further into the pipe..."; +5 on 1346,10232, same facing, minimap on; +6 the fade in and "You see light from above, and start to climb upwards and out of the pipe system." with a continue, which closes the box and the overlay and clears BUSY. No XP (Wiki). East to west mirrors it (not recorded). Script `karuulmPipe` (KaruulmPipe.Agility.js) |
| Rocks (Alchemical Hydra's lair, Karuulm Slayer Dungeon) | rsprox captures 1521 (rev 224) and local 1000143, 1000471, 1000473, 1000480, 1000497 (rev 227), all south to north: no requirement. The player faces the rocks (34548, two tiles wide on 1351-1352,10251); the next tick live teleports them into the lair's instance (`rebuild_region`); the tick after that comes climb-over 839 and an exact move two tiles north on the player's own column (1351 or 1352, cycle 0 to 60); 2 ticks after the move "You climb over the rocks." (spam) and the animation reset. Counted from the arrival that is +0/+1/+2/+4 when the player clicks beside the rocks (local 1000143, 1000471, 1000473, 1000497) and a tick later after a walk (1521, 1000480). Here there is no instance teleport tick between the face and the move (recorded difference). Live also moves the player into an instance of the lair as they climb; here the lair stays in the world and the Alchemical door makes the private chamber. North to south mirrors it (not recorded). Script `karuulmHydraRocks` (Kourend.Agility.js) |

## Below the level: the captured refusals

A shortcut with no `levelMessage` refuses with "You need an Agility level of at least N to
attempt this." Live sends each obstacle's own line instead, one tick after arrival and without
moving the player (rsprox captures, record ids below; "item box" is objectbox 193 with the item,
its text also logged as a mesbox chat line). The Fremennik Slayer Dungeon and Taverley Dungeon
strange floors and the Shilo Village stepping stone refuse at the click instead, from where the
player is once the loc is in reach: the Fremennik floor from 6 tiles and the stepping stone from 5,
both idle, and the Taverley floor mid-run, on the step to 2881,9813 (1000217 t12768, 1000359
t14761, 1000323 t8697-8699). Their entries say `"refusalTiming": "click"`. The Mount Karuulm rocks
(1000456 t15653, 1000473 t51), the tunnels and the Troll Stronghold and Crandor rocks refuse on
arrival:

| Shortcut | Live (record, tick) |
| --- | --- |
| Underwall tunnel (Draynor Village), 42 | game message "You need an agility level of 42 to negotiate this tunnel." (1001399, 1001445) |
| Underwall tunnel (Grand Exchange), 21 | game message "You need an Agility level of 21 to negotiate this tunnel." (1001438) |
| Obstacle pipe (Edgeville Dungeon), 51 | game message "You need 51 Agility to squeeze through the pipe." (1000186) |
| Jutting wall (Zanaris, advanced), 66 | spam "You try to squeeze past.", then game message "You need an agility level of 66 to negotiate this tunnel."; no sound (1000479) |
| Strange floor (Taverley Dungeon), 80 | game message "You need 80 agility to tackle this obstacle." (1000323) |
| Strange floor (Fremennik Slayer Dungeon), 43 | game message "You need an agility level of 43 to tackle this obstacle." (1000217) |
| Stepping stone (Shilo Village), 32 | item box, `agility_jump` (6514): "The stepping stone looks very small and slippery.<br>You'd better have an Agility level of 32." (1000359) |
| Rocks (Mount Karuulm, upper), 62 | game message "You need an Agility level of 62 to climb these rocks." (1000456, 1000473; climbing up only, the top rocks reuse it) |
| Pillar (Ruins of Mokhaiotl), 75 | item box, `agility_jump_area` (6518): "You need an Agility level of 75 to do that." (3285) |
| Tunnel (Asgarnian Ice Dungeon), 82 | item box, `agility_contortion` (6516): "The tunnel is very dark and dangerous.<br>You'll need an Agility level of 82 to try this." (1001401 t6484, rev 241; 1000361 t12466, rev 227, sends the same item box) |
| Colossal Wyrm advanced ladder, 62 | item box, `agility_climb` (6517): "You need an Agility level of 62 to use this course." (1106 t8114, a Leagues world) |

The successful Zanaris squeeze's "You try to squeeze past." is spam too (5 of 5 attempts).

## Still unverified, with what the captures show

- **Broken Raft, Crossbow Tree:** grapple, the rope added as scenery, the side panels hidden, a
  swim along the rope (their own swimming animations) and a chance the grapple breaks. Needs its
  own script.
- **Wall (Darkmeyer):** recorded climbing up (39173, `human_reachforladder`, then a teleport to
  3595,3312 a tick later), but that half is on plane 1 and the other (39172) on plane 0; where the
  player stands needs another look. Not added.
- **No usable recording:** Crevices (Wilderness Slayer Cave) (5)-(8), Rocks (Trollheim hard and
  advanced).

## Map mismatches found on the way

Every entry's `at` tile was checked against the rev-241 cache's placements.

- **Fixed:** the Yanille wall and its battlements are on 2556,3073 and 3074 (the entries said 3072
  and 3075), so grappling up and jumping down there did nothing.
- **Not fixed yet:** "Rocks (dense essence mine, north/south side)" point at 1761,3872-3873, where
  the rock is 34741, not their 27984/27985; and the 12 "Hole (Draynor Manor and Falador walls)"
  tiles have no hole in the cache at all (12656 is only placed at 2344,3651).
