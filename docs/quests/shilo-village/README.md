---
quest: Shilo Village
key: shilo_village
status: in-progress
tested: 2026-11-16
tester: agent
model: claude-opus-5-5
commit: 79282990e
cache: osrs-242_2026-11-03
start: checkpoint
travel: manual
---

# Shilo Village

Aligned with the user's whole-quest capture (RSProx capture ShiloVillage, revision 242.1: the village before
the quest, the start at tick 1926, completion at 5257, Trufitus's two post-quest talks at 5788/5794). The
plugin is `server/plugins/quests/quests/ShiloVillage.Quest.js` with its units in
`server/plugins/quests/shilovillage/`; the words are the "Shilo Village", "Mosol Rei", "Trufitus" and "Yanni
Salika" transcript pages, corrected from the same capture in osrsreboxed-db's `capture-sources.json`.

## Stages (varp 116, zombiequeen)

| Value | Set by (capture tick) |
| --- | --- |
| 1 | the continue of Trufitus's "adventuring." line, which also takes the Wampum belt (t1926) |
| 2 | Trufitus's answer to "Erm, I don't know where to look?" (t1935); the mound's Look-at sets nothing |
| 3 | Search on the mound of earth (t2459) |
| 4 | the spade's Dig beside the mound (t2464) |
| 5 | the continue of the light's object box at the fissure (t2511) |
| 6 | the rope on the fissure (t2547) |
| 7 | down into Ah Za Rhoon (t2566) |
| 8 | out of Ah Za Rhoon by any way, a teleport included (t2885) |
| 9 | the "drop to your feet" box of the crawl into Bervirius' tomb (t3519) |
| 10 | the bone key on the carved doors, a tick after the first line (t4022; varbit 8180 zqdoor_multi 1 -> 2) |
| 11 | through the ancient gate wearing the Beads of the Dead (t4067) |
| 12 | the third bone in the tomb doors (t4592) |
| 14 | Rashiliyia's remains taken from the ground on the dolmen (t4850); 13 is never set |
| 15 | the last continue of Rashiliyia's lines on Bervirius' dolmen (t5257) |
| 16, 17 | Trufitus's first and second talks after the quest (t5788, t5794) |

Varbit 8180 drives the hidden tomb doors (multilocs 34657/34673): 0 jungle plants, 1 carved doors (after the
palm trees' Search, t3972), 2 hillside entrance. The palm trees themselves stay, as live's do.

## Facts the plugin relies on

- **Boxes.** Live shows about ninety of the quest's messages in a message box (229) or an object box (193)
  with the item; the rest are game messages. `Boxes.ShiloVillage.js` lists them as captured, keyed by text.
- **The cart** (multiloc 2216: 28930 "Look-at"/"Search" at 0-14, 28931 "Climb over" from 15). Search from the
  road: the box, one of Mosol's two warnings, the three-option menu, and the climb on the continue of the
  player's line (t678-689, t753-773). The climb is sequence 828 (delay 15) with sounds 4035, 4033 (13), 4034
  (19); a tick later the landing, with one line inbound and two lines outbound (t741-742, t5405-5409).
- **The metal gate** (2259/2260, west-edge walls at x 2875). From outside before the quest, the cold-gate menu:
  Yes is "The gates slowly begin to open...", a step to y 2953, then "Suddenly some Zombies grab you..." with the
  gate open and the player dragged to 2870,2953 (t708-713); No is two lines two ticks apart (t699-701). From
  inside, "The gates open very slowly." (t734). After the quest, a line each way (t5401, t5412). Open is inviswall
  38848 on both leaves with 1573/1574 on x 2874 and sound 71, shut again two ticks later.
- **The inner wooden gate** (2261/2262, east-edge walls at x 2867). "The gate won't open." before the quest
  (t719); after it, "You make your way into/out of Shilo Village." on the crossing tick, inviswall plus
  2263/2264 and sound 67 for two ticks (t5398-5421).
- **The mist** (map_anim 184 delay 3 height 124, area sound 2138): four pulses four ticks apart at one tile with
  "A green thick mist rises from the ground and starts choking you." (t726-738, t4160-4172). The Wiki (Undead
  one) gives the zombie variants' death gas, 2-3 damage within one square.
- **Mosol Rei.** "What danger is there around here?" closes the chat; he shouts overhead and in chat, and undead
  ones (5344/5342) rise at 2883,2952, 2880,2954 and 2880,2951 with a smokepuff (86, sound 1930) and a shout each
  (t830: three, t1100: one). After the quest, Follow and Talk-to's Yes are one box with a fade out, the player on
  2866,2952 two ticks later, and the box again with the fade in (t5392-5397, t5430-5433).
- **The dig** is the spade's Dig option: sequence 831 and sound 1470, the five lines two ticks apart, the fissure
  (2218) on the fifth (t2464-2472). The dug fissure is the mound again 49 ticks later (t2521); a re-dig plays 830
  then 846 with its box (t2539-2543).
- **Ah Za Rhoon.** Items come on the Yes branch at the object box; repeat searches have their own lines; the
  gallows' "You search the gallows..." comes three ticks before its box. The tattered scroll opens interface 220
  and the crumpled scroll 222 (messagescroll_handwriting) with the captured lines from line 3 (t2652, t2711).
  Burying Zadimus in the sacred ground: three game messages two ticks apart with 830 and 827, the box, smoke and
  the Spirit of Zadimus (5341) at 2796,3088, and the corpse becoming the bone shard in its slot (t3199-3227).
  Dropping the corpse is the same as burying it in the wrong place (t2763).
- **Cairn Isle's bridge.** The roll comes a tick after crossing x 2779 (all four captured rolls). A fall is "You
  fall!", sound 2493, a walk through the river to 2782,2971 with a splash (68) and sound 1658, then twelve ticks
  later two lines and three hits (t3394-3410).
- **Bervirius' tomb.** The crawl's teleport comes on the third box, with 827 on the second (t3513-3519, t5224-5227);
  the dolmen gives each item as its object box shows (t3600-3604); Bervirius' notes open interface 222
  (t3679); the locating crystal asks first and drains a prayer point (t3660-3666).
- **Rashiliyia's tomb.** The bone key: line one, then a tick later the stage, varbit 8180 and sound 2410. The
  ancient gate opens for two ticks with sound 69. The rocks are two moves each way with their lines (down
  t4086-4093, up t4891-4897). Each bone is sequence 832 with an object box and a per-player door leaf (2248-2250);
  after the third the doors open by themselves (2251/2252, sound 46) and walk the player in (t4591-4599). The
  tomb exit's Open is always locked; the bone key lets the player out (t4902-4911).
- **Nazastarool.** The dolmen's box with a camera shake and sound 1678; the zombie at 2890,9486 six ticks after
  its continue, "Who dares disturb Rashiliyia's rest?" then "I am Nazastarool! Prepare to die!" (t4605-4616). Each
  death box comes seven ticks after the death animation, and the next form a tick after its continue (skeleton
  2895,9485, ghost 2893,9484). No form drops the remains: after the ghost, the chat lines, then the two boxes,
  and an owned ground item 609 on 2893,9487 for 200 ticks (t4837-4842). Taking it sets 14 (t4850).
- **The ending.** The remains on Bervirius' dolmen: the object box, the mist at 2767,9367, Rashiliyia (5352) for
  her two lines, then "Without warning the spirit of Rashiliyia disappears.", the mist again and the completion
  (t5245-5257). The scroll lists "2 Quest Points", "Access to Shilo Village", "3,875 Crafting XP".
- **Yanni Salika.** He pays on the continue of his line with "You sell the <name> for <N> gold." (t5598-5646).

## Recorded differences (Wiki values kept)

- Cairn Isle's bridge fall: the Wiki's three hits of floor(HP / 11); the capture shows floor(HP / 10) (54 HP: 5,5,5
  at t3410; 39 HP: 3,3,3 at t3457).
- Crafting the beads, the necklace and the bone key: the Wiki's 20 Crafting.

## Not covered

- Ours: the courtyard mist's and the zombie gas's chances (the capture shows one of each; the Wiki says "a
  chance"); the number of Mosol's undead (1-3: the capture shows three and one); his undead going after 500 ticks;
  "Don't warn me again" being remembered; the crystal's brighter tiers and their distances.
- Not captured: the strange looking stone, the smashed table and raft, the waterfall rocks, the stone-plaque,
  dropping the crystal, pommel or beads, the loose rocks' falling ceiling.
- Yanni's fifth quote-menu option ("Is there anything else interesting to do around here?") lives on One Small
  Favour's page; the stage-9 Trufitus lines that differ from stage 8 are not split out.
- Live keeps a dead Nazastarool form standing until its box; ours removes it at the death.

## Runs

### 2026-11-16 · agent · claude-opus-5-5

- **Start:** checkpoint stages set with `::quest`, on the worktree's server (agent MCP over HTTP).
- **Route:** the cart's warning and climb before the quest, the cold gate's Yes and the drag into the courtyard
  (the mist rose there), Mosol's Follow after the quest, the spade's Dig at stage 3, and Trufitus's two
  post-quest talks.
- **Result:** each matched the capture's lines and tiles; the stage went 15 -> 16 -> 17 at Trufitus.
- **Not checked:** a fresh run start to finish with Quest Helper.
