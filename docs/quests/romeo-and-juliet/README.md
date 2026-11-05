---
quest: Romeo & Juliet
key: romeo_and_juliet
status: passed-with-issues
tested: 2026-10-25
tester: community
model:
commit:
cache: osrs-241_2026-10-20
start:
travel:
---

# Romeo & Juliet

Community-reported completion accepted for scheduling (skip full manual replay). Retained caveat: Scenes and optional dialogue were missing; completion was possible.

## Findings

- **open** Scenes and optional dialogue were missing; completion was possible. [#1257](https://github.com/RSPSApp/tsps/pull/1257)

## Runs

### 2026-11-02 — agent — Claude Opus 5.5

- **Skipped:** No rsprox database capture covers the quest route. The only varp 144 change
  (recording 3276) is the full varp resend after a reconnect, already at 100; Juliet, the
  cadava potion and the quest dialogue appear in no recording. Not replayed.

### 2026-10-25 · community (thehardcorenoobs1234) · model not recorded

- **Source:** community report ([#1257](https://github.com/RSPSApp/tsps/issues/1257)); moved here from its ledger on 2026-10-29. Proven against plugin hashes, not a commit, so a later plugin change is not flagged automatically.
- **Not checked:** Single account/run report; no full Quest Helper, recovery, multiplayer, dialogue, event or cutscene parity claim.
