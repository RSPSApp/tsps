---
quest: In Aid of the Myreque
key: in_aid_of_the_myreque
status: untested
tested:
tester:
model:
commit:
cache:
start:
travel:
---
# In Aid of the Myreque

Aligned with a full live playthrough: an rsprox capture of the whole quest, revision 242 (the
user's own recording, stages 0 to 430; ticks below are its server ticks). The library books were
aligned earlier with rsprox.net recording 365 (below). Code: `server/plugins/quests/quests/InAidOfTheMyreque.Quest.js`
and its units in `server/plugins/quests/inaid/`.

## State

- The stage is varbit 1990 `myreque_2_quest` with live's values: 20, 30, 40, 60, 70, 80, 90, 100,
  110, 140, 150, 160, 165, 170, 180, 190, 200, 205, 210, 220, 230, 240, 250, 260, 280, 290, 300,
  310, 315, 320, 330, 340, 350, 360, 370, 375, 380, 390, 400, 410, 420, 430 (complete). Each is set
  by the action listed in `State.InAidOfTheMyreque.js` (`STAGE`), as the capture shows it.
- The rest is live's quest varbits in varps 704-706 (`VARBIT`): the inn wall/trapdoor/rubble
  (1970-1972), plaque (1973), store roof/wall (1974/1975), bank booth/wall/teller (1977-1979),
  furnace (1980), blood tithe cast (1981), temple trapdoor (1982), tomb boards (1983), store stock
  (1984), Ivan's armour/sickle/food (1986-1988, 2003, 2005), the crate (1991-1993), the tithe chats
  (1995-1997), fight and ambush deaths (1999, 2000), route (2001), warhammer (2004), rubble message
  (2006), the Canifis hideout's Myreque (10367), vampyre aggression (15488) and Temple Trekking's
  NPCs (1954). The cache's multilocs and multinpcs read them, so every repair and every NPC move is
  per player. They are saved in `in-aid-of-the-myreque:varbits` and sent again at login.
- Saves from before this alignment used other stage numbers and attributes; they are migrated once
  at login (`in-aid-of-the-myreque:save-version`).

## Florin, the gate, the inn and its cellar (0-110)

### Florin's food pelting (stage 20)
- Throws at t270, t280, t290: every 10 ticks while the player is near (t270: Florin 3483,3243, player 10 tiles away at 3488,3253).
- Each throw:
  - Florin: seq 385 `human_throw`, spotanim 30 `rotten_tomato_launch` (height 96), overhead "Get out of it! You're not having our food or our blood!", faces the player's tile.
  - Projectile 29 `rotten_tomato_travel`: starttime 28, angle 15, progress 32, heights 163 -> 96. The endtime is 96 / 61 / 66 for distances 10 / 3 / 4, which fits endtime = 46 + 5 x Chebyshev distance.
  - Player: spotanim 31 `rotten_splash` (height 96), delayed to the endtime. Sounds 2708 `thrown` (delay 0) and 2285 `apple_splat` (delayed to the endtime).
  - Hitsplat 12, value 0, floor(endtime / 30) ticks later (t273, t282, t292).
  - If a chatbox is open it closes (`trigger_ondialogabort`, t280, t290).
- Varbit 1969 goes +1 per throw, capped at 3 (no throws once it reaches 3). It falls by 1 at t491, t700 and t901, about 200 ticks apart starting from the last throw.

### Gate and Florin's talk
- Gate at stage 20 (t295): only the mesbox "The gate has been locked. Clearly the townspeople don't want visitors." (step rIdIca).
- Gate at stage 60 (t442-447, and again at t1970):
  - Opening: inviswall 38848 at 3484,3244 and 3485,3244 (shape 0, rotation 3); 12818 at 3485,3243 (rotation 2); 12819 at 3485,3242 (rotation 2); sound 67.
  - The player walks one tile across (3484,3244 -> 3484,3243).
  - Two ticks later the closed gates are back and the open leaves are deleted.
- Stage 20 -> 30 happens on Florin's "Hey! Don't try to sweet talk me..." (t309). That line is shown after the player's "What on earth makes you think I want your food or your blood?".
- Food on chest 12736 (t370-384):
  - t371: stage 30 -> 40, the salmon leaves its slot, objectbox 193 (salmon, zoom 400) "You gingerly place the food into the chest." (t8c_30).
  - t373, on continue: game message "Nothing interesting happens."; `cam_moveto` 3487,3250 height 500, rate 100/100; `cam_lookat` 3483,3242 height 100, rate 100/100.
  - Florin's line "Blimey, did you see that? He put some food in the chest for us! He's probably not after anything!" with chathap2 568 and no continue (`if_setevents` none).
  - t384: `cam_reset` and the chatbox closes (11 ticks after t373).
- Stage 40 -> 60 happens on "Well, there's the inn. You could look there..." (t431), after "Ah, right, I know what you mean. Hmm, let's think now...".
- Florin at stage 40 (t389-391): the opening line, then the citizens' menu "How come you have no food?|What is this place?|What do you do here?|Are there any 'out of the way' places here?|I'd best be off.".
- The citizens' shared lines (the transcript labels them "Citizen") show the clicked NPC's own name and head: Razvan at t1166 (`if_setnpchead` 4468, name "Razvan"), Vasile at t9227 and Elisabeta at t10290 on "How do you mean, 'out of the way'?" (issue 6415).

### Inn
- Broken wall 12737 Climb-over (t794; again at t1155 and t4924):
  - Exactmove one tile: to the north from 3491,3230 (angle 1024), to the south from 3491,3231 (angle 0). delay1 0, delay2 60.
  - Seq 840 `human_walk_crumbledwall`, sound 2453 `climb_wall`, busy for 2 ticks.
  - The first climb sets stage 60 -> 70.
- Pickaxe on 12738 at 3489,3231 (it resolves to 12739 "Rubble" while 1970 = 0):
  - t799: "You swing your pickaxe at the rubble..." (7dGySL) and the pickaxe's own swing (624 for rune).
  - t803: 1970 = 1, stage 70 -> 80, "...and successfully break it down." (4mYTLo), seq -1, sound 3600.
- Trapdoor 12743 at 3490,3232 (1971: 12744 Open -> 12745 Climb-down/Close):
  - Open (t807): 1971 = 1, stage 80 -> 90, sound 91. No message.
  - Climb-down (t811): seq 827 and stage 90 -> 100.
  - t812: rebuild_region into a copy of 3488-3503 x 9616-9639 on plane 1. The player lands on 3491,9632,1 and 15 locs of 12812 are added (shape 10, plane 1).
  - The tiles and rotations are in `RUBBLE_TILES`, in live's `loc_add` order.
- After stage 110 the trapdoor's Climb-down lands at 3490,9631,0 a tick after seq 827 (seen at stage 430, t4929-4930).

### Cellar
- Mine (t814-828):
  - First tick: spam "You swing your pick at the rock." and the pickaxe's animation.
  - Every 3 ticks the loc goes 12812 -> 12813 -> 12814 -> 12815, each step with sound 3600 and `update_stat` mining experience=10 (read as +10 xp).
  - On the third step: seq -1 and "You manage to mine the rubble to pieces." (FfK9Xz).
  - The first time only: varbit 2006 = 1 and the mesbox FB48Vh in place of that message.
- Remove on 12815 (t834-838):
  - "You use a spade to scoop the rubble into a bucket." (i-5aAw), seq 830, sound 1470; again 2 ticks later.
  - 4 ticks after the start: 1972 + 1, the loc is deleted, and the bucket goes up one fill (1925 -> 7622 -> 7624 -> 7626).
  - Bucket order: the one being filled first, then a new empty one.
- Finds:
  - Scoops 2 (t856) and 8 (t975):
    - On the floor at the player's tile (owner-only, despawn 200): bronze nails ×10, iron ×5, rock ×1, black ×2, mithril ×1.
    - Steel nails +3 into the inventory, and broken glass 1469 into the inventory (on the floor at t975, when the inventory was full).
    - objectbox_double 11 (4819 + 968) k3MuUJ.
  - Scoop 5 (t921): plaster 7628. Scoop 10 (t1013): scroll 7629. Both were with a full inventory, so objectbox 193 8fvSLr / bCQy9U.
- Last scoop (t1105-1119):
  - 1972 = 15, stage 100 -> 110, mesbox WHIxIw.
  - On continue (t1108): mesbox F1dHNo held with no continue; `cam_moveto` 3494,9628,1 height 400 rate 100; `cam_lookat` 3494,9633,1 height 100.
  - t1110: `cam_moveto` 3494,9631 height 300 rate 3, same look.
  - t1115: the same mesbox again, now with a continue. On continue (t1119): `cam_reset`.
- Plaque 12750 at 3494,9632,1, Search (t1133, t1139):
  - Mesbox "You read the wall plaque:<br>'<col=000080>Blessings on Efaritay, our icyene queen from far off lands and her<br><col=000080>loving children of Hallowed name.<col=000000>'".
  - 1973 = 1 on the first read only.
- Cellar ladder 12779 (t1142-1149): seq 828, then a tick later back to 3491,3232,0.

### Outside
- Dropping 7626 in town (t1187-1189): objectbox 193 with the bucket model, "The people of Burgh de Rott would not be happy if you dumped the rubble here." (rucOKN).
- Rubble pile 12749, Search (op2):
  - With a full inventory (t1242-1251): the "...throw it back onto the rubble pile." objectbox for the plaster, then for the scroll, then the menu "Empty your rubble onto the pile?" with "Yes.|No.".
  - On Yes (t1255): every 7626 turns into 1925 in its own slot, seq 2283, "You empty your rubble onto the pile.".
  - With room and no buckets (t1266): plaster then scroll objectboxes (xw81NT / NMW9RQ), each item added as its box shows.

- Read on the plaster fragment 7628 (op 2, t2757-2775): six objectboxes 193 with its model (zoom 400), the Wiki's text; nothing else changes.
- Read on the dusty scroll 7629 (op 2, t2778): `toplevel_mainmodal_open`, the long scroll 625 and `longscroll_setup` (418) with an empty title and Sialathin's letter to Lantania (the Wiki's text). Closed with its close button (t2788).
- A find that goes into the inventory is on the client with its objectbox (the inventory is sent on the same tick). `ItemContainer.add` without a refresh flag used to change the inventory without sending it (issue 6415).

## The store, crate, bank and furnace (110-210)

- Store ladder 12780 at 3513,3238,0, Climb-up (t1309-1316): seq 828 two ticks after arriving, and a tick later the roof at 3513,3239 on plane **2** (not 1). Ladder 12781 at 3513,3238,2, Climb-down (t1327-1331): seq 827 two ticks after arriving, then 3513,3237,0. Both are rows in `server/plugins/world/data/loc-teleports.json` (issue 6415: Ladders looked for a ladder on plane 1, found none and did nothing).
- Aurel at 110 (t1293-1308): the "after the inn" greeting (UXJgpJ), then the menu "What do you do here? | What do you think of your town? | I'd like to help fix up the town. | I'd best be off." 1990 goes 110 -> 140 at t1305, on Aurel's "Please can you fix the roof, then the walls..." line, after "What needs fixing?". Razvan's same option (t1174) does not change 1990. Implemented as a `before` on that line (Aurel, 110-139).
- Roof 12751 (3515,3240,2) Inspect t1318: mesbox PrBgdV, then the menu "Fix the roof?" with "Yes." / "No.". On Yes (t1323): seq 3931 pest_repair, and synth 2101 hammer_wood at delays 0, 20 and 40. Two ticks later (t1325): 1974=1, 1990=150, seq -1, 3 planks + 12 nails gone, synth 1710 m2_build, objectbox_double 11 (960, 1539) "You use some wooden planks and nails to patch up the hole in the roof.", Crafting +100.
- Store wall 12752 (t1333-1341): the same steps. Full inspect text FshL1-, "Fix the wall?", 1975=1, 1990=160, double box (960, 1539) with 2TCJ1Y.
- Aurel at 160 (t1350-1373): tg-CGu, then the menu "What do you do here? | What do you think of your town? | What should I do now? | I'd best be off." ("I'd like to help..." is hidden). Then A1yJWY: "I need 3 tinderboxes, 10 snails of any type and 10 bronze axes." On its continue (t1369): 1990=165, crate 7630 added, objectbox 193 (7630) "Aurel gives you a crate."
- Crate 7630: the item never changes. Search with nothing in it: mesbox "The crate is empty." (t1516). Using an item on it: the menu "Would you like to fill the crate with tinderboxes? / bronze axes? / food?" with "Yes, I'll fill the crate." / "No, I just want to add one.". On Yes, every needed item goes at once.
  - Tinderboxes (t1527): 1993=3.
  - Bronze axes (t1556): 1991=10.
  - Snails (t1593): 1992=10. 1994 is the overlay of all three (not sent by us).
  - Each fill shows an objectbox with the item used ("You add 3 tinderboxes to the crate." / "You add 10 bronze axes..." / "You add 10 snails..."), then a mesbox "The crate is now full of tinderboxes." / "bronze axes." / "food."
- Hand-in (t1991-1999), on Aurel's Talk-to with the full crate:
  - objectbox (7630) UsJ9P- "You show the full crate to Aurel who takes it off your hands.", then Aurel's "Wow...".
  - Next continue (t1995): 1984=1, 1990=170, the crate removed, mesbox WMcYsv "Aurel quickly puts the stock out around the shop.", then the bank request.
- Cornelius 6214 (4470) at 170 (t2018): no greeting. The menu is "What do you do here? | What do you think of your town? | How did everyone come to be here? | What should I do now? | I'd best be off.". Ku941Z: "It would be good if you could fix the bank up. I'd suggest starting with the bank booth first."
- Booth 12759 (t2041-2046): DGksPr mesbox, then "Fix the booth?". The same animation and hammer sounds. 1977=1, 1990=180, 2 planks + 8 nails + 1 swamp paste gone, double box (1941, 960) ougJmJ, Crafting +100.
- Bank wall 12760 (t2048-2060): 6hKiDA, "Fix the wall?", 1978=1, 1990=190, double box (960, 1539), Crafting +100.
- Cornelius at 190 (t2071-2096): A9Xs3G greeting, the 5-option menu, "What should I do now?" -> XNcdpB, then the recruiting lines.
  - "Cornelius gets changed..." mesbox goes out with fade_overlay 948 [0,255,0,0,50] (t2088).
  - t2090: 1979=1, 1990=200.
  - t2091: fade [0,0,0,255,50], and the mesbox is sent again.
- At 200 (t2112-2119), Razvan: the furnace citizens' greeting, then "What should I do now?" -> "...the old furnace were up and working again." 1990=205 as that line shows.
- Furnace 12805 (3527,3209) Inspect (t2166): VOBL_n mesbox, then "Fix the chimney?". After about 5 ticks of walking: seq 3931 and synth 2099 hammer_steel at 0, 20 and 40. Two ticks later (t2179): 1980=1, 1990=210, 2 steel bars gone, 1710, objectbox (2353) XVO4rp, Crafting +100.
- Fuel (t2183-2194): k2GaUk mesbox, then "Refuel the furnace?". On Yes, after about 5 ticks of walking (t2193): seq 832, 1 coal gone, synth 1709. A tick later (t2194): 1980=2 and objectbox (453) eBvDAy. No stage change and no XP.
- Cache: the multilocs are 12751 [12782, 12783], 12752 and 12760 [12787, 12786], 12759 [12799 Inspect, 12798 "Bank Booth" Bank/Collect], and 12805 [12806, 12807, 12808, 12809]. Multinpc 6214 is [4470, -1] and 6215 is [-1, 4471], both on varbit 1979.

## The furnace, Castle Drakan and the blood tithe (210-280)

### Lighting the furnace
- t2202: oploct tinderbox (590) on `burgh_furnace_multiloc` 12805 at (3527,3209), 1980=2 (shows 12808 "Repaired furnace"). Objectbox 193, item 590 zoom 400, `objbox_setbuttons` 2868 with "" (no continue), text "You light the furnace..." (also a mesbox chat line). Player anim 733 (human_createfire).
- t2207 (+5): 1990 210->220, 1980 2->3 (12809 "Furnace"), synth 2596 fire_lit, fade out (948 [0,255,0,0,50]), messagebox text cleared.
- t2209: 542=1, 12139=1, varp 5588=1, 18141=1, side tabs closed, music 241 "stagnant", minimap 2.
- t2210: rebuild_region_v2 zone (1370,732) = source chunk (440,410), 13x13. Player to (3572,3331). Vanstrom 9632 at (3553,3337) facing S; Gadderanks 9635 at (3559,3337) facing W.
- t2211: cam_moveto (3553,3328) h1900 rate 100/100; cam_lookat (3553,3358) h450 rate 100/100. t2212 fade in. t2216 first line "Gadderanks." (head 9632).
- t2270: shown with the last Vanstrom line: 1990 220->230, 1981 0->1.
- t2274 (continue): fade out. t2276: cutscene varbits reset, rebuild_normal, player at (3526,3209), tabs reopened, cam_reset, minimap 0. t2278 music 501. t2279 fade in, Gabriela (head 4461, chatscared1) "It's Gadderanks! He's found us!". t2282 (continue): 15488=1.

### The tithe in the store (230)
- Multinpcs keyed on 1981=1: 6218->4483 Gadderanks (3515,3241) S; 6216->4481 juvinate (3514,3241) N; 6217->4482 juvinate (3513,3242) N; 4479->4480 Wiskit (3515,3242) W.
- First chats set their varbit on the continue of the last line: 1995 t2328 ("Ha! We'll see about that!"), 1997 t2338 ("...Yum!"), 1996 t2347 (Wiskit's line).
- The third chat chains (t2347): fade out + challenge line (head 4483, chatang2). t2348 minimap 2. t2351: "You have unlocked a new music track: Vampyre Assault", rebuild zone (1583,758) = source chunk (433,398); player to (3514,3239); 4484 (3513,3241) SE, 4486 (3513,3240) SE, 4487 (3515,3242) S, 9634 (3517,3241) S; loc 12761 at (3514,3238) shape 0 rot 1, loc 32545 at (3514,3239) shape 0 rot 0; music 678.
- t2352: 1990 230->240, fade in, the challenge line again (chatneu2), minimap 0. Continue t2356; juvinates attack t2357.

### The fight
- Gadderanks 4484: attack 2067 (barrow_dharok_crush), block 424, attack sound 2714 granite_maul, hit sound 513 human_hit; 20 hp (sum of hits to 0).
- Juvinates 4486/4487: attack 422, block 425, attack sound 879 vampire_attack, hit sound 884 vampire_hit.
- t2415: Gadderanks at 0 hp: anim 837, transformation 4485, level_change 0, synth 512; 1999 0->1.
- t2420 (+5): 1990 240->250; Veliaf 989 at (3514,3237) facing N. t2421: overhead "Fear not my friend! I will come to your aid!" (transcript 3SyWCq); loc 38848 at (3514,3238) rot 1, 12856 at (3514,3239) rot 0; door_open 62 (report). t2422 Veliaf to (3514,3239); t2424 to (3514,3240), loc_del (3514,3239), 12761 back at (3514,3238), door_close 60.
- Veliaf: attack 390 human_sword_slash, block 388 human_sword_def. Shouts at t2445 "Let us slay these dogs!", t2449/2453 "Fight on!", t2481 "Let's kill these fiends!", t2485 "You made a big mistake coming here!", t2509 "Take that!" (all on his 4-tick cycle from t2421).
- Juvinate death: removed a tick after the killing hit (t2499 hit -> t2500 del), no death anim; mist 4435 spawned one tile SW of it, anim 1262 nine ticks later (t2509), removed t2510. 1999 1->2 at t2500, 2->3 at t2517, with 1990 250->260 the same tick.
- t2517: the dialogue opens by itself: "*cough*" (head 4485, chatsad1), t2521 Veliaf (head 989, chatang3) "Huh, it looks like Gadderanks is still alive...".

### Wounded Gadderanks, the hammer, store Veliaf
- t2530 Talk-to 4485 starts at the player's "You don't look too well, Gadderanks..." through "...bring light to Morytania." (t2588).
- t2595 mesbox "Gadderanks passes away." + fade out; t2596 minimap 2; t2599: 1990 260->280, 1981 1->2, rebuild_normal, player to (3512,3241); 4479->9633 at (3517,3242) E; Aurel 4445 (3518,3240). t2600 fade in, the mesbox again.
- t2605 (continue): 2004=1, 7668 into the inventory, then Aurel (head 4445, chatshock2) "Hey there! Gadderanks dropped this warhammer...". t2610 objectbox 7668 zoom 400 "Aurel gives you Gadderanks' Warhammer.".
- t2616 Talk-to 9633: the Veliaf variant; Veliaf's head is 989 (t2623 chatquiz2). t2632 mesbox "Veliaf heads back to the Hollows." + fade out; t2634 1981 2->3 (he goes); t2635 fade in, the mesbox again. 1990 stays 280.
- t2642 Aurel: Aurel page standard dialogue ("Hey, it's the hero! ...").

## The hideout, Ivan's escort, Drezel and the library trapdoor (0-20, 280-360)

- Hideout Myreque are world multinpcs keyed on varbit 10367 (route_hideout_npcs): 9620->5048 Veliaf, 9626->5051 Radigad, 9628->5052 Polmafi, 9630->5053 Ivan; transforms `[x, -1]`, so all vanish at 10367=1. No owner-only copies.
- Start: 0->20 as Veliaf's "Exactly. Head down to Burgh de Rott..." line shows, with the quest-start message (t46), not on the "Yes." option (t28). Implemented as the line's `before`, gated by the requirement check.
- Stage 20: Radigad (t53-57), Polmafi (t60-63), Ivan (t66-69) play their job-offer variants.
- Hollows talk (stage 280, after the store Veliaf set 1981=3 at t2634): `at-the-myreque-hideout` from t3235; 290 on Continue past "I'll see what I can dig up." (t3278); after "Sure." live opens Veliaf's 5-option menu at once (t3282), without "Hello again".
- 300 as the player's "Hey. Veliaf says..." line shows to the first of Radigad/Polmafi (t3347); the other then says "Don't worry, I'm just getting my stuff together..." (t3353).
- Ivan at 300: three lines; 310 on Continue past "That's right. We should get going soon." (t3362); after "Very well. I'm ready, lead the way." the chat closes and interface 53 burgh_map opens (t3364) with clientscript 1281 burgh_set_hover. Again at 310 (t3426-3432, t3800-3811); 2000 resets 2->0 as the map reopens (t3811).
- burgh_map (cache gamevals): 21 clickout -> cs2 1467 burgh_revert_highlight; 23 route1_layer -> cs2 1469 (shows 38); 28 route2_layer -> cs2 1470 burgh_highlight_2; 37 text_travel_layer2, 38 text_travel_layer1; 18/19 player/npc icon models. Route seqs 3559/3560 (route 1 pt1/pt2), 3561/3562 (route 2).
- Travel route 2 (t3477): game message "You decide to take route 2.", if_setanim 3561 on 53:18/19; 6 ticks later (t3483) 2001=1, follower_npc 447 = (4441<<16)|index, instance copy of source chunks 356-358 x 569-571 plane 0 (2848-2871 x 4552-4575), player to (2859,4554), Ivan 4441 at (2860,4553) and four juvinates 4443 at (2860,4557), all facing south, map closed, music 504; t3484 juvinate line "There's that tasty morsel Ivan!..." (chathead 4443, chathap1 567). multiway_indicator 0 (single-way, "I'm already under attack.").
- Juvinate at 0 HP: removed the same tick with no death animation, 2000 +1, mist 4435 spawned on its tile (it wanders), seq 1262 mist_disappear 9 ticks later, removed the tick after (t3577/3586/3587). Hits by Ivan count too (any killer).
- Ivan eats: 2005 -1 with game message "Ivan : Urgh, just had to eat some food, I only have N left." (t3950, 3970, 4010).
- Failure (first try, no food): at 2000=2 (t3624) Ivan is removed (t3625) and says "I'm getting badly beaten up here..." with head 4440, chatang2 615. Stage stays 310. Exit path 12820 at (2859,4552) "Escape" -> (3429,3401) Mort Myre (t3632-3633).
- Success (second try, with food): 2000=3 (t4023): Ivan and the rest removed, 447 -> -1, mesbox "You manage to escape from the rest..." (closes by itself at t4025), map reopened at t4027 with seq 3562 on both icons, t4033 player to (3432,3484), t4034 Ivan 4441 at (3432,3485) facing south, his "Many thanks..." lines; 315 + 10367=1 on Continue past the player's "Not a problem..." (t4040); Ivan removed 4 ticks later (t4044). The player then uses the ordinary trapdoor 3432 themselves (t4044-4055): no teleport into the basement.
- Supplies (t3384-3411): armour piece removed and varbit set as Ivan's thanks shows: helm 1986, legs 1987, body 1988, and control mask 1989 (helm 1, legs 2, body 4: 1 -> 5 -> 7). Texts "Thanks for the helmet!...wear it", "...chainbody!...wear it", "...steel legs!...wear them". Sickle: objectbox 193 with sickle 2961 "You offer the sickle to Ivan.", player line, then on Continue 2003=1 and the sickle taken (t3411).
- Food (t3780-3789): objectbox with the food "Would you like to offer Ivan all of this food type...", menu "Yes, I'll offer all...|Nope, I'll just given him one.", objectbox "You hand over some food to Ivan...", 2005=8 on its Continue, "...I could carry another 7 bits of food." (cap 15).
- Drezel: world NPC 9805 (multinpc 9636 via varp 302) at (3441,9894). Live starts at "Well done for bringing Ivan to the temple, ..." (t4060): the transcript's first line is skipped. 320 on Continue past "Yes, it seems to be..." (t4068), 330 past "But you don't even know what he said about Ivandis." (t4089), 340 past "So you have no further information..." (t4182), 350 with the key 7632 added and objectbox "Drezel gives you a key." (t4264).
- Keyhole 12765 Inspect: mesbox "You inspect the panel. It looks like there's some sort of keyhole in it." (t4269). Key on keyhole: 1982=1 and mesbox "You use the library key in the keyhole and you hear a click to the left of you."; stage stays 350, key kept.
- Trapdoor multiloc 12762 (1982=1 -> 12763 "Trapdoor" Climb-down): seq 827 human_pickupfloor (t4286), next tick 360 and teleport (3360,9904), no message (t4287).

## The library, the tomb and the Rod of Ivandis (360-430)

- **Ivandis bookcase 12767**, t4323: "You search the bookcase..." (game message), varbit 1990 360 -> 370, The Sleeping Seven
  7633 added, objectbox 193 with item 7633 "You find a book called The Sleeping Seven." on the same tick. The history
  bookcase 12766 and both books' pages/boxes are still rsprox.net recording 365's (data/in-aid-of-the-myreque-books.json).
- **Reading The Sleeping Seven** (op Read on 7633), t4358: 1990 370 -> 375 on the tick the book opens (human_readbook 1350,
  book 392). The other two books were read at t4327 and t4345 with no stage change.
- **Tomb boards**, hammer 2347 on multiloc 12772 at (3483,9832) (varbit 1983: 0 -> 12773 "Wooden boards", 1 -> none), t4479:
  t4480-4482 human_poh_build 3676 each tick, poh_build_wood 938 on t4480; t4483 varbit 1983 0 -> 1, anim -1, objectbox
  with item 2347 "You manage to break up the boards using a hammer." 1990 stays 375. No loc add/del.
- **Tomb entrance 12770** at (3484,9832), click t4488: t4489 1990 375 -> 380, human_longcrawl 2796, fade_overlay 174 with
  script 948 [0,255,0,0,50], synth climbing_loop 2454 (loops 3, delay 4); t4491 teleport to (3491,9876,0), anim -1; t4492
  fade-in 948 [0,0,0,255,50]; t4494 overlay closed. No chat line.
- **Coffin 12802** at (3511,9863): examine (op6) at t4506 "The resting place of an ancient warrior." (examine data).
  Soft clay 1761 on it, t4513: 1990 380 -> 390, clay's slot 8 becomes 7649, objectbox with 7649 "You use some clay to
  create a mould of the rod."
- **Silvthrill rod**: Falador furnace 24009 Smelt opens silver_crafting 6 (t4546); "ivandis" (6:29) at t4549:
  varbit 13893 = 19, human_furnace 899, sound 2725, menu closes; t4551 1990 390 -> 400, rod 7637 into slot 6, slots 7
  and 16 emptied, Crafting +55, no message. Our side: Crafting's "crafting:made" (itemId 7637) -> 400.
- **Lvl-1 Enchant on 7637**, cast t4562: t4563 1990 400 -> 410, busy, script 915 [6]; second cast t4569 ignored;
  t4572 burgh_human_quest_enchanting_rod 3566, spotanim 609 height 92, 1 water + 1 cosmic used, slot 6 7637 -> 7638,
  sound 136, objectbox with 7638 "As you cast the enchantment on the rod, it seems to vibrate and glow.", Magic +18
  (the spell's 17.5); box closed t4576.
- **Salve well 3485** at (3423,9890), enchanted rod used t4706: human_pickuptable 832 + pool_plop 1658 that tick; t4710
  1990 410 -> 420, slot 6 7638 -> 7639, objectbox with 7639 "You lower the rod into the Salve and withdraw it shortly
  after. It seems to glow in a rather strange way." The player carried a rope (slot 11, bought at the GE ~t3015), kept.
- **Veliaf** = myq5_veliaf_burgh_hideout 8277 (multinpc 9489 via varbit 10352 = 0) at (3494,9628); chathead sent as 8277.
  t4934 talk: "Well met. How's it going?" (588) / player "I have brought you the Rod of Ivandis!" (567) / "Very
  impressive. Good work." (567). On that continue (t4942): 1990 420 -> 430, varbit 1954 0 -> 1, rod removed (slot 7),
  objectbox with 7639 "You give the Rod of Ivandis to Veliaf.". Then "I... I don't believe it! You've really done it!"
  (571) and "Well <name>, you have certainly excelled yourself in this task. I believe you may soon be true Myreque
  material." (572).
- **Completion**, on the continue after that line (t4953): qp 120 -> 122, varbit 6347 +1, "Congratulations, you've
  completed a quest: In Aid of the Myreque", chat closes, midi silence 147, jingle 154, scroll 153 (title, model 7639,
  the five reward lines), quest_rating 983 in the chatbox, then +2,000 XP Attack/Defence/Strength/Crafting.
- **After the scroll** (closed t4963): player "So what now?" (554) and Darkness of Hallowvale's start (its
  `starting-the-quest-talking-to-veliaf-hurtz`, condition 5iTY3c) up to "Start the Darkness of Hallowvale quest?"
  (t4982); "Yes." then the chat closes (t4987) with no Darkness of Hallowvale varbit change. A second talk (t4988) plays the
  "coming back" path: "Hello again. How's things?" / "Very good. I'd say our mission..." (condition Ao7Gq6).

## Recorded differences (Wiki vs capture)

### Burgh

- The Wiki lists the finds as "10 bronze, 5 iron, 3 steel, 2 black and 1 mithril" nails plus the rock, glass, scroll and plaster. The capture splits them over scoops 2, 5, 8 and 10. Implemented as captured.
- The Wiki says the buckets are emptied by using them on the pile. The capture empties them through the pile's Search menu. Both are implemented: a bucket used on the pile empties every bucket, without the menu (Ours).
- The Wiki says "The rubble will reappear upon leaving the cellar and returning if you only mine it and do not remove it." This matches deriving the cellar from 1972: only removed rubble stays gone.

### Store

- Crate food: the Wiki says Aurel randomly asks for 10 mackerel or 10 snail meats (raw or cooked), rerolled until the crate is handed over. The capture asked for "10 snails of any type" (t1364). Implemented the Wiki's rule:
  - The choice is drawn per conversation at the stock line and saved when the crate is given, in attribute `in-aid-of-the-myreque:crate-food` (1 snails, 2 mackerel).
  - Snails accept 3363/3365/3367/3369/3371/3373; mackerel accepts 353/355.
  - A save with no choice takes snails.
- Booth "Bank" before Cornelius: the transcript (cv08Lr) says "While the booth looks functional, there still isn't anyone working behind the booth to serve you."; implemented as a mesbox. Not captured. 1977=1 still turns the loc into 12798 at once, as live does.
- Crafting XP: the Wiki gives no value; the capture's +100 per repair is used.

### Tithe

- Veliaf's arrival: Wiki "After one of the vampyres turns into mist, Veliaf will enter"; capture: 5 ticks after Gadderanks is wounded (the player hit him first). Implemented as "5 ticks after the first foe counted in 1999", which matches both.
- Wiki: with a full inventory the Gadderhammer "can be claimed from [Aurel] later". Capture only shows a free slot. Implemented: 2004 and the item only when a slot is free; Aurel's next talk hands it over (with the capture's line + box).
- Wiki (Vampyre Juvinate): 4487 is grouped with the level-54, 85 hp Burgh juvinates; the cache gives 65 hp / lvl 54; the capture's hits on 4487 add up to roughly 60. Unresolved; combat defs below use the cache's hp.
- Wiki: "You may leave the room at any time, which will cause the fight to reset." Not captured; implemented on the door's Escape/Quick-escape and on any leave of the copy.

### Escort

- Ivan's eating message: Wiki "just had too eat", live "just had to eat" (t3950). Implemented the Wiki's.
- Ivan's flee: the Wiki permits either route without supplying him if he is protected. The capture's first attempt ended at the second juvinate death with no food (t3624-3625), but his hitpoints were not recorded; this is not a kill-count rule. Failure follows the health watcher (below half HP with no food) or his defeat, so a healthy Ivan can continue without supplies. The exact health threshold remains an implementation approximation below.
- The legs' thanks: the transcript's template has "wear it"; live says "wear them" for the legs (t3399). Implemented live's (placeholder filling).

### Rod

- None found in this range: the rope requirement (Wiki/transcript) agrees with the capture (the player had one).
- Magic XP: the spell's 17.5 (Wiki); live's stat packet shows 18 (rounded display).

## Not covered and our own choices

### Burgh

- Ours: the pelting also runs at stage 30 (live only threw at 20). The Wiki keeps Florin hostile until the food is placed.
- Ours: the throw watch runs only in Burgh's map square (54,50) and needs Florin within 10 tiles. Live's real trigger isn't captured.
- Ours: the gate's locked mesbox is followed by a throw while 1969 < 3, as the transcript has it. Live never showed this, because 1969 was 3 at t295.
- Ours: food is taken only at stage 30. The Wiki says to talk to Florin first, and the capture never tried food at 20. Food means any non-noted item with an "Eat" option.
- Ours: the chest's Search sends o-ZQU1 as a game message (not captured).
- Ours: the climb gives no Agility xp. The capture's update_stat deltas are 0 then 1, which may mean 0.5 xp a climb; it's unclear.
- Ours: the mine steps are a fixed 3 ticks whatever the pickaxe (only rune was captured).
- Ours: re-entering a partly cleared cellar spawns the last (15 - 1972) tiles of the list at 12812. Mid-mined state isn't kept.
- Ours: the trapdoor's Close (1971 = 0, no sound), "The trapdoor is buried under rubble." before the wall is broken, and the no-pickaxe / no-spade / no-bucket lines (from the old plugin).
- Ours: a pot also scoops, with fGcoJY from the transcript.
- Ours: the pile hands back the plaster or scroll only once 1972 has reached 5 or 10, and only when the player isn't carrying it. With nothing to give and no buckets, the Search does nothing.
- Ours: the cellar drop/Empty refusal uses xM4kXM in the same objectbox. Empty in town uses rucOKN.
- Ours: stage >= 110: the Climb-down goes to 3490,9631,0 (live at 430) and the plane-0 cellar ladder returns to 3491,3232,0.
- Ours: in the live capture, the first scoop moved the bucket to another slot (t838). Ours fills it in place.
- Not covered: "trying to put food on the table" (E5uljt): the table loc isn't identified.
- Not covered: reading the plaster and scroll (t2800+, later stages).
- Not covered: the block sound with the 0 hitsplat (2966/2963 delay 20); that's left to the hit system.
- The old plugin's owner-only Razvan (and every other runtime spawn) is gone. A test checks that no owned Razvan exists.

### Store

- No walk-to before the furnace and fuel animations (live walked about 5 ticks to 3527,3211 / 3526,3209). The roof, walls and booth had no walk.
- The mesbox re-sent with the fade-in at t2091 is approximated by `box.holdTicks: 3` on the recruiting mesbox.
- `hpbar_hud:hp` 303:5 hide during the fade: not sent.
- Inspecting the roof/wall before 140, the booth before 170, the bank wall before the booth, or the furnace before 200: the inspect mesbox alone, no menu (not captured).
- Aurel's Trade from 110-169: his line q11mmS as an NPC chat (not captured). From 170 it falls through to the generic shop handling.
- Partial crate Search text (eNm9WM blanks filled with the remaining counts; the food named as asked), "You need another N ... to fill this crate.", "You add a ... to the crate.", and "You've already filled the crate with ...": transcript wording, not captured.
- A full bag when Aurel hands out the crate: "You don't have enough inventory space." and the stage stays at 160.
- A lost crate: asking Aurel again at 165 (IWXcv-) gives a new crate when the player has none anywhere; what was packed stays packed (varbits 1991-1993).
- Aurel's greetings: tg-CGu at 160, otUEZ9 at 165, _npW-_ at 140-159, 4l7-ER from 170. "I'd like to help fix up the town." is hidden from 160 (captured at 160 only).
- Citizens handled 110-219 by name: Florin, Vasile, Razvan, Luminata, Elisabeta, Teodor, Gabriela, Cornelius, Luscion, Sergiu, Sorin, Ileana, Radu, Valeria, Grigore, Emilia, Simona, Calin, Nicoleta, Mihail. The variant is chosen by stage: after-inn below 140, store citizens 140-169, bank citizens 170-199, furnace citizens 200-219.
- Inspecting the fuelled furnace (1980=2) falls through to Tithe.
- The working booth's Bank opens `player.getBank(tab).open()` directly (see below). Collect is not handled.

### Tithe

- Ours: stage 220 with no castle scene playing (a logout before it opened, or a save taken during it) resolves as a scene cut short: 230, varbit 1981 = 1 and 15488 = 1, at logout or the next login.
- Ours: Veliaf's shout chance (1 in 4 per 4-tick cycle; the capture shows 6 in ~24 cycles), picked at random from the five captured lines.
- Ours: Veliaf's hitpoints are locked (he takes hits, never falls); he targets the first living juvinate.
- Ours: leaving the copy resets 1999 to 0 and a 250 back to 240; talking to Gadderanks (4483) at 240-259 replays the challenge into a new copy; at 260-279 it reopens the copy with the wounded Gadderanks and Veliaf (no fades).
- Ours: exit/logout tile of the fight copy (3514,3237), outside the store door. Castle scene cut short by a logout still sets 230, 1981=1 and 15488=1.
- Ours: Gadderanks' level_change 0 and the headbar removal at t2415 are not sent (no core API).
- Ours: the Inspect option on the fuelled furnace (1980=2) plays the transcript's lighting variant; not captured.
- Ours: lost-hammer purchase keeps the old plugin's full-bag check ("You don't have enough inventory space.").
- Not covered: citizens' talks from 280 on (left to the default/other units); the "Vampyre Assault" unlock message relies on the area music unlock (`rules.musicTrack`).
- Chathead animations are not set by this unit (they belong in `plugins/quests/data/chathead-animations.json`).

### Escort

- Ours: a won ambush cut short by a logout before Ivan's arrival is saved outside Paterdomus (3432,3484) and counts as Ivan delivered (315), his thanks unplayed.
- Route 1 (Canifis) is not captured: Ours: its message follows route 2's ("You decide to take route 1."), 2001=2, the same swamp copy with two level 75 juvinates 4442 (Wiki: two level 75), escape at 2 deaths, seqs 3559/3560.
- Ivan's hitpoints/heal: the capture shows none. Ours: eats below half his max HP, each bite heals a quarter of max; at 0 HP he leaves like the no-food case. (Ivan 4441 currently gets the engine's default 40 HP.)
- Which juvinates engage: Ours: one on the player, one on Ivan, the others wander and take a fallen one's place.
- Teleports out of the copy are allowed (rule null); logout/death inside comes back at the exit path tile (3429,3401).
- Stages 20-279 Veliaf: the job offer's "If speaking again" lines (not captured). Radigad/Polmafi/Ivan at 280-289: their job-offer lines (not captured).
- Drezel at 320-349 talked again: same variant from its second line (not captured). Drezel 350-429 without the key: the Drezel page's lost-key lines (P91CrU) alone. With the key: the "afterwards" variant.
- Drezel's "didn't exhaust other options" (zTSrDo) is answered false (live had used all three first).
- Food offered when Ivan is full: Ours: only his "totally stocked up" line. Sickle offered twice: the lines play, nothing taken.
- "Other armour" = an item whose equipment slot is head/body/shield/legs; "other food" = an item with a cache "Eat" option.
- The pet-follower refusal (_MNE1A) stays the entry's (answered false).
- Map travel is dropped if the player closes the map during the 6-tick animation.

### Rod

- The server stage stays 420 from the hand-in box to the rewards (the client sees 430 from the box, as live). A
  disconnect or walk-away between them leaves 420 + 1954 = 1 and no rod; Ours: the next Veliaf talk resumes at "I... I
  don't believe it!" and completes there. At login the client sees 420 until then.
- The scroll opens one tick after the continue (QuestRuntime defers it at least a tick); live: same tick (t4953). XP is
  granted before the chat line/jingle in ours, after the scroll in live (same tick).
- No `busy` (12393) varbit, no hp bar hide (303:5) or fade_overlay:message "" around the crawl.
- Stage 420 without the rod: the after-making-a-silvthrill-rod talk (as before the alignment; no source).
- Unenchanted rod in the well, no-rope refusal, rod/coffin Inspect: not captured; the transcript's words go to chat
  (not a box).
- Veliaf 9489 below stage 315 and Radigad/Polmafi outside 315-429: not handled here (no source).
- The tomb's way out was not captured (the player teleported); not handled.
- The library ladder 12764 up (t4389-4394: human_reachforladder 828, then (3440,9899,0) the next tick) is left to the
  generic Ladders plugin; not verified.
- Second Enter during the crawl is ignored (Ours).

## Live capture: the library books

rsprox.net recording 365 (revision 231; the account had finished the quest) searches both
Paterdomus library bookcases and reads all three books cover to cover. `InAidOfTheMyreque.Quest.js`
follows it:

- **Bookcases.** Search sends "You search the bookcase..." and then, for each book of that case
  the player does not carry, the book and an item box (193) "You find a book called <title>."
  (Ivandis case 12767, ticks 2918-2923; history case 12766, ticks 3876-3884, Histories of the
  Hallowland then Modern day Morytania, one box after the other). Searching again with the book
  held sends only the search line (2927-2928). With one free slot, the second book went on the
  floor under the player (owner only, despawn 200) and its box still showed.
- **Read** opens book 392 with the reading animation (human_readbook, 1350): The Sleeping Seven
  runs to 9 spreads (3114-3123), Histories of the Hallowland to 11 (4170-4183), Modern day
  Morytania to 8 (4545-4554). The text is in `server/plugins/quests/data/in-aid-of-the-myreque-books.json`.

## Findings

None recorded.

## Runs

No run yet. Tracked in issue [#728](https://github.com/RSPSApp/tsps/issues/728) active (q061); PRs: [#1133](https://github.com/RSPSApp/tsps/pull/1133).
