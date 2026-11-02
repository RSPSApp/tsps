---
quest: Black Knights' Fortress
key: black_knights_fortress
status: passed-with-issues
tested: 2026-11-01
tester: agent
model: claude-opus-5-5
commit: b7fb0e92d
cache: osrs-241_2026-10-20
start: fresh
travel: travel_to
---

# Black Knights' Fortress

A fresh account played the quest to completion with `travel_to` after placement. The main route is checked against the OSRS Wiki only, because no capture in the rsprox database shows it. Rsprox 469 covers the post-quest fortress, and 1581 and 2977 the completed journal; those parts were compared directly.

## Findings

- **open** No rsprox database capture shows the main route. The plugin's sabotage timings came from a revision 240 capture that isn't in the database and can't be re-checked.
- **open** The banquet "if disguised" branch holds an unresolved `[sir/madam]` and isn't played; the Wiki doesn't say which disguise it means.
- **open** 469's disguised guard says a King's Ransom line rather than the Wiki's "Get back on duty!". Its King's Ransom stage wasn't determined, and neither plugin has that branch.
- **open** Small position differences from 469: the grill stand tile is 3026,3508 vs 3026,3507, and the player steps onto the door tile outside the main door where 469 stops a tile short.
- **open** `travel_to` has no fortress passages, so it returns `no-route` from inside the sturdy-door room. Transport data gap.
- **open** A nameless NPC 7749 stands in the witch's room, not investigated. The dossier stays in the bag after completion; neither capture nor Wiki settled that.
- **open** Community report: scenes can be shortened or glitchy. Not reproduced in the run below, which didn't watch a client. [#1257](https://github.com/RSPSApp/tsps/issues/1257)
- **fixed** Generated dialogue from rsprox 469, in osrsreboxed-db: the guard's single "I might be new here..." box, the player's "Yes, but I work here!" at the sturdy door, and "scaring the cat".
- **fixed** Against rsprox 469, 1581 and 2977: completed and not-started journal text, doors and walls opening for 2 ticks as a walked crossing with sound, main doors refusing with "You can't open this door.", the banquet knight's "Die, intruder!" attack after continuing past the player's line, guard chat heads, grill animations, chat-head animations. Also the black-armour disguise (Wiki only).

## Runs

### 2026-11-01 · agent · claude-opus-5-5

- **Start:** fresh account placed with `::tele`. Declared setup before the baseline: six free quests completed by command for 15 quest points, `master`, disguise armour, cabbages, lobsters. Baseline: varp 130 = 0, 480 coins. The dossier was earned.
- **Route:** Sir Amik, the dossier, sturdy door in disguise, the walls, the grill, the cabbage hole, back to Sir Amik, by `travel_to`. Passages inside the fortress were clicked by hand, because `travel_to` has no route through them.
- **Result:** varp 130: 0 → 1 → 2 → 3 → 4. Coins +2,500, quest points 15 → 18, no XP, once each.
- **Repeat and relog:** Sir Amik plays his greeting with no second reward, and stage, points and coins persist.
- **Crossings:** both disguises cross, doors shut after 2 ticks with menu and collision back; spam clicks and logging out mid-crossing leave no stuck door. Rechecked after fixing the route from the ladder landing and the banquet timing (separate account, stage set by command).
- **Not checked:** client visuals, including the door leaves and grill animations; Sir Amik's stage 2 report; the journal at stages 1 to 3 (no capture).

### 2026-10-25 · community (thehardcorenoobs1234) · model not recorded

- **Source:** community report ([#1257](https://github.com/RSPSApp/tsps/issues/1257)); moved here from its ledger on 2026-10-29. Proven against plugin hashes, not a commit, so a later plugin change is not flagged automatically.
- **Not checked:** Single account/run report; no full Quest Helper, recovery, multiplayer, dialogue, event or cutscene parity claim.
