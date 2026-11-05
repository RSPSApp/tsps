---
quest: The Feud
key: the_feud
status: untested
tested:
tester:
model:
commit:
cache:
start:
travel:
---

# The Feud

No native playthrough recorded; natural completion pending.

## Findings

Newest first. One line each, linked to its issue or PR when there is one.

- **fixed** The stage was sent as feud_var unchanged, one step behind Quest Helper from 8 on, so after hiding behind the cactus the helper still said to hide. Stages now send Quest Helper's step numbers (`FEUD_VAR_BY_STAGE`). The cactus also plays its "feel a little silly" line outside the stake-out instead of doing nothing. [#1711](https://github.com/RSPSApp/tsps/issues/1711)

## Runs

No run yet. Tracked in issue [#728](https://github.com/RSPSApp/tsps/issues/728) active (q039); PRs: [#1177](https://github.com/RSPSApp/tsps/pull/1177).
