---
quest: Elemental Workshop I
key: elemental_workshop_i
status: passed
tested: 2026-11-19
tester: agent
model: claude-opus-5-5
commit:
cache: osrs-242_2026-11-03
start: fresh
travel: travel_to
---

# Elemental Workshop I

Fresh run of the rev 242 capture's route on the agent MCP: bookcase, the Start prompt and book, the knife, the odd wall,
the stairs, both water controls and the lever, the leather crate, bellows and air lever, the bowl, lava and furnace, a mined
elemental rock killed for its ore, the bar and the shield, with the client state matching the capture.

## Live capture (rev 242)

The user's rsprox recording `ElementalWorkshop1.bin` (rev 242.1, one full run from the bookcase to the
quest rating) is what the plugin follows; ticks below are that recording's. The Wiki's
[quest transcript](https://oldschool.runescape.wiki/w/Transcript:Elemental_Workshop_I) gives the branches
the run doesn't take (full inventory, missing materials, levers out of order, workbench refusals).

| Step | Live (ticks) |
| --- | --- |
| Bookcase (26113) Search | objectbox with the battered book, "You search the bookcase and find a battered book. You take it." (25) |
| Battered book Read, unstarted | chatmenu "Start the Elemental Workshop I quest?" Yes./No. (30); "No." closes it (32). On "Yes." (35): varbits 2056=1, 13718=1, the start message, "The book has two parts: an introduction and an instruction section.", "You flip the book open to the introduction and start reading.", book 392 "Book of the elemental shield" with two spreads (35, 38) |
| Read, started | the two lines and the book, no prompt (209) |
| Knife on book | "You make a small cut in the spine of the book.", "Inside you find a small, old, battered key."; varbit 2057=1; the slashed book (9715) takes the book's slot and the key the next (78) |
| Odd wall Open, outside, key carried | "You use the battered key to open the doors."; varp 299 bit 15 set once; inviswall 18505 on both wall tiles (2709/2710,3495), open leaves 26117/26116 north, scrape 2410; the player steps to 3496 the same tick; the wall is back two ticks later (198-200) |
| Odd wall, no key | "You see a small hole in the wall but no way to open it." and sound 2402 (245, 247) |
| Odd wall Open, inside | the same doors with no line; the player steps south (240-242) |
| Staircase (3415) Climb-down | lands on 2716,9888 a tick after the click; the first time varbit 2065=1 and the player says "Now to explore this area thoroughly, to find what forgotten secrets it contains." (203-204). Up (3416) lands on 2709,3497 (232-233) |
| Water controls Turn | "You turn the handle.", seq 4861, sound 1541 on arrival; the gate varbit three ticks later: east (3403) 2059, west (3404) 2058 (272-275, 293-296) |
| Water lever (3406) Pull, both green | "You pull the lever.", varbit 2060=1, "You hear the sound of a water wheel starting up.", sound 1547; the lever shows 3417 for two ticks (305-307) |
| Bellows (3407) Fix | seq 4863, "You stitch the leather over the hole in the bellows.", varbit 2061=1, one leather and one thread used, needle kept (325) |
| Crate (3394) Search | varbit 2066=1, "You find some leather." (345) |
| Air lever (3409) Pull | "You pull the lever.", "The bellows pump air down the pipe.", varbit 2063=1, sound 2400, lever 3417 for two ticks (361-363) |
| Boxes (3397) Search | "You find a stone bowl." (375) |
| Bowl on lava trough | seq 4862 (397); two ticks later the full bowl, "You fill the bowl with hot lava.", sound 1537 (399) |
| Full bowl on furnace | "You empty the lava into the furnace.", the empty bowl back, sound 1538 (411); four ticks later "The furnace bursts to life.", varbit 2062=1 (415) |
| Elemental rock (1368) Mine | the rock's emerge seq 4865 on arrival (436); two ticks later it says "Grr... Ge'roff us!" and is the level 35 earth elemental 1367, the same NPC (438). No player animation |
| Earth elemental death | seq 4870 (466); Rock (1480) and elemental ore on its tile, owned (471); a rock again after (476) |
| Ore on furnace, 4 coal | seq 899, "You place the elemental ore and four heaps of coal into the furnace.", ore and coal gone (500); four ticks later seq 899, the bar, 8 Smithing XP, "You retrieve a bar of elemental metal." (504) |
| Bar on workbench (3402) | seq 896 and sound 2721 (515); three ticks later the shield in the bar's slot, "Following the instructions in the book, you make an elemental shield.", varbits 2067=1 and 13718=2, the completion; 20 Smithing XP with the 5,000 (518) |
| Quest journal, started | "<str>I have found a battered book in a house in Seers' Village.", "<str>It tells of magic ore and a workshop created to fashion it.", "", "Where is this workshop and how do I get in?" (53) |
| Completion scroll | shield model 2890; "1 Quest Point", "5,000 Crafting XP", "5,000 Smithing XP", "Ability to make Elemental", "Shields" (518) |

Not in the recording, so not modelled: varbit 2064 (elemental_workshop_boxes) goes 0 -> 1 -> 5 at the start
(tick 35); no loc reads it and no step depended on it. The journal after the first stage is ours.

## Findings

- **fixed** Messages, the start prompt, the book interface, the wall doors, the stairs line, the
  valve/lever/furnace/smelt/shield timings and the elemental rock now follow the rev 242 capture.
- **fixed** Entered-wall state, slashed-book requirements, valves, recoverable supplies and elemental floor loot were corrected.

## Runs

### 2026-11-19 · agent · claude-opus-5-5

- **Start:** fresh account placed in the bookcase house with `::tele` (the only teleport); `::master` and the
  knife, needle, thread, hammer, pickaxe and four coal spawned.
- **Route:** the bookcase, Read and "Yes.", knife on the book, `travel_to` the smithy, the odd wall, the stairs, east
  then west water control and the lever, the leather crate, the bellows and air lever, the boxes, the trough and
  furnace, Mine on an elemental rock and the fight, the ore picked up, the furnace and the workbench.
- **Result:** varp 299 went 2 on the start, 6 after the cut and 32774 through the wall (as the Wiki's transcript
  notes), then each machine bit; 13718 1 -> 2 and 2067 1 at the workbench, the shield in the bar's slot, the scroll.
  The wall's inviswall and open leaves stood for two ticks and the player crossed both ways.
- **Not checked:** the first Climb-down after the first crossing walked to the stairs without climbing once; three
  later tries (the same timing) all climbed a tick after arrival, so the cause wasn't found. No vision client run:
  the wall leaves stand two ticks and the machinery is varbit multilocs, both checked by id.

### 2026-10-23 · agent · model not recorded

- **Source:** issue [#728](https://github.com/RSPSApp/tsps/issues/728) active (q030); moved here from its ledger on 2026-10-29. Proven against plugin hashes, not a commit, so a later plugin change is not flagged automatically.
- **Start:** fresh.
- **Result:** varbit 13718 = 2; QP +1, Crafting +5,000, Smithing +5,000, one shield.
- **Checked:** second legitimate shield craft without repeat reward, relog, logout/offline.
- **Not checked:** Optional recovery, exact skill gates, book interface/visuals, base crafting XP and overlay unchecked; HP1 aid after each elemental was really hit.
- **PRs:** [#1116](https://github.com/RSPSApp/tsps/pull/1116).
