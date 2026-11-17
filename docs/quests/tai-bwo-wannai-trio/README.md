---
quest: Tai Bwo Wannai Trio
key: tai_bwo_wannai_trio
status: in-progress
tested: 2026-11-17
tester: agent
model: claude-opus-5-5
commit: 5effdecea
cache: osrs-242_2026-11-03
start: checkpoint
travel: manual
---

# Tai Bwo Wannai Trio

Aligned with two whole runs of the quest on live: RSProx captures local 1001562 (revision 241: the start at
tick 5547, completion at 8101) and 75 (revision 227, Leagues V: start 3103, completion 5054, the brothers'
post-quest rewards at 5098-5137), with JunglePotion (revision 242.1) for Timfraku before and after Jungle
Potion (ticks 534-575, 1429-1469). The plugin is `server/plugins/quests/quests/TaiBwoWannaiTrio.Quest.js`
with its units in `server/plugins/quests/taibwowannaitrio/`; the words are the "Tai Bwo Wannai Trio"
transcript page, corrected from the same captures in osrsreboxed-db's `capture-sources.json` and with a
bullet-depth fix for Lubufu's menu in its `runtime-bindings.json`.

## Stages (varp 320, tbwt_main)

| Value | Set by (capture tick) |
| --- | --- |
| 1 | the continue past "Well then <title>, you would do better to ..." (local 1001562 t5486; JunglePotion t544, before Jungle Potion too) |
| 2 | the start prompt opening (t5544; JunglePotion t1458) |
| 3 | "Yes." on the prompt, with "You've started a new quest" before "Ok, I'll do it." (t5547) |
| 4 | the continue of the last son's "I will meet you in the village once you have helped my brothers and spoken to my father." (t7942) |
| 5 | Timfraku's "hands you a big stack of gold coins." box, with the 2,000 coins (t8097) |
| 6 | that box continued: completion and the scroll (t8101) |

The brothers' field NPCs (6235/6237/6239) are multinpcs on varp 320 at 0-5 and their house NPCs
(6236/6238/6240) at 6.

## Tiadeche (varp 321, tbwt_tiadeche)

| Value | Set by (capture tick) |
| --- | --- |
| 1 | the first talk, on the click (t6182) |
| 2 | "I will return only when I have caught a Karambwan." showing (t6195) |
| 3 | the baited vessel's hand-over box (t6216) |
| 4 | "Take a Karambwan vessel to my brother Tinsay..." showing (t6719) |
| 5 | Tinsay's crafting manual box (t7761) |
| 6 | the manual's hand-over box to Tiadeche (t7917) |

## Facts the plugin relies on

- **Timfraku.** Until Jungle Potion's news reaches Trufitus (varp 175 at 13), the menu after "Well then ..." is
  only "Why should I leave?" and "Right, I'm going then.", and a second talk is "You again! Only a fool would
  ignore my instructions." with three answers, each "I said: begone!" (JunglePotion t534-575). With the news,
  the menu adds "Trufitus sent me." and "Ask about Village." (local 1001562 t5486), and a met player opens
  with "Trufitus sent me." (JunglePotion t1429). "Timfraku appears to concentrate very deeply." comes as "Then
  it must be true." is continued; the chatbox closes and "I cannot thank you enough..." follows 4 ticks later
  (t5511-5515). A refused start: "Are you ready to help me?", "What do I have to do?", the request and the
  prompt again (JunglePotion t1462-1469).
- **The reward.** The coins box shows coins_1000 (1003); once its scroll is closed Timfraku says "You should go
  and see my sons in the village. I think they have something for you." and the village menu follows (t8103).
  The scroll's model is the raw Karambwan and its lines "2 Quest Points", "5,000 Fishing XP", "5,000 Cooking
  XP", "2,500 Attack XP", "2,500 Strength XP": no coins (t8101; 75 t5054).
- **Lubufu.** The player says "Who are you?" before his answer. "What do you do?" leads to a menu of "What do
  you do with your Karambwan?", "How old are you?" and "What do you use for bait?", with "I could help collect
  the bait." once he has said what he does with his Karambwan (locals 1001562, 1000187 and 1000406 and 75 all
  ask "What do you do?" twice for it). After the 20 Karambwanji, "What do you use to catch Karambwan?" ends at
  his answer twice; the third time, "My, you're keen aren't you?", then as it is continued "Lubufu appears to
  think for a moment." with his think emote (857), and 3 ticks later his apprentice offer (t5801-5867; 75
  t3310-3352). "Lubufu teaches you a new fishing technique." is an item box of raw Karambwanji; "Lubufu hands
  you a Karambwan vessel." an item box of the vessel, with the vessel and 1,500 Fishing XP as it shows
  (t5939). The lost-vessel replacement comes with its box too (t5982).
- **Tiadeche.** "As you say, Bwana." continued: "Tiadeche attempts to use the Karambwan vessel.", the chatbox
  closes, he plays human_octopus_pot (1193) 2 ticks later and "Bwana! I cannot believe my eyes!" comes 12
  ticks after the continue (t6234-6246). Accepting his catch: "Tiadeche hands you his first catch!" box with the
  raw Karambwan, then his request (75 t3758-3769). Left before it, the next talk is "Can we return to the
  village now?" and the request (t6699-6730). The manual handed over: jingle 189 as its box is continued
  (t7920).
- **Tinsay.** "Tinsay pauses and then mutters to himself." as "Right ... what do you need?" is continued, his
  request 4 ticks later (t7467-7471). The rum box: he drinks it (human_drink_rum, 1194) as it is continued and
  speaks 4 ticks later (t7509-7513); "I'm thinking..." holds 4 ticks (t7536-7540); the sandwich box: he eats it
  (human_eat) the tick after and speaks 5 ticks after the continue (t7578-7583); the marinated bones box: he eats
  them with jingle 188 as it is continued, retches (human_wretch, 1196) 2 ticks later and speaks 9 ticks after
  the continue (t7681-7690; 75 t4918-4928). The vessel for Tiadeche: "Tinsay studies it..." as its box is
  continued, the manual's box 4 ticks later (t7756-7761).
- **Tamayu.** The watched hunt: the player at 2520,4568, Tamayu (4705) at 2523,4567 facing the Shaikahan (4709)
  at 2524,4567, the camera on 2523,4567 (height 160) from (2518,4571), (2524,4575), (2525,4563), (2529,4567),
  (2530,4571), (2528,4564) at height 350, rates 232; back 25 ticks later with his three lines (t7097-7130).
  The win: 14 ticks in the player is at 2537,4568 and Tamayu (4706) at 2541,4565, the camera at (2552,4566)
  height 700 on (2541,4565) height 320; "The end approaches, Shaikahan!" 2 ticks later, "Gods! Witness this
  triumph!" and jingle 190 6 after that; back at 30 (t7223-7253). The potion and the spear are item boxes;
  after the potion's "Thank you Bwana. Now I must prepare for my next hunt." he drinks it (human_eat) and speaks
  4 ticks later (t7168-7172); with a four-dose potion before any spear the player says only "I've noticed you
  commenting on the Shaikahan's agility. Try drinking this potion." (t7155; 75 t4569). The monkey corpse box:
  he skins it (human_cooking, 896) as it is continued and "Tamayu hands you some monkey skin and bones." comes 4
  ticks later with them (t7316-7324). After the quest: "Tamayu trains you in fighting technique." is a message
  box; the XP and the spear come as it is continued (75 t5102-5103).
- **Items.** Raw Karambwanji on a vessel loads every empty vessel, the tick after the click then every 2 ticks,
  with no message (t6004-6007). A tinderbox on jogre bones is lit as logs are: the bones on the ground, "You
  attempt to light the Jogre bones." and human_createfire, the roll 3 ticks later, a step aside, and the tick
  after "The fire catches and the bones begin to burn." with the Burning bones loc (3862, rotation 1), sound
  2596 and 90 Firemaking XP; 35 ticks on the fire is gone and the burnt bones lie there (t6820-6868; 75 t3789-
  3839). Raw-paste burnt bones on a fire: "You marinate the burnt bones perfectly.", human_firecooking, sound 2577
  and 100 Cooking XP (t6980; 75 t4297). Grinding: "You grind the raw Karambwanji to form a sticky paste." and
  "You grind the cooked Karambwan to form a sticky paste." (poorly cooked Karambwan) on Herblore's grinding loop,
  human_herbing_grind and sound 2608 (t6871-6876, t6998-7000). "You smear the poisonous Karambwan paste over the
  spear." (t7004). "You sandwich the seaweed in the monkey skin." (t7331).
- **Wiki.** Firemaking 30 for the tinderbox; jogre bones on a fire only heat ("You heat the bones over the fire,
  but they don't look any different."); a furnace burns them for 25 Cooking XP; only the poisonous paste
  poisons spears (Karambwan paste); cooked-paste bones explode for 2 damage (Pasty jogre bones); a tinderbox's
  failed light retries (Burnt jogre bones), on Firemaking's lighting chance.

## Recorded differences (Wiki values kept)

- Live words three lines differently from the Wiki transcript, whose wording is kept: Timfraku's "Adventurer,
  please accept my eternal gratitude!" for a roving adventurer (the Wiki: "Roving adventurer, ...", local
  1001562 t8077, 75 t5044); Tinsay takes the rum and the sandwich straight after "Yes, I have it right here."
  without the Wiki's "Well, hand it here then." (t7502-7505, t7572-7575; 75 t4835-4883); "You ask too many
  questions! Now begone!" (the Wiki has a full stop; JunglePotion t553).

## Not covered

- Ours: the timings of the other titles' welcome-backs and rewards, the Wiki's failure branches (wrong bones,
  wrong rum, the partial potions, the plain and poisoned spear hunts' outcome lines are the Wiki's, played
  after the same 25-tick hunt), and the return tile after a hunt (the tile the player left from; live's varies).
- Ours: whether Lubufu's three asks and his bait offer survive a logout (saved here).
- Ours: the message for raw-paste bones that weren't burnt (the burnt bones' line is used), and for grinding a
  raw or a properly cooked Karambwan.
- The way to Tinsay is not this quest's: the Rock slide is an Agility shortcut (`agility-shortcuts.json`, 1 XP,
  as t7386) and Cairn Isle's bridge is Shilo Village's ("You manage to keep your balance on the bridge.", 10
  XP, as t7397); neither was re-checked against this capture.
- The tribal statue's and the bamboo doors' post-quest behaviour (75 t5089-5145: walk-through with sound 40)
  are left as they were.

## Runs

### 2026-11-17 · agent · claude-opus-5-5

- Capture alignment against local 1001562 and 75 (and JunglePotion for Timfraku), from a checkpoint per
  conversation: `server/tests/tai-bwo-wannai-trio-capture.test.cjs`.
