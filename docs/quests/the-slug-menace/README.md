---
quest: The Slug Menace
key: the_slug_menace
status: capture-aligned
tested: in-game over the agent MCP (see the PR)
tester:
model:
commit:
cache: osrs-242_2026-11-03
start: Sir Tiffy Cashien, Falador Park
travel:
---

# The Slug Menace

Aligned with the user's whole-quest capture `TheSlugMenace.bin` (RSProx, revision 242.1, a male
account; transcribed with a fresh RSProx clone). Ticks below are that recording's. The words are
the "The Slug Menace", "Witchaven villager" and "Sir Tiffy Cashien" records in
`npc-dialogues.json`, corrected from the same capture in osrsreboxed-db
([#95](https://github.com/RSPSApp/osrsreboxed-db/pull/95)).

Code: `server/plugins/quests/quests/SlugMenace.Quest.js` (stages, conversations, items, objects),
`server/plugins/quests/slugmenace/Scenes.SlugMenace.js` (the three cutscenes and the fight),
`Puzzle.SlugMenace.js` (the torn page), `Journal.SlugMenace.js` (the journal). The Witchaven
Dungeon shortcut is a data entry in `server/plugins/skills/data/agility-shortcuts.json`.

## Stages (slug2_main, varbit 2610)

| Value | Set when (tick) |
| --- | --- |
| 1 | Sir Tiffy's "Now, is there anything else I can do for you?" shows; the Commorb becomes the Commorb v2 in the same tick (238) |
| 2 | O'Niall's "Who are the important people" ends ("Will do Col. O'Niall...", 997) |
| 3 | the report to O'Niall, as "Anything else I can do for you?" is continued (1506) |
| 4 | Savant's door-scan conversation ends (1860) |
| 5 | Jorral's goodbye (2152) |
| 6 | Savant calls back, with slug2_savant_gotinfo (2157) |
| 7 | O'Niall hears about the Mother Mallum (2315) |
| 8 | the church cutscene opens (2505) |
| 9 | Maledict's "It is imperative that you find them." (2553) |
| 10 | Savant's swamp-paste warning ends (2986) |
| 11 | Bailey's "Right, I'll get cooking.", with the glue in the slug's slot (3086) |
| 12 | Savant speaks in Falador after the teleport (4879) |
| 14 | the hand-in, with varp 875 back to 0 (4991) |

Sub-varbits: slug2_oniall_control 1 as O'Niall's menu first shows (900); slug2_npc_track3/2/1 with
alltrack 4/6/7 as Maledict's and Hobb's menus show and Holgart's talk ends (1089, 1231, 1433);
slug2_scan_mayor 1 after Savant's request, 2 with the scan's answer (1334, 1345); slug2_doorbit
with the wall's box (1725); slug2_haveslug at the pickup (1824); slug2_savant_scan after Savant's
slug call (1844); slug2_doorscan with the door scan (1847); slug2_tornpages with the fragments
(2912); slug2_fixed_page and varp 875 with the mended page (3293); slug2_used_runes earth 1, air
2, fire 4, water 8, mind 16 (4566-4589); slug2_queen_door as the door scene opens (4592).

## Witchaven

- Sir Tiffy after the start: greeting, then "Slug Menace. | Something else." (257); "Something
  else." is his standard menu (271).
- O'Niall sits still on 2740,3310 (every capture tick); his spawn has wanderRadius 0.
- Talk-to on Mayor Hobb once his questions are done, before the report: Savant breaks in and asks
  for a scan (1318). Scan near the Mayor: seq 4839, spotanim 799, sound 1900; the reading two ticks
  later (1343-1345).
- Scan anywhere else: seq 2721, spotanim 454, sound 1900, and "You have nothing to scan for..." two
  ticks later (1367-1369).
- Contact: stage 2 "So, Savant, what do you think?" (1383); stage 6 the Mother Mallum reminder
  (2173); stage 7 "Hello... What can I do for you?" (2341).
- Holgart mid-quest: his talk sets track 1 (1413-1433); after it, Talk-to and Travel both give
  "I don't know what to do without my boat." (1438, 1441).
- Jeb: "Hello there." until Holgart has talked (351); the boat to the platform and back are Sea
  Slug's rowing legs (fade, seaslug_boat_travel 461, 3022-3037 and 3162-3175).
- The shop doors (slug2_village_poordoor 18168) open into 11617 on the next tile (487, 716, 723).
- The villagers: a "_stage1" transform has a random normal line, a "_stage2" (possessed) one the
  vacant-stare box and a random possessed line (469-854, 5251-5363).

## The shrine and the cave

- The ruin lands at 2696,9684 (1640); its exit at 2697,3283 (4502).
- The false wall: Push hands over (seq 4834, delay 30), two ticks later slug2_doorbit and the box
  "The wall creaks open..."; its continue squeezes through (seq 752, sound 1107) to 2324,5104 the next
  tick (1715-1728). Once open, Enter squeezes through (1747-1750).
- The passage back (18412): the squeeze, then 2700,9689 two ticks later (1736-1741) - west of the
  wall, not its own tile.
- The shortcut (18416): exact move 2330 -> 2333,5096 (delays 30/96, seq 749 delay 30), sound 2489
  three ticks on (1768-1772, 4530-4534). 30 Agility and no XP (Wiki).
- The dead sea slug lies at 2352,5096 (1823). Savant asks for a door scan as the player walks up
  (1826) and calls about the slug after the pickup (1831-1844).
- The door: "A flash of light springs from the door, burning your hand." with sound 3029, 5 damage
  the next tick (1862-1864).

## The pages

- Jorral takes the transcript at "Hmm. Interesting, very interesting." (2137).
- Walking by the church at stage 7 (2502, at 2718,3287): the fade, a copy of Witchaven, Hobb
  (4785) leaving the church with an overhead line and jingle 228, back after 21 ticks.
- The desk: locked (seq 899, sound 2402) before; the page with seq 4834 and sound 64, the item three
  ticks later (2586-2590); "The desk is empty." after (2606).
- Ezekial hands page 2 after "Sure, here you go." (2705). O'Niall's fragments with "Don't mention
  it." (2912).
- Bailey: the glue in the slug's slot with "Right, I'll get cooking.", his seq 899, the next line two
  ticks later (3086-3090).
- The torn page: see `Puzzle.SlugMenace.js` (3188-3316).

## The runes and the door

- Shaping: "You manage to shape the rune essence into the desired shape." and +2 Crafting, the blank
  in the essence's slot (3562).
- Empowering: seq 791, spotanim 186, sound 2710, +2 Runecraft, the rune and its message the next
  tick (3790-3791); a failure is "You attempt to empower the rune but fail, destroying the essence."
  with the blank gone (3779).
- Each rune on the door: seq 4834, sound 3032 (4566-4589). The fifth opens the door scene; the
  scenes' timings are listed in `Scenes.SlugMenace.js`.
- The Prince (4797, level 62) only takes melee damage and drains Prayer by the damage it deals
  (Wiki; 4724, 4740).
- The scroll: model item 9700, "Promotion to Proselyte", jingle 154 (4991).

## Not covered

- Ours: the church trigger box (the capture has one entry tile), the puzzle's tolerance (between 5
  and 10), re-entering the fight, and the shortcut's way back and its failure.
- Savant's post-quest "current assignment" Contact, Jorral's "Thanks for the help again" and
  Ezekial's later greeting come from pages this change does not touch.
