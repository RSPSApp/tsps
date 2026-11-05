---
quest: While Guthix Sleeps
key: while_guthix_sleeps
status: untested
tested:
tester:
model:
commit:
cache:
start:
travel:
---

# While Guthix Sleeps

Deferred on 2026-10-23 as long/complex; no native playthrough recorded.

## Findings

- **open** (2026-11-05, source audit of capture 1698) The plugin sends its internal checkpoint
  values (10, 30, 40, 100, ...) directly as the `wgs` varbit (9653, varp 4092 bits 0-9). Capture
  1698 records the native ladder `2, 3, 4, ..., 44, 410, 420, ..., 780`, so the client and Quest
  Helper read non-native values between checkpoints. A stage-to-native map (as in The Blood Moon
  Rises and Desert Treasure II) is still needed; it was not changed here because the quest has no
  native playthrough to validate the mapping.
- None otherwise recorded.

## Runs

No run yet. Tracked in issue [#728](https://github.com/RSPSApp/tsps/issues/728) deferred (q126); PRs: [#1189](https://github.com/RSPSApp/tsps/pull/1189).
