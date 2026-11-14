---
quest: Murder Mystery
key: murder_mystery
status: passed
tested: 2026-10-25
tester: agent
model:
commit:
cache: osrs-241_2026-10-20
start: checkpoint
travel:
---

# Murder Mystery

Anna's alibi was disproved at the real compost heap and the Guard accepted the evidence. Rewards paid once and persisted.

## Findings

- **fixed** Mansion front-door leaves needed a shared door fix before Anna could be questioned.
- **fixed** The kitchen's barrel of flour (loc 26122, 2733,3582) answered only Take-from, only
  during the quest, with lines of our own. rsprox captures (local recordings 1001551 rev 241,
  1001930 and 1001958 rev 242) show an empty pot used on it: one tick after arriving,
  "You take some flour from the barrel." and "There's still plenty of flour left.", the pot of
  flour in the pot's own slot, no animation or sound. Without a pot the transcript's line is
  "You need something to put the flour in."; the Wiki ("Barrel of flour (Sinclair Mansion)")
  keeps it as an infinite flour source after the quest, and gives the line for the silver or
  pungent pot used on it. Take-from answering like a used pot, and no stage check before the
  quest, are ours.

## Runs

### 2026-10-25 · agent · model not recorded

- **Source:** issue [#728](https://github.com/RSPSApp/tsps/issues/728) active (q080); moved here from its ledger on 2026-10-29. Proven against plugin hashes, not a commit, so a later plugin change is not flagged automatically.
- **Start:** checkpoint: fresh stage-0 prefix, clues preserved, resumed without reset.
- **Result:** varp 192 = 2; QP +3, Crafting +1,406 XP, coins +2,000; evidence consumed.
- **Checked:** repeat dialogue (Guard), relog, save history, logout/offline.
- **Not checked:** Anna route only; alternate suspects unverified; Recovery and overlay unverified.
- **PRs:** [#1146](https://github.com/RSPSApp/tsps/pull/1146).
