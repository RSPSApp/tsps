---
quest: Fishing Contest
key: fishing_contest
status: passed
tested:
tester: agent
model:
commit:
cache: osrs-241_2026-10-20
start: checkpoint
travel:
---

# Fishing Contest

Natural route linked across saved checkpoints to the Vestri trophy hand-in. Reward was not duplicated and the post-quest tunnel worked.

## Findings

The contest closes after three successful catches and automatically hands in the
available fish caught during that round. The result uses the existing Bonzo
dialogue; its automatic presentation and exact timing are not captured retail
evidence. After a loss, using Bonzo's existing Pay interaction reopens a round
without charging another fee, as a compatibility recovery policy. Bait and
Talk-to give estimated guidance to that option when the round is closed. A
manual regular-fish hand-in also closes the losing round. Inventory
items of the same id cannot be distinguished if fish are dropped or exchanged;
the hand-in is capped at the round's recorded catches.

## Runs

### date not recorded · agent · model not recorded

- **Source:** issue [#728](https://github.com/RSPSApp/tsps/issues/728) active (q041); moved here from its ledger on 2026-10-29. Proven against plugin hashes, not a commit, so a later plugin change is not flagged automatically.
- **Start:** checkpoint: stage 0->1, continued to 4, completed after later restarts.
- **Result:** varp 11 = 5; QP +1, Fishing +2,437.5 XP; trophy consumed.
- **Checked:** repeat (no duplicate), relog/save, post-quest tunnel descent.
- **Not checked:** Recovery, full-bag and overlay unchecked; Later plugin edits and uncovered recovery need rechecks.
- **PRs:** [#1122](https://github.com/RSPSApp/tsps/pull/1122).
