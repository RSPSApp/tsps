---
quest: Waterfall Quest
key: waterfall_quest
status: passed-with-issues
tested: 2026-10-29
tester: agent
model: grok-4.7
commit: 62d662706242
cache: osrs-241_2026-10-20
start: fresh
travel: travel_to
---

# Waterfall Quest

A fresh account finished the quest on the normal route, including the chalice reward, Almera's repeat talk, and a relog. Leaving the raised room and the dungeon needed quest fixes. `travel_to` still cannot cross the Tree Gnome Village dungeon or the raised-room door by itself.

## Findings

- **fixed** Dismissing the raft or downstream arrival message left movement blocked until logout. Closing the chatbox now ends the travel beat.
- **fixed** Raised-room doors 2002 at 2606,9892 and 2604,9900 swung into a disconnected pocket. Open returns to 2566,9900, on the exit side of the lower door.
- **fixed** Inside dungeon door 2000 at 2575,9861 swung in place. Open returns to the ledge at 2511,3463.
- **fixed** ([#1699](https://github.com/RSPSApp/tsps/issues/1699)) Crossings played no animations. Rope on the rock now plays the captured `map_anim` `rope_piece` (67, delay 3) at 2512,3474. The roped rock and rope pieces appear a tick later, and one piece goes per tick behind the player. The rock reverts with the last piece (rsprox 1533, rev 224, another player crossing south). These parts are **unverified** because no capture shows them: the throw `human_throwrope` (774), the northward throw tile 2512,3470, the swim `human_swim` (772), the barrel `barrel_fall_play` (4188), and the dead tree to the ledge as a 3-tick exact move with `human_wading` (776).
- **open** `travel_to` reports no route through the Tree Gnome Village dungeon from the ladder landing 2533,9556 to Golrie's crate, while a plain walk exists.
- **open** `travel_to` aims the raised-room exit at 2604,9901, where Open did nothing. The live doors are 2002 at 2604,9900 and 2606,9892.
- **open** Upstairs bookcase 1989 on the natural route gave Book on Baxtorian, and Read advanced varp 65 from 2 to 3. Full-bag refusal and lost-book recovery stay on the earlier run. https://github.com/RSPSApp/tsps/issues/1262

## Runs

### 2026-10-29 · agent · grok-4.7

- **Start:** fresh account, placed at 2523,3498,0 with `::tele` (the only teleport), with a rope, six air, water and earth runes, shrimps, and a games necklace. Baseline before Almera: varp 65 = 0, quest points (varp 101) = 0, Attack and Strength 13,034,431 XP. Branched from `62d662706242`.
- **Route:** Almera (varp 65 = 1), log raft to Hudon (2), swim downstream (stage stayed 2), Hadley's bookcase 1989 and Read (3), Tree Gnome Village ladder, Golrie's key and pebble, banked the runes, pebble on the tombstone (4), chest amulet and coffin urn, rope on the rock and dead tree, amulet worn through the waterfall door (5), crate key, doors (6), six pillars, amulet on the statue (8), urn on the chalice (10). Left by the raised-room door and the inside dungeon door, then talked to Almera again.
- **Result:** varp 65 = 10, varp 101 = 1, Attack and Strength each +13,750 XP (13,048,181). Rewards: two diamonds, two gold bars, 40 mithril seeds, and Glarial's urn (empty). The dungeon key was kept. Golrie's chat varbit 9110 = 1. Relog kept the stage, quest point, experience, and items.
- **Not checked:** the barrel, climbing the dead tree with no rope, taking the chalice before the urn, a pillar flood, full-bag and lost-book bookcase cases, Gerald, Hadley, and Hudon's completion dialogue.

### date not recorded · agent · model not recorded

- **Source:** issue [#728](https://github.com/RSPSApp/tsps/issues/728) supplemental (q131); moved here from its ledger on 2026-10-29. Proven against plugin hashes, not a commit, so a later plugin change is not flagged automatically.
- **Result:** varp 65 = 2 (route); 2 -> 3 in bounded bookcase check.
- **Checked:** River Swim downstream with no state change, relog, bookcase full-bag refusal/retry and lost-book recovery (bounded).
- **Not checked:** No cave entry, completion or reward claim; Bookcase check used developer-arranged stage, position and inventory.
- **PRs:** [#1187](https://github.com/RSPSApp/tsps/pull/1187).
