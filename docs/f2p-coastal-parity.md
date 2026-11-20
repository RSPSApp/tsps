# Coastal free-to-play quest parity

Source evidence is the revision 240 rsprox sessions dated 15–17 August 2026 from issue #600's F2P recordings. Cache 241 supplies current item, NPC and object identities. No recordings or player identifiers belong in this repository. The recordings show one successful route through each quest; uncaptured alternative routes use the existing OSRS dialogue and quest rules.

## Witch's Potion

The ingredient request commits varp 67=1 when Hetty names the ingredients (capture tick 1462). Handing them over initially displays a statement; the four ingredients are removed and state 2 is sent when she says to drink (1574). Drinking the cauldron shows its statement before continuing to state 3, 325 Magic XP, 1 QP and jingle 154. Rats retain their quest-tail drop hook.

## Pirate's Treasure

The rum, banana crate, plantation employment, apron check, shop search and Frank handover remain separate requirements. Wydin's previously empty job branch now opens his employment dialogue. Canonical Zembo supplies the rum shop. The note uses native handwritten interface 222, with the Falador clue on children 5/6; reading it changes varp 71 from 2 to 3.

The first dig summons gardener 3651 at 3001,3386, facing south-west, with his overhead "First moles, now this! Take this, vandal!" and a hint arrow; both digs play animation 830 and sound 1470 (digspade). Digging while he still threatens the player is refused. A successful dig takes four ticks ("You dig a hole in the ground..." then "and find a little chest of treasure.") and grants casket 7956, 2 QP, 800 Cooking XP and jingle 153. Opening that casket grants 450 coins, gold ring 1635 and emerald 1605 once, respecting inventory capacity, with sound 52. The note and key are separate stages, and the casket's contents are deferred until it is opened. The note opens after toplevel_mainmodal_open (2524) with no background. Open on the closed Varrock chest says "The chest is locked." with sound 2402. The key opens it as object 2080 for four ticks with sound 52; the key is exchanged for the note when object 2079 returns. Logging out restores the closed chest without consuming the key.

### The user's revision 242 capture (PiratesTreasure, a whole run)

Ticks are the recording's own.

- **Boats.** Every Karamja crossing (ticks 171, 187, 221, 327, 343, 431, 822) sends "You pay the boarding charge of 30 coins." and "You board the ship and sail to Musa Point." (Port Sarim, the Pandemonium) on the click, song 147 (silence) and jingle 171, and fade_overlay 174 with script 948 `[0, 255, 0, 0, 50]`. The player is teleported five ticks later to the dock, not a deck: Musa Point 2956,3146,0, Port Sarim 3029,3217,0, the Pandemonium 3065,3002,0. The fade back in (`[0, 0, 0, 255, 50]`) follows 2 to 10 ticks after that (we use 2), and the overlay closes two ticks later. There is no ship_journey (299) and no "The ship arrives at ..." box. Every Karamja boat recording since rev 227 agrees; only 224/1434 and 226/1653 show the old voyage. The Seamen's talked-through "I'd like to go to Musa Point." (tick 220) and Seaman Morris's "Port Sarim" from the Pandemonium (tick 187) sail the same way. The Wiki's customs transcripts still give the old "You pay 30 coins and board the ship." and the arrival box; the boats follow the capture, and the Wiki lines are the recorded difference.
- **Customs with rum.** The officer's Port Sarim option with rum and 30 coins (tick 327) is one line, "You pay the boarding charge of 30 coins. However, the customs officer confiscates your rum before letting you board.", and the ship sails. The Talk-to search conversation stays the transcript's.
- **Teleporting with rum.** A house teleport from Zembo's (tick 386) lands with "Your Karamjan rum gets broken and spilled." and the rum gone (tick 390); the Wiki's Karamjan rum page says the same of any teleport off the island.
- **Luthas.** "Thank you, I'll be on my way" after a payment ends the job: the next Talk-to opens "Hello I'm Luthas..." again (ticks 588, 591, 805, 808). "Will you pay me for another crate full?" keeps it (tick 739).
- **Crate.** Fill with every carried banana going in, ten into an empty crate or nine into one, is "You pack all your bananas into the crate." (ticks 569, 660, 790). Recording 4287's "You fill the crate with bananas." came with 12 and 11 bananas carried, so it is the crate filling with bananas left over.
- **Wydin's door.** Open puts inviswall 38848 on the doorway and wydindooropen 2070 on the tile west, with sound 62. The player walks across from 3012,3204 to 3011,3204 (tick 937), and the door is back two ticks later; leaving (tick 973) is the same. Before the job, Wydin's "Hey, you can't go in there..." conversation plays; hired without the apron worn, "Can you put your white apron on before going in there, please?" plays (tick 893).
- **Wydin's crate.** "There are a lot of bananas in the crate." on arrival (tick 942), the rum four ticks later with animation 832 and sound 2582 (tick 946), and "Do you want to take a banana?" four ticks after that (tick 950). Taking one plays 832 and 2582 too (tick 953). The rsprox index (grocerycrate, recordings 465 and local 1001335, 1001527, 1001994) agrees.
- **Journal.** Stage 1's lines are captured at ticks 111, 556, 748 and 858 (not employed, employed, rum hidden, crate shipped; "as  the" keeps live's double space), and stage 2's in local recording 1001335 (rev 240). Stages 3 and 4 have no capture.
- **Frank.** The Braindeath line plays for a player who has completed Rum Deal (tick 57). The capture's "Ok, I will bring you some Karamja Rum." (tick 85) differs from the Wiki's "Ok, I will bring you some rum."; the Wiki line is kept (recorded difference).
- **Apron.** Taking Gerrant's apron (tick 850) says "You take an apron. It feels freshly starched and smells of laundry." and gives white apron 1005; the ground spawn returns seven ticks later (tick 857).

Recordings 4287 (rev 239, main game) and 465 (rev 233) cover the plantation employment and apron checks. Packing one banana is a message box ("You pack a banana into the crate."), not game chat, with animation 832 and sound 2739. An empty crate reads "The crate is completely empty.", and Luthas pays with "Luthas hands you 30 coins." Using bananas, Fill or rum on the crate before asking Luthas for employment gives "Why would I want to do that?". The pack, Fill and stash actions are therefore gated on Luthas's employment flag. The customs officer's `[Charm]` options are hidden unless a Ring of Charos(a) is worn (the unactivated ring does not count), and the free branch sails with "You board the ship and sail to Port Sarim." alone.

Issue #2432 follow-up: Zembo's canonical transcript already guards the Barcrawl option with “During Alfred Grimhand's Barcrawl”. The quest plugin now answers that exact condition for Zembo using cache241 `barcrawl_progress` varbit 13714: 0 is unstarted, 1 is in progress and 2 or 3 is complete (native quest-status helper 4029, DB row 4/endstate 2). The old `BARCRAWL` varp 77 is not used as a substitute. This hides the option before starting without implementing the separate miniquest or changing generated dialogue data.

A full bag keeps a shipped bottle of rum in Wydin's crate with the existing inventory-space message, and no banana is offered; a repeat search cannot duplicate the recovered bottle.

The other two #2432 reports did not reproduce on this revision. Native Talk-to at Pirate's Treasure stage 1, before Luthas employment, offers both employment and customs choices; choosing customs plays the full export-crate/Wydin exchange without hiring the player.

## Prince Ali Rescue

Varp 273 follows 10→20→30→31→40→50→100→110. Historical saved internal 21/22 key states still report wire 20. The modern key route uses key print 2423 on a furnace, asks for confirmation, consumes a bronze bar and the print, and grants bronze key 2418 plus 2 Crafting XP after one tick. Leela accepts a fully prepared player at 20 without requiring the historical Osman key route. Her first visit always explains the plan (Wiki transcript); a return visit with the disguise, key and rope plays "I do indeed." and moves to 30. The revision 242 capture (`rsprox_transcripts/242/900240.txt`) instead answers "Yes. In fact, I already have everything we need." on the first visit; the Wiki is followed here.

Ned's rope option now reaches the captured 15 coin or four-wool exchange; three wool produces the grey wig separately. Aggie's ingredient statement precedes the paste exchange. Joe takes one beer at 30→31 and the remaining two at 31→40. Tying Keli and disguising the prince each take four ticks; the disguise consumes the wig, skirt and paste, retaining the bronze key. Rescuing the prince sets 100; Hassan completes at 110 with 700 coins and 3 QP. The Al Kharid gate grants free passage at rescue 100.

## The Corsair Curse

The main wire states are 0,5,10,15,20,25,30,35,40,45,49,50,52,55,60. Existing compact saved quest stages are preserved and mapped to those states. Colin, Gnocci and Arsen retain independent varbits 6072/6073/6074, with navigator 6075. Opening a dialogue variant never advances an investigation: the relevant spoken line commits progress. The relic stages include acquisition, Tess's explanation and the separate report to Arsen.

Scenes, the dig, the fire, Ithoi's fight, the journal and the capture facts behind them are in
[quests/the-corsair-curse/README.md](quests/the-corsair-curse/README.md) (rsprox capture local 1001340, a whole run of
the quest at revision 240.1). Tock completes 60 with 2 QP and bank access; Yusuf's bank remains closed until completion.

## X Marks the Spot

The capture sends cluequest 8063 through 0→1 on accepting,2 on Veos's scroll line,3/4/5 on the three clue digs,6 on finding the casket,7 on handing it over and 8 on completion. Existing saved stages 1–6 are mapped to this wire sequence, with an extra saved handover flag. The previously looping quest shortcut now reaches the same start menu as the longer introduction, with native Yes/No wording.

Scrolls open native clue-text 203:2 and map 267. Digging swaps the current clue and presents its native item box, including the casket's whisper and subsequent player dialogue. The recording successfully digs adjacent to the published pins at 3230,3209;3203,3212;3109,3264;3078,3259. The dig hook runs before generic spade handling. Canonical Veos parents 8632 and 1063 use visibility varbits 12151 and 12148; no permanent owner copies are spawned. From *A Kingdom Divided* stage 12 (`akd` 12296), when Cabin Boy Herbert takes over, 12148 is 0 and the Port Sarim Veos is gone, as captured at `akd` 150.

The orb uses Chebyshev distance, previous-distance 8064, previous-coordinate 3697 and helper script 6473. Recorded readings reproduce cold 95, warm 86/76/73/61, hot 47/35/28 and very hot 22, including warmer/colder comparisons. Casket handover precedes completion, and the final Veos dialogue waits until the player closes the completion scroll; the reward is 200 coins, lamp 23072, beginner box 24361 and 1 QP, with captured reward flags and jingle 154. The lamp uses the shared native skill picker for 300 XP and records its consumed reward flag.

Login after completion restores 8065=1 alongside 8066 and 8258. The bootstrap re-sends
`cluequest` 8063 as value 8 and clears the sibling reward bits in the same varp, so restoring
only the lamp and clue-box flags left the coin reward unset; a completed account now logs in
with the same three captured reward flags it had at the hand-in. Post-quest Veos also still
offers `Can you take me somewhere?` and travels to Port Piscarilius (setting
`zeah_playerhasvisited`, 4897, to 1); the earlier report that Kourend access stayed
unavailable after completion did not reproduce.

## Verification and limits

`node --test tests/f2p-coastal-parity.test.cjs` covers30 progression, exchange, timing, private-scene cleanup, owner-only combat and native-note regressions. Filtered `quest-dialogue.test.cjs` covers the five quest variant maps and Fight Arena. These tests use the production cache and quest modules, with deterministic task ticks and packet/NPC mocks; they are not full client playthroughs.

The Corsair Curse's scenes and fight are covered by `tests/corsair-curse-capture.test.cjs`, against the capture's ticks. Pirate's Treasure, Prince Ali Rescue and X Marks the Spot have no quest-directed camera move/look-at sequence in their supplied successful captures.

The recordings do not establish Ithoi's spell probabilities or the distribution of his combat shouts. Selection is uniform among the captured choices. Uncaptured post-quest/member alternatives and abandoned-dialogue timing have not been claimed as packet-identical.

Live agent MCP checks on this worktree verified canonical Veos dialogue through the repaired quest shortcut, its native Yes/No start, the first adjacent-tile dig and native map 267. A separate player used the key print on Edgeville furnace 16469 and received bronze key 2418 after confirming; both ingredients disappeared and Prince Ali's state remained 20. These accounts were explicitly logged out to save progress. The initial live Ned purchase exposed a Fight Arena condition hook matching the substring “5 coins” in “15 coins”. Its condition hook now returns null outside Fight Arena’s full set of dialogue NPCs. A full quest-registry dialogue regression passes, and the live retry charged 15 coins and granted Rope 954 through the native handover statement, without the members-only Fremennik tail.

Orb readings at exact unrecorded temperature boundaries, distant/other-plane readings and lamp reclamation are not established by this capture. The implemented temperature bands interpolate the recorded categories; boundary captures would be needed to call them exact. Post-quest Kourend travel and the wider Treasure Trails system remain outside these quest modules.
