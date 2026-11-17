---
quest: Fight Arena
key: fight_arena
status: passed
tested: 2026-10-23
tester: agent
model:
commit:
cache: osrs-241_2026-10-20
start: checkpoint
travel:
---

# Fight Arena

Checkpoint-linked natural route including the real Khazard encounter and jail action. Rewards and saves were independently checked.

## The fights (rsprox captures)

From rsprox recordings local 1002138 (rev 242, the whole quest, ticks 11229-12445) and local 1001680
(rev 241, the same). Both players escaped Khazard's fight through the door, so neither recording has
Khazard's defeat.

- **Each fight is its own copy of the arena:** `rebuild_region` from 2552,3104 (13 x 13 chunks, every
  plane) as the ogre (tick 11838), scorpion (11991), Bouncer (12036) and Khazard (12204) fights start.
  The cutscenes before them are separate copies, and the jail is on the real map.
- **What the copy holds:** the arena building's own NPCs (guards, slaves, Hengrad, Joe, Kelvin, the
  Spectator, the stand), resolved at the player's stage, and the beasts still to come caged as their
  cutscene versions facing west (`arena_scorpion_cutscene` 2608,3159, `arena_bouncer_cutscene`
  2608,3162). There's no caged copy of the beast being fought. In Khazard's copy, Khazard
  (`general_khazard` 12025) stands at 2600,3153 facing north and the stand form isn't there.
- **Start tiles:** the player at 2605,3153 (ogre), 2604,3155 (scorpion, Bouncer) and 2601,3156
  (Khazard). The beast at 2602,3165 (ogre), 2601,3159 (scorpion), 2603,3162 (Bouncer), facing west.
  The ogre walks out at once, and Khazard hits first (tick 12206).
- **The escape door:** the arena door becomes `fightarena_door2_escape` (46563) at 2606,3152, shape 9,
  rotation 0. Escape asks "Are you sure you want to leave?" Yes./No. (tick 12211, 7948). Yes fades out
  at once, moves the player to 2607,3151 on the real map two ticks later (7951) and fades in two after
  that (7953). The stage stays: the rev 242 player escaped at stage 12 and was paid by Lady Servil.
- **The stand on the real map** (tick 11113, stage 9): `general_khazard_arena` 2600,3153,
  `justin_servil_khazard` 2602,3153, `sammy_servil_arena` 2603,3153 and `arena_guard_family` 2606,3154
  facing north-west. All are multinpcs on `arenaquest`; the guard shows at stages 9-11.
- **Not recorded:** Quick-escape (taken as Escape without the question), re-entering the arena (the
  Wiki transcript's "Return to the arena?" Yes./No. on the arena door, timed here like the escape in
  reverse), and Khazard's defeat.

## Findings

None recorded.

## Runs

### 2026-10-23 · agent · model not recorded

- **Source:** issue [#728](https://github.com/RSPSApp/tsps/issues/728) active (q040); moved here from its ledger on 2026-10-29. Proven against plugin hashes, not a commit, so a later plugin change is not flagged automatically.
- **Start:** checkpoint.
- **Result:** varp 17 = 14; QP 0->2, coins +1,000, Attack +12,175, Thieving +2,175.
- **Checked:** repeat dialogue, relog, logout/offline.
- **Not checked:** Combat aid used after the Khazard encounter began; No full-branch or overlay claim.
- **PRs:** [#1121](https://github.com/RSPSApp/tsps/pull/1121).
