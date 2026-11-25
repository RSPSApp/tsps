---
quest: Shadow of the Storm
key: shadow_of_the_storm
status: in-progress
tested: 2026-11-24
tester: agent
model: claude-opus-5-5
commit:
cache: osrs-242_2026-11-03
start: fresh
travel: travel_to
---

# Shadow of the Storm

Aligned with a whole run of the quest on live: the user's RSProx capture `ShadowOfTheStorm.bin`
(revision 242, SHA-256 `0caec8d2...dc2d00e`; Reen's start at tick 51, Badden at 335-468, the dyeing at
500-543, Evil Dave and the escort at 630-773, Denath at 773-830, the throne room's talks at 853-1052,
the golem at 1079-1090, Jennifer's mould at 1218-1280, the sigil at 1304-1315, the kilns and the book
at 1449-1511, Matthew and the ritual call at 1603-1660, the first ritual at 1680-1788, Tanya's death at
1833-1851, the recruiting at 1870-2041, the second ritual and the summoning at 2124-2226, the fight to
2760 and completion at 2782, then the post-quest talks to 2927). Ticks below are the capture's. Rsprox
recordings 3333 (revision 235) and 572 (revision 227), which the earlier plugin was built from, agree
where they recorded the same step, except where noted.

The plugin is `server/plugins/quests/quests/ShadowOfTheStorm.Quest.js`; the tome's text is
`server/plugins/quests/data/shadow-of-the-storm-tome.json`. The words are the Wiki's "Shadow of the
Storm" transcript, with osrsreboxed-db's correction adding what the capture has and the transcript
lacks (see "Dialogue"). The sigil is cast in Crafting's silver interface
(`server/plugins/skills/data/crafting.json`, component 30); the black mushroom's pick and the strange
implement's spawn are The Golem's; black dye itself is Land of the Goblins'.

Checked by `server/tests/shadow-of-the-storm-capture.test.cjs` (real Player, packets, plugins, cache and
map), `shadow-of-the-storm-items.test.cjs`, `-after-the-fight`, `-demon`, `-stairs`, the Shadow cases in
`golem-storm-quest-parity.test.cjs` and `npc-dialogue-event-entrypoints.test.cjs`, and in game over the
agent MCP.

## Stages (varbit 1372 agrith_quest, varp 602)

| Value | Set by (capture tick) |
| --- | --- |
| 10 | Reen's "You should go to Uzer and find Badden at once." showing, with the start message (73) |
| 20 | Badden's "I don't know. You'll have to find some way to convince them you're one of them." showing (468) |
| 30 | Evil Dave's escort message box, as the screen fades (716) |
| 40 | Denath's "You must memorize the incantation carefully" (815), or his "Ignoramus!" if the player left first |
| 50 | Matthew's "Josef must have hidden the book somewhere in the ruins" (940) |
| 60 | the golem's "He was carrying a large book" (1086); the kiln is drawn then |
| 70 | the player's "Don't worry. I'm here to kill the demon!" to Matthew, with the book (1620) |
| 80 | nine ticks after Matthew's "Are you prepared for the ritual?" talk ends (1627 -> 1636), with Denath's call |
| 90 | the first chant in Denath's order, as the chorus finishes (1739) |
| 100 | the ghosts kill Tanya (1845) |
| 110 | continuing Matthew's "*gulp* Okay, here we go..." (2134 -> 2135), once all four helpers have arrived |
| 120 | the second chant in the book's order (2201) |
| 124 | the last hit with Silverlight worn, in melee (2760) |
| 125 | the reward skill picked (2782); the plugin's own stage is 130 |

The completion threshold is the cache's quest DB row. Quest Helper keys its steps on the same values.

## Varbits (varp 602)

| Varbit | Values (capture tick) | Cache transform |
| --- | --- | --- |
| 1373-1377 agrith_incantation_1..5 | the book's order, drawn per player as Denath tells it (815: 1,4,0,3,2; 3333: 3,2,4,0,1) | |
| 1378 agrith_kiln | the kiln holding the tome, 0-3 (ours left it at 0, 572 set 2) | |
| 1381 agrith_badden_uzer | 1 at the start (73), 2 as he takes a sigil (1918), 3 once he has arrived (1950) | 1986 shows at 1, the walker 915 at 2 |
| 1382 agrith_reen_uzer | 1 with the escort (716), 2 (1999), 3 (2021) | 1985 at 1, 916 at 2 |
| 1380 agrith_convinced_dave | 1 with the first ritual's end (1739), 2 as he gives Eric's sigil (1889), 3 arrived (1904) | 913 at 1, 914 at 2 |
| 1379 agrith_convinced_golem | 1 refusing (1932), 2 reprogrammed (2008), 3 taking a sigil (2021) | |
| 348 golem_clay (The Golem's) | 5 as the golem walks off (2021), 6 arrived (2041), 4 again with the kill (2760) | 6277 shows at 0-4, the walker 6183 at 5 |

The helpers' arrival delays (15, 32, 22 and 20 ticks) are this capture's; a relog on the way counts as
arrived. The kilns' multiloc on 1372 shows "Look-in" (10246-10248) at 60 only; the rubble 10249 shows
Eric (10250) and the sand storms (1988) show at 90-110.

## The throne room

Each visit during the quest is a fresh copy of the room (live: `rebuild_region`, 717, 1213, 1594, 2049),
here a private area at the source coordinates: the torches, fire remains, beds and standards as captured,
and the cast for the stage. Before the summoning they walk about it; Evil Dave is at the portal outside
until the ritual. After the quest the room is the plain map with "You step into the portal." (2963).

- **Escort (716-773):** the message box with no continue over a 15-cycle fade-out; the player and Dave
  walk the corridor between invisible walls (3550) up to Denath under a moving camera, with the "denath
  cutscene" jingle; the walls go after Denath's "Indeed?"; the cutscene state ends as Denath asks "So
  you wish to join us?".
- **Tanya's laugh (872-884):** each laugh overhead too, the camera climbing away from her, back for
  Patrick's line.
- **The ritual call (1636-1646):** Denath's call overhead and in the chatbox, "Incantation" unlocked,
  Dave comes in and everyone walks to their place.
- **Chanting:** from 2718,4902 (first) and 2720,4903 (second); five menus, each word overhead with
  2879 on everyone, the wizards in their sigil forms from the first word, a camera step a word (and a
  shake in the second). Anywhere else the sigil's Chant is the same menus and "Nothing interesting
  happens." (1356-1370).
- **Wrong chants:** 2880 on everyone, Denath's "You fool!" (1706) or Matthew's "No, we need to perform
  the ritual forwards" (2169) with the sigil-form head, the camera back; the sigils stay out.
- **The first ritual's end (1739-1788):** the cutscene state, the magic circle, Denath's 482 and 2888,
  his sigil where he stood (1751), BOOM, the closing portal, Dave, Eric and Tanya running off; each line
  carries its own camera.
- **The summoning (2201-2226):** the circle and the open portal back, Agrith-Naar's arrival (482, 4623,
  "Grip of the Talon"), his Fire Blast at Matthew (bones left), the player's lines, then the fight.

- **Every cutscene** (escort, first ritual's end, summoning) closes the side tabs as it starts and
  reopens them as it ends (716-774, 1741-1790, 2200-2227). If its talk is gone anyway (the chat shut for
  three ticks), the scene ends the way its last line would (ours).

## The fight

Fire Blast is launched at 51 and lands at 46 + 10 a tile, as the capture's projectiles do (2235, 2513).
A landed blast shows 128 with fireblast_hit (156) as it lands (2513); a miss splashes, 85 with
spellfail (227) and no hitsplat (2235 and 42 more). The cast sound 155 is an area sound. The Wiki's
rules decide the rest: Telekinetic Grab against Protect from Magic out of melee, his hitpoints back to
12 for a last blow out of melee or without Silverlight.

## Uzer during the storm (stages 90-110)

- The first climb out of the temple is stopped by falling rocks: the message, spotanim 271, a shake and
  a hit of 1 (1901; 3333 t2232, 572 t1233). The next climb arrives in the storm: "You must fight your
  way against a sandstorm!", overlay 296, sound 1314 (1906); going down closes it (2027).
- After going down, rocks fall again some ticks later with no message (2036; 572 3 ticks, 3333 18).

## Dialogue

The transcript's text, through osrsreboxed-db (`data/dialogues/corrections.json`, "Shadow of the
Storm"), with the capture's additions: Reen's "Do you know where Silverlight is?" in each of his talks
(80, 1122, 2100; 137 banked), his lines when Silverlight was lost in Uzer (1560) and the throne room
(2108), his menus there and in the fight (2090, 2243), Evil Dave's "And I love that evil black sword!"
(714) and his greeting without "sister" (1028), the player's "I'll get ready." (1626, 1660), Denath's
stage-80 talk (1644), Tanya's own stage-80 line (1673) and the player's name where the Wiki has its
editor's (1788). Chatheads are the clicked NPC's (1984, 1985, 1986, 1987, 913, 6277), the sigil form's
in a ritual (898, 904).

## Recorded differences (the Wiki's kept)

- "You must hurry!" after the player's "Not yet." to Reen (the capture ends there, 84).
- Badden's "All right!" (capture "Alright!", 1916).
- Patrick, not Matthew, says "Look, we've told you not to do that." after Tanya's laugh (capture 887:
  Matthew).
- The two lines "Don't worry. I'm here to kill the demon!" and "This is the demon-slaying sword..." (the
  capture shows them as one, 1620).
- Agrith-Naar stays where he was summoned (the Wiki; the NW torch safespot). The capture has him
  shift a tile or two after the player (2229-2758).
- Badden's "Well I came here and opened a portal..." (capture "Well, I came here...", 390) and Reen's
  post-quest "un-summoned" (capture "un- summoned").
- The black mushroom crushed into a vial: Land of the Goblins keeps the Wiki's "...pour the juice into a
  vial." (capture "...create some black dye.", 522, 532, 541).
- Matthew's "*gulp*" line breaks after "*gulp*" as live does (2134); live's blank line between is
  dropped by the engine's chat layout.
- Patrick's "Those gems on the demon's throne look valuable..." shows while The Golem's gems are still
  on the throne (the Wiki's condition; the recording account had taken them).
- Dyeing Silverlight takes every clean Silverlight carried (the Wiki's warning on the Silverlight page).

## Menus

Live leaves out the option just asked when a talk's menu comes back (every one of the capture's 35
talk menus; Denath 785-806, Badden 369-412); the ritual's word menus stay whole. Badden's golem and
portal answers end back at his topics without the topic that led there (405, 451), where the
transcript returns to his opening question.

## Ours

- The helpers' arrival delays and the descent rockfall's spread (3-18 ticks) are from one sample each.
- The journal at stages 30, 50, 70, 80, 100 and after the quest (the capture opens it at 10, 20, 40, 60,
  90 and 120).
- The refusal for a player without The Golem and Demon Slayer (no source has Reen's).
- A final blow without Silverlight restores his 12 hitpoints with no message (the capture's message is
  for being too far away).
- The room is a private area at the source coordinates rather than a client instance.
- The strange implement on the golem once it is reprogrammed: the default "Nothing interesting happens.".
- Black dye gives the vial back for every item it dyes. The capture shows it for the desert shirt and
  robe and the red cape (528, 537, 543), and the Wiki's Black cape page agrees; the Wiki says nothing
  for the other desert clothes, so they follow the capture.
- Dying in the fight: no source covers it. The player respawns as from any death, the stage stays 120,
  and the portal brings back a room with Agrith-Naar at full health and the cast that had arrived.
- A logout in the summoning before Matthew's death line: he is dead at the next login (he always dies
  in that scene).

## Runs

### 2026-11-24 · agent · claude-opus-5-5

- **Start:** fresh account `sotsrun1`, The Golem and Demon Slayer completed by fixture, stage 0, one
  `::tele` to Reen. Every later leg walked or travelled by Quest Helper; the fight in melee to the kill.
- **Found and fixed:** Denath's lines inside Evil Dave's escort talk neither moved the stage nor used the
  player's words (the triggers keyed on the NPC clicked); menus repeated the option just asked; the
  player's "Did you see anything happen last night?" and "Yes." to Matthew were missing (osrsreboxed-db);
  the escort's Dave stayed in the room; the implement on a reprogrammed golem said nothing.
- **Checked as is:** rewards once, the repeat chant, relog (stage, varbits, items), the offline save, the
  post-quest room and talks, Reen's lost-sword recovery.
- **Vision (after the fixes, account `sotsvis1`, stages set for the setup):** frames of the escort, the
  first ritual's closing and the summoning at a reader's pace: none black, the view and minimap back after
  each, everyone on screen. Tanya's death and the storm were checked over MCP, without frames.
