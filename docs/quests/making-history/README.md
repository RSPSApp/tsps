---
quest: Making History
key: making_history
status: passed-with-issues
tested: 2026-11-11
tester: agent
model: claude-opus-5-5
commit:
cache: osrs-242_2026-11-03
start: fresh
travel: ::tele between legs
---

# Making History

Aligned with a complete live run, start to finish: rsprox captures, revision 242 recording
`20261111T015053-5ab63b4` (ticks below are that recording's). Issue
[#4170](https://github.com/RSPSApp/tsps/issues/4170).

## Capture facts the plugin relies on

**Start (Jorral).** "Tell me more." is followed by Jorral's "That's what I like to hear.<br>Let me
tell you about the outpost..." (29). Its continue holds an empty message box and fades the screen
out (script 948 `[0, 255, 0, 0, 50]`, 30). At 32 the cutscene starts: cutscene_status, hidden ops,
minimap_state 2, fov_clamp, draw_distance_max_override and the area-sound overrides; the combat,
stats, journal, inventory, worn, prayer, magic, settings and emote tabs close; the song goes silent
and jingle 141 ("outpost cutscene") plays; the camera moves to 2432,3380 (height 1000) looking at
2436,3346 (500), rates 100. The five Narration captions show in the fade overlay (174:4) at 34, 44,
54, 64 and 78, each cleared 8 ticks later (42, 52, 62, 72) and the last at 84. The first fades the
screen in (`[0, 0, 0, 255, 30]`), the others show at once (`[0, 255, 0, 255, 0]`). The camera moves
to 2432,3361 (34), 2445,3361 (44), 2445,3330 (54), 2432,3330 (64), all height 1000 and rates 5, then
looks at 2438,3350 (525) from 2435,3347 (800) at 74. At 84 the screen fades out, and at 87 the
cutscene ends, the camera resets, the tabs return, the screen fades in and Jorral asks "If all goes
well...". Accepting sets `makinghistory_prog` 1383 to 1 (176). Each "three people" answer returns
to the "What's the story so far?" menu (190, 193).

**Erin.** The key comes on the continue past "Why not. I can't use it anyway." with
`makinghistory_trader_prog` 1384 = 1 (239), not on the menu pick.

**The dig.** Digging at 2441,3140, 2442,3140, 2442,3141, 2443,3140 and 2442,3139 all found it (294-313;
Quest Helper's dig step is 2442,3140). Each dig plays human_dig with synth 1470 and shows the message
box "You use the spade and find a chest. Wonder what's inside?"; the chest and 1384 = 2 come on its
continue (315). Feeling the key with the chest held: game message "You already have the chest"
(326). The key on the chest shows the message box "You look in the chest and find a journal, and
then you throw away the chest."; its continue adds the journal, then removes the chest (340). 1384
stays 2: live never sends 3.

**Blanin and Dron.** `makinghistory_warr_prog` 1385 = 2 on the continue past Blanin's "I know this
sounds strange..." (611). A wrong quiz answer gets one of Dron's insults straight after the pick, with
no player line, and the talk ends (738-740 "Wrong, wrong, wrong!", 791 "You know nothing!"); the
player talks to him again. 1385 = 3 on the continue past "You would." (864).

**The ghosts.** `makinghistory_ghost_prog` 1386 = 2 on the continue past Droalak's amulet request
(1305). Melina takes the amulet after "Goodbye.": 1386 = 4 and `makinghistory_melina_pres` 1387 = 1
(1345). The scroll and 1386 = 5 come on the continue past "Of course. Let me know if it was of any
use..." (1362).

**Jorral's hand-ins: one talk.** "Hi there." / "How's it going?" once, then the journal ("Jorral reads
through the journal." is a message box, 1388; the journal goes and 1384 = 4 past "Interesting.", 1393),
then Dron's story (the chat closes and the screen fades out on the continue past "Well...", 1395, fades
in at 1398, and "And then I asked him..." shows at 1401; 1385 = 4 past "It seems you're lucky...",
1405), then the scroll ("Jorral skims over the contents of the scroll" is a message box, 1406; the
scroll goes and 1386 = 6 past "Very interesting...", 1408), then the whole story. Jorral's letter and
1383 = 2 come on the continue past "You've got that right!" (1415).

**King Lathas** (9228 transformed to 9005 at 2579,3292,1). "The King reads the letter." is a message
box (1485); the reply letter takes the first letter's slot with 1383 = 3 past "Very well, I will
comply..." (1489).

**Finale.** "Jorral reads the letter." is a message box (1517). On the continue past "I can now continue
with my plans for this place. Thank you." the chat closes and the screen fades out (1521); at 1524
`makinghistory_objloc` 1390 = 1 and the screen fades in; "Take a look at the artefacts in the new
museum room..." shows at 1527, and its continue completes the quest (1529): 1383 = 4, `enchantedkey`
13717 = 1, the letter goes, 750 coins, jingle 152. The scroll shows the enchanted key (6754, zoom 400)
and "3 Quest Points", "1,000 Prayer XP", "1,000 Crafting XP", "750 Coins", "The Enchanted Key". The
key stays in the inventory (it was never handed back).

## Not covered

- The capture never feels the key before the chest, so the hot/cold messages follow the transcript.
- The scroll's "You are awarded:" line and the reward-scroll layout are the shared quest runtime's.
- Jorral's line before the cutscene is joined with a space: the Wiki parser keeps no forced break.
- The fade overlay closes 3 ticks after each fade in; live keeps it until the talk ends (98, 1415).

## Runs

### 2026-11-11 · agent · claude-opus-5-5

- **Source:** issue [#4170](https://github.com/RSPSApp/tsps/issues/4170); capture `20261111T015053-5ab63b4`.
- **Checked:** a fresh account (Priest in Peril and The Restless Ghost set with `::quest`) from Jorral's
  start to the reward over the worktree's agent MCP, `::tele` between legs; the cutscene in the
  headless client.
- **Not checked:** walking the legs (teleported); Quest Helper's overlay.

### date not recorded · agent · model not recorded

- **Source:** issue [#728](https://github.com/RSPSApp/tsps/issues/728) active (q071); moved here from its ledger on 2026-10-29. Proven against plugin hashes, not a commit, so a later plugin change is not flagged automatically.
- **Checked:** payment, cancel, full-bag, banked-key and relog (bounded).
- **PRs:** [#1139](https://github.com/RSPSApp/tsps/pull/1139), [#1239](https://github.com/RSPSApp/tsps/pull/1239).
