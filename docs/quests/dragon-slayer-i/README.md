---
quest: Dragon Slayer I
key: dragon_slayer_i
status: passed-with-issues
tested: 2026-10-25
tester: community
model:
commit:
cache: osrs-241_2026-10-20
start:
travel:
---

# Dragon Slayer I

Community-reported completion accepted for scheduling (skip full manual replay). Retained caveat: Some optional dialogue was incomplete or missing; completion was possible.

## Findings

- **open** Some optional dialogue was incomplete or missing; completion was possible. [#1257](https://github.com/RSPSApp/tsps/pull/1257)

## Runs

### 2026-11-02 — agent — DeepSeek V4.1 Flash

- **Skipped:** No rsprox database capture covers the quest route. The archive has journal
  text, Oziach's clue-scroll dialogue, post-quest Crandor visits and unrelated Melzar
  sightings, but no captured start, voyage, maze, Elvarg fight or hand-in. Not replayed.

### 2026-10-25 · community (thehardcorenoobs1234) · model not recorded

- **Source:** community report ([#1257](https://github.com/RSPSApp/tsps/issues/1257)); moved here from its ledger on 2026-10-29. Proven against plugin hashes, not a commit, so a later plugin change is not flagged automatically.
- **Not checked:** Single account/run report; no full Quest Helper, recovery, multiplayer, dialogue, event or cutscene parity claim.
- **PRs:** [#1112](https://github.com/RSPSApp/tsps/pull/1112).
