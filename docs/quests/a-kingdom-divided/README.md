---
quest: A Kingdom Divided
key: a_kingdom_divided
status: in-progress
tested: 2026-11-03
tester: agent
model: DeepSeek V4.1 Flash
commit: e21c6b5f1
cache: osrs-241_2026-10-20
start: fresh
travel: not run
---

# A Kingdom Divided

Source/cache and Quest Helper audit. **No usable capture exists in the RSProx archive**: no
recording contains this quest's own start or completion message, and the archive index has no
hit for its stage varbit or parent varp. A full native route was not replayed.

## Findings

- **open / unverified** The durable stage ladder uses eight values that the native quest never
  holds: `1` (started), `11` (Fullore in Kingstown), `25` (Fullore outside), `35` (note found),
  `57` (assassin), `65` (settlement panel done), `67` (Faun talk) and `119` (lookout).
  `::quest a_kingdom_divided <stage>` at each of those values leaves the pinned Quest Helper
  with **no step** (`helperStatus: unavailable`), because its `loadSteps` keys are the even
  values 0-150 and the cache's 12296 transform thresholds are even too. Every even durable
  stage does resolve a helper step. Changing the wire mapping to round those eight states to
  the next native value would fix the blank panel, but it needs a real AKD capture first
  (none exists) so the change is not made in this pass.
- **checked** `varbitValue` is not defined, so the durable stage is sent straight to varbit
  12296. Every even durable stage matches its helper key; the completion stage 150 equals the
  cache DB row 81 completion threshold 150.
- **checked** Login re-sends the stage-driven transform varbits: `tomas_lawry_location`
  (12144), `piscquest_queen_vis` (12145), `orson_lookout` (12311), the five `*_helped` bits
  (12318-12322), the receipt/confirmation/map/order/lie clue bits (12298-12302) and the
  funeral flag (12310). The Quest Helper's conditional steps read these, and the stage sweep
  found no disagreement at an even stage.
- **unchecked** No capture means the exact wire value at each stage transition, the quest's
  start/completion chat text, its reward scroll wording, and the shared-NPC transforms over
  time are not verified against live OSRS.

## Capture-search note

Searched `type 14` text `A Kingdom Divided` (34 submissions, all revision 230, May 2025) and
`new quest` (the same 34). Every match is the Yama warning sign: submission 2954 decoded to
`IfSetText interfaceId=378 componentId=6` ("Yama awaits those who have completed A Kingdom
Divided..."). None is the quest's own start/completion message. The archive also returned
**0** for varbit 12296, varbit 12297-12302/12311/12318/12319, varp 3063, NPC 10928 (Tomas
Lawry), 10890 (Martin Holt), 10922 (Fullore), 10943 (Orson) and 11112 (Istoria). Submission
2954 `rsprox-2954.bin` SHA-256 is not committed; it was decoded only to identify the sign.

## Runs

### 2026-11-03 — source/cache/helper audit

- **Start:** none played. A fixture account was moved through every durable stage with
  `::quest` to compare the wire value and the helper step; it is not a playthrough.
- **Wire:** varbit 12296 `akd` in varp 3063 bits 0-8; cache DB row 81 completes at **150**.
  Stages are sent unchanged: `0, 1, 10, 11, 12, 18, 24, 25, 30, 34, 35, 36, 42, 50, 52, 56,
  57, 58, 60, 62, 64, 65, 66, 67, 70, 74, 78, 82, 84, 88, 90, 92, 94, 104, 106, 110, 119,
  122, 138, 146, 148, 150`.
- **Rewards (source):** 2 Quest Points, the Book of the Dead and two antique lamps (10,000 XP
  each, level 40+); the plugin matches the Wiki. Not observed live.
- **Not checked:** the whole route (Martin Holt, Tomas Lawry's house, Fuggy, Judge of Yama,
  Rose's diary, Forthos/Settlement/Faun puzzles, Orson, Kaht B'alam, Xamphur, the five House
  tasks), rewards, repeat/relog, recovery, post-quest dialogue, visuals and jingle.
