# The Fremennik Trials

Server: `server/plugins/quests/quests/FremennikTrials.Quest.js` (the quest, Brundt, the dialogue listeners) and one unit
per trial in `server/plugins/quests/fremenniktrials/` (`State` is the shared context; `Journal` and `Name` the journal and
the Fremennik name). Issue #4886.

Sources: rsprox captures of the whole quest in one session (local 1002236, rev 242: start t3091, complete t10305), every
trial again from just after the start to completion and the unlocks after it (local 1002313, rev 243: Bard t0-863, Reveller
-t1475, Hunter -t1974, Merchant -t3671, Warrior -t6547, Navigator -t6871, Seer -t7497, complete t7531, Rellekka and its
ferries t7531-8351), the third trial on to completion (local 1001646, rev 241), single trials (local 1002250 and 1002249,
rev 242; local 1001364, rev 241; local 1002247, rev 242), plus the OSRS Wiki and its transcript for branches no capture
shows. Ticks below are those recordings' own. Every captured line's chathead animation is in
`plugins/quests/data/chathead-animations.json` (1002313).

## Quest state

- Live keeps every trial's progress on the server. The only quest var it sends is `viking` (varp 347): 0 -> 1 when the
  player says "Yes." to Brundt (1002236 t3169, with "You've started a new quest: The Fremennik Trials"), up by one as each
  trial passes (2 ... 8), and 10 once Brundt accepts the player (t10305). We store stage 1..7 with 8 complete and send
  1 + trials passed (`nativeProgress`).
- Trials are three bits each in `quest.fremennik_trials.trials` (0 none, 1 started, 2 passed). `completeTrial` sends no
  message: each trial's own line says it, where live says it.
- Every council member on Sigmund's trading chain opens with "Ask about the Merchant's trial | Ask about becoming a
  Fremennik" while it runs. The second option replays that member's own trial offer (the dump lost its jump).

## Completion and the Fremennik name

- With seven votes Brundt says "Greetings again outerlander! ..." and the seven-vote lines; on the last one's continue
  the quest completes (1002236 t10284-10305). The scroll shows the Fremennik helm (3748) and live's own reward lines
  ("3 Quest Points", "2,800 XP each in Strength," ... "Woodcutting"); the jingle is 153 ("quest complete 2"). No item is
  given: the old Fremennik blade reward is gone.
- Once the scroll is closed, Brundt says "From this day onward, you are outerlander no more! ... You will now be called
  <name>." (t10313 -> t10314). The name is one of 16 prefixes and 16 suffixes (Wiki, "Fremennik name"); the captures
  show Thorvald and Raktin. It is saved in `quest.fremennik_trials.name`, rolled for players who finished before it
  existed, shown in the journal ("They also gave me a new name:", 1001646 t3517) and spoken wherever a dialogue says
  "[Fremennik name]". Other plugins ask for it with the custom event `fremennik-trials:name`.
- Ours: in 1001646 Brundt said "Raktin" while the journal read "Raklak" on the same tick; we use the saved name for
  both. Not shown: the quest rating interface (983), which live opens with the scroll and closes with it (1002313 t7531,
  t7538), and the last_completed_quest varbits; both are QuestRuntime's, for every quest.
- The scroll's helm sits at 74,128 (1002313 t7531, if_setposition).
- The reward's level-ups wait until the naming line is continued (1002313: scroll closed t7538, Brundt's line, the Fishing
  level-up at t7546). SkillLevelUp holds an announcement while a plugin answers `skill-level-up:hold`; the Name unit does
  from the completion until the naming line closes.
- Brundt with no votes: "I don't have any votes yet." and the "Go and speak to the twelve members..." line, without the
  "Remember:" line (1002313 t692, t782; data condition 61Mzn_).

## The journal

The running journal is live's (1002313, read 14 times from t93 to t7510): the struck start, the vote line ("I don't have
any votes yet" + "I should try and find some of the council members", "I have one ... six vote(s) so far", "I have seven
votes! I should go and speak to Brundt again"), then one section per trial in a fixed order: Navigator, Merchant, Hunter,
Seer, Warrior, Reveller, Bard. A trial not started is one blank line (the Merchant three), a passed one its struck "I now
have the X's vote at the council" (the Merchant's after two blanks); full stops as live has them. Running sections:

- Hunter, Reveller, Seer: the header "The X will vote for me if I can pass his trial" and the task line.
- Merchant: header, "Someone in this town has a rare flower that he wants.", a blank, the current request's line, a
  blank. Only the armourer's ("...a rare inedible fish...", t2582) is captured; other links show none.
- Bard: header, task, the three steps, then by the lyre held: golden wool (t323), strung lyre (t452), enchanted (t611).
- Ours: the Navigator's and the Warrior's running lines (no recording reads them), in the captured headers' pattern.

## Rellekka's townsfolk

`fremenniktrials/Townsfolk.FremennikTrials.js`, registered after every quest (Quests.plugin.js) so a later Fremennik
quest's own stage window answers a shared NPC first:

- While the quest runs, the townsfolk not on the council play the quest page's "not a council member" talk (1002313 t701
  Bjorn, t707 Eldgrim, t2390 Agnar; the others the Wiki's).
- Once it is complete, every Rellekka NPC plays their own page's after-the-quest talk, as live does (1002313
  t7650-t8337): Eldgrim, Bjorn, Thora, Askeladden, Sigli, Inga, Skulgrimen, Thorvald, Sigmund, Jarvald (his Waterbirth
  trip is free there), Haskell, Torfinn, Agnar, Yrsa, Peer, Swensen, Olaf, the fish monger, Manni, Lalli and the bouncer.
  The trial units stop answering at completion. The module answers those talks' conditions (inventory space, a pet rock
  kept, 1,000 coins, Jarvald's armour parts by item name) and hand-outs (Askeladden's new pet rock, Lalli's fleece for
  1,000 coins, Wiki; with a full inventory the fleece goes on the floor). Brundt's "(Charm) Can I have a new name?" stays
  hidden: its rename ("[new Fremennik name] [honorific]") is not implemented; live showed his four options (t7563).
- Brundt after the quest, before the Exiles: "Ask for a quest. | Ask about anything else." (the Seal of Passage and
  mountain camp options once Lunar Diplomacy / Mountain Daughter are started); "Ask for a quest." is his "Not at the
  moment" line and the requirements message box while the Exiles cannot start (t7551-t7563).
- Olaf's Music cape is his page's "About the Music Cape..." (Music.plugin.js answers its conditions and the sale); the
  invented "Buy a music cape" menu is gone.
- Yrsa's "I'd like to change my shoes" opens the makeover on shoes (1002313 t8292; Makeover.plugin.js).
- Ferries (`plugins/world/data/ferries.json` gates): the Sailor's Miscellania option mid-quest plays his "not a council
  member" lines (1002313 t3630; 1001646 t1505); after the Trials and before the Isles, Mord and Maria refuse with their
  message boxes (t7989, t8001, t8014).
- Recorded differences: Waterbirth landings 2543,3762 out and 2620,3685 back (1002313 t8088, t8119), against ours
  2545,3761 and 2621,3683 from recording 2714. Not done: misc_visited / misc_approval 32 on the first Miscellania
  arrival (t7924; Throne of Miscellania's state) and dag_island_quick_travel (t8081).

## Manni the Reveller

Unit: `server/plugins/quests/fremenniktrials/Reveller.FremennikTrials.js`. Test:
`server/tests/fremennik-trials-reveller.test.cjs`. Captures: 1002236 (rev 242), 1002250 (rev 242,
the win), 1001364 (rev 241).

- **Offer** (1002236 t3188-3256): no items. The trial starts on "A drinking contest? Easy..."
  (the Yes branch). Old saves still start it on condition step KniVWy.
- **The keg** is a ground item: viking_beerkeg (3711) on the table at 2660,3676,0. The unit adds it as
  a `ground_items` definition source (`fremennik-trials-keg`, members only, respawn 1). Take is the
  core table take: seq 9401 and synth 2582 (t3262). If the player already has a keg: "You already have
  a keg of beer." (t5802). Ours: live puts the keg back on the same tick. Ours comes back two ticks
  later, because the core respawn task runs on the next tick's task pass.
- **Manni's conditions** test the keg, not the tankard. With the keg he plays the contest talk.
  Without one he plays the "after the player's loss" talk ("Grab a keg of beer from that table...").
- **The contest.** On the "As you wish" continue the chatbox closes and Manni plays seq 1327. Then:
  - +2: "The Fremennik drinks his tankard first. He staggers a little bit."
  - +7: the player's seq 1330 and the drink message. On a loss this is "You feel extremely drunk..."
    with synth 2401. On a win it is "You don't feel at all drunk." with no sound.
  - +9: the keg is removed. On a loss cam_shake 3/0/20/2 is sent through CameraShake "atmospheric".
  - The rest of the talk follows: +15 after a loss (t3285-3300), +12 after the win (t5836-5848).
  - A loss sends cam_reset as "Come back if'n..." opens (t3309).
  - Talk-to on Manni does nothing while the scene plays (t5839).
- **The win.** "Congratulations! You have completed the Revellers' trial." is sent once, as
  "I jusht can't..." opens. The trial passes on that line's continue (KrSm12, varp 347 +1, t5868). The
  hidden LOW_ALCOHOL flag is cleared then. The win menu's "No" has a dangling jump in the data, so it
  plays the again talk's "No" ("I'm not quite ready yet...").
- **Council workman** (t4744): a beer or a beer tankard used on him becomes the strange object in the
  drink's slot as his first line opens. His wink ("The workman winks at you") is a message box
  (1001364 t3084).
- **Strange object** (t5690): the tinderbox lights it, with synth fuse_light 2598.
- **Pipe** (viking_pipe_end_longhall 4162, t5697): the lit object gives "You put the lit strange
  object into the pipe." and the player's line (chathap3), with no bang. Wiki: anything else gets
  "I don't have anything I really want to put inside a smelly old drain pipe.". An unlit object gets
  "Nothing interesting happens.".
- **The switch** (t5811-5813), 3711 on 3712 in either order, with the object in the pipe:
  - Same tick: "You hear a loud bang from outside. It echoes through the drain." and area sound 1487
    (range 10, at 2659,3685,0).
  - Next tick: "You empty the keg and refill it with low alcohol beer." The low-alcohol keg is removed
    and the held keg stays 3711 (hidden flag). "What was THAT?" comes from Thora, Eldgrim, Bjorn,
    Manni and Brundt, and a tick later they face the pipe.
  - One bang per object: FIRECRACKER is cleared.
  - Wiki: without the object in the pipe, Manni's "Thinking of cheating my test, outerlander?" plays.
- **Poison salesman** (t4461-4652): 250 coins for the low-alcohol keg. "The salesman takes a deep
  breath." and "He seems to have finished for the time being." are message boxes. Every Talk-to while the
  quest runs opens on "Talk about the Murder Mystery Quest | Talk about the Fremennik Trials" (1002313
  t1193, t1203, t1217). Once the pitch has been heard (attribute `quest.fremennik_trials.poison_pitch`, Ours)
  or a keg bought, the Fremennik option is his "again" offer; its Yes and No are the pitch's own and answer
  on the pick's tick (t1214, t1222), so a lost keg can be bought again. Before and after the quest he plays
  his own page.
- **After the quest (Wiki):** Manni's own page `after-the-fremennik-trials` ("Hey! It's [Fremennik
  name]!"). He gives a beer (RSKxfK). Ours: no beer when the inventory is full.
- **Lit object timer (Wiki):** a lit object still in the inventory after 117-167 ticks (70-100 s)
  explodes. The player gets "The strange object you lit earlier explodes in your inventory!", says
  "Ow!" overhead and takes 4% of max Hitpoints (minimum 2). The object is gone. Ours: the object
  being removed, and the fuse starting over after a relog.
- Not covered:
  - The busy varbit 12393.
  - The area sound reaches only the player who switched the kegs. Live's sound_area is zone-wide.
  - The overhead "What was THAT?" is sent by the unit, so the data's "what was THAT?" is not used.

## Olaf the Bard

Captures: 1002236, 1002247, 1002250 (rev 242), 1001364 (rev 241). Test: `server/tests/fremennik-trials-bard.test.cjs`.

| Step | What plays (source) |
| --- | --- |
| Olaf | Offer / reminder / vote variants; "Yes" starts the trial; `ctx.offer` replays the same. Merchant-chain variants come first (Merchant unit). |
| Swaying tree (Cut-branch) | No usable axe: "You need an axe to chop down this tree.<br>You do not have an axe that you have the Woodcutting level to use." With one: spam "You swing your axe at the tree." + the axe's seq on arrival; 3 ticks later seq -1, the branch, "You cut a branch from the strangely musical tree.", 1 Woodcutting XP. Several branches allowed (1002236 t3749-3756, 1001364 t2102, t2295-2319). Full inventory: the data's line (Wiki). |
| Knife on branch | "You craft an unstrung lyre out of the branch." + seq 1248 on the click; the unstrung lyre in the branch's slot +1 tick, 1 Crafting XP (1002236 t3761-3762). |
| Lalli | First talk; with the pet rock the plan, ending in a message box (t4129). After the plan (bit `quest.fremennik_trials.bard` 0, or any soup item for old saves) Lalli's "talking-to-lalli-again" (Wiki). After the soup: the fleece arrives with "Here you go. Hah! ..." (t4213). |
| Askeladden | Rock + varbit askelladen_hasop 6486=1 as his last line ("Sure thing buddy, although...") shows (t4008); varbit resent at login (bit 1). Afterwards / lost rock: the "again" variant, whose lost-rock branch gives another (Wiki). |
| Rock soup | Each item on Lalli's Stew: its own "You put a potato/an onion/a cabbage/your pet rock into the cauldron."; vegetables then Lalli "It am ready now?" / "Not just yet..."; the 4th item (any order) plays the done branch (2e7LZD) (1002236 t4140-4186, 1001364 t1975-2064). Trial not started: Lalli's own "attempting-to-put-anything" line (Wiki). |
| Spinning | Fleece on a spinning wheel (2 ticks after arrival: 1002313 t317-319, 1002236 t4410-4412) or the wheel's Spin with a fleece held: seq 13138, loc anim 466, sound 2590; the wool in the fleece's slot 3 ticks later, 2.5 Crafting XP (Wiki), no message, no menu (1002236 t4412-4415, 1001364 t2419). Rellekka's wheel before the quest: "Only Fremenniks may use this spinning wheel." (Wiki). |
| Stringing | Golden wool on the unstrung lyre: "You attach the golden strings to the lyre.", the lyre in the lower of the two slots, 1 Fletching XP, same tick (t4419; 1002313 t331, 1002247 t5862, 1001364 t2429). Under 25 Fletching: the data's message. |
| Strung lyre Play | Player line "I really wouldn't know where to begin playing anything on this..." (1001364 t2435). |
| Altar | Raw shark / manta ray / sea turtle on the Strange altar with the strung lyre held: "Fossegrimen has enchanted your lyre so that you may play it.", seq 8315, spotanim 758, sound 136, Fossegrimen (owner-only) rises at 2626,3596 facing the player, the enchanted lyre goes into the fish's slot, her blessing line (chatneu2) (1002236 t4800). She stays until the player is more than 16 tiles away (t4825) or logs out. |
| Summon / Talk-to | Fossegrimen rises (once) and plays "talking-to-the-fossegrimen" (first line chatquiz1); a fish not held is a message box (1001364 t2661-2700). A held worthy fish picked there enchants as the altar does, all on the pick's tick (1002313 t524). |
| Backstage door | With the enchanted lyre: inviswall 38848 at 2667,3683 + viking_door_inactive 4249 rot 1 at 2666,3683, sound 62, the player walks through; +1 the bouncer's "entering-the-backstage" line (+0 in 1002313 t804), he and the player face each other; +2 the door is back. Leaving: the same swap, no line (1002250 t805-808). Without the lyre: the bouncer page's refusal (Wiki; after the trial its "after-completing" variant). |
| Tuning | Play on the enchanted lyre off stage (or with no trial to pass): W "You withdraw your lyre." + seq 1318 (W the click tick standing, 1002313 t536; a step later after a walk, 1001364); W+1/4/7/10 "Doh Ray Me So." / "Fah La Ti Doh." / "La La La La." / "De-Doo-De-Doo." with seq 1321, silence, jingle 165/164; W+13 seq 1320 + jingle 163; W+15 "Your lyre is perfectly tuned.". Walking stops it (1001364 t2712-2730, 1002313 t539). |
| Performance | On stage (2655-2662, 3683-3685) in the trial: M "You withdraw your lyre." (movement held, faces the hall); M+1 seq 1318; M+2/6/10/14 the ballad overheads + seq 1321 + silence + jingle 165/164; M+18 "Your lyre is perfectly tuned." / "Congratulations! You have completed the Bard's Trial!" / "As you finished playing you felt Fossegrimen's power leave you...", seq 1319, jingle 163, Olaf's two chat_left lines (chatneu3, chatneu2). Last continue: "You feel the musical ability from Fossegrimen leave you..." (rev 243, 1002313 t863; rev 241/242 "from the Fossegrimen"), the vote, enchanted lyre(s) back to strung lyre(s), movement freed (1002250 t814-846, 1002236 t5724-5752, 1001364 t2844-2868). Fridgeir (if near) heckles "Is that supposed to impress us outerlander?" then "I do such feats before breakfast!" 3 ticks later. |

Ballad: the data's conditions in its order, first true: Champions' Guild (32 Quest Points), Heroes' Quest complete, Legends' Quest complete, 99 in a non-melee skill (Wiki trivia), none. The Champions' lines are live's (every capture); the others are the data's (Wiki).

Ours:
- XP for the branch, unstrung lyre and stringing is the capture's whole-number delta (1), no Wiki value.
- Walking off the tree before the 3 ticks cancels the cut.
- A second of the same soup item: "Nothing interesting happens.".
- Summon-menu pick with a raw bass, or with no strung lyre: the talk just ends. Raw bass / the lyre itself on the altar: not handled ("Nothing interesting happens.").
- The heckles come in half the performances (1002236 and 1002250 had them; 1001364 and 1002313 did not, Fridgeir in view)
  and start at a random tick M+14..M+21 (captures: M+14, M+21).
- Olaf mid-trial: the long walkthrough the first time (1002236 t3545), the short reminder ("What do I have to do to earn
  your vote ... again?", data `...-talking-to-him-again-afterwards`) once it has been heard (1002313 t642). What switches
  it is ours (bit 2 of `quest.fremennik_trials.bard`). Each reminder's menu drops the option just picked (data).
- Askeladden: the lost-rock branch hands the rock over as "Sure thing buddy!..." shows (1002313 t119); after the Bard's
  trial he plays his own talk (t2883).
- During the performance only movement is held; a chat closed some other way than its continue still ends the performance (vote given), so nobody stays held.
- Not sent: tracking_logs_chopped +1 and the loot-tracker scripts on the branch, varbit last_quest_id on the vote.

## Sigmund the Merchant's trading chain

Unit: `server/plugins/quests/fremenniktrials/Merchant.FremennikTrials.js`. Test:
`server/tests/fremennik-trials-merchant.test.cjs`.

Live (rsprox 1002236 rev 242 t5891-t7941; 1001646 rev 241 and 1002250 rev 242 the same):

- Sigmund asks for a rare flower. His Yes starts the trial (we set the trial to "started" there,
  so the journal shows it). The requests then run Sailor (ballad) -> Olaf (boots) -> Yrsa (tax cut)
  -> Brundt (hunting map) -> Sigli (bowstring) -> Skulgrimen (fish) -> Fisherman (sea map) ->
  Swensen (forecast) -> Peer (bodyguard) -> Thorvald (Champions' token) -> Manni (cocktail) ->
  Thora (promise) -> Askeladden (5,000 gp for the promissory note, t7220).
- No varp/varbit belongs to the chain; `viking` (347) only moves when the flower goes to
  Sigmund (t7941).
- Every chain NPC opens with "Ask about the Merchant's trial | Ask about becoming a Fremennik".
- Trades happen inside the dialogue, on the tick the NPC's hand-over line opens: Thora t7255,
  Manni t7293, Thorvald t7382, Peer t7432 (the first line after the player's), Swensen t7504,
  Fisherman t7550, Skulgrimen t7592, Sigli t7650, Brundt t7685, Yrsa t7755, Olaf t7834, Sailor
  t7905. The input item leaves, and the output goes to the first free slot (1001646 t1255). No
  message, sound or animation.
- Sigmund takes the flower on the player's "Here's that flower you wanted." (t7941). No
  "Congratulations" message.
- Sigmund op3 Trade before the quest is done: game message "Only Fremenniks may trade with this
  merchant." (1001646 t439, t1523). This is set in `plugins/quests/data/quest-shops.json`.

State: one ordered link table. `quest.fremennik_trials.merchant_chain` holds 0 (not started) or
1 + the number of requests heard (0-13); -1 means "not converted yet". The item the player holds
decides the hand-over leg, so the hand-over leg is not stored. A request is recorded when the
player picks "Ask about the Merchant's trial" on that link's own request. Picking the variant
does not record it, and neither does "Ask about becoming a Fremennik" or closing the menu.
For link i, in this order:

1. holds its input item: the hand-over talk;
2. holds its output item or anything later in the chain: the "after" talk;
3. i is the next request: the request;
4. i was asked before: its reminder (Yrsa, Brundt, Sigli, Skulgrimen, Fisherman, Swensen, Peer,
   Thorvald, Manni and Thora have one). While Sigli's bowstring is wanted, the Sailor, Olaf and Yrsa
   ask the bowstring question instead. Once Thora's request is heard, only Thora reminds: the earlier
   links are asked where Askeladden's note is, each with their own answer (1002313 t3069-t3600, the
   items dropped with every request heard). The others repeat their request.
5. i comes later: the flower question while requests 0-4 are heard, and the bowstring question
   at 5-6 (the Wiki's "finding the ... whereabouts" sections). After that, the NPC's own talk.

Issue 4886 point 4 is fixed. Under the old code a step moved only from exactly the previous step,
while the full request played at any step, and the `bowAsk` guards compared against the
"holds the bowstring" value. So the chain stuck at Skulgrimen and Peer asked about the flower.

Old saves: `quest.fremennik_trials.merchant` (old M_* steps) converts once, on login or first use.
0 -> 0; 1-13 -> the same value (1 + requests heard); 14-26 (item steps) -> 14 (every request
heard). A converted started save also gets trial state 1. The old key is left untouched.

Wiki: a lost chain item means starting again at Askeladden. With every request heard and no chain
item held, Askeladden sells the note again for another 5,000 gp.

Ours:
- An NPC asked before its turn, once Sigli's bowstring phase is past, plays its own talk (no
  variant exists).
- Using a chain item on its NPC (no capture) plays that link's "Ask about the Merchant's trial"
  hand-over branch. The trade still happens on the hand-over line. Using the flower on Sigmund
  plays his flower hand-in.
- The chain applies only to Rellekka's Sailor (viking_sailor 3936), not Sailor 3680.
- After Sigmund's trial is passed, the helpers no longer play chain talks; each NPC's own talk
  answers.

- "Ask about becoming a Fremennik" from the chain's townsfolk not on the council plays their "not a council
  member" talk (1002313 t2178 the Sailor, t2363 Yrsa, t2536 Skulgrimen; Thora and the fisherman from the data).
- Dropping and taking back a chain item sends only the put_down and pick2 sounds; the next link takes the item
  back as usual (1002313 t2963-t3602).
- The Sailor's op3 "Miscellania" while the quest runs plays "Hi. Are you a member of the council?" / "Nope.
  I'm just a sailor." / "Fair enough." (1001646 t1505-1509, 1002313 t3630).

## Swensen the Navigator's maze

Swensen (3925) offers the maze (`...-swensen-s-trial-talking-to-swensen`); "Yes" in that offer
starts the trial (state 1). Re-talks: `-again` while running, `-again-2` once passed. While
Sigmund's trial runs, the Merchant unit answers Swensen first; "Ask about becoming a Fremennik"
replays this unit's offer without its leading "Hello!" (the player already said it before the
menu, rsprox 1002236 t6630).

The maze is a 4x4 grid of rooms under the house. Captured behaviour (1002236 rev 242, 1001646
rev 241, 1002250):

- Entrance ladder 4158 (2644,3657): seq 828 on arrival, the next tick to 2631,10004 (1002236
  t6717-6718). Music "The Navigator" comes from music-areas.
- Correct portals 4150-4156 (S-W-E-N-S-E-N): no seq, sound or message; teleport one tick after
  the player reaches the portal. Landings: 4150 -> 2642,10018; 4151 -> 2650,10004; 4152 ->
  2668,10015; 4153 -> 2630,10029; 4154 -> 2653,10034; 4155 -> 2669,10026; 4156 -> 2665,10038.
- Wrong portals 4157: a random portal tile of a random dark dead-end room (B1 D1 A2 C2 B3 C3 A4
  B4), which can be the room the player is in (1001646 t2792-2804). Only the escape rope gets
  out of a dead end.
- Escape rope 4161: seq 828, next tick to 2647,3658, then Swensen's "Decided you could not solve
  my labyrinth..." lines (branch N8Oic4) start on their own (1001646 t2807-2811).
- Exit ladder 4160: seq 828, next tick to 2649,3661, then "Outerlander! You have finished my
  maze!" (branch TyXhH2) starts on its own; the trial passes (viking +1) as the player continues
  past "Thanks!", with no game message (1002236 t6761-6779, 1001646 t2860-2866).
- Flag `NAVIGATOR` (bit 7 of `quest.fremennik_trials.flags`) is set on the exit ladder and
  cleared on "Thanks!": a player who relogs before then, or an old save that finished the maze on
  the old code, hears TyXhH2 on the next Talk-to Swensen and passes then.

After passing, Swensen's talk opens with the player's "Hello!" (1002313 t6885).

Wiki only (no capture): the entrance ladder before accepting plays Swensen's "Have you no manners
outerlander?..." / "Erm.... sorry I guess."; after passing, the player's "No way am I doing that
maze again!" (branch kPL39A); the house's maze-exit trapdoors (loc 100 at 2647,3657 and
2650,3661) send "You try to open the trapdoor but it won't budge!" / "It looks like the trapdoor
can only be opened from the other side.".

Ours: the start room's up-ladder 4159 has no capture; it works like an escape rope (seq 828,
2647,3658, Swensen's rope lines while the trial runs). Swensen's house door (4247 -> 4248) is the
generic Doors plugin's.

## Peer the Seer's entrance door

The west door of Peer's house (`viking_seers_door1`, loc 4165 at 2631,3667) has a combination
lock under a riddle plaque. Facts from rsprox captures 1001646 (rev 241, ticks 2931-3101) and
1002236 (rev 242, ticks 9896-10024):

- Open shows a message box: "There is a combination lock on this door. Above the lock you can
  see<br>that there is a metal plaque with a riddle on it.", then the menu "What would you like
  to do?" with Read the riddle / Solve the riddle / Forget it.
- Forget it: "You leave the riddle for later."
- Read the riddle: two message boxes (the four letter lines, then "My whole ...<br>What am I?"),
  then the lock opens. Solve the riddle opens the lock at once.
- The lock is `seer_combolock` (298), an if1 modal: script `toplevel_mainmodal_open` (-1, -1),
  then the modal, with each wheel's letter (`seera`..`seerd`, 298:43-46) set to "A" first.
  `seerX_left` steps a wheel back a letter (A to Z, Y, X ...), `seerX_right` forward; the server
  answers each click with the wheel's new letter.
- `seerenter` (298:56) closes the lock with "You have solved the riddle!" or "You have failed to
  solve the riddle.". Solving does not move the player.
- Opening the door after solving lets the player in, with `door_open` (synth 62).

Riddles: MIND (1002236), WIND (1001646) and FIRE (1002313 t6943) as the captures show them. LIFE, TIME and
TREE are from the Wiki's Transcript:The Fremennik Trials.

Ours:

- Each player's riddle is rolled once and kept (`quest.fremennik_trials.seer_riddle`). No
  recording shows how live picks it, but 1001646 read the same riddle three times in 100 ticks.
- Opening the door after solving walks the player in (see the house section below).
- The `busy` varbit (12393) that live sets during the plaque and lock is not sent.

## Peer the Seer's house

Code: `server/plugins/quests/fremenniktrials/Seer.FremennikTrials.js`. Tests:
`tests/fremennik-trials-seer-lock.test.cjs` (entrance lock) and
`tests/fremennik-trials-seer-house.test.cjs` (everything else). Captures: 1002236 (rev 242,
t9725-10290) and 1001646 (rev 241, t2880-3460). Live sends no varbit during the puzzle; all of its
state is on the server. Only `viking` (varp 347) goes up, 7 -> 8, when the player leaves with the key.

Map: the interior is x 2629-2638, y 3659-3666, on planes 0 and 2 (there is no plane 1). A wall at
x=2634 splits plane 0 into a west room (entrance door 4165, the up ladder 4163) and an east room
(exit door 4166, ladder 4164, the mural 4179). The puzzle floor is plane 2. Its west trapdoor 4173
is open in the map; the east one, 4174, starts closed. Every house handler checks this box, so
Swensen's boxes and crates next door, the street and a key used from outside are not part of it.

Peer:

- First talk, variant `the-council-members-peer-the-seer-s-trial`: Yes starts the trial. The bank
  spell (`-sJh9n`; `-rbFGl` from the "depositing your equipment" menu) banks the inventory and the
  worn items on the "Yes, thank you!" line, before "The task is done..." (1002236 t9888).
- After that: `...-talking-to-peer-the-seer-again` while the trial runs, `...-again-2` once it has
  passed. "Ask about becoming a Fremennik" replays one of these. The again variant's Yes/No lost its
  jump target in the dump, so its "small spell" line replays the first-talk bank menu.
- He is also on Sigmund's trading chain. The Merchant unit answers those variants first.

Doors (both are walked through, 1002236 t10024 in and t10267 out): `inviswall` (38848) goes in the
doorway, `viking_door_inactive` (4249, shape 0 rot 0) stands on the inside tile (y 3666), `door_open`
(synth 62) plays and the player takes one step. Two ticks later the door is back and the leaf is gone.

- The entrance from outside needs the trial running, nothing carried and the riddle solved.
  Otherwise the reply is "This door is locked tightly shut.", "You must bank all your items and
  equipment before entering Peer's house." or the plaque. Before the quest, Peer's own page plays
  "Hey! Outerlander! That is my house! ..." (data/Wiki only).
- The exit door: "This door is locked tightly shut." (1001646 t3216) without the key, and from
  outside. With the key, from inside (1002236 t10267-10269, 1001646 t3433-3435), all on one tick:
  "You unlock the door with your key.", the door animation, the step out to 2636,3667, and the key
  and every other house item taken. A plain herring stays. On the next tick the trial passes, with
  "You have successfully completed the Seer's Trial." and then Peer's "Incredible! To have solved my
  puzzle so quickly! I have<br>no choice but to vote in your favour!". Peer is not interacted with,
  and there is no other congratulation.
- Leaving by the entrance from inside (1002313 t7180-7182; Wiki uvFMwf): a message box, "If you leave by
  this door you will fail this trial.<br>Press continue to go through the door anyway.". Continue takes
  the house items and walks the player out on the same tick. The riddle stays solved: the door let the
  player straight back in (t7195). Closing the box instead leaves the puzzle as it was.
- Peer's Talk-to once Sigmund's trial has passed opens straight on his trial offer, without the
  Merchant / Fremennik / depositing menu (1002313 t6907).

Inside:

- Ladders 4163/4164 (Climb-up): `human_reachforladder` (828), then one tick later the player is
  on plane 2 at the same x/y (1002236 t10030-10031, t10153-10154). The trapdoor's Climb-down has no
  animation and arrives one tick later at the same x/y on plane 0 (1001646 t3206-3207).
- The east trapdoor opens for one player only: "The trapdoor opens...", the open form (4173) for
  that player alone and `door_open` (1002236 t10128). It stays open until they leave. Going down
  before the puzzle is solved is allowed, as live allows it (1002236 t10132, 1001646 t3207).
- The cupboard (4177/4178) and the jug chest (4167/4168) open and shut for one player only. Open
  plays `human_openhighcupboard` 542 + `cupboard_open` 58, or `human_openchest` 536 +
  `chest_open` 52, and the open loc follows one tick later. Shut/Close plays 541 + 57 or 535 + 51
  (1001646 t3243, t3267). Search on the open loc says "You search the cupboard..." (or chest),
  and four ticks later the find and its item, or "You find nothing of interest." when the player
  already holds one (1002236 t10042-10046, t10087-10091, 1001646 t3280).
- Both bookcases hide the red herring, with the same four-tick search (1002236 at 2635,3665,
  1001646 at 2634,3665). The Wiki's "north-east bookcase: nothing" is not what live does. With the
  herring, its goop or the cooked plain herring held: "You find nothing of interest." (1002313 t7443-7449).
- The heads: two message boxes, and the disk is given as the second one opens (1002236 t10050-10055,
  t10063). Studying the unicorn again shows the first box, then the game message "It's unusual
  because you removed it already!" (1001646 t3145). Once its disk is in the mural, the bull gives the
  single box "There is a hole in this bull head where a right eye should be." (1001646 t3259).
- The mural: Study says "You study the mural... it appears to be missing something..." and opens
  `viking_mural` (376) through script 2524 (0, 150), its six red coins (3715, zoom 116) set, each black
  circle 3716 until its disk is in, 3715 after, and the lid outline 3717 (zoom 10) once both are
  (1002313 t7252, t7264; which circle is which disk is ours). Either red disk can go in first; each
  gives "You put the red disk into the empty hole on the mural." and "It is a perfect fit!". The second
  adds "The center of the mural falls out!", and the vase lid goes to the first free slot (1002313
  t7261, 1002236 t10147). The mural loc does not change.
- The range and the herring: a message box ("As you cook the herring on the stove, ..."). The
  herring keeps its slot as a plain herring, and the goop goes into a new slot. The goop on the
  wooden disk: "You coat the wooden coin with the sticky red goop.".
- Water: from the tap, "You fill the bucket from the tap." (a partly full bucket too). Pouring says
  "You fill the <target> to the brim." when the target is now full, and "You empty the <source>
  into the <target>." otherwise. Both items change in their own slots. The drain plays
  `throw_bucketofwater` 1077 + `holy_water_pour` 1733 on arrival, and a tick later the vessel empties with
  "You empty the jug down the drain." (1002313 t7321-7322, 1002236 t10177-10178, 1001646 t3307-3308).
- The scales chest (4170): the bucket at four-fifths gives three lines plus `human_openchest`, and
  the bucket's slot becomes the vase (1002236 t10204). Open, a full jug, an empty bucket and a full
  bucket give the Wiki's lines.
- The vase: Shake gives a message box (1001646 t3373; the water and frozen versions are Wiki). The
  tap fills it, and the lid seals it in the lower of the two slots (1002313 t7380, 1002236 t10223). The frozen table shatters the sealed vase of
  water into the frozen key, and the range melts the ice (1002236 t10212-10242).
- The red herrings' piles on the puzzle floor: the magnet in 4183 at 2636,3660, the toy ship in 4186,
  the thread in 4184, each "You search the boxes..." and the find four ticks later (1002313
  t7450-7490). From the Wiki only: the small pick (4185) and the piles' item lines, the frozen-table and range lines for empty and frozen vessels and the vase, the lid
  on a frozen vase, and the wooden disk on the mural.

Ours:

- The house items (buckets, jugs, vases, lid, keys, herring, goop, disks, the red herrings' items)
  never leave the house. Teleporting out takes them (an onZoneExit on the interior box), and so does
  logging in outside the house with any of them. The mural's disks are reset along with them, so the
  lid can be made again. Leaving by the entrance also clears the riddle; the quest page says some
  parts must be done over.
- The swapped locs (trapdoor, cupboard, chest) go back to closed when the player leaves or logs out.
  Close on an open trapdoor shuts it for that player.
- A lost bucket, jug, herring or disk can be found again. Live's answer to a second search while
  not holding one is not captured.
- Both chests give the jug (the south one, 1002236 t10091; the east one at 2638,3662, 1002313 t7483 with a
  jug of water held); with an empty jug held, nothing (1001646 t3280). 4183 at 2633,3660 holds nothing.
- On the scales, partial jugs and buckets under four-fifths are "too light". When one pour both
  fills the target and empties the source, the "to the brim" line is used.
- Remove-lid splits a sealed vase back into its vase and the lid, silently.
- No capture shows a vase-of-water animation at the drain, so none plays.

## Thorvald the Warrior and Koschei

Live (rsprox 1002236 rev 242 t8254-9696; 1001646 rev 241 t2279-2722):

- **Accepting** ("Yes") only ends the talk: no NPC, no varp, no message (1002236 t8381). The trial
  is started internally (trial state 1).
- **Hut ladder** `viking_warrior_ladder` 4187 op2 Climb-down: seq 828 and the move to
  2671,10098,2 on the same tick (t8388); 3 ticks later "Explore this battleground and find your
  foe..." (data U98HqS, t8391). The generic Ladders plugin is bypassed through `ladders:climb`.
- **Refusal** (data YSTKi0; 1002313 t4149-4157, carrying a scimitar, staves, axes, runes and Graceful):
  Thorvald's two rule lines, the player stays. What counts (Wiki, Thorvald's section): worn or carried,
  any item the cache gives a worn slot other than amulet/ring, except bracelets (1002313 t4724 went in
  wearing a combat bracelet), god books, boots of lightness and H.A.M. pieces; carried runes; carried
  fletching materials (logs, arrowtips, arrow shafts, headless arrows, bolt tips, `(unf)`, `(u)`).
  Ours: the name patterns stand in for the Wiki's item classes; a rune pouch is not inspected.
- **Arena** (an `Area`, 2641-2673 x 10064-10100 plane 2, the cache's walkable room plus a tile):
  dropping says "You cannot drop items in this area." (1001646 t2291) and keeps the item.
- **Koschei comes** 24-55 ticks after the player enters, walking or not (1002236 24, 1001646 52, 1002313 55
  with the player walking throughout; ours: any tick in that range), on a free tile next to the player
  (diagonal in 1002236 and 1001646, north in 1002313), facing south, owner-only,
  with a random overhead from the data's random list, smokepuff 86 + area sound 1930 (range 10)
  on his tile, varbit 14192 = 7 and the NPC hint arrow. He attacks first (t8415).
- **Forms**: one NPC. At 0 HP (onNpcBeforeDeath, preventDeath) the player is locked (varbit
  12393, movement, combat); +1 seq 1057, transformation 3898/3899/3900, healed to 50/70/255;
  +2 the new form's chat line from data h5yzdR / mY4kck / Liuu-2. Form 4 with prayer > 0: the
  long line and prayer 0 the same tick; with prayer 0 only the line's first sentence (1001646
  t2582; derived from the data line). On continue: unlocked, a random overhead, he attacks the
  next tick. The engine reads the transformed form's definition (`getCurrentDefinition`): form 4
  attacks every tick with max hit 1, as monsters-complete says (checked in the test).
- **Pass**: a form-4 hit that would take the player below 1 HP lands with no hitsplat
  (`hit.withoutHitsplat()`); that tick the trial passes (viking +1) and the player is locked;
  +2 seq 1331; +6 "Oh dear you are..." (ibN1vU), move to 2667,3692,1, Koschei removed, hint
  reset; +11 "...still alive somehow?" (vFYLg2) + "Congratulations! You have passed the
  warrior's trial!" (KVGiuL), HP and prayer restored, seq 1332, Thorvald's talk (WzpjVF's lines,
  head anim chatlaugh2 606 on the first). Any other 0-HP in form 4 also passes.
- **Balcony ladder** 4189 Climb-down: closes the talk, seq 828, the move to 2666,3694,0 a tick
  later (t9695-9696); ignored while the pass runs.
- **Thorvald after passing**: the "after defeating Koschei" variant with b1Fki8 answered true
  (Wiki); the hut ladder plays the player's "I'd really rather not go back down there..." line.

Wiki only / Ours:

- Form 4 drains prayer every tick; restores work (1002313 t5151-5188: 36, 32, 29, 26, 23, 21 ...). Ours:
  a tenth of the current points, at least 1, fitted to that series (Protect from Melee was on too).
- Wiki (data ppj2xU): 10 minutes (1000 ticks) in form 3 and he leaves with the two data messages; the
  fight starts over. Not form 4: 1002313 fought it 1409 ticks (t5138-t6547) with no timeout.
- After the quest Thorvald plays his own page's after-the-Trials talk (1002313 t7853), and the hut ladder
  the player's "...now that I have been accepted as a member of the Fremennik clan." (t7860).
- Wiki (data -dImPE): killing form 4 removes him with a smokepuff, gives the Fremennik blade,
  "Congratulations! you have completed the warriors trial!" (WSyuYN), trial passed.
- Wiki "safe death" in forms 1-3. Ours: death prevented, no item loss, HP/prayer restored,
  "Oh dear, you are dead!", moved to 2666,3694,0, trial still started.
- Ours: the arena ladder 4188 (no capture): the fight resets, seq 828, 2666,3694,0 a tick later.
- Ours: leaving the arena any other way (teleport) or logging out removes Koschei; the trial stays
  retryable and he comes back in form 1. A logout during the pass keeps the vote and restores HP.
- Ours: the hut ladder before accepting the trial does nothing (no capture, no data line).
- Not covered: raw sardine on Thorvald (data 57ztwd), the blade's wield restriction (Tv25ZW),
  attacking another player's Koschei (owner-only NPCs are invisible to others), music.

Data gaps for osrsreboxed-db (The Fremennik Trials):

- WzpjVF's message KVGiuL comes before the first Thorvald line (with "...still alive somehow?"), not after
  line 3. (Its missing lines 3 and 4 and the random list's wording are fixed in the data now.)
- Liuu-2 has no variant for a player without prayer: "You show some skill at combat... I will
  hold back no longer!" (1001646 t2582); the unit cuts the long line at its first "!".

## Sigli the Huntsman and the Draugen

Unit: `server/plugins/quests/fremenniktrials/Hunter.FremennikTrials.js`. Test: `server/tests/fremennik-trials-hunter.test.cjs`.
Captures: 1002236 (rev 242, t3327-t3461 offer, t4833-t5674 hunt and return), 1002250 and 1002249 (rev 242),
1001646 (rev 241), 1002160 (a bystander sees someone's Draugen).

### Offer
- The lines are the transcript's `the-council-members-sigli-the-huntsman` word for word. The uncharged talisman
  (viking_draugen_talisman_uncharged 3697) arrives as "We do this with a special talisman..." shows (1002236 t3448).
  No varp change and no game message. A full inventory plays Sigli's "too full" line. The trial still starts, and
  his "lost it" branch gives the talisman later.
- "Ask about becoming a Fremennik" replays the offer, or the trial's current variant once it has started.

### Tracking (issue point 3)
- The Draugen's position is a real NPC, viking_draugen_safe 3923 (`BUTTERFLY_8`, named `DRAUGEN_BUTTERFLY` in the
  unit). It is visible to everyone and has no ops. Every butterfly seen in 8 recordings (547 sightings) was inside
  x 2605-2743, y 3496-3733.
- First Locate of a hunt: a butterfly spawns on a walkable tile in that box, 35-80 tiles (Chebyshev) from the player.
  There is no "moved" message (1002236 t4833).
- Each Locate:
  - Within 3 tiles (Chebyshev) of the butterfly: "The Draugen is here! Beware!" and the Draugen spawns.
  - Otherwise, about 1 Locate in 9: "The Draugen has moved elsewhere..." and a new butterfly spawns. The old one keeps
    wandering (1002236 t4921, t4997, t5043, t5082, t5197; 1002250 t95, t156, t183, t419, t462).
  - Then: "The talisman guides you <dir>." The direction is one of 8, taken from sign(dx) and sign(dy) toward the
    butterfly's live tile. A cardinal is used when one axis is equal (1002250 t156 "east").
- A hunt whose butterfly expired says "moved" on its next Locate. The 1002249 and 1002250 first clicks did this.
- Not modelled: in one segment, 1002236 t5378-t5496, 7 of 13 answers did not point at the butterfly (1002313's ten all
  did, t1776-t1825). Either the
  Draugen has a hidden position that loosely follows the butterfly, or live adds noise. We always point at the
  butterfly.

### The Draugen
- viking_draugen 3922 spawns on a free tile orthogonally next to the player, facing them. The captures show it west,
  west and south (1002236 t5535, 1002250 t545, 1001646 t315). It attacks 2 ticks after appearing, before the player's
  own click (t5537, t317).
- Death: no death animation. The tick after the killing hit it is removed, with a smokepuff map_anim (86) on its
  tile, the ghost_death synth (438), "You absorb the Draugen's essence into your talisman." and 3697 -> 3696 in the
  first free slot (1002236 t5572-5573, 1001646 t356-357).
- Locate on the charged talisman: "You have already captured the Draugen." (1001646 t363).

### Return
- "I saw the entire hunt..." / "Thanks!". On the continue of "Thanks!" the charged talisman is removed and the vote
  counts (viking +1), with no game message (1002236 t5674). The old click-time completion and its two invented
  messages are gone. So is the invented item-on-Sigli handling.
- After the trial: "Absolutely outerlander! ...".

### Ours / Wiki
- Ours: only the hunter can attack their Draugen. Others see it (1002160) and get the core "This npc was not spawned
  for you.". No capture shows a bystander attacking.
- Ours: at most 4 butterflies per player. The oldest decoy goes first.
- Ours: butterflies wander within 12 tiles of their spawn. Live covers about 20-30 tiles in a few minutes.
- Wiki: a butterfly despawns after ten minutes (1000 ticks).
- Ours: one Draugen per hunt. While it is out, Locate says "here". It leaves after 500 ticks, or at a Locate made
  more than 16 tiles from it, so a fled or died-to hunt can find it again.
- Wiki: losing the charged talisman after the kill restarts the hunt. Sigli gives a new uncharged one, and so does a
  Locate on an uncharged one. A talisman in the bank counts as kept: Sigli's "Laziness" line and no new one (1002313
  t1550, t1587); only one in neither place is lost (t1761).
- After the trial the player asks "So can I rely on your vote..." before Sigli's "Absolutely outerlander!..." (1002313
  t1987).
- Ours: a Draugen killed without the uncharged talisman in the inventory charges nothing.
- Logout removes the player's butterflies and Draugen. After a relog the next Locate starts a fresh hunt.
- Not done (Wiki): "Locate with a dropped/old talisman destroys it".

### Known data gaps (shared data, not changed)
- npc-combat-sounds.json has 3922's hit (ghost_hit 439) and no attack. Live sends unarmed_punch 2566 on its swings, and
  Koschei's forms staff_stab 2562 / human_hit 513 (1002313); the miner (scripts/mine-npc-combat-sounds.mjs), rerun over
  every transcript, keeps none of them, as the unarmed player's own swing sends the same sounds.
- In our loaded definition, 3922 swings seq 422 (seen in the test) and blocks with 424, although npc-animations.json
  has [390, 388]. Live: 390 (human_sword_slash) and 388 (human_sword_def). `NpcDefinition.getMaxHit()` is 1 while
  monsters-complete.json says 7, and live hits went up to 7. Whether combat uses that 1 was not checked.
