---
quest: Fairytale II - Cure a Queen
key: fairytale_ii_cure_a_queen
status: passed-with-issues
tested: 2026-11-16
tester: agent
model: claude-opus-5-5
commit:
cache: osrs-242_2026-11-03
start: checkpoint
travel: manual
---

# Fairytale II - Cure a Queen

Aligned with the user's whole-quest rsprox capture `FairyTale2` (revision 242.1, one account, from
Martin's ready offer to the reward, SHA-256
`bae003a3b96bad06b9ef93410871387ff9b16619a21ab7772ed7d6ab547c5d13`). Ticks are FairyTale2's. The
plugin is `server/plugins/quests/quests/FairytaleIICureAQueen.Quest.js` with its journal and scenes
in `server/plugins/quests/fairytaleii/`; the words come from the Wiki transcript as
`osrsreboxed-db`'s capture sources correct it (entry "Fairytale II - Cure a Queen"). The capture
starts at stage 10 (Martin's wait already over), so the first talk and the wait are the Wiki's.

## Stages (varbit 2326, varp 810)

| Stage | When (tick) |
| --- | --- |
| 5 | Martin's first "Ask about the quest." (Wiki; not captured) |
| 10 | the same option once his crops have had time (Wiki's 5 minutes; Ours 5.5) |
| 20 | the start menu's Yes, with 1807 → 2, 2332 → 1, 2327 → 1 and "You've started a new quest" (77) |
| 30 | the grotto's camera sweep ends, with 2339 → 1 (306) |
| 40 | as the Godfather's "Eet does? Oh, sorry, must-a geeven yous da wrong-a scroll." shows, with 2328 → 1 and 2329 → 2 (511) |
| 45 | "You see a fairy approaching ..." in Fairy Nuff's welcome: the 2970 multinpc shows Fairy Very Wise (976) |
| 50 | as the player's "That's easy I'll just pickpocket them off of him" shows, with 1808 → 2 (1002) |
| 60 | the successful pickpocket (1603) |
| 65 | the secateurs box closes; 1808 → 1 (1882) |
| 70 | the player continues past Nuff's recipe's last line (1915) |
| 72 | the star flower into the vial of water (2391) |
| 73 | the gorak claw powder into it (2398) |
| 75 | a dose poured on the sleeping Queen (2415) |
| 80 | four ticks later: the 2971 multinpc stands her up at 2354,4455 (2419) |
| 90 | the Queen's lamp box, with 2335 → 1 (2532) |

Other varbits: 2336 on Study (365), 2338 = 4 with the sign read, 2329 = 1 with "No, I'll rescue her
myself." (473), 2331 on arriving on the Gorak plane (2094), 2382 on a Gorak kill (2206). 2330 (the
cosmic plane) did not change on arriving there (1962) or on picking a star flower (2076).

## What the capture shows

- **Martin** (30-89): the refusal ("I've done enough for you, sort it out yourself!") keeps 10 and
  the offer comes back; the prompt is "Start the Fairytale II - Cure a Queen quest?".
- **The grotto** (283-313): the player steps in at 2387,4471 and is held (a click at 288 does not
  move them). Four ticks later the camera moves to 2386,4471 at height 300 (rates 4/10), then looks
  at 2387,4474 (25), 2384,4474 (75), 2384,4472 (150), 2384,4471 (200), 2384,4470 (200), 2385,4470
  (200), 2388,4470 (200) and 2389,4471 (75), every two ticks from 289 to 303. At 306 it resets, 2339
  and stage 30 are set, and the player says "Wow! Somebody has trashed this cave! And what's
  happened to Fairy Nuff and the Fairy Queen?" (chatscared2, 597).
- **The certificate** (317-346): Take on the broken frame (loc 16315) gives it with the box "You pick
  up Fairy Nuff's certificate, being careful not to cut yourself on its broken frame." (its picture
  the certificate); every shelf searched then shows "You don't find anything useful, just some glass
  from a broken vial." with broken glass (1469). Read opens 423, Study opens 424 with "You turn the
  certificate over and look at the back...", the sign opens 425 (script 2524 first, as rsprox 424).
- **The Godfather** (420-524): his menu is "Where is the Fairy Queen?|Where have all the fairies
  gone?|Show the Godfather the Certificate!"; the third shows the certificate box and his "learning
  to draw" answer. After "That's not very helpful." the other question plays without the menu
  (455-457). After a refusal, "Oh, okay then." leads to the contract scroll (427, script 2524 [-1,
  -1]) a tick after his line (494); the talk waits until the player closes it (506), then the
  player's "I'm not signing this!" (507) and permission with his reply (511).
- **The co-ordinator** (619-639): "What do you want to ask about?" with "Fairy Nuff's certificate."
  (the box "You show the certificate to the co-ordinator.", then "maybe somebody else") and "The
  fairy rings.".
- **The ring sequence** (778-849): AIR, DLR, DJQ (no trip; "Wow, fairy magic sure is useful, I
  hardly moved at all!") and AJS to the hideout ring at 2328,4426, still at stage 40.
- **The hideout fairies**: at 40 they say one of "How could everything have gone so wrong, so
  quickly?", "What is that evil fairy doing to our beautiful kingdom?", "The Queen is the true ruler
  of Zanaris, not that wicked Godfather!", "I hope that the Queen wakes up soon, I want to go back
  home." and "The Godfather's henchmen tried to pull off my wings!" (877-941); at 50 the Wiki's lines
  (1016, 1020).
- **The pickpocket**: each attempt says "You attempt to pickpocket the Fairy Godfather." with the
  pickpocket animation (881) and synth 2581. A failure: "Rocco, teach-a thees thief a lesson!" over
  the Godfather three ticks on, Fat Rocco steps over, "You're beaten unconscious." with the player's
  block animation (415), synth 1842 and a fade out (overlay 174, script 948 [0, 255, 0, 0, 50]) at
  +5, a move outside Zanaris at +11 and "You slowly wake up in an unknown place." with the fade back
  ([0, 0, 0, 255, 50]) at +16 (1216-1234, 1363-1384, 1486-1504). Success: 60, the secateurs, the
  box "You pick-pocket the Fairy Godfather and get the Queen's enchanted secateurs!", 47 Thieving
  XP and the "pickpocket fairy godfather" jingle (204), all on one tick (1603).
- **Fairy Nuff with the secateurs** (1875-1915): the box "You hand fairy Nuff the Queen's enchanted
  secateurs." (their picture); as it closes she casts (seq 4328, spotanim 568 at height 40, synth
  1097) and takes them, and the recipe follows.
- **Nuff at 70** (2364-2370): the recipe again, then "Thanks for the lecture, I've seen a Gorak, but
  where do I get one of these Star Flowers from?" and the short star flower answer, with the Gorak
  plane visited and not the cosmic one. Items used on her: "Nothing interesting happens." (2381).
- **The star flowers** (1966-2098): the first shoot (NPC 1856, seq 4312, area synth 2874 delay 255)
  sprouts 46 ticks after arriving and blooms into 1857 58 ticks later; more sprout every few ticks.
  Pick plays the pick-up animation (832) and synth 2581, the bloom withers (seq 4313, area synth
  2873) and goes six ticks later; no message.
- **The Goraks** (2125-2222): a kill drops the claws for the killer only ("Untradeable drop: Gorak
  claws") with big bones and coins, and sets 2382.
- **Brewing** (2390-2398): "You put the star flower into the vial of water.", "You grind the Gorak's
  claw into dust." and "You mix the gorak claws into your potion." (spam messages; animations 363,
  364, 363, each with synth 2608); Magic essence(3) and 130 Herblore XP.
- **The Queen** (2415-2539): the dose on loc 16316 plays the player's kneel-and-pour (4316), the
  loc's waking (4317) and the "fairyqueen awakens" jingle (205); 80 follows four ticks later. Fairy
  Very Wise then thanks the player (2426); Nuff's Talk-to plays the awakening, the Queen speaking
  first, with the Queen's (1161), Nuff's (1841) and Very Wise's (1847) heads. The lamp box "The Fairy
  Queen gives you an XP lamp." (6543) comes with 90 and the XP; after it, the quest complete message
  and the scroll, whose model is a four-dose magic essence (9021).
- **The journal**: as captured at 215, 313, 531, 1236, 1654, 1921, 2105 and 2374; an ingredient is
  struck through once held.

## Recorded differences and Ours

- Only the second of the three recorded failures also says "You fail to pick the Fairy Godfather's
  pocket." (1364); the plugin always sends it with a failed roll. The capture does not show what
  makes the difference (the Wiki's tip about the henchmen watching suggests being seen).
- The wake-up tile is one of the three recorded ones at random (3186,3211; 3139,3260; 3139,3228); the
  Wiki only says outside Zanaris.
- The first star flower: the Wiki says they "start to bloom within a minute of arriving", so the
  first shoot sprouts at 42 ticks and blooms at 100; the capture's sprouted at 46 and bloomed at 104.
  Ours: a new shoot every four ticks within six tiles, at most eight, and a bloom nobody picks
  withers 100 ticks after blooming.
- The post-quest Godfather said "I have-a my eye on-a yous, [name]. I donn-a know what-a yous is up
  to, but if-a I find-a out that yous is causing trouble, yous hadda just better watch-a your back!"
  both times (2623, 2632); the Wiki's "After Fairytale II" is kept.
- The XP comes at the quest complete action, three ticks after the lamp box where live gives it.
- Ours: a pour cut short (logout, death) still wakes the Queen, and a saved 75 logs in at 80 (the
  dose is spent and 75 lasts four ticks live); a saved 80 without the pour's mark is an older save's
  completion and logs in at 90. Walking off while the contract scroll is open ends the talk (live
  only closes it in place, 506-507).
- Ours: what sets 2330; the plugin sets it on the Cosmic Being's star flower answer. Nuff's recap
  with neither plane visited (the full "where can I find a Gorak?" answer) and with only the cosmic
  one (the same).
- Ours: the pickpocket chance, the Thieving/Herblore/Farming level messages, the full-bag
  certificate message, the early-brew refusal, and the Wiki's "Yes, okay." route granting
  permission with the Godfather's reply.
- Gorak (1834) has no generated drop table, so the bones and coins are not dropped; only the quest's
  claws are.

## Verification

`server/tests/fairytale-ii-capture.test.cjs` plays each step above with a real Player, the real
plugins, cache and map; `server/tests/qh728-q037.test.cjs` checks the Quest Helper stage route.

## Earlier notes

RSProx recording [424](https://rsprox.net/download/424), revision 232, records certificate Read
opening native group 423 (tick 16448), Study opening 424 (16453), and the Rune temple sign opening
425 (18355). Script 2524 precedes each mount: Read/sign use `[-1, -1]`; Study uses `[4269835, 100]`.
NPCs cannot attack a player standing on a fairy ring destination tile, as the Wiki describes.
