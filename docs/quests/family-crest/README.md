---
quest: Family Crest
key: family_crest
status: in-progress
tested: 2026-11-26
tester: agent
model: claude-opus-5-5
commit:
cache: osrs-242_2026-11-03
start: fresh
travel: travel_to
---

# Family Crest

Aligned with two whole runs of the quest on live, revision 242: the user's RSProx capture
`FamilyCrest + FamilyPest.bin` (local recording 1002252, SHA-256 `c03a509b...e8f75`; the start at tick
189, Caleb 319-399, the Gem trader 567-581, Avan 611-642, Boot 793-823, the Witchaven Dungeon 1208-1397,
the jewellery 1638-1654, Johnathon 2017-2055, Chronozon 2438-2910, the hand-in 3019-3036, then the
post-quest talks and Family Pest) and local recording 1002185 (SHA-256 `0e60f24f...d727f`, 2026-11-12;
cited as B below). Ticks below are 1002252's unless marked B.

The plugin is `server/plugins/quests/quests/FamilyCrest.Quest.js`, with the Witchaven levers in
`WitchavenPuzzle.FamilyCrest.js` and the doors' crossing in `server/plugins/objects/Doors.plugin.js`
(`PASS_THROUGH_GATES`). The words are the generated "Family Crest" transcript and the Dimintheis, Caleb,
Avan, Johnathon, Boot and Gem trader NPC transcripts; where live words a line differently,
osrsreboxed-db's `capture-sources.json` lays the capture's wording over the Wiki. Checked by
`server/tests/family-crest-capture.test.cjs` (real Player, packets, plugins, cache and map),
`family-crest-perfect-gold.test.cjs` and the Family Crest cases in `quest-plugins.test.cjs`.

## Stage (varp 148 `crestquest`)

Every change comes as the player continues the line or box before the one it goes with.

| Value | Set by (capture tick) |
| --- | --- |
| 1 | "Yes." on "Start the Family Crest quest?" (189), with "You've started a new quest: Family Crest". The skills are not needed to start (Wiki Requirements): below them the transcript's warning box comes before the prompt |
| 2 | "Ok, I will get those." on the pick (B 7757); "Why don't you just give me the crest?" as its echo is continued (364 -> 365) |
| 3 | continuing "You exchange the fish for Caleb's piece of the crest." (374): the five fish go, `caleb_crest` (780) comes |
| 4 | continuing Caleb's "...I did hear from my brother Avan a while ago though." (392, B 7849) |
| 5 | continuing the Gem trader's "Maybe we'll all get lucky and the scorpions will deal with him." (B 7980) |
| 6 | continuing Avan's "Unfortunately he has apparently returned to his home..." (637, B 8150) |
| 7 | continuing the player's "Hello. I'm in search of very high quality gold." (812, B 8253) |
| 8 | continuing the ring-and-necklace box (1648): the jewellery goes, `avan_crest` (779) comes |
| 9 | continuing "I am here to retrieve your fragment of the Fitzharmon family crest." (2021) |
| 10 | any antipoison used on Johnathon (2032): the potion goes whatever its doses, synth 2401 |
| 11 | continuing Dimintheis's "They can also be granted extra powers..." (3033): 1 quest point, 2,000 Mining, Smithing and Crafting XP, steel gauntlets, the jingle and the scroll ("Some Steel Gauntlets", "Gauntlet Skill Imbues") |

The family crest leaves as its box is continued (3027), before the last five lines.

## Facts the plugin relies on

- **Chatheads.** Dimintheis 4984, Boot 4985, the Gem trader 2874. The sons stand in the world as nameless
  multi-NPCs, Avan 4983 (shown as 385 "Man", then 386/387 "Avan"), Caleb 4986 (4317/5433) and Johnathon
  4988 (5443/5445); every line of theirs has the multi-NPC as its head and the shown form's name ("Man"
  until Avan's quest talk ends).
- **Boxes.** The fish exchange, Johnathon's sweat, the murmur after the quest and Family Pest's smells are
  messageboxes (229); the jewellery is an objectbox_double (11) with the perfect ring and necklace; the crest
  hand-in, the imbues and Dimintheis's returned pair are objectboxes (193) with the item.
- **Caleb after his piece** (385-392): "Hello again. I'm just putting the finishing touches to my masterful
  salad." and a menu "Uh.. what happened to the rest of the crest?" / "Good luck with that then." From stage
  4 he asks where Avan is until you have found him (394).
- **Boot** keeps the quest's three-option menu at stages 6 and 7 (816: the gold answer again at 7); no recording talks
  to him later, so from 8 his own page plays. "Hello short
  person." ends the talk during the quest (797-798).
- **Johnathon's questions** (2037-2052): the first menu has no "I will be on my way now."; each later one
  leaves out the question just asked.
- **Chronozon** (2441-2474, 2864-2893): every Blast spell cast at him says "Chronozon weakens..." on the
  cast's own tick, repeats included; a Blast that splashes or hits 0 says nothing and doesn't count (Wiki: he
  has to be hit for actual damage; every recorded cast did damage). Short of all four, the hit that empties his health bar is followed by
  "Chronozon regenerates..." the next tick and full health (2477 -> 2478). The Wiki: he dies once each of
  the four Blast spells has hit him.
- **The Witchaven Dungeon** (1210-1356): "This door is locked." from a door the levers keep shut; a lever pull
  is `macro_lever_switch_up`/`_down`, synth 2400, the lever's other loc and "The lever is now up."/"down.".
  An open door swaps to `inviswall` on the doorway and its leaf one tile on, turned a quarter
  (`inactiveposhdoor`; `famcrest_doori2h1_open` for the gold room's door), plays door_open (62), lets the
  player walk over and is back two ticks later.
- **Perfect gold** (1518-1574, B 9304-9342): Smelt with only 'perfect' gold ore held offers just the Gold bar (as
  many as there is ore), or with one ore left smelts it at once (1531-1536, no menu); the ore used on the furnace
  smelts one at once. Each is "You smelt the gold in the furnace." and, with the bar four ticks later, an empty
  spam line. A 'perfect' gold bar (Smelt once no 'perfect' ore is left, or the bar used on the furnace) opens
  crafting_gold (446); its ruby necklace (446:26) and ruby ring (446:11) make the 'perfect' pieces, with no
  message. Every other product, the slayer ring included, comes out plain from it (Wiki, 'perfect' gold bar).
  **Ours:** with a plain and a 'perfect' gold bar carried, the bar used on the furnace decides; Smelt uses the
  plain one (no recording holds both).
- **Chat lines** break after a hyphen as well as at a space ("much in-<br>fighting", 168), so a page holds what
  live's holds (`ChatTextLayout`).

## Recorded differences and Ours

- Live drops Johnathon's piece the tick Chronozon starts dying (2897) and the vile ashes six ticks later
  (2903); here both come from the drop table at the drop.
- The lever and door clicks resolve on arrival; live answers one tick later (1215 -> 1217).
- **Ours:** Caleb's "Good luck with that then." (never picked on live) is the player saying it and the talk
  ending.
- **Ours:** holding goldsmith gauntlets, Dimintheis names them (3800); for cooking or chaos gauntlets no
  recording exists and he gives the Wiki's steel answer.
- **Ours:** "Dimintheis returns your gauntlets." gives back the pair last given or imbued (the
  `family-crest:gauntlets` attribute).

## Findings

- **open** An item used on Dimintheis (crest parts, 2161-2164) says nothing; live says "Nothing interesting
  happens.". Server-wide: an unhandled item on any NPC is silent.
- **fixed** 'perfect' gold smelting listed every bar and had its own messages; the 'perfect' jewellery was a chat
  menu with a message, not crafting_gold (found in the playthrough).

- **fixed** Caleb's and Avan's crest pieces were the wrong way round (Caleb gave 779 `avan_crest`). A save from
  then holds 779 as Caleb's piece; Avan's jewellery hand-in then gives 780, so the crest can still be made.
- **fixed** The message boxes were game messages; the stage moved when the lines were built, not shown.
- **fixed** No "You've started a new quest" message on the start.

## Runs

### 2026-11-26 · agent · claude-opus-5-5 (natural playthrough)

- **Start:** fresh account, declared setup (all skills 99, the fish, pickaxe, rubies, moulds, Blast runes, antipoison,
  coins, travel items; Plague City completed for Ardougne Teleport), one `::tele` to Dimintheis.
- **Route:** Catherby (Caleb), Al Kharid (Gem trader, Avan), the Falador trapdoor (Boot), the Witchaven Dungeon (the
  lever doors in the Wiki's order, the gold-room door, two 'perfect' ores), the Al Kharid furnace, the Jolly Boar
  (Johnathon), the Edgeville Dungeon (Chronozon with the four Blasts, `::infhp` declared), Dimintheis. Then Family Pest.
- **Result:** varp 148 0 -> 11 at the recorded moments; 1 quest point, 2,000 Mining, Smithing and Crafting XP and steel
  gauntlets, once; the scroll's lines as live; relog twice; post-quest talks as recorded. Differences found: the
  'perfect' gold furnace steps (fixed) and the silent item-on-NPC (open).
- **Not checked:** the sons' chatheads on screen (asserted in tests).

### 2026-11-26 · agent · claude-opus-5-5

- **Tests:** `family-crest-capture.test.cjs` plays every captured conversation through packets against the
  recordings' lines, heads, boxes, items and stage ticks; the hand-in through a save and reload.
- **Not checked:** see the PR for the natural playthrough.
