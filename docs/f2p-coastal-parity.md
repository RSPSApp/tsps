# Coastal free-to-play quest parity

Source evidence is the revision 240 rsprox sessions dated 15–17 August 2026 from issue #600's F2P recordings. Cache 241 supplies current item, NPC and object identities. No recordings or player identifiers belong in this repository. The recordings show one successful route through each quest; uncaptured alternative routes use the existing OSRS dialogue and quest rules.

## Witch's Potion

The ingredient request commits varp 67=1 when Hetty names the ingredients (capture tick 1462). Handing them over initially displays a statement; the four ingredients are removed and state 2 is sent when she says to drink (1574). Drinking the cauldron shows its statement before continuing to state 3, 325 Magic XP, 1 QP and jingle 154. Rats retain their quest-tail drop hook.

## Pirate's Treasure

The rum, banana crate, plantation employment, apron check, shop search and Frank handover remain separate requirements. Wydin's previously empty job branch now opens his employment dialogue. Canonical Zembo supplies the rum shop. The note uses native handwritten interface 222, with the Falador clue on children 5/6; reading it changes varp 71 from 2 to 3.

The first dig summons gardener 3651 at 2997,3382. Digging while he still threatens the player is refused. A successful dig takes four ticks and grants casket 7956, 1 QP and jingle 153. Opening that casket grants 450 coins, gold ring 1635 and emerald 1605 once, respecting inventory capacity. The note and key are separate stages, and the casket's contents are deferred until it is opened. The Varrock chest opens as object 2080 for four ticks; the key is exchanged for the note when object 2079 returns. Logging out restores the closed chest without consuming the key.

Captured sailing (rsprox captures 1434 and 1653, Seaman Lorris, Captain Tobias and the Customs officer) charges 30 coins with "You pay 30 coins and board the ship." On the same tick the player is put on the ship at sea (a one-chunk instance of map chunk 3064,3208 plane 1), song 147 and jingle 172 play, `ship_journey` (299) opens with script 1131 (route 4 to Karamja, 5 to Port Sarim), and the side tabs close (combat to magic, logout to music). Nine ticks later the tabs come back, 299 closes, the player stands on the destination ship's deck, 2956,3143,1 (Musa Point) or 3032,3217,1 (Port Sarim), and a message box says "The ship arrives at Karamja." / "The ship arrives at Port Sarim."; the gangplank leads ashore. Logging out at sea lands the player on that deck. Repeat travel during the voyage cannot charge twice. The Pandemonium trips have no capture and still move the player after five ticks. Carrying rum through the customs travel option goes through the confiscation conversation.

## Prince Ali Rescue

Varp 273 follows 10→20→30→31→40→50→100→110. Historical saved internal 21/22 key states still report wire 20. The modern key route uses key print 2423 on a furnace, asks for confirmation, consumes a bronze bar and the print, and grants bronze key 2418 plus 2 Crafting XP after one tick. Leela accepts a fully prepared player at 20 without requiring the historical Osman key route.

Ned's rope option now reaches the captured 15 coin or four-wool exchange; three wool produces the grey wig separately. Aggie's ingredient statement precedes the paste exchange. Joe takes one beer at 30→31 and the remaining two at 31→40. Tying Keli and disguising the prince each take four ticks; the disguise consumes the wig, skirt and paste, retaining the bronze key. Rescuing the prince sets 100; Hassan completes at 110 with 700 coins and 3 QP. The Al Kharid gate grants free passage at rescue 100.

## The Corsair Curse

The main wire states are 0,5,10,15,20,25,30,35,40,45,49,50,52,55,60. Existing compact saved quest stages are preserved and mapped to those states. Colin, Gnocci and Arsen retain independent varbits 6072/6073/6074, with navigator 6075. Opening a dialogue variant never advances an investigation: the relevant spoken line commits progress. The relic stages include acquisition, Tess's explanation and the separate report to Arsen.

The introductory ship view, Colin and Gnocci recollections, telescope view and fire proof use private areas, temporary actors/scenery and camera packets. Ending, leaving or logging out restores the player's model, location, controls and camera, and removes temporary actors. Canonical crew morphs are used in the shared world. The present-day clockwork doll appears one tick after digging, follows the captured nine-tile path and disappears ten ticks later; it is owner-only and removed on logout. The ogre-cavern vine ladder animates for one tick and preserves the north/south entry side at 2523,2861 ↔2012,9005.

The fire proof sends 49 during its private scene and 50 after Ithoi exposes himself. The subsequent conversation sets 52. Entering the hut then creates an owner-only aggressive Ithoi 7964; unrelated or other players' kills cannot advance the quest. Ithoi attacks every five ticks using the captured elemental strikes and Curse, with strike damage capped at 6 and no direct Curse damage. Killing him sets 55; Tock completes 60 with 2 QP and bank access. Yusuf's bank remains closed until completion.

## X Marks the Spot

The capture sends cluequest 8063 through 0→1 on accepting,2 on Veos's scroll line,3/4/5 on the three clue digs,6 on finding the casket,7 on handing it over and 8 on completion. Existing saved stages 1–6 are mapped to this wire sequence, with an extra saved handover flag. The previously looping quest shortcut now reaches the same start menu as the longer introduction, with native Yes/No wording.

Scrolls open native clue-text 203:2 and map 267. Digging swaps the current clue and presents its native item box, including the casket's whisper and subsequent player dialogue. The recording successfully digs adjacent to the published pins at 3230,3209;3203,3212;3109,3264;3078,3259. The dig hook runs before generic spade handling. Canonical Veos parents 8632 and 1063 use visibility varbits 12151 and 12148; no permanent owner copies are spawned.

The orb uses Chebyshev distance, previous-distance 8064, previous-coordinate 3697 and helper script 6473. Recorded readings reproduce cold 95, warm 86/76/73/61, hot 47/35/28 and very hot 22, including warmer/colder comparisons. Casket handover precedes completion, and the final Veos dialogue waits until the player closes the completion scroll; the reward is 200 coins, lamp 23072, beginner box 24361 and 1 QP, with captured reward flags and jingle 154. The lamp uses the shared native skill picker for 300 XP and records its consumed reward flag.

## Verification and limits

`node --test tests/f2p-coastal-parity.test.cjs` covers22 progression, exchange, timing, private-scene cleanup, owner-only combat and native-note regressions. Filtered `quest-dialogue.test.cjs` covers the five quest variant maps and Fight Arena. These tests use the production cache and quest modules, with deterministic task ticks and packet/NPC mocks; they are not full client playthroughs.

The camera audit covers all five Corsair scenes and all23 move/15 look-at packets in the full recording, including the source-coordinate equivalents of Colin's OSRS instance positions. It preserves exact coordinates, heights, rate pairs (including6/0 and1/0 ship pans), shake clearing, reset timing and terrain-height mode. Missing telescope, flashback and fire-proof pans are restored; the fire's second shot is7 ticks after its initial framing. Tock's ship view and Gnocci's final8-tick burial cut run automatically while their lines have no Continue button. Scene-owned task cancellation prevents shots after leaving. Pirate's Treasure, Prince Ali Rescue and X Marks the Spot have no quest-directed camera move/look-at sequence in their supplied successful captures.

The recordings do not establish Ithoi's spell probabilities or the distribution of his combat shouts. Selection is uniform among the captured choices. Fade overlays and other scene animation pauses have not all been audited. Uncaptured post-quest/member alternatives and abandoned-dialogue timing have not been claimed as packet-identical.

Live agent MCP checks on this worktree verified canonical Veos dialogue through the repaired quest shortcut, its native Yes/No start, the first adjacent-tile dig and native map 267. A separate player used the key print on Edgeville furnace 16469 and received bronze key 2418 after confirming; both ingredients disappeared and Prince Ali's state remained 20. These accounts were explicitly logged out to save progress. The initial live Ned purchase exposed a Fight Arena condition hook matching the substring “5 coins” in “15 coins”. Its condition hook now returns null outside Fight Arena’s full set of dialogue NPCs. A full quest-registry dialogue regression passes, and the live retry charged 15 coins and granted Rope 954 through the native handover statement, without the members-only Fremennik tail.

Orb readings at exact unrecorded temperature boundaries, distant/other-plane readings and lamp reclamation are not established by this capture. The implemented temperature bands interpolate the recorded categories; boundary captures would be needed to call them exact. Post-quest Kourend travel and the wider Treasure Trails system remain outside these quest modules.
