---
quest: Ghosts Ahoy
key: ghosts_ahoy
status: passed-with-issues
tested: 2026-11-12
tester: agent
model: claude-opus-5-5
commit:
cache: osrs-242_2026-11-03
start: checkpoint
travel: ::tele between legs
---

# Ghosts Ahoy

Aligned with a complete live run, start to finish: rsprox captures, revision 242 recording
`20261112T092603-5ab63b4` (the ticks below are that recording's). Issue
[#4166](https://github.com/RSPSApp/tsps/issues/4166): the Old crone never took the tea, so the
quest stopped at stage 3. The dialogue gaps are filled in osrsreboxed-db (Transcript:Ghosts Ahoy,
Ghost guard and Old crone capture sources).

## Capture facts the plugin relies on

**Progress varbits (varp 408).** `ahoy_questvar` 217 is the stage, sent as it is (1 asked
Velorina, 2 Necrovarus refused, 3 sent to the crone, 4 tea drunk, 5 materials in, 6 enchanted,
7 commanded, 8 complete). Ak-Haranu's multi-NPC (5859) shows him only at 4-8. The other varbits:
`ahoy_subquest_nettletea` 211 is 1 on "Yes, I would love a nice hot cup of nettle tea." (361),
2 with the cup (365) and 3 with the tea drunk (409). `ahoy_subquest_toyboat` 214 is 1 with the toy
boat (459), 2 on "The Captain says yes." (819) and 3 when the chest is unlocked (917).
`ahoy_subquest_bow` 212 is 1 on "Okay, wait here" (1197), 2 on the first Runedraw game (1232),
3-6 a win each (1318, 1348, 1381, 1407), 7 on the signing box's continue (1415) and 8 with the
manual (1458). `ahoy_signaturecounter` 209 is 1 with the form (1523), +1 a signature, 11 at ten
(1609) and 31 once burned (1642). `ahoy_killed_lobster` 215 (615), `ahoy_templedoor_unlocked` 213
(1689), and `ahoy_given_robes`/`_book`/`_manual` 207/208/206 (1801-1803).

**Barrier and guards.** Pay-toll short of 2 tokens: the game message "You don't have enough tokens
to pay the toll.", then the guard's "All visitors to Port Phasmatys must pay a toll charge of 2
Ectotokens." and the menu "I don't have that many Ectotokens." / "Where can I get Ectotokens?"
(105-123). Paying in: the spam line "You pay the 2 ectoken toll to enter Port Phasmatys." (141,
244, 1081). The town is on the side each barrier faces; walking out is free (215, 1628). From
questvar 7 there is no toll (1952). With the bedsheet worn: the message box "You can't pass the
barriers of Port Phasmatys while wearing the bedsheet." and no crossing (1621).

**Velorina and Necrovarus.** Questvar 1 on "Yes." (203); 1→2 on Necrovarus's "Get out of my
sight!!..." (228); 2→3 on Velorina's "She fled before..." (261). Her vision says "there looms
castles". At the end: "Velorina gives you a vial of bright green ectoplasm." is an item box
(1971); the quest completes as "Remember that once the Ectophial..." shows (1973). The scroll
lists "2 Quest Points", "2,400 Prayer XP", "An Ectophial", "Free Port Phasmatys Entry".

**The Old crone.** With Animal Magnetism done every talk opens with "I'm here about
Necrovarus." / "I'm here about the farmers east of here." (346; the farmers' line names Malcolm,
349). A bowl of nettle tea gets her special cup in an item box (365). The tea into the cup and the
milk into the tea make no message (373-383). The milky tea: questvar 3→4 and the cup gone as the
player offers it (409), then the message box "As the old woman drinks..." (411). Wearing the
amulet only plays "Yes, I'm wearing one right now." (448). Her first materials speech ends with
"I cannot read the strange letters..." (452). The toy boat is an item box showing the repaired
model (459). The hand-in is one talk: "I have something for you." (robes taken), "Good - the robes
of Necrovarus.", the book and manual lines (taken as they show), "Wonderful; that's everything I
need." (4→5), "I will now perform the ritual of enchantment." Its continue closes the chat and
she plays anim 818 (1805); three ticks later questvar 6, the worn amulet becomes 4250 and the item
box "The ghostspeak amulet emits a green glow from its gem." (1808).

**Robin and Runedraw (interface 9).** With the oak longbow: "Would you sign this oak longbow for
me?", "I'm sorry, I don't sign autographs.", "While you're here, though..." (1227-1229).
"Yes, I'll give you a game." takes 25 coins on the pick (1232). The board opens on the continue,
with every slot and text cleared and both layers shown (1233). The bag is ten runes for both
players (air 1 ... nature 9, death). After a draw, the score shows, both layers hide, Robin's text
reads "Thinking..." and he draws 2-4 ticks later (5 after Hold). Then "Your turn", and Hold shows
only while the player is ahead. Death ends it: "You lose!" / "You win!" and the game message
"You've lost the game of Runedraw." / "You've won the game of Runedraw!". The board stays open
until closed, then the player says "Well done, you beat me." (nothing owed) or "So are you going
to pay up then? You owe me 25/50/75 gold coins!". At 100 the threat and the item box "Robin signs
the oak longbow for you." (1410-1415). Talking to him after a loss replays the loss lines (1274).

**Ghost villagers.** "Would you sign this petition form, please?" then a random answer; asked
again, the same ghost says "You only just asked me the same thing!..." (1541). Bribes name 1-3 ecto-tokens
(Transcript: "Oh, it'll cost you [1-3] ecto-tokens.") and take what they name; the capture's three
asks were all 2 (1528-1533). Each signature is an item box "The ghost
signs your petition. You have obtained N signature(s) so far." The tenth is "You have succeeded in
obtaining 10 signatures on the petition form!" (1609). "My answer is no." is one of the refusals
(1538).

**Necrovarus's petition and tomb.** "The petition form turns to ashes in your hand." and "In his
rage, Necrovarus drops a key on the floor." are message boxes (1642-1643); the key lies on the
floor (picked up at 1648). The locked door (3656,3514,1) brings a Ghost disciple's "What are you
doing going in there?" (1668). The bone key on it: spam "You unlock the door." and the key is kept
(1689). Open: inviswall 38848 on the door tile, the open door on the tile west, sound 56, back two
ticks later (1691-1693). The coffin: "The coffin creaks open..." (1696), Search gives the robes in
an item box then "Nothing interesting happens." (1699-1702), Close gives spam "You close the
coffin." (1705).

**The command.** "A beam of intense green light..." is an item box with the enchanted amulet
(1939). Its continue makes questvar 7 and the worn amulet back to 552 (1940).

**The shipwreck.** Open on the chest gives anim 536 and sound 52, and the chest opens a tick later
(587-588, 965-966); Close gives 535, 51 (973). Searching the guarded chest: spam "You are attacked
by a giant lobster!!", lobster 2994 at 3616,3543, hint arrow (591); its death sets 215 and clears
the arrow (615). The next search gives map scrap 2 in an item box (617). The office chest: "The
chest is locked." (907); the key on it gives the item box "You unlock the chest." (917). Open:
the chest shows open (16117, sound 62) with scrap 1 in an item box, and on its continue "You
search the chest but find nothing." and it shuts (920-921). The top deck opens the ahoy_windspeed
overlay showing "High" (632); varbit 205 flips at random (gusts of 2-25 ticks) and the overlay
closes off the deck (768). The mast's Search is a message box: "...blowing in the wind." plus
"The wind is blowing too hard to make out any details." when high, or one random part ("The top
half of the flag is coloured orange." etc.) when low. Repairing the boat ("You replace the toy
boat's missing flag.") and each dye ("You dye the top of the flag orange.") are item boxes.

**The rocky island.** The gangplanks: spam "You cross the gangplank." and the move a tick after
arriving (934, 1014). Each rock jump is a forced walk to the take-off, then anim 1604 (delay 26),
sound 2461 and the move. A fall plays anim 767, sound 2455 and hits 3 two ticks later, with no XP
(981-985). The island chest gives scrap 3 (968). The three scraps make the map in an item box
(1025).

**The Ghost captain.** Travel has no dialogue. On reaching him 25 tokens go (outbound only; 10
with the Ring of Charos(a) worn, per the Wiki), the
screen fades out (174, script 948 `[0, 255, 0, 0, 50]`) with the caption "After a long boat trip
you arrive at Dragontooth Island." / "... you return to Port Phasmatys." The move comes four
ticks later (3792,3559 / 3702,3487), the fade in a tick after (`[0, 0, 0, 255, 50]`), and the
overlay closes two ticks after that (1115-1122, 1160-1167).

**Dragontooth.** Digging at 3803,3530 with the map gives the item box "You unearth the Book of
Haricanto." three ticks after the dig; the map is kept (1138-1141).

## Not covered

- Ours: the rock fall chance (the capture fell once in ten jumps), the wind's gust lengths
  (drawn evenly from the captured 2-25 ticks) and the Runedraw shuffle.
- Not captured: Robin's lines after a loss while he owes coins (the transcript's are used), the
  Gravingas line for 2-3 signatures (Ours: his one-signature line; the transcript has none) and
  the treasure map's Read (Ours: "This map is for use elsewhere.").
- The bedsheet's look and any change to the villagers' answers without it (the capture always
  wore it).

## Runs

### 2026-11-12 · agent · claude-opus-5-5

- **Start:** checkpoint, prerequisites completed by command and the stage set to 3 with `::quest`.
- **Route:** the crone's tea (cup, brewing, hand-in, toy boat), Ak-Haranu's errand, a Runedraw
  win, the Ghost captain both ways, the temple barrier both ways and short of tokens, and the tomb
  door, key and coffin, over the agent MCP.
- **Result:** questvar 3→4 with 211 = 3 and 214 = 1; 212 = 3 after the win; tokens 39→14, return
  free; the toll messages and menu as captured; 213 = 1 with the key kept; robes from the coffin.
- **Not checked:** a full natural run; the board and the fade on screen.
