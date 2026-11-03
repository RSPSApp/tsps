---
quest: Witch's Potion
key: witchs_potion
status: passed
tested: 2026-11-03
tester: agent
model: DeepSeek V4.1 Flash
commit: ee56b90ad
cache: osrs-241_2026-10-20
start: fresh
travel: travel_to
---

# Witch's Potion

Fresh stage-0 run to completion on the captured F2P route, including the quest-only rat's
tail drop and the cauldron drink. No capture mismatch found.

## Findings

None recorded.

## Runs

### 2026-11-03 · agent · DeepSeek V4.1 Flash

- **Source:** `ee56b90ad`; capture route from issue #600's F2P archive
  `20260815T221841-59bcb26.bin` (rev 240, 15 August 2026), as summarised in
  [f2p-coastal-parity.md](../../f2p-coastal-parity.md#witchs-potion).
- **Start:** fresh account, stage 0, placed in Rimmington with `::tele` before the first
  interaction. Ordinary supplies: eye of newt, onion and burnt meat supplied by `item`; the
  rat's tail was earned normally.
- **Route:** Hetty start menu (native Yes/No) → the ingredient line set varp 67=1 and the
  start message → killed a level-1 rat and picked up its quest-only tail (300) → returned with
  all four ingredients → hand-over statement, then `Ok, now drink from the cauldron.` removed
  the four items and set 67=2 → `Drink-from` the cauldron showed its statement, then 67=3.
- **Result:** 1 quest point and 325 Magic XP; repeat `Drink-from` gave the refusal line and no
  duplicate reward; relog kept 67=3 and the XP; post-quest Hetty dialogue worked.
- **Not checked:** Partial-ingredient dialogue conditions, a full inventory at hand-in, and
  the alternative witch dialogue branch were not replayed live. The rat drop was observed
  once; its "only while in progress / only without a tail" guards are source-reviewed.
