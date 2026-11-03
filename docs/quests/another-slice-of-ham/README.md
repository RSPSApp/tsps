---
quest: Another Slice of H.A.M.
key: another_slice_of_ham
status: in-progress
tested:
tester: agent
model:
commit:
cache: osrs-241_2026-10-20
start: checkpoint
travel:
---

# Another Slice of H.A.M.

Crate hiding, guard lure/combat and ladder 23376 reached stage 10 from a declared checkpoint. Progress survived relog.

## Capture search

RSProx database and issue #600 capture list checked on 2026-11-03: no full quest recording
was found. Capture 1885 (rev 233) contains the Dorgesh-Kaan opening argument and its four
options, but the player chose the market permission branch and `slice_quest` (997) stayed 0;
3197/3188/3191/1694 contain only post-quest Ur-tag, Zanik and Oldak lines with 997 already 11.
No start/completion message or stage progression was captured, so the quest was skipped.

## Findings

- **fixed** Seven earlier integration failures repaired. [#1192](https://github.com/RSPSApp/tsps/pull/1192)

## Runs

### date not recorded · agent · model not recorded

- **Source:** issue [#728](https://github.com/RSPSApp/tsps/issues/728) active (q002); moved here from its ledger on 2026-10-29. Proven against plugin hashes, not a commit, so a later plugin change is not flagged automatically.
- **Start:** checkpoint: declared stage-9 setup checkpoint.
- **Result:** stage 9 -> 10.
- **Checked:** relog.
- **Not checked:** Not a fresh complete route; No reward/recovery proof; No visual/timing parity.
- **PRs:** [#1192](https://github.com/RSPSApp/tsps/pull/1192).
