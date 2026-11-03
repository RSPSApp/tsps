---
quest: Rune Mysteries
key: rune_mysteries
status: passed-with-issues
tested: 2026-10-30
tester: agent
model: grok-4.7
commit: 69bc52e8f3ea
cache: osrs-241_2026-10-20
start: fresh
travel: travel_to
---

# Rune Mysteries

A watched account with the quest unstarted finished the normal route: Duke Horacio, Sedridor's package, Aubury's notes, the hand-in, the essence-mine teleport, and a relog. The first hand-in closed Sedridor's chat before his follow-up menu. After that step stayed open, a replay of the notes hand-in showed the menu. `travel_to` still cannot plan the long walks or the Wizards' Tower doors.

## Findings

- **fixed** Handing Sedridor the research notes ended the dialogue on the congratulations step, so the chatbox closed before his follow-up menu. That step now stays open. The menu offers the essence-mine teleport, who else knows the teleport, the old Wizards' Tower, and "I'd better get going."
- **open** `travel_to` from Lumbridge Castle plane 1 to the Wizards' Tower basement, and from the castle ground floor toward the tower ladder at 3104, 3162, returned `no-route`. `plan_route` still found a walk, and hops of about 40 tiles worked. A region `travel_to` has not loaded yet is treated as blocked for the rest of that search.
- **open** `travel_to` Open on Door 12348 at 3207, 3217 did nothing (`blocked`). A retry of the same goal walked around the door.
- **open** `travel_to` back toward the tower used Stepping stone 62412 at 3193, 3344, landed at 3193, 3340, then returned `no-route`. `plan_route` still had a walk. The stone gave 5 Agility XP.
- **open** Wizards' Tower doors 23972 (north door at 3109, 3167 and the inner door at 3107, 3162) are not transports, so `travel_to` cannot reach ladder 2147 from outside. Opening both by hand, then Climb-down, reaches the basement. Basement door 1535 at 3108, 9570 did open once the account was already inside.

## Runs

### 2026-11-02 — agent — Claude Opus 5.5

- **Skipped:** No rsprox database capture covers the quest route. No recording changes varp
  63, and the research package, research notes and air talisman hand-over appear in none;
  Sedridor and Aubury hits are post-quest accounts (varp 63 = 6). Not replayed.

### 2026-10-30 · agent · grok-4.7

- **Start:** fresh account, placed at 3210, 3218, 1 with `::tele` (the only command teleport). Baseline: varp 63 = 0, quest points (varp 101) = 0, talisman varbit 13720 = 0, empty inventory and equipment, every skill 13,034,431 XP. Branched from `acf4a8659da5`. The menu replay is the quest code in `69bc52e8f3ea`. The user watched in their own client.
- **Route:** Duke Horacio, "Have you any quests for me?" then "Yes." (varp 63 = 1, varbit 13720 = 1, air talisman). Castle door 1543 and staircase 16672 down to the ground floor. The tower approach was a walk where `travel_to` returned `no-route`, including around Door 12348. Tower doors 23972, ladder 2147 down to 3104, 9576, basement door 1535, then Sedridor: "Okay, here you are.", "Go ahead.", "Yes, certainly." (research package, varp 63 = 3). `travel_to` in hops to Aubury. "I've been sent here with a package for you." then "I'd love a cup of tea." (research notes, varp 63 = 5). The return used the stepping stone, then a walk. The notes hand-in followed Sedridor's explanation. A later replay set the stage back to 5, used the essence-mine portal (34825) back to 3104, 9571, and handed the notes in again.
- **Result:** varp 63 = 6, varp 101 = 1, varbit 13720 = 1, one air talisman, no quest XP. Chat: "Congratulations, you've completed a quest: Rune Mysteries". The first hand-in did not open the follow-up menu. The replay did, and "I'd better get going." closed it without a second quest point or a second talisman. Repeat talk after the first completion teleported to the essence mine at 2913, 4832, 0 (music "Rune Essence") and gave nothing else. Relog kept the stage, the quest point, the talisman, and the Agility XP from the stepping stone (13,034,431 → 13,034,436).
- **Not checked:** a lost talisman, package or notes, a full inventory, the identity-doubt branch ("No, I'll only give it to Sedridor"), Aubury's tea energy restore and the "Aaah, nothing like a nice cuppa tea!" line, Duke Horacio after completion, the reward-scroll lines, the Quest Helper overlay, kudos at Historian Minas, and the drop trick for extra talismans. Journal text is already known not to match the live packets.

### 2026-10-25 · community (thehardcorenoobs1234) · model not recorded

- **Source:** community report ([#1257](https://github.com/RSPSApp/tsps/issues/1257)); moved here from its ledger on 2026-10-29. Proven against plugin hashes, not a commit, so a later plugin change is not flagged automatically.
- **Not checked:** Single account/run report; no full Quest Helper, recovery, multiplayer, dialogue, event or cutscene parity claim.
