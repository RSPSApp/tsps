---
quest: Sleeping Giants
key: sleeping_giants
status: passed-with-issues
tested: 2026-11-08
tester: agent
model: claude-sonnet-5-5
commit: b75e1d090
cache: osrs-241_2026-10-20
start: fresh
travel: travel_to
---

# Sleeping Giants

Run of 2026-11-08 played the quest live from the strike to the first preform pickup and tool use (tutorial varbit 50); the rest of the sword work and the hand-in were not replayed. Earlier run: fresh natural route to completion, reward persisted after relog.

## Findings

- **fixed** The cutscene slid the player (force movement) instead of walking; recording 96 shows one walking step per tick. Reported in [#3674](https://github.com/RSPSApp/tsps/issues/3674).
- **fixed** Hover on the mould jig (a 3x3 multiloc with 1x1 forms) was click-tested a tile away: the client's raycaster sized it by its form while the scene places it by the map's id. [#3674](https://github.com/RSPSApp/tsps/issues/3674).
- **fixed** The worn preform used the one-handed default stance; it now uses the cache's human_weapon_giant01 ready/walk/run poses. [#3674](https://github.com/RSPSApp/tsps/issues/3674).
- **fixed** Using a bucket of water on the poured mould did nothing, so the sword could not be cooled without ice gloves. It now empties the bucket and cools the jig, and Pick-up takes the preform. [#4249](https://github.com/RSPSApp/tsps/issues/4249).

## Runs

### 2026-11-08 · agent · claude-sonnet-5-5

- **Start:** fresh account placed beside the Hill Giant with `::tele` (the only teleport), Smithing 60 set by command.
- **Route:** Strike the giant, cutscene (walk now tile by tile, as recording 96), repaired polishing wheel, grindstone and trip hammer, Kovac's commission talk, crate (20 slots), crucible fill, mould jig setup, Kovac's check, pour, bucket from the pile, cooled at the waterfall, preform pickup, Kovac's tool talk, wrong-tool damage dialogue.
- **Result:** varbit 13902 = 15, then 25; tutorial varbit 13903 = 10, 15, 20, 25, 30, 35, 40, 45, 50; repair varbits 13904-13906 = 2.
- **Not checked:** completing the three tool stages, the hand-in and rewards in this run; hover and the stance were checked by a raycaster unit test and a headless screenshot, not by hand in the browser.

### date not recorded · agent · model not recorded

- **Source:** issue [#728](https://github.com/RSPSApp/tsps/issues/728) active (q105); moved here from its ledger on 2026-10-29. Proven against plugin hashes, not a commit, so a later plugin change is not flagged automatically.
- **Start:** fresh.
- **Result:** varbit 13902 = 30; varbit 13903 = 65; QP 0->1, Smithing +6,000 XP.
- **Checked:** relog, logout/offline.
- **Not checked:** Branches, recovery, overlay, full-bag and combat balance unchecked.
- **PRs:** [#1167](https://github.com/RSPSApp/tsps/pull/1167).
