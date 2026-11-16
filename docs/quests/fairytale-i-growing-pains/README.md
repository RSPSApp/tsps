---
quest: Fairytale I - Growing Pains
key: fairytale_i_growing_pains
status: passed-with-issues
tested: 2026-11-16
tester: agent
model: claude-opus-5-5
commit:
cache: osrs-242_2026-11-03
start: checkpoint
travel: manual
---

# Fairytale I - Growing Pains

Aligned with the user's whole-quest rsprox capture `FairyTale1` (revision 242.1, one account,
start to finish, SHA-256 `a9d52c2ca369a298f03d241d649dfa57f3e375235ee80a7d91a3479db26b1735`) and
their earlier revision 241 run (rsprox index recording 1001455). Ticks are FairyTale1's unless a
recording is named; rsprox.net recording 424 (revision 232) shows the grove after the quest. The
plugin is `server/plugins/quests/quests/FairytaleIGrowingPains.Quest.js` with its journal and scenes
in `server/plugins/quests/fairytalei/`; the words come from the Wiki transcripts as
`osrsreboxed-db`'s capture sources correct them (entries "Fairytale I - Growing Pains", "Fairy Nuff",
"Martin the Master Gardener" and "Fairytale II - Cure a Queen").

## Stages (varbit 1803, varp 671)

| Stage | When (tick) |
| --- | --- |
| 10 | as Martin's "If I were you I would start by speaking to some of the other gardeners." shows, with "You've started a new quest" (171) |
| 20 | as Martin's "Hello again, [name]. How are you getting on..." shows, after five gardeners (1065) |
| 30 | the player's "?" after the Godfather's advice continued, with "The Godfather is no longer paying attention to you." (1370) |
| 40 | Nuff's "Here, I've written down a list of her symptoms." continued, with the list (1525) |
| 50 | "So I guess I need to go and kill this Tanglefoot..." continued; the list goes (1748) |
| 60 | "Yes, I have it right here." (or, holding the skull at the first ask, "Excellent, hand it over then.", 1001455 tick 1940) continued; the skull goes and the items are rolled (2404) |
| 70 | six ticks into the blessing; the magic pair takes the secateurs' slot (3271) |
| 80 | the Queen's secateurs taken (3997), by hand or Telekinetic Grab, not the kill |
| 90 | the Godfather's "Grazie infinite!" continued (4181) |

Siblings in varp 671: 1804-1806 are the three nature items as 0-based rows of the Wiki's ordered list
(17-19 = a raw cave eel, edible seaweed, an oyster, 2404; 10-12 = a potato cactus, crushed gem,
snapdragon, 1001455 tick 1940), cleared to 0 at 90; 1807/1808 (Queen in Nuff's room, the Godfather
and henchmen) are 0 through stage 10 and 1 from reaching Zanaris at 20 (1255); 1809 is Nuff's first
meeting, set after her "What do you do around here?" talk (1602).

## Capture facts

- **Gardeners (stage 10):** numbered by the order asked: rain, insects, adventurers, seasons, then the
  fairies (Dreven, 782-795). A gardener asked again shows the same five-option menu and answers
  "I've already told you everything I suspect." (277-281); any after the five: "I don't think the crops
  ARE failing..." (856, 957). Journal for 0-5 answers: 1001455 ticks 637-1178, 811.
- **Martin:** the quest menu (skillcape / quest) first; his "have you noticed" menu before the start
  prompt (126-133); the returning conversation repeats at 20 (1084).
- **Godfather:** Slim Louie answers for him from 30 (1374); after the quest a chat message
  "The Godfather is ignoring you." (4201).
- **Zandar:** his own page outside stage 40; "the hard way" moves the player to 3217,3176 with synth
  tele_other_cast (199), no animation, the next line a tick later (1771-1772).
- **Malignius:** his menu title is "What would you like to say?"; the necromancy submenu leaves out the
  question just asked (2031, 2038, 2052). The mushroom (1951-1966): human_casting and synth 229 on the
  continue; two ticks later spotanim 78 on the player's tile, loc mushroom_inactive (9572, shape 10,
  rotation 1) there, the player as desert_treasure_invisible_npc (716), synth 907, a held "MMMmmph!";
  twelve ticks later spotanim 78 again, the loc goes, synth 908, the chat closes. After the quest: his
  three-option menu with no greeting (4455), until Swan Song reaches him (its stage 110). The blessing and
  the mushroom keep their own time, so a click during either cannot leave the player blocked.
- **Blessing (3265-3271):** on the continue past "Then let us begin...": human_fairy_kneel_and_offer
  (3256), the spirit's human_fairy_take_and_hold_up (3257) and spotanim fairy_flower_enchant (568) at
  height 100, cam_moveto 6 east/4 south of the spirit and cam_lookat the spirit (height 375, rates
  100/100), synth ft_enchant_flower (1097), chat closed; six ticks later stage 70, items, cam_reset,
  "It is done!". Back again: "Why have you returned..." with a two-option menu (1001455 ticks 2520-2525).
- **Grove (3707-3716):** at 70 the Gate Keeper's line, the box "You squeeze past the thorny vines into
  a small tunnel.", then human_into_sidestep (752) with synth ft_squeeze_past (1107), and a tick later a
  private copy (rebuild_region of zones 2368-2407 x 4352-4407) at 2396,4379 with its own Tanglefoot and
  seven babies. Leaving: the box on reaching the gap, then on its continue the sidestep, the sound and
  2400,4379 (4039-4042). After the quest the line moves the player straight into the real grove
  (424 ticks 18514-18518).
- **Tanglefoot:** only magic secateurs deal damage; a melee swing with anything else sends "I can't
  deal any damage..." and lands a 0 (1001455 ticks 3033, 3037; a baby: 424 tick 18688); a Wind Blast
  lands a 0 with no message (1001455 tick 3064). Its drop is announced "Untradeable drop: Queen's
  secateurs" (3994).
- **Completion (4181):** the scroll shows the Queen's secateurs and "Some Magic Secateurs".
- **Dig (2216):** the player says "I can't believe I'm about to do this!" as the dig starts.

## Recorded differences and not covered

- **Ours:** Martin at stages 30-80 replays the stage-20 conversation (no source); Nuff at stage 20
  (before the Godfather) is her own page.
- **Ours:** the 25 nature-item names the captures do not show (the six they do are live's); the recipe
  sentence wraps at 435 pixels of the chat font, a width fitted to the two captured recipes.
- **Ours:** the Tanglefoot and babies' spawn tiles are where each first shows in the copy, wandering 3.
- Not covered: the gardener pages the dump leaves empty (Elstan, Frizzy Skernip, Heskel, Dreven,
  Vasquen) answer their quest=No options with nothing; Nuff's healing for gems is not implemented;
  "No reason, really." to the Nature Spirit has no captured answer; the Wiki's Tanglefoot damage
  formula (Farming and Strength) is still the normal melee roll.
- The quest-complete scroll opens a tick after the completion, as QuestRuntime does for every quest.

## Runs

### 2026-11-16 · agent · claude-opus-5-5

- **Start:** checkpoint at stage 70 (`::quest`), magic secateurs given, placed at 2400,4379.
- **Route:** the grove wall, the Gate Keeper, the box, into the copy; walked to the Tanglefoot and
  killed it with wielded magic secateurs (its hitpoints lowered with `set_npc_hitpoints`), took the
  Queen's secateurs, left through the gap. A second account logged out inside the copy.
- **Result:** one mesbox line, the sidestep, the copy (area "tanglefoot scene") with the Tanglefoot and
  babies; "Untradeable drop: Queen's secateurs"; 1803 = 80 on taking it; out at 2400,4379 with the
  cutscene varbits cleared; the logged-out account came back at 2400,4379. Every other conversation and
  scene is checked by `server/tests/fairytale-i-capture.test.cjs` against the capture.
- **Not checked:** the copy on screen (a vision client's login ends the copy); the Godfather hand-in in game.
