---
quest: The Hand in the Sand
key: hand_in_the_sand
status: untested
tested:
tester:
model:
commit:
cache:
start:
travel:
---

# The Hand in the Sand

Aligned with a whole run of the quest in an rsprox capture (revision 242, local 1002235, stage 0 to 160,
Zogre Flesh Eaters not started). Ticks below are that recording's. Code:
`server/plugins/quests/quests/HandInTheSand.Quest.js`, the shared bell in
`server/plugins/quests/WizardsGuildBell.js`; test: `server/tests/hand-in-the-sand-capture.test.cjs` (a real
Player through every step, with the capture's timings).

The words come from the Wiki transcript (osrsreboxed-db). Where its markup misses the live flow, osrsreboxed-db
capture sources restructure it and keep the Wiki's wording: the start prompt, the bell conversation, the
player's own question before Sandy's second and third answers, and the runes-and-sand hand-in.

## Steps as captured

| Ticks | Step | What live sends |
| --- | --- | --- |
| 7226-7282 | Bert's start | Menu "Start The Hand in the Sand quest?" (Yes./No.). On the continue of "..... Nae, ye can 'ave the 'and as h'evidence.": `handsand_quest` 0→10, `handsand_question1-3` (1528-1530) 0→1, the start message, then the sandy hand (6945) in an item box. |
| 7303-7350 | The Guard Captain with a beer | Talk-to. "You give the beer..." item box (beer); on its continue the beer goes with `handsand_gulp` (1589). On the continue of "But aren't you going to find out...": 20, the beer soaked hand (6946) for the sandy hand, `handsand_drop_hand` (1588), its item box. |
| 7398-7474 | The bell | The bell swings (`zogre_bell_ring` 2103) and rings (`zogre_bell` 1959, area sound, range 5, at 2598,3086) the tick after the click; a tick later Zavistic Rarve is added at 2598,3087 facing south and speaks. "What are you doing ringing that bell?!", "But I was told...", "Well...anyway..." (no menu), "You wave the hand at the wizard." (item box, beer soaked hand) ... on the continue of "Bert? Ahh yes...": 30, the hand taken, "You hand it over." (item box). Zavistic walks about and goes 12-16 ticks after the chat closes. |
| 7511-7563 | Bert's rota | On the continue of "So you're employed by Sandy's Sand Corp...": 40 and Bert's rota (6947). |
| 7668-7671 | Sandy's desk | 50, Sandy's rota (6948), "You quickly sift through..." in a statement box (messagebox 229). |
| 7675-7690 | Pickpocketing Sandy | `human_pickpocket` (881) every attempt, no XP, no stun. Two misses ("You felt something but it slipped through your fingers..."), then two successes: each adds a sand (6958) with "You rummage around in Sandy's pockets....." and "You find a small amount of sand." |
| 7856-7887 | Bert's scroll | On the continue of "A scroll appeared?...": 60, the scroll (6949) in Bert's rota's slot, Sandy's rota gone. |
| 7925-7987 | The scroll to Zavistic | Bell; Zavistic's "What are you doing...Oh, it's you..." then straight to "I talked to Bert..." (no Zogre menu). On the last continue: 70, the orb (6950) for the scroll, its item box. |
| 7989-8037 | Zavistic's teleport | Bell; his guild menu (What is there to do / requirements / What do you do / Can you help me more?), "Bring me a vial...", the transport offer and "Yes, that would be great!". On the continue of "Off you go then, break a leg!": `handsand_tele` (1531) 0→1, a vial taken, the chat closes, and the bell's Zavistic casts (`human_castentangle` 710). Two ticks on `human_shrink` (3041, delay 4) with `teleport_casting` (111, height 92) and `teleport_all` (200); two ticks after that the player is at 3014,3259 with the sequence cleared (-1) and the facing reset. `human_shrink` lasts 20016 client cycles and ends shrunk to nothing, so the landing must clear it or the player stays invisible (#6542). |
| 8045-8063 | Betty | Menu "Talk to Betty about the Hand in the Sand." / "Talk to Betty about other matters.". On the continue of "I have one here!": `handsand_serum` (1532) 0→1, a vial for the bottled water (6953). |
| 8068-8078 | The lens | Redberries on the water: 1532 2, redberry juice, "Now you just need to add white berries to make the pink dye." White berries: 3, pink dye. Dye on the lantern lens: 4, the rose-tinted lens (6956), `drip_liquid` (2392), an item box. |
| 8082-8118 | The counter | Betty's lines, then on the last continue `handsand_counter_multi` (1537) 0→1, `put_down` (2739), "Betty places a vial on her counter." (item box, vial). The player walks to Betty's doorway (3016,3259) by their own click (also 01698 t2803-2811) and uses the lens on the counter (10812) from there, three tiles away, turning to it (Ours: a use from elsewhere walks there first); no graphic or projectile is sent (no "ray of light"): 1537 0, 1532 5, the truth serum (6952), `handsand_vialshatter` (1587), its item box. |
| 8121-8149 | The sand | On the last continue (of "Don't forget to dilute it..."): 1532 6, 80, one sand taken. |
| 8250-8266 | The distraction | "There's a herd of huge mutant herring..."; on the continue of "Wow! I must see this!": 90, `handsand_sandy_multi` (1535) 0→1 (Sandy 6405 gone, 6537 at 2788,3176 looking out), "Sandy turns to look out of the window, now is your chance!", the chat closes. |
| 8275-8287 | The coffee | Serum on the mug (10806): 100, 1535 0, the serum taken, `handsand_serum` (1592), a statement box. |
| 8280 | The orb | Activate: 110, the full orb (6951) for the orb, `handsand_orb` (1590), item box (6950). |
| 8292-8353 | The questions | The menu offers only questions still to ask (4, then 3, then 2 options). The player asks each; its varbit (1528-1530) goes to 0 on that line's continue, then Sandy answers. After the third: "I think I have enough evidence now...", then 120 and the full orb's item box. |
| 8539-8574 | The orb to Zavistic | Bell; greeting, "You hand the magical scrying orb..." (statement box), on the continue of "Well, well...": 130, the orb taken. |
| 8578-8650 | The sandpit | Bell; one greeting, "I've brought what you wanted...", "Ahh excellent... Watch and learn...". On its continue: cutscene status, hidden ops, minimap off, side tabs closed, fade out. 3 ticks: a copy of the map (rebuild_region) at 2536,3109, jingle 114 ("handsand cutscene"). 5: Bert (5382) at 2546,3099 facing south, the camera at 2536,3109 height 850 looking at 2544,3102 height 25 (rate 100/100). 9: fade in. 12: "The Wizard chants..." (statement box). From the tick after its continue Bert walks one step a tick, north-west, west, west, north-west, to 2542,3101 (t8610-8613), and faces the pit (2542,3102) a tick later. 7 ticks after its continue: `handsand_sand_magic` (3037) on the pit at 2542,3103, `handsand_sandswirl` (1591), Bert `prisoner_ready_crying` (2702); "My sand! My lovely sand!" over him a tick later; the second box 2 ticks after the swirl. 8 ticks after its continue: fade out; 10: back at 2598,3086, Zavistic at 2597,3086 facing south-west, fade in; 13: the cutscene's varbits back, 140, the five earth runes and the bucket of sand spent, the tabs back, Zavistic's two lines. |
| 8785-8828 | Mazion | On the continue of "You're very strange...": 150, the wizard's head (6957), its item box. |
| 9004-9037 | The head to Zavistic | Bell; greeting, "You show the wizard the head." (item box), his two lines. On the last continue: 1535 2, `handsand_coffee_multi` (1536) 0→1, 160, the completion message, the head taken, jingle 152 ("quest complete 1"), the scroll (model 6945) with "1 Quest Point", "9,000 Crafting XP", "1,000 Thieving XP", "Wizards' Guild Rune", "Store Access", "A secret reward from Bert". |

## Recorded differences (the Wiki's words kept)

The Wiki transcript states these lines; live words them differently.

| Wiki (played) | Live |
| --- | --- |
| Talk to Betty about her shop. | Talk to Betty about other matters. |
| Now you just need to add the white berries to make the pink dye. | ... add white berries ... |
| You have successfully made the rose tinted lens! | You use your dye to make a rose-tinted lens. |
| As you focus the light on the vial and betty pours the potion in, ... betty hand you the vial of Truth Serum. | ... Betty pours ... Betty hands you ... |
| You hand the sand and watch Betty sprinkle it in the serum, it fizzes. | You hand the sand over and watch ... |
| You rummage around in Sandy's pockets... | ...pockets..... |
| You pour the serum in Sandy's coffee, the a little while later watch him drink it. | You pour the serum into Sandy's coffee, then a little while later ... |
| Sandy has told you all he knows. The magical orb is full ... | ... The magical scrying orb is full ... |
| The Wizard chants and your attention to the sandpit where Bert is found. | The Wizard chants and your attention is taken to the sandpit where Bert found the hand. |

Smaller timing differences, left as the transcript orders them: Bert's scroll and 60 come after his "O'course..." line
(live: before it); the sand's 80 comes with its box (live: one line later); the orb hand-in's 130 comes with its box
(live: on the next line's continue).

## Ours (no source)

- A pickpocket on Sandy succeeds half the time; so does a tall tale. The Wiki says only that the pickpocket "may take
  multiple attempts" and that no distraction is guaranteed; the capture saw two misses in four pickpockets.
- Zavistic leaves the bell 12 ticks after the chat closes (the capture: 12-16), or when the player is 15 tiles away.
- Each ringer gets their own Zavistic at the bell, seen and spoken to by them alone (the capture has one player; whether
  others see him is not recorded).
- Bert's refusal when 17 Thieving or 49 Crafting is missing, on "Yes.": "You do not meet all of the requirements to start
  The Hand in the Sand quest." The capture met the requirements.
- A logout during the sandpit cutscene leaves the player beside the bell at 130, with the runes and bucket; ringing again
  plays it again.
- With Zogre Flesh Eaters complete, the bell's Zavistic greets the player as he knows them and asks his menu, as the Wiki
  has it; uncaptured.

## Not implemented

- Bert's post-quest daily 84 buckets of sand to the bank and the Wizards' Guild rune store unlock.
- Whether the shop door must be open for the lens (Wiki: "stand in the doorway while the door is open"). Ours: the use
  always walks to the doorway tile (3016,3259) and runs there; the capture has no closed-door attempt. Any item used on
  the counter at the lens step takes the same walk, since the route doesn't name the item.
- Chathead expressions (the dump has none), the quest-rating interface (983) and the `last_quest_id` varbits.

## Runs

No in-game run recorded here yet. Tracked in issue [#728](https://github.com/RSPSApp/tsps/issues/728) (q054); PRs:
[#1129](https://github.com/RSPSApp/tsps/pull/1129).
