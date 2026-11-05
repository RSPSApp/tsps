---
quest: Royal Trouble
key: royal_trouble
status: in-progress
tested: 2026-11-05
tester: agent
model: DeepSeek V4.1 Flash
commit: 4f630dec1
cache: osrs-241_2026-10-20
start: fresh
travel: not run
---

# Royal Trouble

Capture/source audit of archive recording **91** (revision 227, Leagues V). The recording has its
own start and completion messages, so the quest section is a real run. A full native route was not
replayed in this pass; the captured completion clears and counters were mirrored and unit-tested.

## Findings

- **fixed** Completion now clears `royal_coalinengine` (varbit 2156) to **0**. Capture 91 loads
  five coal (1-4 at ticks 21422-21430, then 0 at completion, line 473531). The plugin left the
  persisted value at 5, so a client that reads the bit still showed coal in the engine.
- **fixed** `royal_etc_totalitemsreturned` (varbit 2158) is now **6** when Sigrid hands over her
  letter (tick 21965, line 471946) and **0** on completion (tick 22002, line 473530), as captured.
- **fixed** `royal_misc_knowaboutteens` (varbit 2161) is now set with the final Vargas turn-in and
  left **1** after completion, as captured at tick 21981, line 472571.
- **fixed** Reading the burnt diary marked all five `royal_misc_diarychapterNread` bits. Capture 91
  reads the complete diary once (item 7965, tick 21559) and sets only `diarychapter1read`
  (varbit 2149); the next read advances to chapter 2. Each read now marks the next unread chapter,
  and login restores the same mask.
- Covered by `server/tests/remaining-miscellania-parity.test.cjs`.

## Runs

### 2026-11-05 — capture/source audit

- **Capture:** [RSProx 91](https://rsprox.net/download/91), revision 227, Leagues V. Start message
  at tick 20580, line 444493; stage first set at line 444492. Completion message at tick 22002,
  line 473517; the completion varp block is lines 473513-473531.
- **Wire:** varbit 2140 `royal_quest` in varp 730 bits 0-9: `10` (start) -> `20` (partner) ->
  `30` (complete). `royal_misc` (2141): `10, 20, 30, 40, 50, 60, 80, 90, 100, 110, 120, 130`.
  `royal_etc` (2142): `10, 20, 40`.
- **Auxiliary bits:** `royal_liftstage` 1-9, `royal_coalinengine` 1-5 then **0**,
  `royal_misc_numberofchapters` 1-5, `royal_misc_ropeloc` 1, `royal_meddlingkids_cutscene` 1,
  `royal_etc_totalitemsreturned` 6 then **0**, `royal_misc_knowaboutteens` 1. Completion also
  clears both `villagers_aboutthefts` bits and `diarychapter1read`.
- **Not checked:** a full native playthrough, the lift build order as a real player, the kids
  cutscene visuals, the sea snake fight, reward pacing, and audio/jingle parity. The diary read
  count is inferred from the single captured read; a second read is unit-tested, not observed.
