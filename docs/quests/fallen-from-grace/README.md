---
quest: Fallen From Grace
key: fallen_from_grace
status: passed-with-issues
tested: 2026-10-30
tester: agent
model: claude-haiku-5-5
commit: fb2befc51
cache: osrs-241_2026-10-20
start: fresh
travel: travel_to
---

# Fallen From Grace

One full run from the start with Cormac to completion, plus a relog. Stage, QP, the four
skill rewards and the repeat talk all checked out. Two issues remain open: the large hat is
drawn inside the rock, and the broken golem spawn stays visible after the golem is powered.
The cave passage by boat now works (fixed, see findings), but sailing back out of the cavern isn't implemented.

## Capture audit (2026-11-20, issue #6300)

Two rsprox recordings of one full run, recorded by the maintainer on revision 241: **P1**
(Wyrmscraig to Cormac's explanation, stages 0-8) and **P2** (the cavern to completion, stages
8-20). Ticks below are each recording's own. The plugin, its tests
(`server/tests/fallen-from-grace-captured-flow.test.cjs` and the lock and Wyrmscraig tests) and
this table follow them; where the Wiki states a value it wins.

| Step | Live (recording, tick) | Ours before |
| --- | --- | --- |
| Start | Yes = stage 2; Cormac's last line ("I'll head over there right away.") = 3 (P1 103, 107) | 3 set by Muriel's first talk |
| Muriel | stage 4 with her "Thank you..." (P1 129) | 4 only on a second talk |
| Monolith | first click: the notebook in an item box, sound 2582, stage 5 (P1 156); `ffg_keenans_book` on the first Read (P1 161) | chat line; flag on take |
| Mining it | "You swing your pick at the monolith.", sunstone 11 ticks later with sound 3600; a full pack gets "Your inventory is too full to hold any more sunstone." (P1 168-181) | instant |
| Chisel | "You chisel the sunstone into a sunstone core.", animation 7202, sound 1553 (P1 186) | other wording |
| Hat | stage 6; message box held 23 ticks while the camera pans from the hat to the cathedral; think emote 857 (P1 247-274) | chat line |
| Cormac | stage 8 after his "Wonderful..." line, as the question menu opens (P1 358) | on the first line |
| Cavern landing | Mortimer's greeting starts by itself (P2 43); stage 11 at "It was those three nearby trolls" (P2 57) | waited for a click; 11 on the kills |
| Trolls | the quest's own `ffg_troll_1-3` (16330-16332) at 2593,8604 / 2591,8610 / 2588,8609; the third kill sets flag 15769, "You notice the skeleton calling you over." and Mortimer's shout (P2 151); stage stays 11 | generic trolls counted |
| Rockfall | message box held 5 ticks, animation 827, fade; stage 13 and the player at 2590,8613 (P2 162-172) | no fade or move |
| Golem | the inspect box with animation 14473; the dull core in an item box with sound 2582 (P2 232-236); the new core: fade, the move to 2573,8655 two ticks in, box held 3 (P2 247-252) | chat lines; instant move |
| Chest | 810 code accepted: animation 536, sounds 2419/52/51, the primer and the old core in one double item box (P2 265-268) | "You successfully pick the lock." and a chat line |
| Key | the key in an item box, sounds 2381 and 2119 (P2 282) | chat line |
| Stairs | "You unlock a hatch at the top of the staircase and climb up into the cathedral.", sound 2419, flag 15766, fade; stage 16 and the player at 2540,2214 in the real cathedral two ticks in; the dull core is taken (P2 288-295) | straight into the boss instance |
| Pew | "Climb over the pew?" (Yes./No.); the instance; the angel (16306) wakes by itself 3 ticks after the move: 16311, then 16309 (P2 314-325) | dormant, waiting for Wake |
| Kill | stage 18, the kill count, the drop (sunstone crystal, granite dust, a prayer potion), the corpse 16312 stays, the pew turns back into 62250; no fight-duration line (P2 431) | the angel respawned |
| Body | flag 15773 and the letter in an item box; stage stays 18 (P2 434) | stage 19 here |
| Letter | Read: stage 19, the long scroll (P2 449) | one-line summary |
| Way out | the climbable pew, no question, back at 2539,2215 (P2 465-469) | the exit pew's question |
| Door | "You attempt to open the doors, but they appear to be locked." (Try to pick the lock./Leave them.), then 811; a new combination per opening (2306, then 7152); failures "That didn't seem to work."; success flag 15767 and a message box (P2 473-626); then Open drags the player out (P2 628) | Wiki choice whose success branch always ran: the success line, no puzzle, still locked (issue #6300) |
| Completion | the scroll lists 2 Quest Points, Wyrmscraig Cathedral access, Ability to craft golems, then 12,500 Sailing, 10,000 Crafting, 5,000 Mining and 5,000 Runecraft XP (P2 713) | XP only, other order |

**Recorded differences and gaps (ours):**
- Live plays stages 9-11 in a private copy of the cavern; ours spawns the cutscene Mortimer and the
  three trolls for the player alone in the shared cavern, without the rockfall locs.
- The quest angel's wake is taken as 3 ticks after the move; the recording can't tell that from
  "as the player steps towards it" (both fall on tick 322).
- The 255-hitpoint enrage is the Wiki walkthrough's; the quest angel's other attack values stay the
  post-quest angel's (the Wiki gives none).
- The door can be picked from inside from stage 16 (the transcript's choice has no stage); the
  recording only shows it after the kill. From outside it stays "firmly locked" (Wiki: "Exit the
  cathedral by searching the lock").
- Trolls killed before Mortimer's request (they are there on arrival) count; his call comes with
  the request. Not recorded.
- The Mad Angel's sunstone crystal drops only when owed (Wiki: "always drops if the bank chest is
  not built and a crystal is not already owned"; owned = carried, worn or banked).
- Going back into the cathedral at stages 18-19 shows the dead angel and the climbable pew; not
  recorded.
- The hat pan leaves out `cam_rotateto` (pitch 2, yaw 240 over 600 cycles), which our packets lack.
- The notebook, primer, warning note and observations still print a one-line summary: only the
  notebook's first spread was recorded.

## Findings

Newest first. One line each, linked to its issue or PR when there is one.

- **fixed** #6300: the Mad Angel never woke after the stairs, and the cathedral door printed its
  success line with no puzzle and stayed locked. See the capture audit above.

- **open** Large hat (34044) renders inside the rock at 2556,2198: the tile is height 11, its
  neighbours are 1 and 12, and the live capture has no loc there. It should sit on top of the stone.
- **open** The sync also added a static "Broken golem" (16321, source `wiki`) on 2573,8650
  beside the cache's multi-NPC (16320). It stays visible after the golem is powered (16322).
  Generated data: fix the `sync:npc-spawns` filter, then regenerate.
- **fixed** Sailing into the cave didn't work: the approach box was at y 2187–2189, but the
  live crossing passes 2555–2561, 2200–2205 (rsprox P2, "You sail through the cave opening." at
  2559,2203). The box is now the captured crossing, and the passage also works after completion
  (stage stays 20). It now also shows the captured portal overlay (745) and sound 10747.
- **open** Sailing back out of the cavern by boat isn't implemented, and no capture of it exists.
- **open** The sea crossing to the Wyrmscraig dock on the test account was skipped (teleport to
  the dock); only the cave passage itself was checked by boat.
- **open** The planner (`travel_to`, `plan_route`) has no route from the cathedral back to the
  island; the way out is the cliff rocks shortcut (62263 mined, 62265 climbed), which the
  planner doesn't use.
- **open** Pandemonium's completion reward lists "a raft", but its `onReward` never gives one; only
  Junior Jim's step (`grantRaft`) does. `quest pandemonium complete` therefore skips the raft.
- **open** The Boat Emporium (Junior Jim's Buy-boat) runs through the Omnishop, which the MCP
  `shop` / `shop_buy` tools can't see.
- **open** `PlayerBots.plugin.js` fails to load: `standardwebhooks` is used but not declared in
  `server/package.json`. Not part of this quest.
- **fixed** Private floor items (the large hat, the journal and the warning note) despawned after
  the default 300 ticks and were re-created only on login or zone entry, so the hat vanished
  mid-quest. They now use a 6000-tick despawn (`QUEST_FLOOR_DESPAWN_TICKS`). No regression test
  yet: it needs a `dist/` build and a larger harness.

## Capture search (2026-11-03, skipped)

Superseded by the capture audit above (the maintainer's own recordings). At the time no usable
recording existed. The archive was searched with the quest's own text and every
distinctive id, and all returned 0 results:

- type 14 text: `Fallen From Grace`, `You've started a new quest: Fallen From Grace`,
  `Congratulations, you've completed a quest: Fallen From Grace`, `Wyrmscraig`,
  `Sunstone core`.
- type 0 NPC: 16318 (Cormac), 16319 (Muriel), 16320/16321/16322 (broken/powered golem),
  16175 (Mortimer), 16330 (mountain troll).
- type 1 item: 34020 (sunstone), 34032 (sunstone crystal), 34044 (large hat), 34051
  (observations).
- type 2 loc: 62216 (sunstone monolith), 62376 (chest), 62255 (basement stairs), 62371
  (notebook rocks), 62378 (bookcase).
- type 5 varp 5715 and type 6 varbit 15759.

This quest is therefore **skipped** for this batch. Its existing run below is kept as history,
not revalidated; no wiki-only work was substituted for a capture audit.

## Runs

Newest first. A rerun adds an entry; it never rewrites an older one.

### 2026-10-30 · agent · claude-haiku-5-5

- **Start:** fresh test account. Setup before the baseline (all declared aids): `::master`,
  `::maxgear melee`, `quest pandemonium complete` (Pandemonium's 1 QP and 300 Sailing XP;
  its raft wasn't granted), `item 995 100000`. Baseline: QP 1, varbit 15759 = 0, varp 5715 = 0.
- **Route:** `::raft` (declared boat, moored at The Pandemonium). Pandemonium to the Wyrmscraig
  dock by hand: first attempt drifted and was left at sea (the raft sank); `::tele` to the
  Wyrmscraig dock; second raft, sailed to the cavern approach by `::bt tp`. On the island:
  Cormac (start), Muriel (x2), the tent (bronze pickaxe, hammer, chisel), the sunstone monolith
  and rocks (notebook, sunstone), the large hat from 2556,2197 (stage 6), Cormac (stage 8).
  Cavern: Mortimer, the three mountain trolls (stage 11), Mortimer (stage 13), the broken
  golem (dull core, stage 14), the sunstone core into the golem (stage 15), the basement chest
  (lock code 1734, ancient core), the core chiselled for the staircase key, the staircase (16).
  Mad Angel woken and killed (stage 18), Keenan's body inspected (stage 19), leave by the
  broken pew's Quick-exit, the rocks shortcut and the front door (captured code 7152), Cormac
  (stage 20).
- **Result:** stage 20; QP 1 → 3; Crafting +10,000, Sailing +12,500, Mining +5,000,
  Runecraft +5,000 XP (wiki). Strength and HP rose from the Mad Angel fight. Elessia's final
  letter was taken on completion. Repeat talk: no extra reward, and Cormac gave a sunstone crystal
  in dialogue (not a reward).
- **Relog:** stage 20, QP 3 and each reward XP persisted; nothing duplicated.
- **Cave passage (after the fix):** sailing into the cave from the sea moves the boat to the
  cavern mooring, with the portal overlay and sound. Stage stays 20. Checked by hand, in the client.
- **Not checked:** the golem's post-quest behaviour, the
  visual rendering of the hat and golem, the recovery cases (full bag, pending rewards),
  and any offline save check beyond the relog.
