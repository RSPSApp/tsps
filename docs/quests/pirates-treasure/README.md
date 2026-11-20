---
quest: Pirate's Treasure
key: pirates_treasure
status: passed
tested: 2026-10-25
tester: community
model:
commit:
cache: osrs-241_2026-10-20
start:
travel:
---

# Pirate's Treasure

Community-reported completion accepted for scheduling (skip full manual replay). No issue reported.

## Findings

- **fixed** The Karamja boats used the pre-rev-227 ship_journey voyage, landing on the deck with an arrival box; live fades to the dock with "You pay the boarding charge of 30 coins." and "You board the ship and sail to ...". Seaman Morris's return from the Pandemonium was missing. Fixed on feat/pirates-treasure-capture.
- **fixed** The customs officer's Travel option with rum played the search conversation; live takes the rum as the fare is paid. Teleporting off Karamja with rum kept it; live breaks it. Fixed on feat/pirates-treasure-capture.
- **fixed** The journal was invented text; stages 1 and 2 now use the captured lines. Fixed on feat/pirates-treasure-capture.
- **fixed** Luthas kept the player employed after "Thank you, I'll be on my way", Fill said "fill" for an exact tenth banana, Frank still offered the treasure after the rum, Wydin's door teleported the player, Wydin's crate gave the rum at once with no banana question, the gardener spawned at 2997,3382, and the dig, locked-chest and casket sounds and Gerrant's apron line were missing. Fixed on feat/pirates-treasure-capture.

## Runs

### 2026-11-20 · agent · claude-opus-5-5 · capture alignment

- **Source:** the user's own whole-quest rsprox capture (revision 242), the user's revision 240 recording (local 1001335) for the stage 2 journal, rsprox database 4287 and 465, and the OSRS Wiki. Facts are in docs/f2p-coastal-parity.md.
- **Start:** fresh account; `::tele` and `::item` placed the player and supplied rum, bananas, coins and a spade between steps (a feature check, not a natural playthrough).
- **Result:** every step matched the capture over the agent MCP: Frank's start, the boats both ways, customs confiscation, the rum spill on a teleport, Luthas's job and re-employment, the crate, Gerrant's apron, Wydin's job, door and crate timing, Frank's hand-in and after-rum options, the chest, the note, the gardener, the dig and the casket (varp 71 1 → 4, 2 QP, 800 Cooking XP).
- **Not checked:** chathead expressions (the dialogue data carries none); the stage 3 and 4 journals (no capture); Seaman Morris's Musa Point option and the Pandemonium legs' landing beyond the captured one.

### 2026-11-02 · agent · capture audit

- **Source:** rsprox database recordings 4287 (rev 239) and 465 (rev 233), plus the OSRS Wiki.
- **Result:** the captured crate wording was applied: packing a banana is a message box with animation 832 and sound 2739; filling the crate to ten says "You fill the crate with bananas."; an empty crate says "The crate is completely empty."; Luthas pays with "Luthas hands you 30 coins."; and crate actions before asking for employment give "Why would I want to do that?". The apron and stock-room door behaviour already matched. The customs officer's `[Charm]` free-passage option now needs a Ring of Charos(a) worn.
- **Checked:** `node tests/f2p-coastal-parity.test.cjs` (26 pass, including the new crate/payment and Charm cases).
- **Not checked:** no live client replay; the rum stash/search messages and Wydin's stock-room crate have no capture.

### 2026-10-25 · community (thehardcorenoobs1234) · model not recorded

- **Source:** community report ([#1257](https://github.com/RSPSApp/tsps/issues/1257)); moved here from its ledger on 2026-10-29. Proven against plugin hashes, not a commit, so a later plugin change is not flagged automatically.
- **Not checked:** Single account/run report; no full Quest Helper, recovery, multiplayer, dialogue, event or cutscene parity claim.
