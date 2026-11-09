---
quest: A Porcine of Interest
key: a_porcine_of_interest
status: passed-with-issues
tested: 2026-11-09
tester: agent
model: claude-sonnet-5-5
commit: 60eec1ff1
cache: osrs-242_2026-11-03
start: fresh
travel: travel_to (walks skipped)
---

# A Porcine of Interest

Played start to finish against rsprox capture 1693: every stage value, dialogue line and prompt matched. The audit found and fixed the cave rope and two message differences. The first-time kill needed a raised Hitpoints level (the Sourhog kills a level-10 account), so the fight itself was not played at a natural level.

## Findings

- **fixed** The trail objects (hole 40341, cart 40346, cabbages, potatoes, carrots, dead trees) and the Sourhog cave entrance did not draw in the browser client, so the quest could not be progressed: multilocs failed to decode since cache 242. Fixed by [#4007](https://github.com/RSPSApp/tsps/pull/4007); verified here on a branch that includes it. [#4011](https://github.com/RSPSApp/tsps/issues/4011), [#4009](https://github.com/RSPSApp/tsps/issues/4009).
- **fixed** The cave rope (loc 40330) is named "Rope", so the generic ladder handler claimed it before the quest's. With the Sourhog dead and the foot uncut the player could climb out instead of getting Spria's warning, and the quest's cave exit never ran. The quest now intercepts it first.
- **fixed** Climbing the rope sent no chat line. Capture 1693 has "You climb down the rope." and "You climb up the rope.".
- **fixed** Saying Yes to the blockage warning put the wiki stage direction "The player climbs over the blockage." in the chat box. The capture sends nothing.
- **open** The optional Ned-shop rope path failed, so rope was supplied as a declared item.
- **fixed** Foot and Sarah wire values were corrected to match source.

## Runs

### 2026-11-09 · agent · claude-sonnet-5-5

- **Source:** rsprox capture 1693 (ticks 101-725), compared line by line with the live run.
- **Start:** fresh account, placed at the Draynor notice board with `::tele` (the only teleport); every later leg used `travel_to`.
- **Route:** notice board, Sarah, damaged cart, rope on the strange hole, blockage, skeleton note cutscene, Spria in Draynor (goggles), back down with goggles worn, Sourhog, foot, blockage and rope up, Sarah's bounty, Spria.
- **Result:** the quest varp 2748 stepped through 5, 10, 15, 20, 25, 30, 94, 99 and 104 exactly as in the capture (the live varp also carries the cart-inspected and corpse bits). Slayer +1,000 XP, 5,000 coins.
- **Checked:** notice board, Sarah (including the topic menu), skeleton cutscene and Spria rescue (no black screen), goggles warning, blockage prompt, death in the cave and return, foot dialogue and walking away after cutting it, climbing out with the Sourhog dead and the foot uncut, completion.
- **Not checked:** slayer helm upgrade lines, full-bag and cancellation branches, the Ned-shop rope path, relog at each stage, and a natural-level fight. The Sourhog was dropped to 1 hitpoint after the real encounter started, with the player's Hitpoints and Attack levels raised.
- **PRs:** this branch (fix/4011-porcine-cart).

### 2026-10-23 · agent · model not recorded

- **Source:** issue [#728](https://github.com/RSPSApp/tsps/issues/728) active (q088); moved here from its ledger on 2026-10-29. Proven against plugin hashes, not a commit, so a later plugin change is not flagged automatically.
- **Start:** checkpoint: fresh stage-0 prefix continued after a server restart.
- **Result:** varbit 10582 = 40; QP 0->1, Slayer +1,000 XP, coins +5,000, 30 Slayer points.
- **Checked:** post-quest task dialogue (no double points), relog, save history, logout/offline.
- **Not checked:** Helm upgrade, full-bag and cancellation branches unchecked; No overlay proof.
- **PRs:** [#1151](https://github.com/RSPSApp/tsps/pull/1151).
