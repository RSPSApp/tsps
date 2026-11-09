---
quest: Recipe for Disaster
key: recipe_for_disaster
status: in-progress
tested:
tester: agent
model:
commit:
cache: osrs-241_2026-10-20
start: checkpoint
travel:
---

# Recipe for Disaster

Only the Mountain Dwarf rescue was played naturally with its reward; the goblin generals route was started but not reached.

## Findings

- **fixed** The opening feast and the dining dimension ([#3839](https://github.com/RSPSApp/tsps/issues/3839)): the Lumbridge kitchen door (`hundred_lumbridge_door`) now enters the same dimension as the large doors and the dimension's kitchen door (`elfdoor`) leads back to the kitchen; the feast camera frames each Wiki stage direction instead of staying on the hidden player; the frozen room shows the cache's time-bubble walls, doorway barriers (Pass-through leads out) and the rings on the Culinaromancer. No recording covers this cutscene, so the camera framing is ours.
- **open** Parked for a rescue-wire source correction; later loaded hash differs from the reviewed one.

## Runs

### date not recorded · agent · model not recorded

- **Source:** issue [#728](https://github.com/RSPSApp/tsps/issues/728) deferred (q094); moved here from its ledger on 2026-10-29. Proven against plugin hashes, not a commit, so a later plugin change is not flagged automatically.
- **Start:** checkpoint: continued a prior stage-4 account (Mountain Dwarf rescue only).
- **Result:** rfd stage 4 (unchanged); Mountain Dwarf rescue: QP 237->238, Cooking +1,000, Slayer +1,000.
- **Not checked:** Remaining rescues, finale, rewards, repeat/relog/offline and overlay unverified.
- **PRs:** [#1158](https://github.com/RSPSApp/tsps/pull/1158).
