# The Golem / Shadow of the Storm — route parity

Quest Helper source (pinned by the coordinator):
[TheGolem.java](https://github.com/Zoinkwiz/quest-helper/blob/06da90f982518a093f2fe1c9cfac5547fa7053d3/src/main/java/com/questhelper/helpers/quests/thegolem/TheGolem.java),
[ShadowOfTheStorm.java](https://github.com/Zoinkwiz/quest-helper/blob/06da90f982518a093f2fe1c9cfac5547fa7053d3/src/main/java/com/questhelper/helpers/quests/shadowofthestorm/ShadowOfTheStorm.java),
[IncantationStep.java](https://github.com/Zoinkwiz/quest-helper/blob/06da90f982518a093f2fe1c9cfac5547fa7053d3/src/main/java/com/questhelper/helpers/quests/shadowofthestorm/IncantationStep.java).

Cache ids come from this checkout's cache (revision 241), not from the guide.
Packet evidence is RSProx capture https://rsprox.net/download/3333, which covers both complete
routes. Where the guide and capture disagree, the capture wins and the difference is noted.

## Validation status
Descriptive "native"/parity below means the plugin path and focused tests, not a full MCP pass.
The Golem is a current full native pass (native3, unchanged, reward and relog verified). Shadow
of the Storm stopped at native3 stage 110; native4 is ongoing and has not passed. Current full
native passes across the issue are six (The Golem, Throne of Miscellania, Shades of Mort'ton,
Tai Bwo Wannai Trio, Scrambled!, Royal Trouble); no all-32 claim.

## The Golem

| Route node | Server behaviour | Source |
| --- | --- | --- |
| Start at the Uzer golem | `Clay golem` transcript, stage 1 | Quest Helper `talkToGolem` |
| 4 soft clay repairs | Consumes clay, `golem_clay` 1-4, NPC 6277 transforms to 5134/5135/5136 | varbit 348 transforms `[5134,5134,5135,5135,5136]` |
| Letter on the floor | Spawned at 3479,3092, readable, `golem_b` 1 | Quest Helper `pickUpLetter` |
| Enter ruins / strange implement | First ruin entry sets `seen_underground`; implement spawned at 2713,4913 | capture tick 408 |
| Elissa | Notes location advances `golem_b` to 2 | capture `golem_b` 1 -> 2 |
| Exam Centre bookcase | Only 6292 at 3366,3332 gives Varmen's notes; no stage change | capture ticks 622-624 |
| Reading the notes | Item action sets `golem_b` 3 | capture tick 548 |
| Curator conversation | Moves stage 2 -> 3; pickpocket requires `golem_b` 3 | capture tick 926 |
| Museum case | Key opens 24626, `retrieved_statuette` 1 | varbit 355 transforms 24626 to the empty case |
| Alcove puzzle | D at 2725,4896 accepts the statuette; each Turn changes only the clicked alcove; A/B/C can be turned before D is placed | varbits 349-352, targets a=1 b=1 c=0 d=2; capture ticks 1020-1031 |
| Portal / throne room | 6310 -> (2720,4884,2); first-entry skeleton line at stage 5 only; 6282 -> (2721,4911,0) | capture ticks 1042 and 10719 |
| Open golem head | Implement sets `head_open` 1 and plays only the opening message | varbit 353; capture tick 1251 |
| Golem program | Used at stage 7; completion keeps `head_open` 1, which clears two ticks later with "The golem's skull shuts automatically." | capture ticks 1257-1262 |
| Lost statuette recovery | Curator hands a replacement before the alcove placement | Quest Helper statuette tooltip |

Item/monster ids: letter 4615, notes 4616, key 4617, statuette 4618, implement 4619, mushroom 4620,
feather 4621, ink 4622, quill 4623, program 4624.

## Shadow of the Storm

| Route node | Server behaviour | Source |
| --- | --- | --- |
| Reen start gate | Refuses with the generic requirement message unless The Golem and Demon Slayer are complete (no refusal branch exists in the transcript) | Quest Helper requirements |
| Wizard/helper recruitment | Dave, Badden, Reen, golem bits, only four helpers | transcript conditions |
| Kiln search | Wrong kilns advance `agrith_kiln`; the book comes from 2733,4904 | Quest Helper `searchKilns` |
| Throne room | Realm is map plane 2, entered by 6310 and left by 6282; owner-only cast spawns there | capture ticks 1808, 1042, 10719, 2432 |
| First incantation | Click the sigil's `Chant` at (2720,4903,2); Denath speaks Nahudu Caldar Tarren Agrith-Naar Camerinthum, and the varbits store the reverse | capture ticks 18905 and 21204-21624 |
| Post-ritual NPCs | Eric, Jennifer and Patrick persist at stage 90 for their post-ritual lines | capture stage 90 |
| Tanya's sigil | **QuestScene**: first-ritual camera track and BOOM (interface 229), portal loc 10251, return to (2721,4911,0), Tanya 919 plus three ghosts 1989 under the captured camera; ghosts message at +7 sets stage 100 and drops her sigil; camera resets at +10 | capture t2109-t2150 |
| Second incantation | Talk to Matthew; the real `pblmt4` condition and/or his resolved acceptance line sets the persisted assembly flag (stage 110 + 4 helpers + sigil + Silverlight), then click `Chant` at the circle; early Chant is blocked. The five picks use varbits 1373-1377 directly (Camerinthum, Agrith-Naar, Tarren, Caldar, Nahudu). **QuestScene** camera rises per picked word with shakes 1-5, Agrith-Naar 911 spawns at (2719,4899,2), fight camera resets at +14 | capture t2429-t2475 |
| Agrith-Naar | Spawned on the demon action; death requires Silverlight and yields Darklight | Quest Helper fight steps |

## Known gaps

- Capture 3333 is decoded and used for both routes; raw packets stay outside Git.
- The Tanya and summoning camera/shake/loc/actor beats use QuestScenes and the captured coords; cosmetic sounds and every echo sequence are not reproduced.
- Stage-110 assembly is set by the real resolved `pblmt4` condition and by Matthew's acceptance line, guarded by stage/helpers/sigil/Silverlight; this was added after native3 found the flag could remain false when only the transient condition callback ran.
- The first- and second-ritual casts use the captured NPC ids and plane-2 tiles, but their full movement choreography is not reproduced.
- The Golem's throne room demon is scenery (the skeleton), so no demon fight is simulated.
