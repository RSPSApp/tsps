---
quest: Beneath Cursed Sands
key: beneath_cursed_sands
status: in-progress
tested: 2026-11-03
tester: agent
model: DeepSeek V4.1 Flash
commit: eaeda7f9f
cache: osrs-241_2026-10-20
start: fresh
travel: not run
---

# Beneath Cursed Sands

Capture/source audit of archive recording **101** (revision 227.1, Leagues V). The recording
contains its own start and completion messages, so the BCS section is a real run, not a completed
login. A full native route was not replayed in this pass; login restoration for the pillar/tomb
and lily varbits was fixed and unit-tested.

## Findings

- **fixed** Login restored only `13844` (entry), `13847` (mould), `13850` (lily) and the owed
  item bits. It now also restores the captured `13845` (citizen talked), `13846` (pillar found),
  `13848` (tomb found), `13849` (rotation solved, **15**) and `13851` (completion type **2**).
- **fixed** `bcs_lily_type` (13850) returned `2` at stage 108, but capture 101 drops it to **0**
  on completion. It now returns 0 once the quest is complete.
- Covered by `server/tests/remaining-desert-parity.test.cjs`.

## Runs

### 2026-11-03 — capture/source audit

- **Capture:** [RSProx 101](https://rsprox.net/download/101), revision 227.1, Leagues V,
  `rsprox-101.bin` size 9,262,945, SHA-256
  `4C6BA8BDEF146CFE63A2CDF645A1F31BED50B69F510EBC65803A2C599A40413D`.
  Start `RunClientScript` at tick 8778, line 160794; stage first set at tick 8780, line 160835.
  Completion message at tick 11030, line 215651. Relied on lines ~160790-215700.
- **Wire:** varbit 13841 `bcs` in varp 3421 bits 0-8. Captured stage sequence:
  `0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32, 34, 36, 38, 40, 42, 44, 46,
  48, 50, 52, 54, 56, 58, 60, 62, 64, 66, 68, 70, 72, 74, 76, 78, 80, 82, 84, 86, 88, 90, 92,
  94, 96, 98, 100, 102, 104, 106, 108`.
- **Auxiliary bits at completion (capture):** `13844=1`, `13845=1`, `13846=1`, `13847=4`,
  `13848=1`, `13849=15`, `13850=0`, `13851=2`, `13852=0`, owed items `0/0`, excavation `0`.
  A targeted MCP completion fixture relogged to varp 3421 = **276713580**; adding the captured
  citizen bit (13845 = 8192, skipped by the fixture) gives the recorded **276721772** exactly.
  The fixture reproduced `13844=1`, `13846=1`, `13847=4`, `13848=1`, `13849=15`, `13850=0`,
  `13851=2` on relog.
- **Rewards observed by the fixture:** 2 quest points, 50,000 Agility XP, no duplicate on repeat
  completion. The Keris partisan/circlet and full-bag owed path were not exercised live.
- **Not checked:** a full native playthrough, the necropolis guard fight, furnace/pillar/urn
  puzzles, the champion and Akh fights, the cure chemistry, full-bag owed partisan/circlet
  recovery, cutscene visuals, and audio/jingle parity.
- **Quest Helper:** bridge unavailable; pinned source `06da90f982518a093f2fe1c9cfac5547fa7053d3`
  confirms `BCS_EMBLEM_ROTATION` must be **15**, which the login mirror now restores.
