---
quest: The Ascent of Arceuus
key: the_ascent_of_arceuus
status: passed
tested:
tester: agent
model:
commit:
cache: osrs-241_2026-10-20
start: checkpoint
travel:
---

# The Ascent of Arceuus

Natural main route from stage 0 to completion across one saved checkpoint, with the grave/trail/altar steps and rewards paid once. Accepted for the exact reviewed plugin revision.

## Capture search

RSProx database and issue #600 capture list checked on 2026-11-03: no Ascent of Arceuus
recording was found. The database has no quest start/completion message or quest dialogue;
the `arcquest_main` (2071) hits are completed accounts (stage 14) and unrelated text, not a
quest run. No capture audit was possible, so the quest was skipped.

## Findings

- **fixed** Sins of the Father's condition handler overrode Mori's requirements check; now scoped to Sins' nine condition IDs.
- **fixed** Grave loc 34602 (4x2 parent of a 1x1 child) was unreachable until the shared MovementQueue footprint fix.
- **open** A later post-quest walk did not find Mori; a later note says that route was on plane 0 while Mori is on plane 2.

## Runs

### date not recorded · agent · model not recorded

- **Source:** issue [#728](https://github.com/RSPSApp/tsps/issues/728) active (q003); moved here from its ledger on 2026-10-29. Proven against plugin hashes, not a commit, so a later plugin change is not flagged automatically.
- **Start:** checkpoint: fresh stage-0 prefix to stage 8, resumed after a later server restart.
- **Result:** varbit 7856 = 14; QP +1, Hunter +1,500 XP, Runecrafting +500 XP, coins +2,000.
- **Checked:** repeat (no duplicate reward), page use/replay persisted, save history, logout/offline.
- **Not checked:** Full-bag, ambient Mori recovery and overlay unchecked; Post-quest dialogue and lost-page recovery unverified; Later plugin edits and uncovered recovery need rechecks.
- **PRs:** [#1093](https://github.com/RSPSApp/tsps/pull/1093).
