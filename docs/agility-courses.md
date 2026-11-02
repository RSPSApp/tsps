# Agility courses added from the Wiki

Courses live in `server/plugins/skills/agility/courses/`, one file each, run by
`Agility.plugin.js`. Levels, XP, pet rates and requirements come from the OSRS Wiki; object ids and
tiles from the rev-241 cache (`yarn dump:loc`); movement from rsprox captures where they exist
(`rsprox_index.py trace`), otherwise it is a guess and says so below.

## The Agility course helper

From rsprox captures (Varrock 339 and 3154, main game; the other courses' Leagues sheets), done by
`Agility.plugin.js` for every course with a `helper` id (the cache's enum 3507):

- A lap's first obstacle sets `helper_agility_highlighted_course` (varbit 13140) to the course's
  id with its first visible step, and runs `helper_agility_start_lap` with a tick clock as it ends.
  A course whose lap starts elsewhere says so with `startsLap` (the Agility Pyramid: the stairs up
  from the ground).
- Every course obstacle runs `helper_agility_add_xp` with the XP it gave, in tenths. A Varrock lap
  sends 135, 230, 190, 280, 100, 245, 45, 35 and 1437: the Wiki's obstacle XP, adding up to 269.7.
- The lap's last obstacle clears the varbit and runs `helper_agility_end_lap` with the clock and
  the extra laps counted (0, or 1 when a lap counts twice).
- The client works out laps an hour from the clock's differences, so the clock counts game ticks
  from 2024 rather than the server's own tick.

## Rooftop timing

The captures' patterns, counted from the tick the player arrives (the runner's steps start the
tick after):

- **Gaps:** the player turns towards the far roof, jumps (2586, sound 2462, both 15 cycles in) two
  ticks after arriving, lands (2588) a tick later and gets the XP the tick after (`gapJump`).
- **Wall gaps:** a jump up the wall (2583 and sound 2468, 20 cycles in) a tick after arriving, the
  grab (2585) a tick later, the pull up the tick after that (`wallScramble`).
- **Hurdles:** sound 1936 with the hurdle (1603, cycles 8-50).
- **Tightropes:** sound 2495 on the first tiles. Draynor's pay on the last tile (the runner's
  `walk` with `arrive: true`); Rellekka's and Shayzien's the tick after.
- **Landings:** a landing on an obstacle's last tick plays out; the runner doesn't reset it.
- **Varrock:** the rough wall's climb (828, 15 cycles in) a tick after arriving, on the roof two
  ticks later with the grab (2585) and sound 2468; three jumps along the clothes line (sound 2461)
  with the line's creak (area sound 413) halfway; the wall's run-up, jump, five holds two ticks
  apart (sound 2459), two side-steps (sound 2451) and the jump onto the roof; the balcony's run-up,
  leap (4789, sound 2461) and grab; the edge's hop (741, sound 2461), jump down and landing with
  the lap.
- **Canifis:** the tree is climbed from 3508,3488 (1765 and sound 1705, 60 cycles in), on the roof
  six ticks later; the first gap has a step's run-up (1995); the pole vault crosses a tile a tick
  from 3482,3481 to 3487,3476, the tiles the captures put the player on, landing on 3489,3476.
- **Rellekka:** the tiles walked in 1885: the first tightrope from 2622,3658, the ledge after the
  second gap to 2639,3653, the last tightrope from 2647,3662 to 2655,3670, and a step west after
  the landing, which comes with the lap.
- **Agility Pyramid** (2932, 1757): the low wall, ledge, plank and gap lines are spam and the
  doorway's is a message box; the low wall (840 and sound 2453, 30 cycles in) a tick after
  arriving, paid three ticks later; the ledge (sound 2451) and the wall gap's hand-holds (sound
  2450, no messages) off six ticks after on; the plank's creak (2470) with its line; the gap jump
  (3067 and sound 2465, 20 cycles in) a tick after arriving, three tiles, paid three ticks later;
  the top's climb (sound 2454) shows the top in an item box a tick later.
  `agility_pyramid_level` follows the floor (1-5) and is 0 again out of the doorway; on floors 1
  and 3 it swaps the static pyramid block for the moving one. Falls set it too, from where they
  land; no fall was captured.
  - **Stairs up** land on a fixed tile per flight, whichever side they were climbed from:
    3355,2833,1; 3356,2835,2; 3358,2837,3; 3041,4695,2; 3043,4697,3. No climb down was captured.
  - **Gaps and low walls** go straight over the loc from the player's side of its footprint (a
    2x2 gap jumped from its corner column still goes over it, 3357,2846 to 3357,2849).
  - **Stone blocks** (Wiki: 12 XP, five a lap) are stepped on, not clicked: an invisible wall
    (`inviswall_serverside`, loc 3550) runs across the middle of each 2x2 block. The tick after
    the player arrives on the near row, `agility_pyramid_tilt_N` (1551-1555) goes to 1, sounds
    1396 and 2455 (25 cycles in) play and the player dives (1115) two tiles on (exact move, 10-30
    cycles); the next tick the varbit is 0 and the XP is paid. A failure, and always a step on
    from the far side, drops the player a floor for 6 (1 backwards) damage (Wiki); neither was
    captured, so the fall's animation (768) and tile are guesses. In the course data these are
    obstacles with `tiles` instead of an `object`, played when a player steps onto one.
  - **Pyramid blocks** (`plugins/areas/AgilityPyramid.plugin.js`) are NPCs 5788 (floor 1, from
    3372,2847 east) and 5787 (floor 3, from 3366,2845 north). They slide out a tile a tick for
    two ticks, with area sound 1395 (range 5) at home, stay out for two more and slide back; every 15 ticks
    on floor 1, every 13 on floor 3. They block players (NPC "full" collision): a walk into one
    waits and goes on once it has gone back, as captured. One that moves onto a player pushes
    them down a floor for 8 damage (Wiki), two tiles on; the push wasn't captured.
  - **Laps** run from the stairs up to the doorway with the floors' obstacles in any order
    (`anyOrder`), so the doorway counts the lap ("Your Agility Pyramid lap count is", as
    captured).
  - **The top's climb** is the Desert diary's medium task "Climb to the summit of the Agility
    Pyramid" (captured).
  - **Simon Templeton** (`plugins/minigames/pyramidplunder/Simon.PyramidPlunder.js`) buys pyramid
    tops for 10,000 coins each (Wiki) through his transcript: his introduction the first time
    (setting `agility_pyramid_simon_named` and `_job`), then the before- and after-sale lines;
    the first sale sets `_job_done`. A top used on him sells them all, or before the
    introduction asks for a chat first (captured).

## Shared obstacles

Some courses share obstacles. A course with `sharesWith: { course, through }` continues a lap that
the other course began, through that obstacle index; when a clicked object belongs to more than
one course, the entry that continues the player's lap is used. A full lap's bonus counts the shared
obstacles' XP once.

## Marks of grace

From the Wiki's [Mark of Grace](https://oldschool.runescape.wiki/w/Mark_of_Grace) page ("Spawning
mechanics" and the despawn rules), run by `rollMarkOfGrace` in `Agility.plugin.js` from each
course's `marks` block:

- **When:** completing a lap rolls for a mark, once 3 minutes have passed since the player's last
  mark. The cooldown counts whole clock minutes (a mark in minute 0 allows the next roll from minute
  3) and is saved, so logging out doesn't reset it. Laps during the cooldown don't roll.
- **Chance:** 2/6 a lap, 2/5 at Rellekka, 2/3 at Canifis and Ardougne. With unboosted Agility 20 or
  more over the course's level, a fifth of that, except at Canifis (a coding error in the game).
- **Diaries:** a missed roll is rerolled at 5%, 10% or 15% at Seers' Village for the easy, medium
  or hard Kandarin diary, and at 25% at Ardougne for the elite Ardougne diary. The cooldown is
  2 minutes instead of 3 half the time at Ardougne (elite Ardougne), and 1 time in 3 at
  Pollnivneach (hard Desert) and Rellekka (hard Fremennik). A reroll's chance isn't cut for
  overlevelling (the Wiki: diary boosts apply after the cut).
- **On the floor:** a mark only its player sees, on one of the course's mark tiles, for 10 minutes.
  Marks on one tile stack and restart the 10 minutes. Time logged out doesn't count: the plugin
  pauses the player's course marks on logout and resumes them on login.
- **Other courses:** the Wiki gives no roll chance for the non-rooftop courses. Ape Atoll uses 2/25,
  which with the cooldown gives the Wiki's 5-6 marks an hour at 95 laps an hour; the Shayzien
  courses use the rooftop 2/6. The Gnome Stronghold, Barbarian Outpost and Werewolf courses give
  marks too (since 8 May 2024), but have no `marks` block: their tiles and chances aren't known.

## Shayzien Agility Course (basic and advanced)

- **Shared start:** the ladder, monkeybars and first tightrope belong to the basic course
  (`ShayzienBasic.Agility.js`); the advanced course (`ShayzienAdvanced.Agility.js`) shares them through obstacle 3.
- **Levels and XP:** the Wiki since the 2024 rebalance: basic 1 (153.5 a lap), advanced 45 (507.5),
  and no obstacle fails. Both laps add up from the obstacles alone, with no lap bonus.
- **Captured** (rsprox 1632, rev 226; the only recording): the ladder (reach up, on the platform a
  tick later), the monkeybars (on, about 12 tiles along, off, dropping to 1541,3633 on plane 2,
  with sounds 2474, 2470 and 2473) and the first tightrope (sound 2495).
- **From the cache's platform decking** (`shayzien_agility_decking01` and the tightrope and
  monkeybar pieces), not captured: the bar, both basic tightropes, the beams and the edges.
- **Guesses, to check in game:**
  - the beam swing (the cache has no Shayzien swing; `dorgesh_grapple_swing` is used);
  - where the gap's jump lands (1554,3639) and where the zipline lands (1522,3626);
  - the mark of grace tiles.
- **Progress varbit:** the basic course sets `shayzien_agility_low_progress` to the obstacle the
  lap has reached (1 after the ladder, 2 after the monkeybars, 3 after the tightrope, as captured)
  and back to 0 when the lap is done; the reset is not captured. No cache script or loc reads it.
  The advanced course's `shayzien_agility_up_progress` is not sent: nothing captured it changing.
- **Timing** (1632): the ladder's climb a tick after arriving; the monkeybars two ticks after,
  off the tick after the last bar; the tightrope a tile a tick from the tick after arriving, paid
  the tick after the last tile.
- The start ladder is named "Ladder", so the Agility plugin claims it from the Ladders plugin
  (`ladders:climb`).

## Colossal Wyrm Agility Course (basic and advanced)

- **Files:** `ColossalWyrmBasic.Agility.js` and `ColossalWyrmAdvanced.Agility.js`, with their shared steps in
  `ColossalWyrmSteps.Agility.js`. The advanced course shares the start ladder and first tightrope
  (`sharesWith`, through obstacle 2), and both end on the same zipline.
- **Levels and XP:** 50 and 62, never failed. Per obstacle, the course page's tables since the 2026
  rework: basic 601.6 a lap, advanced 1053.6. (The page's text says 633 for basic, which its own
  table doesn't add up to; the obstacle pages still show the older values.)
- **Obstacles that need no click** (the edges after the first tightrope, the edge after the basic
  rope, the rope after the advanced tightrope) run as part of the obstacle before them, and their
  XP goes with it.
- **Tiles:** each obstacle ends on its termite marker (`varlamore_wyrm_agility_*_termites`), which
  sits where the obstacle drops the player.
- **Captured** (rsprox 1106 and 1108, rev 237, a Leagues world, before the August 2026 rework that
  made the basic course about 25% and the advanced about 40% slower): the start ladder, the edge
  jumps after the first tightrope (a run-up, then six hurdles three ticks apart), the advanced edge
  (a step back, a run-up, three long hurdles), the ropes (`wyrm_agility_ledge_*`), the basic rope's
  long jumps and the zipline (2 tiles a tick, the jump off, the fall and getting up). Timing is
  therefore the pre-rework one.
- **Wiki:** the lines said at the pauses on the last rope (one pause on basic, two on advanced).
- **Guesses:** where the tightropes wobble and the ropes pause, and the advanced ladder's top tile
  (1648,2908; the next recorded step starts beside it).
- **Not given yet:** termites, blessed bone shards and Worm Tongue's rewards; the giant squirrel
  rate is unknown on the Wiki since its 2026 change, so these courses don't roll it.

## Werewolf Agility Course

- **Files:** the course is `Werewolf.Agility.js`; the trapdoor, the stick throw, the trainers' lines and
  the Talk-To variants are `plugins/areas/WerewolfAgility.plugin.js`, which reacts to the Agility
  plugin's `agility:obstacle-start` event.
- **Access:** the trapdoor east of Canifis opens and is climbed down only with a ring of Charos
  worn (Wiki); otherwise its werewolf guard refuses. Inside, the obstacles don't need the ring,
  but the trainers call you "human" without it (Wiki transcripts).
- **A lap:** five stepping stones (10 XP each), three rows of hurdles (20 each), a pipe (15), the
  skull slope (25) and the deathslide (200), then the stick handed to the Agility Trainer at the
  bottom ("Give-Stick", 380, and the lap count): 730, the Wiki's lap. All sticks carried go when
  one is handed in (Wiki). The hand-in is a course obstacle done on an NPC (`npc` in the course
  data), so the lap, its message and the pet roll work as on any course.
- **The stick:** the Agility Boss throws it when the first stone is jumped onto ("FETCH!!!!!"), or
  asks "Why didn't you hand the stick over?!!?" if one is already carried (Wiki). The projectile is
  captured (338, `waa_stick_travel`); where it lands, beyond the pipes, is a guess.
- **Captured** (rsprox 366, 1849, 1858; rev 227-231, mostly Leagues): the trapdoor (sound 91,
  "The trapdoor opens..."), the guard's two lines on climbing down, the stepping-stone jump
  (`human_jump_stones`), the hurdles, the deathslide (by the teeth, 5 tiles a tick, its two
  messages and sounds) and the hand-in message.
- **The pipe crawl follows capture 1849.** From the map, not captured: the skull slope climb, and the tiles either side
  of the trapdoor and the exit ladder.
- **The deathslide's failure is a guess:** the Wiki says Agility, Strength and carried weight all
  count, with no formula; it fails on Agility alone here (never from 80), partway down onto the
  spikes for 10-30 damage and 160 XP. A helmet is refused with the trainer's line (Wiki), as a
  message rather than his dialogue.
- **Not done:** marks of grace (no tiles known), the Skullball course, and putting a logged-out
  player back at the entrance.

## Ape Atoll Agility Course

- **File:** `ApeAtoll.Agility.js`. The player must be a small or medium ninja monkey or Kruk, which
  the course asks the Greegrees plugin through `greegree:form` ([greegrees.md](greegrees.md)).
- **Requirements (Wiki):** 48 Agility, which a boost can't make up ("Your Agility boost won't help
  you here."). Monkey Madness I up to chapter 2 isn't checked: no quest plugin answers for a
  chapter, and the island can't be reached without it.
- **A lap:** stepping stone 40, tropical tree 40, monkeybars 40, skull slope 60, rope 100, then the
  second tropical tree 0 and the 300 lap bonus: 580. Marks of grace since May 2024, 5-6 an hour at
  95 laps an hour, so 2 rolls in 25 a lap with the 3-minute cooldown ([Marks of grace](#marks-of-grace)).
- **Failing (Wiki):** from 75 Agility (boosts count) nothing fails, and the stepping stone and the
  second tree never fail (15 May 2024). A fall from the first tree, the monkeybars or the skull
  slope lands at the course entrance by the signpost; the rope drops a monkey by the first tree.
- **Without the form (Wiki):** a human slips off every obstacle with "...you're not monkey enough
  to try this!" (on the rope, "You lose your grip on the vine! ...you're not monkey enough to try
  this!", and back to the stepping stone) and takes a little damage. Any other monkey is refused
  with "Only the stealthiest and most agile monkey can use this!". A pet can't cross the rope
  ("Your little friend can't make it over the obstacle...").
- **Tiles from the cache:** the obstacle locs (`100_ilm_*`), the bars between 2752 and 2747 on
  plane 2, the slope's pieces (2744-2746), the rope (4x1 from 2752,2731) and the vines from the
  last tree (plane 1, 2758,2735 to their end at 2770,2747). The tiles between them were walked with
  the agent MCP: a lap loops from the vines' end back to the stepping stone.
- **No capture exists.** The movement and its timing come from the monkey animations' lengths
  (`100_ilm_*`, `yarn dump:seq`); the fall damage (1-3), the fail chance below 75 (the engine's
  linear default), the entrance tile (2757,2745) and the mark tiles are guesses.
- Recipe for Disaster's Awowogei part opens its hole when this course's rope is swung during the
  quest (`agility:obstacle`); it no longer swings the rope or climbs the last tree itself.
