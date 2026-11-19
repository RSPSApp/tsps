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

- **fixed** (2026-11-05) The Tome of Experience published only its saved chapter count in quest
  attributes. Capture 1637 raises `myq5_xp_reward` (varbit 10346) 1-3 for the first three chapters
  and `myq5_bonus_xp_reward` (varbit 14611) 1-3 for the last three (ticks 7398-7424, lines
  135530-135870), with both at 0 after completion. The plugin now sends and restores both varbits.
  Covered by `server/tests/remaining-morytania-parity.test.cjs`.
- **fixed** `myq5_lab_sc_unlocked` (varbit 13719) was published as 1 from stage 58, but capture
  1637 leaves it **0 for the entire run**, including inside and after the laboratory. The send was
  removed from `syncVisuals`; login now leaves the cache default in place. Covered by
  `server/tests/sins-qh-actions.test.cjs`.

- **fixed** (2026-11-19) Damien Leucurte's magical fires were missing: the fight had no fires
  and nothing handled `myq5_damien_fire_small` (loc 37996, "Magical Fire", Stamp-out). Now
  `server/plugins/quests/quests/Fires.SinsOfTheFather.js`. Covered by
  `server/tests/sins-damien-fires.test.cjs` and `server/tests/sins-qh-actions.test.cjs`.

## Damien's magical fires

rsprox captures: the user's local 1000270 (rev 227, ticks 6281-6344), rsprox.net 102 (ticks
3534-3629) and 1637 (ticks 4940-5064).

- **Cast:** Damien (`myq5_damien_combat`, 9564) faces the fire's tile and plays
  `human_castenfeeble` (728); two ticks later `myq5_damien_fire_small` appears there (shape 10,
  any rotation) with `sound_area 2596`. The cast takes one of his 5-tick attack turns.
- **Cadence:** fires at +15/+45 (1000270), +30/+60 (102) and +30/+70/+110 (1637) ticks after he
  turns hostile: 30 or 40 ticks apart. Tiles used: (3717-3722, 3355-3360, 1).
- **Effect:** `Your attacks seem to have reduced effect on Damien.` once per fire, as the
  player's next attack lands; 102 has no message because the player stamped the fire before
  attacking again. Wiki: the fires reduce the damage dealt to him and he becomes "increasingly
  resistant"; he can still be killed with one burning.
- **Stamp-out:** `human_stamp` (794) on arrival, a tick later `sound_area 1446` at the fire and the
  loc is gone (`invisible_type8_nonblocking`).
- **Death:** Damien's removal clears the fires still burning (1000270 tick 6344).
- **Ours:** a cast every 30 ticks, the first 28 ticks after the fight starts; leaving the fight
  (more than 15 tiles from Damien, or off his floor) puts the fires out and the count starts over
  on return; a free tile from the recorded area; 20% less player damage per burning fire (no source gives a figure; hits with one
  fire burning averaged about 80% of those without in 1000270). The cast does not yet replace
  Damien's attack on that turn. Not added: the big fire at (3722, 3357, 1)
  (`myq5_damien_fire_noop` 37994 before the fight, `myq5_damien_fire` 37995 from it, with
  Escape/Quick-escape options nobody recorded).

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
