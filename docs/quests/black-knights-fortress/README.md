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

A fresh account played the quest to completion with `travel_to` after placement. The main route was first checked against the OSRS Wiki only; the 2026-11-06 run compares it with two full-quest recordings. Rsprox 469 covers the post-quest fortress, and 1581 and 2977 the completed journal; those parts were compared directly.

## Findings

- **fixed** Aligned with a third full-quest recording, rev 242 (2026-11-12, varp 130 0 -> 4, black-armour disguise). Rev 242 throws the cabbage on the scene's first tick, together with the camera shake and cutscene varbits, and `busy` follows a tick later; every later step keeps the same distance from the throw as in rev 240/241, so the scene now runs a tick earlier (fade 5, instance 7, NPCs and camera 9, fade in 13, first line 23). After "Meow!" it fades out at 3, returns at 5 and gives the closing line at 8 (rev 241 used 4/6/9). The cabbage flies from the player's own tile (3031,3506 / 3031,3508 / 3030,3507 across the three recordings).
- **fixed** Rev 242 dialogue: Sir Amik adds "Don't forget to read that dossier of information I gave you." when asked at stage 1 with the dossier still held (tick 186), and the hand-in has no "Sir Amik hands you 2500 coins." box (rev 240/241 had one, before the 3 November reward change). The grill's "mention" and "Mithtreth" and the cat's bare "Meow!" are now in the generated transcript (osrsreboxed-db) instead of being rewritten at runtime.
- **fixed** Every captured line's chat-head animation is in `plugins/quests/data/chathead-animations.json` (all three recordings agree). The cat's "Meow!" is 588 in all of them, so the forced 567 is gone.
- **fixed** The dossier's box closes and its bang (sound 1418, delay 22) plays on the explosion tick; `busy` clears a tick later (rev 242 195 -> 203, 204).
- **fixed** The completion scroll shows the broken cauldron (9591) and "3 Quest Points", "2 Antique Lamps", "2,500 Coins" in that order (rev 242 tick 1113).
- **open** Rev 242 sends silence (track 147) with no fades before both jingles (5 at the scene, 152 at completion) and the area track once the jingle ends; `sendJingle` re-sends the current track instead. Shared music behaviour, not changed here.
- **open** Rev 242 positions the scroll's model (if_setobject zoom 400, if_setposition 78,128) and leaves the points line to the interface's own script; the shared runtime sends the item with count 1 and writes "Quest points: N" into child 6.
- **open** The NPCs' steps after the scene's first four are their own wandering and differ in every recording; the plugin replays rev 240's.
- **fixed** The main route is now checked against two full-quest recordings (rev 240 and rev 241): dialogue, dossier read, grill, cabbage scene steps, camera and fades match. Fixed from them: the stage 2 and stage 3 journal text (it was invented), the sabotage sounds (cabbage throw, "What's that noise?", splash, the cat's meow with its range of 5), the throw coming a tick after the camera shake (rev 242 throws with it; see above), and the grill stand tile, which is the grill's own tile 3026,3507. No track is scripted in the scene: rev 241 plays none at "My potion!", and rev 240's Knightmare (374) at tick 3134 is the area track returning when jingle 5 (35,050 ms, from 3076) ends.
- **open** The banquet "if disguised" branch holds an unresolved `[sir/madam]` and isn't played; the Wiki doesn't say which disguise it means.
- **open** 469's disguised guard says a King's Ransom line rather than the Wiki's "Get back on duty!". Its King's Ransom stage wasn't determined, and neither plugin has that branch.
- **open** The player steps onto the door tile outside the main door where 469 stops a tile short (rev 240 also stops beside the sealed door, at 3008,3515).
- **open** `travel_to` has no fortress passages, so it returns `no-route` from inside the sturdy-door room. Transport data gap.
- **fixed** NPC 7749 is `wildwars_timer`, an invisible controller, so it needs nothing. The dossier stays in the bag after completion (rev 241).
- **open** The stage 1 journal has no capture and stays Wiki-based. The black-armour and not-disguised branches are still unplayed.
- **open** Community report: scenes can be shortened or glitchy. Not reproduced in the run below, which didn't watch a client. [#1257](https://github.com/RSPSApp/tsps/issues/1257)
- **fixed** Generated dialogue from rsprox 469, in osrsreboxed-db: the guard's single "I might be new here..." box, the player's "Yes, but I work here!" at the sturdy door, and "scaring the cat".
- **fixed** Against rsprox 469, 1581 and 2977: completed and not-started journal text, doors and walls opening for 2 ticks as a walked crossing with sound, main doors refusing with "You can't open this door.", the banquet knight's "Die, intruder!" attack after continuing past the player's line, guard chat heads, grill animations, chat-head animations. Also the black-armour disguise (Wiki only).

## Runs

### 2026-11-12 · agent · claude-opus-5-5

- **Kind:** source alignment against the rev 242 recording plus a bounded live check; not a natural playthrough.
- **Source:** user-supplied rev 242.1 recording `BlackKnightsFortress.bin` (SHA-256 1d7c44c5f919546287f011892d8a295b4e03fa89a6b1b7a8ac4d0b9d68106b2e), transcribed with RSProx; rev 240 and 241 re-read for the scene timing and chat heads.
- **Start:** checkpoint. Fresh account, `master`, eight free quests completed by command for 12 quest points, black armour and cabbages spawned. `::tele` placed it at Sir Amik, inside the grill room and at the hole (no `travel_to` route inside the fortress), and back to Sir Amik.
- **Route:** Sir Amik's start dialogue (cower, then decline; then accept), the stage 1 reminder, the dossier read, the sturdy door in black armour, Listen-at grill, the cabbage scene to the closing line, the hand-in.
- **Result:** varp 130 0 -> 1 -> 2 -> 3 -> 4; quest points 12 -> 15; +2,500 coins and two lamps (34748); no coins box. Scene ticks from the use: instance by +9, first line +23, noise line 6 after Greldo's continue, back at the hole 5 and the closing line 8 after "Meow!". Stage and rewards persist over relog.
- **Not checked:** chat-head animations and the scroll on screen (unit tests cover the data); the jingle/music packets; the banquet and not-disguised branches in this run.

### 2026-11-06 · agent · claude-sonnet-5-5

- **Kind:** source review against two recordings plus focused tests and a bounded live check; not a natural playthrough, so the status block above still describes the 2026-11-01 run. The plugin changed after it, so the index marks this page for recheck until a full run is recorded.
- **Source:** two user-supplied full-quest recordings, rev 240 and rev 241 (varp 130 0 -> 4), transcribed with RSProx. Compared line by line with the plugin: dialogue, dossier read, grill, sabotage scene steps, camera, fades, sounds, journals, reward.
- **Start:** checkpoint. Fresh account given `master`, placed with `::tele`, stage set with `::quest black_knights_fortress <stage>`. Travel was `::tele` only.
- **Route:** grill Listen-at at stage 1; stage 2 with a cabbage used on the hole from (3031,3506,1).
- **Result:** the player ends on the grill tile (3026,3507) as in both recordings; the sabotage scene starts, moves the player into the private area and ran without server errors. Unit tests cover the stage 2 and 3 journal text, the scene's sounds and throw timing, and the grill route.
- **Not checked:** the scene's dialogue clicked through to stage 3, the reward and relog (covered 2026-11-01), the new sounds audibly, client visuals, the stage 1 journal, the black-armour and not-disguised branches, door positions against the recordings.

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
