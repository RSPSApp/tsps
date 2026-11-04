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

## Findings

Newest first. One line each, linked to its issue or PR when there is one.

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

No usable recording exists. The archive was searched with the quest's own text and every
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
