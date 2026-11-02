---
quest: Nature Spirit
key: nature_spirit
status: untested
tested:
tester:
model:
commit:
cache:
start:
travel:
---

# Nature Spirit

No native playthrough recorded; natural completion pending.

## Findings

Early entrance clicks used to move the player underground before the ritual, while Filliman
remained outside. Before stage 60, Enter now summons the outside actor without moving the player;
entry after the ritual still moves into the grotto. Players already inside can use the existing
Exit and resume outside. This follows the [Wiki walkthrough](https://oldschool.runescape.wiki/w/Nature_Spirit?oldid=15372142)
and its [entrance transcript](https://oldschool.runescape.wiki/w/Transcript:Nature_Spirit?oldid=15371590).

The existing q082 fixture exercises native object packets, actual cache routing, owner-only NPC
spawns and PlayerSession sync views. It covers early attempts before/after the gate, repeated
clicks, exit recovery, logout/login and ritual/post-quest entry. The old handler fails the early
entry assertion. This is offline verification, not a complete natural quest playthrough.

## Runs

No run yet. Tracked in issue [#728](https://github.com/RSPSApp/tsps/issues/728) active (q082); PRs: [#1147](https://github.com/RSPSApp/tsps/pull/1147).
