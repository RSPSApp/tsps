---
quest: Biohazard
key: biohazard
status: in-progress
tested:
tester: agent
model:
commit:
cache: osrs-241_2026-10-20
start:
travel:
---

# Biohazard

Native attempt stopped at stage 1 and logged out; no completion.

## Findings

- **fixed** Mourners inside the headquarters, outside while wearing the medical gown, and the sickest mourner upstairs (9008) used the wrong transcripts; the sickest mourner's attack actions start the fight. The back door (2036 at 2551, 3328) stays locked from both sides with its transcript, and the trapdoor (8783 at 2542, 3327) is refused only during Biohazard, so Mourning's End Part I keeps it. Ardougne castle's main staircase (15645/15648 at 2571, 3295) arrives on walkable landings both ways. [Quick guide](https://oldschool.runescape.wiki/w/Biohazard/Quick_guide). Fixed in #3796.
- **open** A courier who disposed of the wrong vial could not get a replacement; repair in progress.
- **open** Premature Guidor advancement was returned to the owner.

## Runs

### date not recorded · agent · model not recorded

- **Source:** issue [#728](https://github.com/RSPSApp/tsps/issues/728) active (q007); moved here from its ledger on 2026-10-29. Proven against plugin hashes, not a commit, so a later plugin change is not flagged automatically.
- **Result:** stage 1 (varp 68).
- **Not checked:** No reward/QP/XP proof; Later source fixes do not validate the old run.
- **PRs:** [#1098](https://github.com/RSPSApp/tsps/pull/1098).
