# Royal seed pod

Monkey Madness II's reward. Commune teleports the player to the Grand Tree, in front of King
Narnode, from up to level 30 Wilderness (Wiki, Royal seed pod). Code: the Commune handler in
`server/plugins/quests/quests/MonkeyMadnessII.Quest.js`; tests:
`server/tests/seed-pod-crystal-teleport-rules.test.cjs`.

## The teleport (rsprox captures)

From rsprox.net recordings 1060, 1067, 2950, 3434, 4042, 4155 and 4263 (rev 230-239), ticks
counted from the click:

| tick | what live sends |
|---:|---|
| 0 | seq `aluft_human_plant_teleport` (4544) and spotanim `aluft_plant_pod` (767), both delay 5; varbit `busy` 1 |
| 4 | the move to 2465,3495,0 (7 of 7 landings) |
| 5 | seq `aluft_human_plant_teleport_revers` (4546) and spotanim `aluft_plant_pod_revers` (769) |
| 8 | the animation reset, "The Royal seed pod teleports you to the Grand Tree." (spam), varbit `busy` 0 |

The player stays held from the landing until tick 8 (busy is still 1). Synth 469 plays on the click
and again on the landing in recording 4042 only; the other recordings have no sound for it.

Ours: only movement is held between the landing and tick 8. Clicks, eating and talking still go
through (no recording tries one during the hold); an animation started then is cut by the tick 8
reset.
