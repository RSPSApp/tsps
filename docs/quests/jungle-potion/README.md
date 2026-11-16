---
quest: Jungle Potion
key: jungle_potion
status: passed
tested:
tester: agent
model:
commit:
cache: osrs-241_2026-10-20
start: checkpoint
travel:
---

# Jungle Potion

All herbs including the Rogue's Purse from Pothole Cave were gathered and handed to Trufitus naturally. Rewards paid once; lost-herb recovery gave no extra progress.

## Herb searches (rsprox captures)

From the user's rev 242 Jungle Potion run (local JunglePotion.bin, rsprox index local 1002225) and rsprox.net
1148, 1875 (snake weed) and 3030 (sito foil):

- Every herb loc: a spam line `You search the vine...` / `palm...` / `scorched earth...` / `rock...` /
  `wall...`, then `You find a herb.` in an objectbox (193) showing the grimy herb. The loc becomes its empty
  variant for everyone (snake_vine_empty 2576, ardrigal_palm_empty 2578, sito_soil_empty 2580,
  volencia_moss_rock_empty 2582, rogues_purse_cave_empty 6840).
- It grows back 99 ticks later: six vines in 1875 and one in 1148, and the scorched earth in 3030 (tick 1750
  to 1849). The palm, rock and fungus wall were never seen growing back; ours use the same 99 ticks.
- Marshy jungle vine: seq 2094 (human_openingchest_mid) and sound 1957 on each attempt, the roll 10 ticks
  later. A miss plays sound 1957 again and the next attempt starts one tick after, so a find lands at 10 or
  21 ticks. 27 finds took 30 rolls across the three recordings, so ours is 0.9 (fitted). The Wiki's
  Jungle Potion/Quick guide says "Your character may spend several minutes finding a herb"; every recorded search found the
  herb in 10 or 21 ticks, so the code follows the recordings and the Wiki's figure is a noted difference.
- Palm tree, scorched earth and rock: the line and the find on the same tick, with no animation.
- Not done: the fungus covered wall plays pick_wall start/middle/end (2096/2097/2098) and finds the herb 5 to 17
  ticks after the search in the local run, with a moss giant attacking; no clean cadence fits, so it still finds
  the herb at once. The Wiki's Quick guide says the wall "may take up to a minute"; ours differs from
  both the recording and the Wiki here.

## Findings

None recorded.

## Runs

### date not recorded · agent · model not recorded

- **Source:** issue [#728](https://github.com/RSPSApp/tsps/issues/728) active (q063); moved here from its ledger on 2026-10-29. Proven against plugin hashes, not a commit, so a later plugin change is not flagged automatically.
- **Start:** checkpoint: fresh stage-0 prefix to varp 175 = 9, resumed after a server restart.
- **Result:** varp 175 = 12; QP 4->5, Herblore +775 quest XP (+10 cleaning XP).
- **Checked:** repeat dialogue, relog, save history, logout/offline, lost-herb re-search recovery.
- **Not checked:** Full-bag, interrupted hand-in and pre-start/stale-slot recovery unchecked; Overlay unchecked.
- **PRs:** [#1135](https://github.com/RSPSApp/tsps/pull/1135).
