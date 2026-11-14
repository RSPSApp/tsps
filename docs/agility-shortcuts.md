# Agility shortcuts: captured behaviour

The shortcuts live in `server/plugins/skills/data/agility-shortcuts.json` (format:
`server/plugins/skills/agility/README.md`). Entries with a `note` of `rsprox captures <ids>` were
rebuilt from live OSRS recordings (rsprox, revisions 223-239); the rest follow the Wiki and the map,
and say what is still a guess in `unverified`.

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
| Jutting walls (Zanaris) | a 2-tile side-step from cycle 28 to 124, sound 2489 and "You try to squeeze past.", sound 2490 five ticks later |
| Strange floor (Fremennik Slayer Dungeon) | a 2-tile run-up (1995) with sound 2464, the 2-tile hurdle (1603) a tick later, both cycles 8-50 |
| Stepping stones (Karamja) | a stone a click: 769 with delay 20, cycles 48-60, sound 2461; "You attempt to balance on the stepping stone." and "You manage to make the jump." |
| Stepping stone (Pollnivneach) | onto the stone and a diagonal jump to the far bank, a jump every 2 ticks (741), sound 2461 |
| Obstacles, tunnel, plant door and holes (Fossil Island sea floor) | a face, then a 60-cycle exact move past it the tick after with 7702 (`human_swim_cavewall`) or 7704 (`human_swim_shipwall`), no message; holes: a step onto the hole, 7705 (`human_swim_hole_enter`), and two ticks later a teleport to its paired hole with 7706 (`human_swim_hole_leave`). The `loc_merge` the obstacles send is not done |
| Rocks (Shilo Village) | rock tile to rock tile, 1148 over 90 cycles facing south |
| Rock slide (Cairn Isle) | 740 over 120 cycles, delay 15, facing west (only eastward recorded) |
| Climbing rocks (Yanille, Taverley), log balance (Fremennik) | only the sound and messages: walks and their animations are not in the recordings, so the movement stays a guess |
| Grapple walls (Falador, Yanille) | rev 237 (the newest): fire and climb in one animation (1779) with its graphic (3575) and sound 2928, a screen fade, the teleport onto the wall 7 ticks in (rev 230 took 10, with 4455/760). The fade isn't sent yet |
| Pillar (Ruins of Mokhaiotl) | a 3-tile jump (12196) in 27 cycles, sound 2461; a tick later varbit 16716 (`moki_agil_shortcut_side`) flips, so only the far pillar shows "Jump-to" (the runner's `varbit` step) |
| Gaps (Chasm of Fire) | two gaps (event-world recordings): the west one a 6-tile jump (12196, sound 2461) from 1440,10098 to 1446,10097; the east one two hops a tick apart, onto 1453 then 1456. The exact moves are drawn a tile or two short of the server position; the entries land where the server puts the player. The way back mirrors it |
| Zip line (Fossil Island) | one way north off the House on the Hill (rsprox captures 3156, 3157, rev 232): 2586 on arrival (delay 10); a tick later 1602 with sounds 1933 and 1934 (delay 15) and a 2-3 tile exact move north each tick to 3765,3897 (the last in 15 cycles, sound 2462); a tick later 2588 on the ground, 3765,3898,0. The first leg is drawn to 3884 while the server places the player on 3885; the entry lands where the server does |

## Below the level: the captured refusals

A shortcut with no `levelMessage` refuses with "You need an Agility level of at least N to
attempt this." Live sends each obstacle's own line instead, one tick after arrival and without
moving the player (rsprox captures, record ids below; "item box" is objectbox 193 with the item,
its text also logged as a mesbox chat line):

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
| Tunnel (Asgarnian Ice Dungeon), 82 | item box, `agility_contortion` (6516): "The tunnel is very dark and dangerous.<br>You'll need an Agility level of 82 to try this." (1001401 t6484, rev 241; rev 230's 1000361 had a plain message box) |
| Colossal Wyrm advanced ladder, 62 | item box, `agility_climb` (6517): "You need an Agility level of 62 to use this course." (1106 t8114, a Leagues world) |

The successful Zanaris squeeze's "You try to squeeze past." is spam too (5 of 5 attempts).

## Still unverified, with what the captures show

- **Broken Raft, Crossbow Tree:** grapple, the rope added as scenery, the side panels hidden, a
  swim along the rope (their own swimming animations) and a chance the grapple breaks. Needs its
  own script.
- **Mysterious pipe (Mount Karuulm):** its messages are chatbox message boxes and the minimap is
  hidden, which the step format can't express yet.
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
