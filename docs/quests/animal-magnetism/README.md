---
quest: Animal Magnetism
key: animal_magnetism
status: untested
tested:
tester:
model:
commit:
cache:
start:
travel:
---

# Animal Magnetism

No native playthrough recorded; natural completion pending.

## Capture search

RSProx database and issue #600 capture list checked on 2026-11-03: no Animal Magnetism
recording was found. The database has only post-quest Ava's-device messages and the
`Ava's Odds and Ends` shop; no quest start/completion message, quest dialogue or `anma_main`
(3185) progression. No capture audit was possible, so the quest was skipped.

## Findings

- **fixed** Ava's Devices option only offered the upgrade dialogue. It now opens Ava's Devices (interface 67) with Buy-1/5/X/All for the attractor (999 coins), accumulator (75 steel arrows, 50 Ranged, 999 coins or an attractor) and assembler (Vorkath's head, 75 mithril arrows, Dragon Slayer II, 4,999 coins or an accumulator); only unnoted, uncharged items pay. The cost text beside each device follows the Wiki's interface image: each part the player can't pay is struck through. [Ava](https://oldschool.runescape.wiki/w/Ava). Fixed in #3796.

## Runs

No run yet. Tracked in issue [#728](https://github.com/RSPSApp/tsps/issues/728) active (q001); PRs: [#1092](https://github.com/RSPSApp/tsps/pull/1092).
