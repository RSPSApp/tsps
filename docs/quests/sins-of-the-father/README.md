---
quest: Sins of the Father
key: sins_of_the_father
status: in-progress
tested: 2026-11-03
tester: agent
model: DeepSeek V4.1 Flash
commit: eaeda7f9f
cache: osrs-241_2026-10-20
start: fresh
travel: not run
---

# Sins of the Father

Capture/source audit of archive recording **1637** (revision 226.1, main world). The capture has
its own start and completion messages, so it is a real quest run. A full native route was not
replayed in this pass; the recorded stages, auxiliary varbits and the plugin's login mirror were
compared and one login mismatch was fixed.

## Findings

- **fixed** `myq5_lab_sc_unlocked` (varbit 13719) was published as 1 from stage 58, but capture
  1637 leaves it **0 for the entire run**, including inside and after the laboratory. The send was
  removed from `syncVisuals`; login now leaves the cache default in place. Covered by
  `server/tests/sins-qh-actions.test.cjs`.

## Runs

### 2026-11-03 — capture/source audit

- **Capture:** [RSProx 1637](https://rsprox.net/download/1637), revision 226.1, world 367,
  `rsprox-1637.bin` size 1,878,582, SHA-256
  `D8BB6476C210CF18A2592C74F523175B29928D373109C102D3C46EB3E5570181`.
  Start `RunClientScript` at tick 1021, line 14058; stage varbit first set at tick 1023,
  line 14072. Completion message at tick 7330, line 134897. Relied on lines ~14050-134940.
- **Wire:** varbit 7255 `myq5` in varp 2712 bits 0-8. Captured stage sequence:
  `0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32, 34, 36, 38, 40, 42, 44, 46,
  48, 50, 52, 54, 56, 58, 60, 62, 64, 66, 68, 70, 72, 74, 76, 78, 80, 82, 84, 86, 88, 90, 92,
  94, 96, 98, 100, 102, 104, 106, 108, 110, 112, 114, 116, 118, 120, 122, 124, 126, 128, 130,
  132, 134, 136, 138`.
  The plugin's saved stages are a subset of these milestones; the wire value it sends for each
  named stage matches the capture.
- **Auxiliary bits at completion (capture):** `myq5_xp_reward=3`, all five convinced bits `1`
  (Polmafi `2`), Kroy tables `2/2`, `myq5_trader_sven_met=1`, `myq5_puzzle_completed=1`,
  `myq5_lab_sc_unlocked=0`. Login mirrors the convinced bits, both tables, Trader Sven and the
  puzzle bit; `13719` is deliberately left at 0.
- **Not checked:** a full native playthrough, full-bag tome reclaim, the Carl follow and Ivan
  trek, the Kakurasu door, the Vanstrom fight, cutscene visuals, audio/jingle parity, and the
  secondary `myq5_veliaf_location` / hideout / `myq5_xp_reward` bits (the capture toggles them
  non-monotonically, so no login derivation was added).
- **Quest Helper:** the bridge token/bridge install were not available in this worktree, so the
  helper was not re-run headless. The pinned source (`06da90f982518a093f2fe1c9cfac5547fa7053d3`)
  was checked for the convinced/table varbits only.
