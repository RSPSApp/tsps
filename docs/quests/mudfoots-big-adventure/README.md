---
quest: Mudfoot's Big Adventure
key: mudfoots_big_adventure
status: untested
tested:
tester:
model:
commit:
cache: osrs-242_2026-11-03
start: Captain Harlan, outside the Lumbridge General Store
travel:
---

# Mudfoot's Big Adventure

Aligned with the user's whole-quest capture `MudfootsBigAdventure.bin` (RSProx, revision 242.1: the quest,
then Harlan's kits after it and the four lamps, in one session; transcribed with RSProx f3918ed8). Ticks
below are that recording's. The Wiki ([Mudfoot's Big Adventure](https://oldschool.runescape.wiki/w/Mudfoot%27s_Big_Adventure),
[Transcript:Mudfoot's Big Adventure](https://oldschool.runescape.wiki/w/Transcript:Mudfoot%27s_Big_Adventure),
[Transcript:Captain Harlan](https://oldschool.runescape.wiki/w/Transcript:Captain_Harlan),
[Outlaw (Mudfoot's Big Adventure)](https://oldschool.runescape.wiki/w/Outlaw_(Mudfoot%27s_Big_Adventure)))
covers what the capture does not, and wins where the two disagree (recorded differences below). No
rsprox.net index recording has this quest.

The whole quest was played in-game over the agent MCP (stage moves between the steps with `::tele`, so it is
not a recorded natural run and the status stays untested).

Code: `server/plugins/quests/quests/MudfootsBigAdventure.Quest.js` (registration, after-fight talks, reward,
lamps, saves) and `server/plugins/quests/mudfoot/`: `Common` (ids, stages, state, the dialogue player),
`Harlan`, `Mudfoot`, `Scenes` (store cutscene, fights), `Journal`. Test: `server/tests/mudfoots-big-adventure.test.cjs`.

## Capture facts

- **Stage** `mba` (16779), as live sets it: 2 on "Yes." [127], 4 at Harlan's "Good luck, adventurer." [138],
  6 as the player says "That sounds... wonderful." [276], 8 on the store scene's walk back [437], 10 at "Mudfoot
  departs." [583], 12 the windmill fight [722], 14 the ranger dead [751], 16 at "So directly south of here."
  [791], 18 the mage fight [896], 20 the mage dead [926], 22 at "So south east of here." [971], 24 the warrior
  fight [1159], 26 the warrior dead [1193], 28 at "Shall we go tell him then?" [1203], 30 at "Mudfoot departs."
  with Harlan [1322], 32 complete [1332].
- **`mba_mudfoot_vis`** (16782) picks the Mudfoot the cache shows: 1 at his house (16823), 2 following
  (16827 with his warhammer, 16828 with the spear), 3 at the windmill (16824), 4 at the ruined building (16825),
  5 in the graveyard (16826). In a fight it holds his waiting spot (3, 3, 4); a kill sets the next spot and then
  2 in one tick. The outlaws' base NPCs show on `mba` (the store 16833 at 6, the windmill 16834 at 10-12, the
  ruined building 16838 at 14-18, the graveyard 16841 at 20-24).
- **Other varbits:** `captain_harlan_intro` (16780) at his first greeting [18]; `mudfoot_first_thief_dialogue`
  (16788) at Mudfoot's "Other goblins see three humans..." [278]; `captain_harlan_bonus_*_giveaway`
  (16784/16786/16787) as each style's first kit is given [622, 1392, 1399]; `mba_lamps` (16789) counts lamps
  rubbed [1490-1502].
- **Tiles:** Mudfoot's house (3246,3250) facing west [181], the windmill (3172,3286) south [711], the ruined
  building (3172,3241) west [1084], the graveyard (3245,3199) east [1225]; the outlaws at the store (3220,3246)
  [365], the windmill (3165,3289) [715], the ruined building (3170,3242) [873], the graveyard (3245,3197) south
  [1141]. The follower appears where the Mudfoot he replaces stood [290, 1098].
- **The house:** Mudfoot walks up to the player once they stop within six tiles [189-195] and swings
  (`slice_surface_goblin_armed_attack` 6185, `goblin_warhammer_attack` 3514, a 0 block splat) as "Die, human, die!"
  and "Me killing you." show [195, 204].
- **The store Confront** [381-446] is a cutscene in a copy of source chunk (396,399), 13 x 13 chunks:
  fade, two ticks, cutscene_status 1, side tabs closed, minimap off, the copy's anchor loc 29733 at (3222,3243),
  the camera at (3221,3239,480) looking at (3215,3253,230) at rates 232/100; the outlaw (16835) and Mudfoot
  (16829) walk in, his harmless swing, the outlaw walks off north, Captain Harlan (16822) walks up; then out of the
  copy at (3218,3238) beside the real Harlan, the screen back after five ticks and his talk two ticks after.
- **"Mudfoot departs."** [580-586, 1319-1326]: the box with the fade; three ticks later the stage moves and he goes;
  a tick later the screen and the box come back, and the talk goes on.
- **The fights** each play in a copy, entered two ticks into a fade: the windmill (390,404) with the field's four
  gates closed and no options [722], the ruined building (390,399) with the H.A.M. trapdoor's options gone [896],
  the graveyard (399,394) with its doors closed [1159]. The outlaw attacks four ticks in, Mudfoot three to five.
  The mage shouts "A human helping a goblin? You're a disgrace!" at once and "H.A.M. will get rid of people like
  you!" at the player's first hit [899, 904]. The warrior prays Protect from Melee four ticks after his first hit
  taken, with "My faith protects me!" [1163-1167]; Mudfoot's blocked stab gets "Ha! Stupid thief pray to stop
  stabs, but he can't stop magic as well!" [1170]. Mudfoot's wrong-style hints come once though the player keeps
  the style [732, 906].
- **A kill** fades out at once; two ticks on the copy goes, the player stands on the matching real tile with
  Mudfoot beside them and the loot lies on the outlaw's real tile (the bones and the kit, `ownership=self`, and
  the loot tracker's script 7192) [751, 926, 1193]; the screen comes back six ticks later and the talk two after.
- **Combat looks:** the ranger `human_bow` 426 with the shared NPC arrow flight; the mage `human_caststrike_staff_walkmerge`
  11423 casting Wind Strike; the warrior `human_sword_slash` 390; Mudfoot's spear 6188 and his thrown rock (4447,
  112 to 144, angle 15, progress 4) (`npc-combat-defs.json`).
- **Harlan's menu** leaves out the option just picked when it comes back [32, 101, 1371, 1377, 1401, 1415], and
  past five options shows three and "More options..." [628, 1259].
- **Kits:** each style's first kit is a bonus the 30-minute wait does not hold back; a kit given starts the wait.
  Live gave the sword at 622, refused it at 1387 ("22 minutes"), gave the bow and the staff at 1391 and 1398 (first
  claims of each) and refused everything at 1418 ("30 minutes"). The kit menu comes back without the kit just asked
  for, as "Let's talk about something else.", and leaves for the main menu once nothing more can be given [1401].
  The staff kit is 40 mind and 40 air runes [1399].
- **The cape below 99 Defence** [26-31]: "Ah, yes. This cape is a symbol of achievement...", "So could I have
  one?", "I'm afraid not...", and the Defence cape box.
- **Combat advice** carries four graphic boxes (graphicbox 633: graphics 901, 168, 168, 898) [605-615]; "Could you
  run me through combat basics again?" is the same lesson without the closing "I see. Thanks for the information."
  and comes back to its menu without itself [595-617].
- **The reward** [1332]: four `mba_lamp` then 500 coins, the jingle "quest complete 3" (154).
- **The lamp** [1484-1490]: Rub opens "Choose the skill you wish to gain XP in." with Attack., Strength., Defence.,
  Ranged., More options...; picking one gives 500 experience, plays `found_gem` (2655) and shows "<col=0000ff>Your
  wish has been granted!</col><br>You have been awarded 500 Strength experience!" in a message box.
- **The journal** at stages 6 and 16 [325, 845] (`Journal.MudfootsBigAdventure.js`, matched line for line).

## Recorded differences (the Wiki is followed)

- After a quest kit ("Could I have a weapon for stabbing?" and the others) live ends on the player's "Thanks. I'd
  best get going." [623-625]; the Wiki adds Harlan's "Good luck, adventurer.".
- The windmill-stage menu's third option is "Thanks. I'd best get going." in live [635-637]; the Wiki's is
  "I'd best get going.".
- After "Do you have any weapons I could have?" is refused for the wait, live comes back to the main menu [1422];
  the Wiki ends the chat.
- The ranger outlaw has 10 hitpoints in the cache and died to 10 damage in the capture; the Wiki (and so
  monsters-complete) says 9.

## Ours (not in the capture or on the Wiki)

- The second page after "More options..." (Harlan's and the lamp's: Magic, Hitpoints, Prayer, "Previous options...").
- "Do you have any weapons I could have?" before the ranger dies (only the sword is unlocked) goes straight to the
  kit menu: the Wiki marks Harlan's line missing.
- Talking to Harlan at stage 2 or 8, or to Mudfoot at 14, 20 or 26 (a talk left before its end), replays that talk.
  At stage 30 "All of those thieves have been dealt with." goes straight to the reward lines.
- Mudfoot's "Look, that him there!" and the others fire at the distance live first said each (2, 12 and 7 tiles
  from the outlaw); his "Where to, Mudfoot?" answer changes to the near-outlaw line within that range.
- He follows inside a box around Lumbridge (x 3140-3290, y 3150-3330); leaving it gives the Wiki's "Me no want
  go this way. Me meet you back ..." and he goes to his spot. The townsfolk lines while he follows apply anywhere.
- The warrior turns to Protect from Missiles when the player hits him with ranged (the Wiki says he uses both
  prayers, not when).
- Mudfoot's wrong-style hint comes once per line per fight. He walks round the player to reach the outlaw when the
  player stands between them (NPC pursuit here steps straight at its target).
- A fight is left by a teleport or logout with the stage at its fight value and Mudfoot at his waiting spot.
- Chathead animations of lines the capture does not show are chatneu1; the journal paragraphs for stages 2-4,
  8-12, 20 and later, the struck form of the stage-14 paragraph and the start text.

## Not covered

- The Feoras and Shop keeper quest menus (Feoras' own dialogue is not implemented in tsps).
- Reclaiming destroyed lamps from Harlan (the Wiki says he gives them back; no dialogue is recorded).
- The 99 Defence cape purchase lines (the Wiki marks them missing; the skillcape sellers make the sale).
- Mudfoot's rock launches at the NPC ranged default (cycle 41), not the capture's cycle 15:
  `npc-combat-defs.json`'s `projectileArc` has no start time.
- The capture's `mba_mudfoot_vis` steps through 1 during the store scene and through intermediate values at the
  kills in one tick; the plugin sends the final value of each tick.

## Findings

- **fixed** The first version (PR #5286) was built from the Wiki alone: invented stage values (1, 6, 10, 11, ...),
  no store cutscene or fight copies, Mudfoot not fighting, a 30-minute wait shared by every kit, the xpreward
  interface for the lamp, no graphic boxes, and every outlaw dropping all three kits (an osrsreboxed-db dumper bug:
  Multi Infobox pages with unnumbered dropversions were not split).

## Runs

None recorded.
