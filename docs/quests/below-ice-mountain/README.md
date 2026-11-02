---
quest: Below Ice Mountain
key: below_ice_mountain
status: passed-with-issues
tested: 2026-11-01
tester: agent
model: claude-opus-5-5
commit: b7fb0e92d
cache: osrs-241_2026-10-20
start: fresh
travel: travel_to
---

# Below Ice Mountain

A fresh account played the quest to completion with `travel_to` after placement, and its stage values match rsprox 1636 at each step. Conversation text and menu titles now match, with gendered placeholders kept where the capture shows only one form, and repeat talk and relog hold on the run below. Mining the pillars was only partly played, and Charlie wasn't exercised.

## Findings

- **open** Kaylee's "What can you tell me about dwarves and ale?" option is in 1636 but no source has what follows it, so it isn't added.
- **open** Message boxes don't send the type 115 chat mirror 1636 shows. Shared dialogue code.
- **open** "Ramarno departs for his workshop." shows once with Continue; 1636 shows it without Continue at 2283, then again with Continue at 2286.
- **open** Timing: recruit varbits move on continuing, about 3 ticks before 1636. No fade-out when leaving the workout (1636 tick 563), and no rocks 41549/41550 (2261) or music 147 (2253). Player lines in 2059-2100 don't hold their Continue, because `PlayerDialogue` has no `sendHeld`.
- **open** Off-quest: stepping stone 16513 and Broken Raft 17069 did nothing on `travel_to` at 99 Agility. Not investigated.
- **open** Community report: training and other scenes can glitch, and a relog was needed to search the backpack. Not reproduced in the run below. [#1257](https://github.com/RSPSApp/tsps/issues/1257)
- **fixed** Generated dialogue from rsprox 1636, in osrsreboxed-db: leading asterisks ("*Sighs*", "*Whispers*", "*Shrugs*", "*hic* Woops"), the literal `{{fact}}`, Checkal's and Marley's wording, and the three quest menu prompts. "Sorry, pal" is the only wording left ungendered on a single capture's evidence.
- **fixed** Against rsprox 1636: completion scroll rows (the capture overrides the Wiki's reward list), drink and bag item boxes, recruit fades, Marley's bites, overheads and sounds in rock-paper-scissors, the entrance's explosion and rubble scene, Marley's trap, Burntof's asides, the bag scene, Ramarno's varbit 12068 at the barronite line, chat-head animations.

## Runs

### 2026-11-01 · agent · claude-opus-5-5

- **Start:** fresh account placed with `::tele`. Declared setup before the baseline: nine quests completed by command for quest points, `master`, knife, bread, cooked meat, stout, rune pickaxe, sharks. Baseline: 17 quest points, varp 2951 = 0, 60 coins.
- **Route:** Willow, Checkal and the workout, Marley and the Cook, Burntof and rock-paper-scissors, the entrance, the Guardian, Ramarno, by `travel_to`, with the Shantay warning answered by hand.
- **Result:** varp 2951 reached 60184952 at completion and 194402680 after Ramarno, each step equal to rsprox 1636. Quest points +1, coins +2,000, plus XP from activity only (Mining 30, Strength 40, Hitpoints 13). Three pillars mined at 10 Mining XP and 10 Guardian HP each.
- **Repeat and relog:** Willow and Ramarno play post-quest dialogue with no second reward; stage, points and coins persist.
- **`travel_to` findings:** gate note 44598 vs live 44050 is an id difference, and the gate works. The Shantay pass is a real requirement. The stepping stone and raft are under Findings.
- **Not checked:** death by pillar, Charlie, wrong-order and "No" branches, journal text (no capture), client visuals (the fuse NPC's name, the player's overheads), the saved database directly.

### 2026-10-25 · community (thehardcorenoobs1234) · model not recorded

- **Source:** community report ([#1257](https://github.com/RSPSApp/tsps/issues/1257)); moved here from its ledger on 2026-10-29. Proven against plugin hashes, not a commit, so a later plugin change is not flagged automatically.
- **Not checked:** Single account/run report; no full Quest Helper, recovery, multiplayer, dialogue, event or cutscene parity claim.
- **PRs:** [#1095](https://github.com/RSPSApp/tsps/pull/1095).
