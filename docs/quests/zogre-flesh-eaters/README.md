---
quest: Zogre Flesh Eaters
key: zogre_flesh_eaters
status: in-progress
tested: 2026-11-18
tester: agent
model: claude-opus-5-5
commit:
cache: osrs-242_2026-11-03
start: checkpoint
travel: manual
---

# Zogre Flesh Eaters

Aligned with a whole run of the quest on live: the user's RSProx capture `ZogreFleshEaters.bin`
(revision 242.1, SHA-256 `92cb2ee0...eea139c`; the start at tick 260, completion at 2815, then the
balm sale and a comp ogre bow). The plugin is `server/plugins/quests/quests/ZogreFleshEaters.Quest.js`
with its units in `server/plugins/quests/zogreflesheaters/` (Jiggig, Tomb, Boxes, Journal, State). The
words are the "Zogre Flesh Eaters" transcript page, with the lines the Wiki lacks added from the same
capture in osrsreboxed-db's `capture-sources.json`; where the capture words a line differently the
Wiki's wording is kept (see "Recorded differences").

## Stages (varbit 487, zogre)

| Value | Set by (capture tick) |
| --- | --- |
| 2 | "Yous creatures is alus says funny stuff..." continued, with "You've started a new quest" and the hand-out box (260) |
| 3 | the barricade guard's kick, a tick after it, with 496 (299) |
| 4 | the evidence hand-in box at Zavistic (1483) |
| 6 | the potion on the cup of tea (1537) |
| 8 | Sithik's "Unfortunately you can't. The spell is permanent..." (1590) |
| 10 | Grish's key box (2328), with 495 = 2 |
| 12 | Slash Bash's death, with his drop (2650) |
| 14 | "~ Grish seems very pleased about the return of the artefacts. ~"; the artefact and the key go (2812) |

## The thzfe varbits

| Varbit | Values (capture tick) |
| --- | --- |
| 488 thzfe_prismsearch | 1 the coffin's second box (547), 2 the knife (587), 3 the lid lifted (662), 4 both clues shown to Zavistic (885), 5 Sithik questioned (1064); loc 6843 reads it (0-2 closed 6844, 3-5 open 6845) |
| 489 / 490 | the tankard (942) and the portrait (1374) shown to the bartender |
| 491-494 | each piece of evidence shown to Zavistic (1472-1482) |
| 495 thzfe_sithik_transformed | 1 the tick after the player is down Sithik's ladder (1558), 2 with Grish's key (2328); loc 6887 reads it (human, ogre, human) |
| 496 thzfe_blocking_barricade | 1 with the guard's crush (299); the barricade multilocs 6878/6879 read it ("Ogre barricade", then "Crushed barricade" with Climb-over) |
| 499 / 500 | Sithik's brutal arrow answer (1600) / Grish's bow box (2246) |
| 502 thzfe_sold_balm | the balm sold to Uglug Nar (3196) |
| 503 thzfe_brentle_skele | 1 the zombie rises (443), 2 it dies (489) |
| 504 thzfe_prismsold | the prism sold to Zavistic (1760) |
| 505 thzfe_cut_scene | the north-west room's scene (417) |

498 (thzfe_makecuredisease) never changes in the capture, though Sithik is asked about the disease (1604)
and Grish is told of the cure (2263), so the plugin no longer sends it.

## Facts the plugin relies on

- **Requirements** (the Wiki): Big Chompy Bird Hunting, Jungle Potion, 4 Smithing and 8 Herblore
  (boostable) and 30 Ranged (not boostable). The plugin asked for 30 Fletching too, which the Wiki
  only needs for the comp ogre bow (issue 4410).
- **The barricade guard** (864): before the quest only his first line (101). At stage 2, after "Ok, I
  opens da stoppa's for yous creature." the chat closes, he kicks (seq 2102, sound 2565) 2 ticks
  later, the stage and 496 come a tick after that (sound 1954) and "Ok der' yous goes!" 2 ticks later
  (296-301). After it his "Hey yous tryin' not to get da sickies..." standard dialogue (304). The
  coffin guard (865) has his own menu (59-79).
- **Climb-over** hops 2 tiles across the barricade: exactmove 20/50 cycles, seq 1236 at 20, sound 1953
  (310-326). The crushed barricade is the player's view of the multiloc; nothing changes for others.
- **The tomb stairs**: "You climb down/up the steps.", the stair sound (1952/1956) and a fade on
  arrival, the player moved 3 ticks later, the fade back 4 after that (376-385, 2406-2409, 2696-2699,
  2746-2749). Landings: (2477,9437,2), (2485,3045,0), (2442,9418,0), (2446,9417,2).
- **The north-west room** (entered at 2447,9462): the chat line, then the message box with no continue
  for 17 ticks while the camera moves (8 cam_moveto/lookat pairs at +0, 3, 6, 8, 10, 12, 14, 16;
  height 400/25), the camera reset on Continue (417-439).
- **The skeleton**: smoke puff (spotanim 188) on (2442,9458) on arrival, the zombie (880) there a tick
  later with "Something screams into life right in front of you." and a hint arrow (442-443); it attacks
  at once. Its drop table leaves the backpack; afterwards "You find nothing on the corpse." (495).
- **The coffin** (6843): its search is two message boxes; the knife an item box with sound 2419; the lid:
  its box, then "Urrrgggg." and "Aarrrgghhh!" each a player chathead line with no continue plus the
  same overhead, 3 ticks apart, then the failure box 3 ticks later (Strength drained 1-3 each time,
  599-647) or "Raarrrggggg! Yes!" (488 = 3, sound 54) and "You eventually manage to lift the lid." 2
  ticks later (591-664). The other Ogre coffins' Open: "The lid to the coffin feels very solid..." (349).
- **Message boxes**: which transcript messages show as message or item boxes is in
  `Boxes.ZogreFleshEaters.js`, step by step from the capture (hand-outs, "You show ..." lines, Sithik's
  room, Grish's bow and key; the key's line also goes to chat, 2330).
- **The tea**: human_pickuptable 832 and drip_poison 1955 as the potion goes in (1537). Sithik turns as
  the player goes down his ladder (the Wiki: "Go down the ladder and back up").
- **The prism sale** (stage 6 on): the box, Zavistic's offer, "Sell it to Zavistic for 2000" and the
  coins box (1750-1760).
- **The stone doors**: "You use the Ogre Tomb Key to unlock the door." going in, "You push the gates
  open." coming out; the player steps through as the leaves swap for an inviswall and the open leaves
  (6874/6873 a tile south) and back 2 ticks later (2391-2399, 2721-2727).
- **The stand**: "You search the plinth..." box; a tick after its Continue Slash Bash (882) on
  (2478,9445) with a smoke puff on (2477,9444), "Something stirs behind you!" and a hint arrow
  (2437-2439). His drop table leaves 2 zogre bones, 3 ourg bones and the artefact; the stage moves as he
  dies (2650). After that the plinth gives "You find nothing in particular." (2667).
- **Completion**: the scroll shows the artefact (4818) and "1 Quest Point, 2,000 Ranged XP, 2,000
  Fletching XP, 2,000 Herblore XP, Ability to make Relicym's Balm, Ability to make Brutal Arrows"
  (2815). The bones are Slash Bash's drop, not a quest reward (the plugin gave 2 more of each).
- **Sithik's chathead**: the ogre head (884, `zogre_sithik_ogre`) on every line while 495 is 1 (1567-1611), the
  man (883) before the tea and again once Grish has the key.
- **Slash Bash's attacks** (`SlashBash.ZogreFleshEaters.js`): the crush (`ogre_attack` 359, hit the same tick)
  only next to the player (2440, 2488, 2494); otherwise `ogre_breath` (2101) with the `flob` projectile (397:
  41 to 51 + 5 a tile from his centre, 163 -> 146, angle 15, progress 11) and area sound 1452 (range 10), the hit
  2 ticks later at every range (2446 -> 2448, 2500 -> 2502). He breathes next to the player too (2470-2482). The
  Wiki: safespotting east of the stand makes him use only ranged. How hits on him are scaled is in
  [docs/zogres.md](../../zogres.md).
- **What the quest teaches** (issue 6283): Relicym's balm (`herblore:unlocked` "relicyms_balm") once Sithik has
  told the cure, brutal arrows (`fletching:taught` "brutal_arrows") once he has explained them (499, 1600), the comp
  ogre bow ("comp_ogre_bow") once Grish has (500, 2246); each also after the quest. The Wiki: "Partial completion of
  Zogre Flesh Eaters" for the balm and the bow, and "Sithik Ints teaches you how to make them" for the arrows.
- **Knife on achey logs** (after the quest, 3253-3255 and 3492-3495): one log opens the menu "How many logs do you
  wish to fletch?" with "Ogre arrow shafts" and "Unstrung composite bow"; the bow without wolf bones is the message
  box "You need wolf bones and achey tree logs to make the composite ogre bow."; with them, `human_fletching` on the
  choice and "You carefully cut the wood into a composite ogre bow." with the bow 2 ticks later.
- **Uglug Nar**: before the cure is known he turns the balm down (765-771); after, he buys the dose used
  (650 coins for a 3-dose, 3196; the Wiki's 1,000/650/300/100 by dose).
- **The journal**: the two captured pages (777, 1158) are `tests/fixtures/zogre-flesh-eaters-journal.json`.

## Recorded differences (the Wiki is kept)

- "Okay, I'll check things out then and report back." (capture 256) for the Wiki's "Ok, ...".
- The start: live asks "Start the Zogre Flesh Eaters quest?" (Yes./No.) after Grish's "Yea creatures..."
  and has no "Is yous creatures really, really sure..." exchange (254-257); the plugin keeps the Wiki's two menus.
- "it looks like there's been an explosion!" (417) for the Wiki's "it looks there's been an explosion!".
- "You find a book on Philosophy written by the leader of the 'Humans Against Monsters' group, Johanhus
  Albrect." (1113) and "As you're looking through the book" (1130) for the Wiki's wording.

## Not covered

- Ours: the lid's chance (50%); the capture lifts it on the sixth try.
- Ours: the north-west room's bounds beyond the captured entry tile.
- Ours: Uglug Nar counts the cure as known from Sithik's answer (stage 8); the capture only shows stage 3
  (refused) and after the quest (bought).
- The Yanni branch of the prism sale was not chosen in the capture: it ends.
- After "What are Zogres?" live offers "Can I help in any way?" (123); the dialogue runtime's "previous"
  returns to the first menu, so the offer only follows "What do you mean sickies?".
- The pages of the journal before the barricade and from the evidence hand-in on (not captured).
- The ogre coffins' Pick-lock; the smoke puffs as the zombie and Slash Bash die (491, 2650).
- Ours: Slash Bash's even chance between crush and breath while next to the player.
- Slash Bash's crush and hit sounds (synth 914 and 917 in the capture): NPC combat sounds come from the
  rsprox.net-mined `npc-combat-sounds.json`, which has no entry for him.
- Making the balm is not captured (the capture buys it): its lines, "You put the Rogue's Purse into the vial of
  water.", "You mix the snake weed into your potion." and "You mix the rogue's purse into your potion.", are ours,
  in the shape of the other Herblore lines. The rogue's purse potion's refusal before the cure is the Wiki's.

## Runs

### 2026-11-18 · agent · claude-opus-5-5

- **Source:** the capture above; targeted tests `tests/zogre-flesh-eaters-capture.test.cjs` and
  `tests/qh728-q128.test.cjs`.
- **PRs:** issue [#4410](https://github.com/RSPSApp/tsps/issues/4410).

### 2026-11-20 · agent · claude-opus-5-5

- **Source:** the same capture (ticks 1567-1611, 2440-2642, 3253-3255, 3492-3495) and the Wiki pages Relicym's
  balm, Comp ogre bow, Brutal arrows, Zogre, Skogre and Slash Bash.
- **Tests:** `tests/zogre-flesh-eaters-capture.test.cjs`, `tests/fletching.test.cjs`, `tests/herblore.test.cjs`.
- **PRs:** issue [#6283](https://github.com/RSPSApp/tsps/issues/6283).

### date not recorded · agent · model not recorded

- **Source:** issue [#728](https://github.com/RSPSApp/tsps/issues/728) active (q128); moved here from its ledger on 2026-10-29.
- **Result:** stage 3, on the Dragon Inn bartender's reach (NPC 1320); not rechecked here.
- **PRs:** [#1191](https://github.com/RSPSApp/tsps/pull/1191).
