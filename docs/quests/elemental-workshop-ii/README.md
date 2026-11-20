---
quest: Elemental Workshop II
key: elemental_workshop_ii
status: in-progress
tested: 2026-11-19
tester: agent
model: claude-opus-5-5
commit:
cache: osrs-242_2026-11-03
start: fresh
travel: manual
---

# Elemental Workshop II

The plugin follows the user's rsprox recording `ElementalWorkshop2.bin` (rev 242.1, one run from the
Exam Centre bookcase to the mind helmet and a mind shield). Lines come from the Wiki's
[quest transcript](https://oldschool.runescape.wiki/w/Transcript:Elemental_Workshop_II) through the
dialogue dump, presented as the recording presents them (message box, item box, chat line or player
line); ticks below are the recording's.

## Stages

Varbit 2639 (`elemental_quest_2_main`), as live sets it: 1 the book found (67), 2 the book read (71),
3 the note read (85), 4 the key found (194), 5 the hatch unlocked (207), 6 the machine floor reached
(213), 7 the primed bar taken (1008), 8 the mind door opened (1356), 9 the primed bar placed (1364),
10 the mind bar made (1377), 11 complete (1454; the cache's completion threshold). The machines are
the other `elemental_quest_2_*` varbits on varps 896/897, saved as they are. Saves from the old
1-12 scheme are converted once at login.

## Recorded behaviour

| Step | Live (ticks) |
| --- | --- |
| Bookcase (17382) Search | chatmenu "Start the Elemental Workshop II quest?" Yes./No.; Yes: stage 1, the start message, objectbox beaten book "You find an old-looking book." (64-67). The note is not on the shelf |
| Beaten book Read, first | "The book has two parts; an introduction and an instruction section." (the Wiki has a colon, which the plugin uses), stage 2, objectbox note "You find a slip of paper that has been used for a bookmark. ...", then "You flip the book open..." and book 392 "Book of the Elemental Helm", four spreads (71-80) |
| Note (9721) Read | messagescroll_handwriting 222 lines "", Down, 2 N, 2 E, 2 N, 2 E, 10 N, 4 W, Pipe 3.; hide_key 1, stage 3 (85) |
| Boiler (18593) Search | stage 4, objectbox key "You find a key hidden in the third pipe." (194); again "You find nothing." (198) |
| Hatch (3413) Open, no key | messagebox "You're unable to open the locked hatch." (183) |
| Hatch Open with the key | the key used up, hatch 1, stage 5, sound 75, objectbox "The key fits the lock in the hatch perfectly." (207) |
| Hatch Climb-down | music Prime Time, stage 6 (first), rebuild_region (8x8 chunks from 1920,5120, planes 2-3), landing 1955,5155,2; "You climb down the stairs." a tick later (213-214). On entry the crane (`elem2_crane_track_up_broken`) and tank door (`elemental_waterdoor_closed_retracted_none`) are sent as locs and the cart (6285, multinpc on jig_state) stands at 1954,5147 |
| Stairs 18598 / 18597 / 18599 | "You climb up the stairs." to 2720,9892,0 (235); "You climb down the stairs." to 1947,5159,0 (1346); up to 1950,5158,2 |
| Gantry stairs 18610/18611 | seq 828 (reach), two ticks later across the stairs a plane up or down (511-517, 592-598) |
| Schematic crate (18711) | chatmenu "There are two schematics here..." Crane schematic/Lever schematic, objectbox "You take a copy of the schematic drawing." (221-224). Crane schematic Read: messagebox (229); lever schematic: interface 466 (1340) |
| Crates 18612-18619 | game messages "You find a small cog." / "You find a medium-sized cog." / "You find a pipe." / "You find a big cog." / "It's empty." (604-633) |
| Workbench, bar + slashed book + crane schematic | skillmulti 270 "What would you like to smith?" Elemental shield / Crane claw (460); claw: seq 896 + sound 2721, the bar taken and the claw in the first free slot, +20 XP (470-473) |
| Raise/lower lever 18622 | seq 4909 + the lever's 4904 + sound 2400; a tick later fire_pos and the crane's loc anim (4887/4888/4889/4890) and sound 3169; the new crane loc three ticks after that (498-502). Raising off the track lifts the cart's cold bar or leaves the hot one, the new load shown at once and the anim a tick later (737-744, 789-794); resting in the lava heats it (761) |
| Rotate lever 18621 | anim 4892, sound 3170, over the lava <-> over the track (750-754, 772-776) |
| Claw on the lowered crane | fire_state 1, objectbox "You replace the broken claw.", sound 3179 (505) |
| Cart lever 18620 | a tick after the pull jig_pos + sound 3167, the cart a tile a tick: crane 1954,5147 -> press 1946,5155 (15 steps) -> tank 1953,5162 (13) -> wind tunnel 1961,5155 (14) -> crane (14) (801-1004) |
| Press lever 18640, hot bar | a tick after the pull the hammer loc 18644 at 1946,5155, then earth_fixed 1, jig_state 3, the box, anim 4908, sound 3180; the hammer gone two ticks later (822-826). Again: "... but the bar has already been flattened." (1101) |
| Junction box (18641) | interface 262, if2 = pipes left; click an inlet (if1), then its other end: the pair index (order a,b,c,1,2,3) in the next pipe varbit, the `_l` connection shown, sound 3179. The run fitted a-3, 1-2, b-c (5, 13, 6), the box closed with the player's "I hope I got that right." (523-536) |
| Piping (3414) with the pipe | water_state 1, objectbox "You replace the section of broken pipe.", sound 3179 (660) |
| Pins with cogs | cog varbits 1/2/3, objectbox "You put the small cog onto the shaft." etc., sound 3178 (704-714) |
| Tank door lever 18648 | a tick after the pull the door's anim (4875/4876) and sound 71/70; the door loc two ticks later (851-854, 872-875) |
| Corkscrew 18649 | seq 4905 + loc anims; out: two ticks later extended (858-861); in: swaps the bar between the cart and the rack at once, retracted three ticks later (864-868, 928-931) |
| Inlet valve 18646 | open: valve_1 + water_level 1, the water loc, a tick later the fill anim, three later the tank full and a hot bar inside cooled, then "You open the valve." (881-885); close: "You close the valve.", the water gone (907) |
| Drain valve 18647 | open: the empty anim, three ticks later "You open the valve." (894-897); closed with the inlet open: it fills (1170-1173) |
| Fan lever 18663 | a tick after the pull air_state 1, fan_state 1, a cool flat bar dried, the cog anims, "The fan starts to blow." then "The machine starts rumbling."; off: "The machine grinds to a standstill." (966-980) |
| Cart Take-from, dry bar | stage 7, objectbox "You take the primed bar." (1008) |
| Mind door 18698 | stage 8 (first), both leaves open (18699/18701), sound 71 (1356) |
| Primed bar on the gun 18725 | mind_jig 1, stage 9, objectbox "You place the primed bar under the device.", sound 3177 (1364) |
| Extractor hat Operate | camera, then the slide onto the chair with seq 4884 and sound 3176, spotanim 807 and the hat gone, the gun's anim 4897 and sound 3173; four ticks later mind_jig 2, stage 10, Magic -20; the hat back, the slide off, "You feel magically weakened." and the camera reset (1370-1381) |
| Gun Take-from | mind_jig 0, objectbox "You take the elemental mind bar." (1386) |
| Workbench, mind bar + beaten book | the mind helmet four ticks on: completion, the note removed, Kandarin medium task, scroll "1 Quest Point", "7,500 Crafting XP", "7,500 Smithing XP", "Ability to make Mind", "Equipment", model 9733 (1450-1454) |
| After the quest, mind bar + both books | skillmulti Mind shield / Mind helmet; "Following the instructions in the book, you make a mind shield.", +30 XP (1464-1471) |

## Recorded differences (the Wiki is followed)

- The book's first line has a semicolon in the recording (tick 71).
- The claw line: the recording has "...from the schematic, you make an elemental claw." (473); the Wiki has no comma.
- The helmet line: the recording has "...you make a mind helmet." (1454); the Wiki has "...an elemental mind helm.".
- The claw and the mind shield came three ticks after the choice (470-473, 1468-1471); the Wiki gives 4 ticks for the crane claw, the mind shield and the mind helmet.
- The bench's product goes to the first free slot (the helmet at 1454 into slot 8, freed at 1446, while the bar came from slot 9).

## Not modelled

The full-inventory lines (the Wiki marks them missing), the press with a cold bar, an east valve
before the pipe, the fan with cogs missing and a crate's item after the quest are ours, as noted in
the code. The journal is captured at stages 3 and 7 only.

## Runs

### 2026-11-19 · agent · claude-opus-5-5

- **Start:** fresh account, `::master`, Elemental Workshop I set complete with `::quest`, three bars,
  the slashed book and a hammer spawned; `::tele` to the Exam Centre and, after the note, to the
  workshop's boiler (not a natural route).
- **Route:** the bookcase, book and note, the boiler key, the hatch, the machine floor instance: both
  schematics, the claw (skillmulti), the claw on the lowered crane, the junction box a-3, 1-2, b-c,
  the crates, the pipe, the cogs, one bar through crane, press, tank and tunnel, the primed bar, the
  stairwell, the mind door, the gun and the hat, the mind bar, the workbench.
- **Result:** varbit 2639 1 -> 11 at the steps listed above; the machine varbits followed the
  recording's sequence (water_door 1, 2, 4, 3, 6, 7, 8, 1, 0; jig_state 1, 0, 2, 3, 6, 4, 5, 0); the
  cart rode a tile a tick; Magic -20 at the hat; Kandarin medium task and the completion scroll.
- **Not checked:** a natural route from the Dig Site, Quest Helper, relog mid-quest, a second
  primed bar and the mind shield in game (covered by the tests), the vision client.
