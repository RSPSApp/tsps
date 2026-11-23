---
quest: Darkness of Hallowvale
key: darkness_of_hallowvale
status: untested
tested:
tester:
model:
commit:
cache:
start:
travel:
---

# Darkness of Hallowvale

Rebuilt from a full live playthrough: an rsprox capture of the whole quest, revision 242 (the
user's own recording "Darkness of Hallowvale", stages 0 to 320; ticks below are its server ticks).
The account had In Aid of the Myreque complete (1990 = 430) and every skill above the
requirements, and it was past Sins of the Father (the Darkmeyer wall shortcut was there). Code:
`server/plugins/quests/quests/DarknessOfHallowvale.Quest.js` and its units in
`server/plugins/quests/hallowvale/` (State, Common, Boat, Ghetto, Errands, Hassle, Sketches, Lab).
Words come from the "Darkness of Hallowvale" transcript page in `npc-dialogues.json` (and the
"Meiyerditch citizen", "Old Man Ral", "Vyrewatch", mine guard and miner pages); the object lines no
page holds are literals in the units.

## State

- The stage is varbit 2573 `myq3_main_quest` (varp 869 bits 0-8) with live's values. 320 is complete (cache DB row 22 column 19). Each value is set by one action (`STAGE` in `State.DarknessOfHallowvale.js`):

| value | set by | tick |
|---|---|---|
| 10 | Veliaf: the continue of "Once you're in, try and establish contact...", with the start message | t334 |
| 20 | the boat's repair result | t436 |
| 30 | the chute's repair result (the push keeps 30) | t463 |
| 40 | the boat map 454 opening | t514 |
| 50 | two ticks after the jump onto the dock rock | t533 |
| 52 | continuing past a citizen's "Yes... but I really can't talk about them." | t603 |
| 54 | the citizen's "I understand, but you may not like what you find..." showing | t736 |
| 60 | choosing "Can you introduce me to Old Man Ral?" | t773 |
| 65 | Ral's "Hmph. Myreque, eh?..." showing | t1158 |
| 70 | the knife on the hideout wall's latch (second box) | t2729 |
| 80 | the teleport down the hideout trapdoor | t2748 |
| 90 | "Vertida gives you a message." | t2939 |
| 100 | "You hand over the message to Veliaf." | t3181 |
| 110 | Veliaf, continuing past "What do you want me to do?" | t3190 |
| 120 | Drezel, before "Ivan mentioned..." (and 2591 = 1) | t3460 |
| 130 | the werewolf scene's teardown | t3621 |
| 140 | Drezel's runes | t3717 |
| 150 | Roald, continuing past "I am sorry, but Aeonisig is my advisor..." | t4020 |
| 160 | Roald, continuing past "Well then, I must try to do something... Will you accept my offer?" | t4167 |
| 170 | Aeonisig's teleport landing | t4180 |
| 180 | Veliaf, continuing past "What should we do now? There must be someone else..." | t4611 |
| 190 | Vertida's "He's very distinctive..." (and 2592 = 1) | t5999 |
| 195 | Safalaan's "Ah, Veliaf! Myreque prevail!..." | t6221 |
| 200 | Safalaan's "Good luck, my friend...", with the charcoal and papyrus | t6409 |
| 210 | the northern sketch (and 2592 = 2) | t6493 |
| 220 | the western sketch, as the scene fades out | t6601 |
| 230 | continuing past Vanstrom's "Prepare to die!" | t6677 |
| 240 | continuing past Vanstrom's "I take no orders..." (and 2593 = 1) | t6739 |
| 250 | Sarius' "And now be away..." (before the third sketch) | t6776 |
| 260 | the knife on the fireplace tile | t7070 |
| 270 | "You show the message to Safalaan." (and 2576 = 1) | t7252 |
| 280 | the tapestry slashed (and 2594 = 1) | t7408 |
| 290 | the key in the statue (and 2596 = 1) | t7419 |
| 300 | the laboratory door's first opening | t7426 |
| 310 | Safalaan's sealed message box | t7644 |
| 320 | Veliaf, the continue after "...here's a little something..." | t7755 |

- The rest is live's quest varbits in varps 869/870 (`VARBIT`): mine punished 2574, sketches given 2575, Sarius' message given 2576, ghetto door 2578, rune case 2584, boat 2585 (0 broken, 1 fixed, 2 pushed), chute 2586, sea boat 2587, mine cart 2588 (ores, 0-15), wall floorboards 2589, bush 2591, Safalaan visible 2592 (1 on the wall, 2 at the hideout), Sarius visible 2593, tapestry 2594, portrait 2595 (1 slashed, 2 key taken), statue 2596, table trapdoor 2597 (1 found, 2 open), ladder top wall 2598 (1 top taken, 2 fixed) and push walls 2599-2601. The cache's multilocs (boat, chute, floorboards, push walls and their floors, table, ladder wall and floor, hideout trapdoor, bush, portrait, tapestry, statue) and multinpcs (Safalaan 6159/6160, Sarius 6161) read them, so each repair, kicked floor or opened wall is per player. They are saved in `darkness-of-hallowvale:varbits` and sent again at login.
- Transient, never saved (`TRANSIENT`): the hideout trapdoor 2590 (0 -> 1 symbol -> 2 open -> 1 at the landing -> 0 ten ticks later, every entry: t2737-2758, t5942-5961, t7142-7161), and the hassle varbits 2580 (1 stopped, 2 sent to the mines; 2 -> 1 about 500 ticks later, t7497; 0 at logout, t7796), 2581 (menu step) and 2582 (the choice's 1-based index).
- 3412 `ramble_npcs_visible` goes to 1 at completion (t7755) and is sent again at login once done.
- Every stage change also flips `last_quest_id` 16741 117 -> 0 -> 117 on live; not sent (below).
- Saves from before the alignment used the old plugin's ladder (its 310 was complete) and a bit field (`quest.darkness_of_hallowvale.bits`). `migrate` maps them once at login (`darkness-of-hallowvale:save-version` = 1): the stage onto live's, the varbits the new stage implies (`impliedVarbits`) plus the old bits' sub-states. A `::quest` jump or another plugin's stage write is answered the same way (`quest:stage-changed` -> the implied varbits).

## Start and the boat (0-50)

### Veliaf (8277, multinpc 9489, Burgh de Rott hideout)
- Chathead 8277 (the hideout NPC itself). Veliaf's anim follows the line count: chatneu1-4 (588-591). The player is chatneu1, chatquiz1 554 for the opening menu's four questions.
- Before the start: "So what now?" (5iTY3c) straight on from In Aid's scroll, "Hello again. How's things?" (Ao7Gq6) on any later talk (t256).
- A menu reached by "other options" leaves out only the option just asked; the one left out before comes back (t297, t304, t309).
- "Start the Darkness of Hallowvale quest?" Yes (t326): no varbit changes. Our requirement check runs here; short of them, the requirement lines and the chat ends.
- t334: on the continue of "Once you're in...", 2573 0 -> 10 and "You've started a new quest: Darkness of Hallowvale" before the vyrewatch line. The requirements are not checked again. The repeat of the same four lines at t356-359 changes nothing and ends in the post-start menu.

### Repairs (t408-466)
- Boat 12944 (2585 = 0 -> 17953 Inspect): messagebox ig64PW (t413), then "Fix the boat?" Yes./No. No just closes (t421).
- Yes (t426): the server walks the player to 3525,3178 (t426-430), faces west, then seq 4757 `sang_repair_boat` and hammer_wood 2101 at delays 43/65/87 (t432). Busy 12393 = 1.
- Four ticks on (t436): 2585 = 1, stage 20, one plank and four nails gone (59 -> 55), seq -1, m2_build 1710, objectbox_double 11 (plank 960, nails 1539, zoom 400) "You use a plank and some nails to fix the boat.".
- Chute 12947: messagebox 1A-9IU (t450), "Fix the chute?", Yes (t458) with no walk (already on 3523,3176), the same anim/sounds (t459), and at t463 2586 = 1, stage 30, plank + 4 nails (55 -> 51), the same double box "...to fix the chute.".
- Any nail type counts; the hammer must be 2347.

### Push (t468-496)
- 12944 is now 17954 Push. t473: fade out (174, script 948), an empty messagebox with no continue, busy. t475: cutscene varbits (542, 4606, 6719 = 2, 12139, 18141, varps 5588/5589), ops hidden, side tabs closed.
- t476: an instance copy of the boathouse (x 3512-3543, y 3152-3191), the player on the copy of 3524,3180, the boat loc deleted and NPC 3833 `sang_boat` on its tile facing south.
- t477 camera (3533,3165 h850 / 3524,3174 h175); t478 fade in; t480 seq 810 `human_push`, sound 3000 delay 30; t481-490 the boat teleports one tile south a tick, ten tiles, with the jump flag clear (`NPC.teleportInView`), so clients slide it down the ramp (issue #6639: a plain move made it blink); t482 a slow pan (rate 1/1); t489 fade out.
- t491: 2585 1 -> 2 and 2587 0 -> 1. The stage stays 30. Back on 3524,3180 facing 3524,3170, cam_reset, tabs back. t494 control back (23 ticks from the click).

### Ride and the dock (t498-535)
- 12945 (2587 = 1) Board. t512: seq 832, fade out, midi 147 silence, jingle 137 "morytania boatride". t514: stage 40, interface 454 in the main modal with 454:3 playing 4748 `myq3_boat_map_01`, tabs closed.
- t525 (11 ticks on): 3605,3161,1. t526: 454 closed, fade in, music 643, the three music unlocks (area music), messagebox RPm_MX "You dock the boat at a portion of wall that looks climbable.".
- Rock 17958 Jump-onto (t531): exactmove to 3605,3163,1, delays 28/40, angle 1024, seq 769, jump 2461 delay 10. t533: stage 40 -> 50.
- Rock 17959 Climb-up (t535): exactmove to 3601,3163,1 over 150 cycles, angle 512, seq 4727, climb_wall 2453 at 0 and 80. No message or xp.
- Later trips (t5420-5434): fade out, empty messagebox, silence + jingle 137, minimap 2, "You board the boat and sail to Meiyerditch.", 3605,3161,1 ten ticks on. Handed to the ferries plugin (`ferries:travel` morytania-meiyerditch).

## Meiyerditch, Ral, the rooftops and the hideout (50-80)

### Into the ghetto
- Floorboards 18122 (2589 = 0 -> 18033 Search): messagebox "These floorboards look a little weak near to the wall." (t552), "Kick them?" Yes (t557): seq 4750 `myq3_stamp` + sound 1716. Two ticks on (t559): 2589 = 1 and "You kick the floorboards; they crack and eventually fall down." The stage stays 50.
- Climb-down (18034): seq 827, a tick on 3588,3173,0 (t561-562). Underboards 18124 Climb-up: seq 828, a tick on 3590,3173,1 (t6074-6075).
- Wall rubble 18037 (t572-584): exactmove 3588,3180,0 -> 3590,3180,1 (d18/d108, angle 1536, seq 4723, sound 1722); +6 ticks to 3592,3180,1 (d145/d168, seq 4724, 1722 + jump 2461 delay 140); +6 ticks down to 3592,3180,0. 18038 is the same backwards (t6053-6065). No xp.

### Citizens (t587-821)
- One conversation whose menu follows the stage, redrawn in place: the whisper "(whisper) Do you know about the Myreque?" -> 52 on the continue past "Yes... but I really can't talk about them." (t603), then the "after quietly asking" menu.
- "(whisper) I really need to meet the Myreque." -> 54 with "I understand, but you may not like what you find. Go and talk to Old Man Ral..." (t736), then the "after insisting" menu.
- "Can you introduce me to Old Man Ral?" -> 60 on the option (t773).
- From 60 the "Meiyerditch citizen" page's after-quest talk: the 4-option menu and the "Hey, don't sneak up on me like that!" greeting (t777, t2395). The random greetings before it are the quest page's (options 4 and 2 seen).

### Old Man Ral (3772, multinpc 15774)
- 50-64: "Someone said you could help me." -> the name menu. Pal, rascal and snitch loop back. "Old Man Ral, the sage of Sanguinesti." (t1026) runs the sage chain. 65 comes four lines later, as "Hmph. Myreque, eh?..." shows (t1158).
- From 65: his own page's "Hello again!" talk (t1181). From 200: the papyrus top-up (Sketches).
- The house doors are plain doors (Doors plugin): door1 17600 at 3602,3208 rotation 3 opens onto area_sanguine_ghetto_open_door1 18031 at 3602,3207 rotation 0 (t841), door2 17601 at 3606,3206 onto 18032 at 3606,3205 (t845), door_open 62 each. The catalog pairs them by the "open_" gameval form (issue #6545). They swing shut by themselves about 499 ticks after opening (t841 -> t1340).

### Rooftop route (t1208-2635)
- Ladders: up = seq 828 then the move a tick on; down = seq 827 then the move. No sound or xp.
- Two-tile jumps: exactmove d58/d70, seq 769 delay 30, jump 2461 delay 64. Three-tile jumps: d60/d85, seq 4721 delay 30. Each jump works only from its own take-off tile; elsewhere the player walks to it and gets "You can't jump from here; you need to get closer to jump here." (18071 says "there", t1224).
- Crawls (18078, 18088): seq 827 at +3, exactmove d6/d20, seq 844, climb_under 2452.
- Shelves up (18086/18095/18105): seq 4722 delay 5 + sound 2997, the move 8 ticks on. "You climb up the shelves." only on 18095 and 18105 (not 18086). Down (18087/18107): seq 827 + 2995, the move at +2; "You climb down the shelves." only on 18107.
- Push walls 18128/18131/18134 (the client clicks the multiloc): seq 810 + sound 1719 at +1; the varbit (2599/2600/2601) = 1 with loc_anim 4744 (4745 for the flat wall 18131) at +2; = 2 at +3. No xp. Their floors (18129, 18132, 18135) are a forced two-step walk.
- Table 18083 (2597): Search -> seq 832, +2 "You search the table and find there is a trapdoor underneath." (1). Open -> seq 827, +2 "You open the trapdoor." + sound 91 (2). Climb-into -> three exactmoves 2589/2590/2591 (d0/50, d0/100, d15/33) with climb_under 2452 (t1303-1314).
- Washing line 18099: "You carefully cross the washing line.", tightrope 2495 loops 5, a forced walk 3616 -> 3622,3202,2 over 9 ticks with a balance stance (t2515-2524). Each two-tile step is a walk (temporary move speed 1); the RuneLite gateway used to forward every temporary speed as 127, a teleport, so RuneLite snapped the player along the line (issue #6639).
- Agility xp: update_stat on every jump, crawl, shelf, the tunnel and the line at the end tick; none on ladders, stairs, push walls, floors, doors or the rubble. rsprox prints 5; used as 5.
- Pots 18065: seq 827 + sound 1720 + "You search the pots." at +3; key 9654 and objectbox "You find a key." at +5 (t2426-2431).
- Locked door 18091 with the key (t2433-2439): "The door seems to be locked.", 2578 = 1, the key gone, sounds 2402 + 2419, objectbox 9654 "...The key seems to be stuck in the lock."; on its continue "You swing the door open.", inviswall 38848 + 18092 for two ticks, door_open 62 and the step through. One click, no item-on-loc.
- Ladder wall 18115 (t2619): "You search the wall...", 2598 = 1, seq 832, top 9655, objectbox "You find the topmost part of a ladder.". Broken ladder 18116 with the top (t2631-2632): seq 827 + snapwood 2107, a tick on 2598 = 2, top gone, objectbox "You attach the top of the ladder to the bottom.". Climb-down: "You climb down the ladder.", 3630,3240,0.
- Varbits 2578, 2589, 2597-2601 were never seen resetting; they are saved.

### The hideout entry (t2712-2758)
- Wall 17980 Push before the latch: messagebox "You push the wall and nothing happens. However, you notice that there is a latch mechanism...". Knife on it: objectbox 946 "You prepare to use your knife to unhook the latch."; on continue seq 832 + stabsword_stab 2549; +2: stage 70, chest_open 52, objectbox 946 "You use your knife to unhook the latch." (t2724-2729). 22 Thieving (Wiki).
- From 70, Push: "You push the door to one side.", inviswall 38848 + 17981 for two ticks, door_open 62, one step south. No latch varbit; only the stage matters.
- Symbol 18146 Press: seq 832, loc_anim 4743, sound 1714; +1 "You push the symbol in... You hear a click." and 2590 = 1. Rug 18120 Open: "You open the secret trapdoor.", 2590 = 2, sound 91.
- Climb-down: "You climb down through the trapdoor.", seq 827, fade out; +3 (t2748) 3626,9618,0, down_stone_stairs 1952, fade in, 2590 = 1 (and stage 80 the first time); 2590 = 0 ten ticks on.
- Ladder 17986 up (t7298-7315): 2590 = 2, seq 828, fade, sound 1956, +4 3638,3249,0 with "You climb up the ladder.", then 2590 1 and 0.
- Shortcut door 17973: messagebox "This door is locked." and sound 2402 on its continue (t7323).

## Errands: Vertida, Veliaf, Drezel, the bush scene, Roald, Aeonisig (80-180)

- The NPCs are the world spawns live used: Vertida 3773 (multinpc 8220), Veliaf 8277, Drezel 9805 (multinpc 9636), King Roald 5215, Aeonisig 3774. No owner-only copies.
- Vertida (t2775-2974): 90 with message 9633 into the inventory and objectbox 193 "Vertida gives you a message." on the same tick (t2939). Its Inspect (not captured) is the Wiki's objectbox: "It's a short message from Vertida to Veliaf..." (Transcript:Message (Vertida)).
- Papyrus crates 17987 (t2980-2995): each Search seq 832, one papyrus 970, "You find some papyrus."; no cap seen, searches on consecutive ticks.
- Veliaf (t3173-3196): 100 with 9633 removed and objectbox "You hand over the message to Veliaf." (t3181); 110 on the continue past "What do you want me to do?" (t3190); the talk then closes with no menu.
- Drezel, first talk (t3416-3524): the player speaks first. 120 and 2591 = 1 before "Ivan mentioned that he heard some strange noises..." whatever is picked after it (t3460); the live player left through "Okay, thanks." in a sub-menu. Re-asked menus drop only the topic just asked.
- The bush 18121 (2591 = 1 -> 17989), at 3390,3480 (t3574-3625):
  - The walk to 3391,3480, busy (t3583), a forced walk to 3390,3479 (t3584).
  - t3586: camera (3388,3478 h250 / 3391,3481 h50, rate 25) and the messagebox "You search the bushes and find someone lying unconscious." with no continue.
  - t3590: fade out (script 948, 15 cycles), music `werewolves` 676, "Morytanian Mystery" unlock.
  - t3591: cutscene varbits, ops hidden, a 4x4-zone copy of x 3376-3407, y 3464-3495; the player on 3390,3479 facing 3390,3484; loc 17988 (bush without leg) on the bush tile; tabs closed.
  - t3592 camera (3387,3476 h300 / 3390,3479 h300). t3593 fade in, werewolves 3825 at 3390,3477 and 3826 at 3389,3477.
  - t3595 both step north, 3825 seq 6536, sound 909; t3596 sound 910; t3597 player spotanim 245 (h124); t3598 seq 836 + sound 2727; t3599 3825 -> 3827, sound 512; t3601 overlay 453 `myq3_blackout`.
  - Five "Shadowy figure" lines (heads 3827 anim 6550 / 3826 anim 6553); the camera moves at the third (3385,3484 h475). The third says "take him" to a male character (live, t3608) and the Wiki's "take her" to a female one, by the player's pronoun setting as the dialogue runtime's gendered text does (Ours: "them" for they/them). 2591 = 0 on the continue of "Of course!" (t3618).
  - t3621: teardown, stage 130, back on 3390,3479 (the wolves vanish with the copy). t3622 seq -1, fade in, "Ouch! My poor head!" (chatsad1). Control back on its continue (t3625).
- Drezel after the scene (t3686-3726): 140 with +1 law, +1 fire, +3 air (one Varrock Teleport) and objectbox_double 11 (law 563 / air 556) "Drezel gives you some runes." (t3717).
- King Roald at 140 (t3758-4121): the after-the-werewolves talk at once; 150 on the continue of the mercenary-protocol line (t4020). At 150 (t4124): "I'd like to ask a few questions if I might?|Not really." with no teleport option; "What should I do now?" leads to the offer, and 160 on its continue, before Yes/No (t4167).
- Teleport (t4175-4183): the chat closes; +1 Aeonisig spotanim 343 + seq 1818; +2 player seq 1816, spotanim 342 (h92), area sound 200 (range 10); +5 stage 170 and 3421,9888,0, cam_reset; +6 messagebox "Aeonisig teleports you back to Paterdomus.".
- Drezel at 170 plays his after-Roald talk (t4198); Veliaf's after-Roald talk ends with 180 (t4611), then "We must inform the Sanguinesti order..." on a re-talk (t4619).

## The vyrewatch and the mine

- Noticed (t5636-5676, stage 180): flying vyrewatch 3717 walks up a tile a tick. Next to the player: "A vyrewatch takes an interest in you." and 2580 = 1 (t5648); +1 landing 4695 and area sound 2991 (range 5); +4 the walking form (3717 -> 3709, flying id - 8, level 105).
- Its lines are timed with no continue: the opener 4 ticks (chatang1), the offer 5 ticks (chatang3); then 2581 = 1 and "The vyrewatch wants an answer!" (t5662). After the hideout the options are bite / mines / distract (before it, bite / fight / distract).
- The choice: 2582 = its index a tick on, the player's line and "Very well..." 3 ticks each. Mines: player seq 4731 + spotanim 342 (delay 70), vyre seq 4729, projectile 787 (10 -> 60, angle 15, heights 32 -> 64), sound 201 delay 70; +5 2580 = 2 and 2391,4620,2 (t5671-5676).
- Talk-to from 80 (t6829-6846): "Hello?", an insult, "Send me to the mines.|Sorry.", two timed lines, the spell without a projectile and the mine 3 ticks later.
- The mine: Daeyalt rocks 17962 -> 17963 -> 17964 -> 17965, 3 ores a rock, one ore 9632 every 3 ticks with a rune pickaxe (no failures), "You manage to mine some ore.", "This rock face is now empty.". These are the Mining plugin's.
- Ore on the cart 18119 (or its Inspect): 3 ticks on 2588 += n (cap 15), every ore taken, sound 2999, messagebox "You deposit 6 ores into the cart.<br>The cart can hold 9 more ores." / "...The cart is now full." (t5753, t5800, t5823; again 0 -> 3 -> 7 -> 11 -> 15 at the second trip).
- Guards 3690/3691: "Hey. How do I get out of here?" / "When you've filled the mine cart, we'll think about it." With 2588 = 15: "But I've filled the mine cart." / "Okay, I guess you can go then, food sack!"; on its continue fade + minimap 2 (+1), +3 2574 = 1 and 3621,3322,0, +5 2588 = 0 and fade in (t5835-5842, t6992-6999).
- Miners 3819-3824 play 4709 and say overheads 54-58 ticks apart (t5697, t5751, t5809).
- 2580 2 -> 1 about 500 ticks after the exit (t6995 -> t7497); 1 -> 0 at logout.

## Safalaan, the sketches, the western scene, the ambush, Sarius (180-250)

- Vertida at 180 (t5962-6017): 190 and 2592 = 1 on "He's very distinctive..." (t5999), before the lead-the-way menu. "Okay, lead the way.": fade, messagebox "Vertida leads you through the ghetto." with no continue, minimap 2; +3 3596,3203,1 (upstairs west of Trader Sven); +4 fade in and the box again; closed 12 ticks after the choice.
- To Safalaan: rocky surface 18056, messagebox "You notice that the rocks seem to move..." (t6107); barricade 18054 opens for a step north (inviswall 38848 + 18055 two ticks, door_open 62, t6115-6117); wall ladders 17999/18000/18001/18002 (827 down, 828 up); the Drakan wall shortcut 39173 lands on 3595,3312,0 (t6191).
- Safalaan (6159 on the wall, 6160 at the hideout; chathead 6159): 195 on "Ah, Veliaf!..." (t6221); objectbox_double 11 (charcoal 973 / papyrus 970) "Safalaan gives you some charcoal and papyrus." with nothing given yet; charcoal, three papyrus and 200 on "Good luck, my friend..." (t6409).
- Sketching: charcoal on papyrus on the marked tile, the player turned to face the castle ten tiles away. "You start sketching...", +1 seq 909 + sound 1723, +3 the sketch in the papyrus' slot.
  - North 3556,3379 facing south (t6490-6493): sketch 9646, "You make the sketch of the northern approach.", 210 and 2592 = 2.
  - West 3522,3357 facing east: the scene below, 220 and sketch 9647 (t6601).
  - South 3572,3331 facing north: the ambush first; the sketch 9648 only at 250 (t6786-6789).
- Sketch Look-at opens 455 (north), 457 (west), 456 (south) (t6871-6881).
- The western scene (t6529-6608):
  - t6532 fade out + empty box; t6534 cutscene varbits, tabs closed, music 677 "Domain of the Vampyres" with its unlock; t6535 a 13x13-zone copy from 3488,3304.
  - t6537 camera (3530,3351 h560 / 3536,3361 h20); Vanstrom 3733 at 3534,3357, Ranis 3744 at 3534,3358, Vanescula 3740 at 3534,3359, the tray juvinate 3700 at 3533,3358.
  - Seven lines; on the continue of "Perhaps a light refreshment..." (t6557) all three play 4725 (delays 25/15/0) with the meal's eat/suck/hit sounds.
  - The transformations: spotanim 785 delay 100, seq 4733 + sound 2994 delay 12, three ticks on seq 4734 and the grounded form (3741, 3745, 3734); the chatheads follow the current form.
  - The take-offs (3743/3747/3738 then flying 3742/3746/3737), a tile a tick, sound 2993 each.
  - t6601 220, the sketch and its message, fade out; t6603 back on 3522,3357; t6606 fade in.
- The ambush (t6652-6790):
  - t6657 cutscene, music 504; t6658 a copy from 3520,3296; t6659 cam_forceangle(150,512); t6660 Vanstrom 3736 at 3583,3331 walking west to 3575,3331, camera (3583,3331 h560 / 3573,3331 h20).
  - t6668 sound 1192 and "Ha! So we meet again, <name>. Prepare to die!" (head 3735). On its continue (t6677): 230, 3736 -> 3735 (level 169), control back inside the copy, Vanstrom to 3573,3331.
  - Five attacks 8 ticks apart: kick 4715 (sound 888), punches 4716 (879), punches, kick, special punch 4717 (879 + stunned 2727 delay 40). Hit sound 518 or shield sounds 2964/2967 delay 20; the player's block anim on the first four, 4718 knockout delay 40 on the fifth. Live hits 0, 10, 8, 15, 0.
  - t6713 fade; t6716 a new copy, the player lying (4718); t6718 Vanstrom 3736 at 3573,3331 and Sarius 3778 at 3582,3331 walking west to 3576,3331, camera (3565,3331 h560 / 3573,3331 h20). Her line and Vanstrom's "I take no orders..."; on its continue 240 and 2593 = 1 (t6739).
  - t6741 back on the real map, Sarius 6161 (2593 -> 3776) at 3576,3331 facing west. t6744 player seq 4719, fade in, music "Lament of Meiyerditch". Her talk starts with no Talk-to (t6745).
  - 250 on "And now be away..." (t6776); on its continue a fade and +3 2593 = 0, Sarius gone (t6783).
- Old Man Ral from 200 tops up papyrus (Safalaan names him).

## The laboratory and completion (250-320)

- Message 9649's Read (not captured): Mauritys Guile's letter from the Wiki's Transcript:Message (fireplace) on the long scroll 625, as live shows In Aid of the Myreque's dusty scroll.
- Fireplace tile 18039, knife (t7070): seq 827, sound 2581, message 9649 and objectbox "You carefully use your knife on the loose tile and find<br>a message hidden behind it.", 250 -> 260 on that tick, before the sketches are given.
- Portrait 18126, knife (t7078-7079): seq 3747 + sound 1721 on the click; a tick on 2595 0 -> 1 -> 2, key 9651 and objectbox "You slash the painting and find a large ornate key<br>hidden inside.".
- Safalaan 6160 at the hideout (t7172-7258), the all-sketches talk: the player says "Guile", and "You give the sketches to Safalaan." is objectbox_double 11 (9646 + 9647) with all three sketches gone and 2575 = 1; the stage stays 260 (t7239). Holding the message, the talk runs on into "Ah yes. I have it here." and objectbox 9649 "You show the message to Safalaan." with 2576 = 1 and 270 (t7252); the message is kept.
- Tapestry 18125, knife (t7405-7412): busy; +2 seq 3747 + sound 1721; +3 280, 2594 = 1, objectbox 946 "You slash the tapestry down the middle.". The slashed tapestry is walked through one step (3638,3304 <-> 3638,3305); no teleport.
- Statue 18127, key (t7417-7419): seq 832 + sound 1717 on the click; +2 290, 2596 = 1, the key gone, messagebox "You carefully place the large ornate key into the statue's hands...".
- Laboratory door 18047 (t7424-7429): the first opening sets 300; each opening walks the player across (3641,3307 <-> 3642,3307), inviswall 38848 + 18048 for two ticks, iron_door_open 71. It works from inside and after the book (t7475-7481) and after completion.
- Stairs: 18049 down: fade, seq 827, sound 1952 delay 10, +3 3637,9695,0 (t7430-7435). 18050 up: fade, sound 1956, seq 828, +3 3643,3306,0 (t7462-7470).
- The book 9652 is a ground spawn at 3624,9690,0, taken with Telekinetic Grab (t7454-7457); no varbit or stage change. Read: objectbox 9652 "This book seems far too complex for you...".
- Safalaan with the book (t7585-7656): objectbox 9652 "You show the book on haemalchemy to Safalaan..." with the book kept; on "Safalaan teaches you how to unlock the doors and gives<br>you a sealed message..." the book becomes 9653 in its slot and 310 (t7644). No shortcut varbit.
- Veliaf 8277 (t7733-7761): objectbox 9653 "You show the message to Veliaf." (kept); on the continue after "...here's a little something to thank you..." (t7755):
  - 2573 320, 3412 = 1, quest points 122 -> 124, "Congratulations, you've completed a quest: Darkness of Hallowvale".
  - The sealed message becomes Tome of Experience (3) 9656 in its slot.
  - Midi 147 silence, jingle 154 "quest complete 3".
  - Scroll 153: "You have completed Darkness of Hallowvale!", model 9661 `myq3_quest_complete_icon` (zoom 400), lines "2 Quest Points", "7,000 Agility XP", "6,000 Thieving XP", "2,000 Construction XP", "A Tome of Experience".
  - +7,000 Agility, +6,000 Thieving, +2,000 Construction.
- After: Veliaf's post-quest talk (t7767), the hideout's Radigad/Polmafi lines (t7780-7785).
- The tome (Wiki): three chapters of 2,000 XP in a skill of level 30 or more, not bankable; Veliaf replaces a lost one at its charge.

## Recorded differences (Wiki vs capture)

Where they disagree on rules, the Wiki wins; where the capture shows exact text or timing, it wins.

- Hammer: Wiki "Bank or drop your hammer" before the push. Live pushed and boarded with it held. No hammer check.
- Requirements: the Wiki's table marks Thieving 22 unboostable, its notes say boostable. Ours follows the notes (Construction, Thieving, Agility, Magic boostable); nothing was tested live.
- Ral: the Quick guide says "How can Old Man Ral help me?"; live set 60 on "Can you introduce me to Old Man Ral?". Both set 60 (the first is Ours).
- Vyrewatch: the Wiki says they "will occasionally stop you"; P2's 2200 ticks had none, P4 one. The Wiki's rules are used: 20% avoidance per vyrewatch outfit piece, tolerance with full vyre noble clothing or after The Blood Moon Rises, 6 hp tithe, Thieving distraction (0-99%) to a tile about four away.
- Mine: respawn 47 ticks (Wiki, 28 seconds; the Mining plugin's) against live's 49; xp 17.5 (the Daeyalt page and live's 17/18) against the mine page's 17.
- Mine cart: the Wiki says left-click deposits (2018); live only showed use-on. Both deposit.
- Vanstrom: Wiki "you can die", "Protect from Melee stops all damage", "you cannot damage him". Implemented: real melee accuracy rolls up to the cache's max hit 16 (live's were 0/10/8/15/0), prayer blocks all, the fifth attack rolls too (live 0), Vanstrom takes no damage.
- Portrait: the Quick guide says to search the slashed portrait for the key; live and the transcript give it on the slash. Inspect gives a lost key back.
- Order: live found the fireplace message at 250 before handing in the sketches; the Wiki says to give both together. Both orders work.
- The lab key on the inner door: 10 damage (Wiki and transcript); not captured.
- Vertida's lead lands at 3596,3203,1 upstairs; the Wiki says "south of Meiyerditch".
- Werewolves: the transcript's "[The two werewolves depart]"; live they vanish with the copy.

## Ours (not captured)

- Start: the requirements are checked on "Yes." only; short of them the lines and the chat ends. The post-start menus drop the last-asked option as the opening menu does. Veliaf's arrival variant covers 50-89.
- Repairs lock movement; the walk to the repair tile is dropped after 12 ticks.
- A logout mid-push counts as pushed; mid-ride lands at the dock with 40. Climb-down 17960 is Climb-up backwards. After the quest and before Sins of the Father, Board is the fade trip; without the ferries plugin a plain move. The push copies 5x5 chunks (live about 4x5).
- Route: reverse obstacles' timings (tunnel 18085, shelves 18096/18106/18108, floors, line); the line's walk anim 762 (rsprox hides live's BAS); the 25-Agility refusal text; the 22-Thieving line; a click near a landing walks and is refused; obstacles below 65 give "You're pretty sure you'll get lost..." (Wiki/dump).
- The pots give no second key once the door is unlocked or a key is held. The rug's Close puts it back. Citizens' sector names are rough bounds. The shortcut doors stay locked.
- A destroyed ladder top resets 2598 to 0 while the ladder is still broken, so the wall gives a new one; one banked or held elsewhere is left alone.
- Errands: full-bag refusals (message, runes); at 100 the handed-in variant sets 110 after "Hey there. What should I do now?"; a bush scene cut short after its last line counts as seen (130); the busy-Roald talk for 110-139; Aeonisig's Talk-to plays Roald's again-talk for 150-169; a one-option menu gets a Goodbye; Drezel's 180 talk skips its leading `unavailable` marker; the caster is the nearest Aeonisig within 15 tiles.
- Hassle: notice chance 1 in 150 a tick within 8 tiles, 20 ticks to reach the player, 100-tick cooldown; an unanswered menu is the tithe after 30 ticks (the dump's "after some time"); a walk-off counts on 2583 and the fourth is the tithe; the vyre stays down 6 ticks, then takeoff form and flies; 2580 = 2 means left alone until it drops; no tithe anim; a fight lasts up to 30 ticks or 10 tiles; untimed lines 3 ticks (5 for two-line ones); a teleport out of the mine empties the cart two ticks on; a logout ends the encounter; never for bots.
- Sketches: the rocks' unlock lasts the session (no varbit live); from the north the barricade always opens; the wall shortcut's top 39172 goes down to 3595,3310,1 with 827; an off-tile sketch gives a default line; a lost sketch 2 is made again without the scene; at 240 a re-talk or re-sketch brings Sarius back; an ambush cut short (death, logout, walking out) stays 220/230 and replays; teleports refused inside the scenes; hits land whatever the distance; the shield sounds play without a shield. Ral tops up to three, less the papyrus and sketches held.
- Lab: messageboxes for the fireplace Look-at and sickle, portrait Inspect/sickle, statue Inspect, the locked inner door, key on the door, the rune case and the early tapestry; the sealed message's Read and reissue boxes; only a knife slashes the tapestry; busy 12393 at the door, tapestry and stairs; a used fireplace tile gives a lost message again.
- Journal text (live's not captured); the stage meanings are live's.

## Dialogue dump differences (osrsreboxed-db follow-up)

Fix these in the dumper or its source overrides, then regenerate; none are patched here.

- Veliaf start: double space in "We will need  their support" (t302). The start hook sits on "Yes."; live starts on the continue of "Once you're in..." (t334). `{{tact|other}}` (x_EXwv, 2VPOiB, tc6r9B) should drop the option just asked. oywUIB's `previous2` should land on the post-start menu (t359).
- Object boxes: message steps lose their kind and `pic=`: jt4wVQ / 4_E5ML (objectbox_double plank + nails), the knife, key, ladder-top, message, rune, sketch, book and sealed-message boxes are objectboxes with items; the floorboard, latch, statue and cart lines are messageboxes.
- Citizens: 58zgZf (the whisper's continue) jumps to "- More questions -"; live goes to the after-quietly menu (t603). Hi8J8E "I'm lost": live "Lost? Well I can tell you you're in sector one, if that helps." and the "Do you live here then?" chain (t608). KdbT2u: live "I'm really sorry, but I just cannot talk to you about that. I'm sorry.". 8AWZGY continues into the after-insisting menu. Sw2Gji is `unavailable`; live "Can you introduce me to Old Man Ral?" (t773). fWtmhR and iIsRzC are `unavailable`; their `{{main}}` targets are not followed.
- Chathead expressions are absent from the dump.
- Vertida: a stray leading "&gt;" on "Well, it seems like you've done that!...".
- Bush scene: fixed in RSPSApp/osrsreboxed-db (the Wiki writes the speakers `'''Shadowy figure: (#1)'''`; the parser now reads them). The transcript's "take her" is "him" for a male character live (t3608), chosen in code.
- Drezel after the werewolves: dump "They have found a way to get across the Salve!", live "The vampyres must be using them to cross the Salve on their behalf!" (t3717 talk). His first line has a trailing space live.
- Roald: missing "Yes, citizen. Do you need something?"; the menu is live "I must speak with you on a matter of grave importance.|Not really." (t3758), not "Talk to the king about Morytania.|..."; at 150 "...if I might?" (dump "may"), nested (t4124).
- Vyrewatch: the quest page's 0lYCTf and 6sUdhp are `unavailable` (the Vyrewatch page is used); the noticed options are exported as conditions alkZUD, Dr5U5z, sUgQwM after an empty choice; the pre-hideout prompt ends "answer." (live "answer!") and the tithe option lacks the full stop after "bite".
- Mine: the guard's "Hey! How do I get out of here?" is live "Hey. How..." (t5830); the cart templates 8pASBk / hRKanq have a `<br>` before "The cart..." live (t5753); miner overheads: "Ooh, my back." / "Ooh, my arms.", "vyres" lowercase, "Work, work, work, that's all I ever do.", "I can't think straight I'm so tired.", "I'm so tired I could sleep standing up.".
- Safalaan's werewolf reply (t6370): dump "Surely the magical influence of the Salve...", live "The vampyres may be trapped by the Salve, but if they can just use the werewolves to overcome that, what's to stop Drakan having them invade Misthalin on his behalf?".
- 58OQpM: "You make a sketch" against live "the sketch" (t6493). 3Ha3WJ places the meal after Ranis' line; live on the continue of "Perhaps a light refreshment..." (t6557; handled in code). 1zYlRN "I'll make my own way." (Vertida again) is `unavailable`.
- All three sketches: the player's "a woman named Sarius showed up" is live "...Guile showed up." (t7184); Safalaan's "Sarius? Vanescula Drakan's servant? Hmmm, interesting." is live "Guile? As in Sarius Guile? But she's Vanescula Drakan's servant... Curious..." (t7220). There is no condition branch for holding the message ("Ah yes. I have it here." and the show tail, t7250-7255); the unit joins the two variants.
- Game messages no page holds (kept as literals): the floorboard kick, door, symbol, trapdoor, ladder, shelf, washing-line and jump lines, and "You board the boat and sail to Meiyerditch.".

## Not implemented

- `last_quest_id` 16741/16742, `last_started_quest_id` 16760-16763 and the last-completed varbits 16767+ (repo-wide; the runtime has none).
- quest_rating 983 in the chatbox at completion, and midi 147 silence before the jingle.
- `hidelocops`/`hidenpcops`/`hideobjops` in the scenes (no packet), the hp HUD hide (303:5), varp 5991 and the sanity varbit 15064 around the push.
- The music unlocks rely on the area music; the mine's music is left to it.
- 2577 `myq3_electric_shock` and the inner door's later states are not used.
- 18145 "Decorated wall" Search, the second table 18084's end, the sector-four bed, cracked wall and fountain stairs (no loc ids), Trader Sven and the cat/juvinate/juvenile talks.
- The Meiyerditch shortcut doors after completion (live sent no varbit when Safalaan taught them).
- The Meiyerditch boat 17961 back to Burgh.
- Post-quest Safalaan and Vertida talks, post-quest lab access, and the hideout chest's tome replacement after A Taste of Hope.
- The cart deposit's timing against walking; the book's respawn is the ground spawn's, not checked against live's ~7 ticks (t7464).

## Findings

None recorded.

## Runs

2026-11-20, agent MCP on branch fix/darkness-of-hallowvale-capture (checkpoint: In Aid of the Myreque completed by `::quest`, then played): every stage from 0 to 320 reached through the quest's own interactions, with live's varbits and landing tiles at each step; the rooftop route was spot-checked (first push wall) and the vyrewatch stop was not seen (random). Earlier: issue [#728](https://github.com/RSPSApp/tsps/issues/728) (q015); PRs: [#1105](https://github.com/RSPSApp/tsps/pull/1105).
