# Native quest state: preserved stage formats

These plugins previously sent their saved stage directly to the client. Seven completed
saves stayed in progress in the stock quest list: their saved reward checkpoint was below
the native cache's completion threshold. Compact stages also selected the wrong intermediate
Quest Helper step and, for Eagles' Peak and Between a Rock, NPC/scenery transforms.

`nativeProgress` belongs to each quest registration. It translates the existing persistent
stage into the native progress variable used by every consumer. It does not change dialogue
branch selectors, saved stages, reward callbacks or the cache's status rules. QuestRuntime
uses the same registration mapping for setStage, login and post-bootstrap replay.

| Quest | Saved phases | Native phases |
| --- | --- | --- |
| Between a Rock | 0,10..90,100 | unchanged through90; Avatar beaten90+flag→100; rewarded100→110 |
| Curse of Arrav | 0..52,58 | unchanged through52; rewarded58→60 |
| Eagles' Peak | 0..8 | 0,5,10,15,15,20,25,35,40 |
| Enlightened Journey | 0..8 | 0,20,40,60,70,80,90,100,200 |
| Eyes of Glouphrie | 0..12 | 0,1,5,15,20,20,20,25,27,35,36,50,60; existing Brimstail follow-up flag at10→40 |
| Forgettable Tale | 0..18 | 0,10,20,30,30,40,40,50,50,60,70,70,100,100,105,118,120,130,140; existing conductor flag at11→80 |
| Fremennik Trials | 0..8 | native1+votes through8, with saved stage as the legacy minimum; rewarded8→10 |
| Mourning's End Part I | 0..14 | 0,2,3,3,3,4,5,5,5,6,6,6,7,8,9 |
| Dream Mentor | 0,2,6,16,18,20,22,24,26,28,30 | 0,4,6,16,18,20,22,24,24,26,28 |

Mourning's End Part I and Dream Mentor had the opposite boundary error: saved orders9
and defeated28 already met native endstates9/28, while their real reward calls still awaited
saved14/30. Their mappings preserve the actual poison/report and dream/return/reward phases,
so the native list remains in progress until those existing reward calls. Dream Mentor's
post-quest wire28 also keeps the cache's Jack transform visible, unlike obsolete wire30.

The Avatar death, Brimstail follow-up, conductor choice and seventh council vote already
changed durable substage flags without necessarily advancing the saved stage. Those same
handlers now publish the resulting native progress immediately. Numeric and string legacy
stages retain the flags' meaning. These handlers do not grant extra rewards or advance the
saved stage to a new format.

## Sources

The active `server/target.txt` cache (`osrs-241_2026-10-20`) is authoritative for DB table0
endstate, bitfield layout, script4029 status and NPC/loc transforms. The seven completion
thresholds are110/60/40/200/60/140/10 respectively. A full cache cross-reference scan found
nine NPC and thirteen loc definitions reading these variables; no direct plugin reader of
the numeric wire values was found outside QuestRuntime/Quest Helper snapshots. Existing
sibling-bit/world sync remains in place.

Intermediate milestones come from the pinned Quest Helper progression source, matched to
the actions already implemented in each plugin:

- [Between a Rock](https://github.com/Zoinkwiz/quest-helper/blob/06da90f982518a093f2fe1c9cfac5547fa7053d3/src/main/java/com/questhelper/helpers/quests/betweenarock/BetweenARock.java)
- [Curse of Arrav](https://github.com/Zoinkwiz/quest-helper/blob/06da90f982518a093f2fe1c9cfac5547fa7053d3/src/main/java/com/questhelper/helpers/quests/thecurseofarrav/TheCurseOfArrav.java)
- [Eagles' Peak](https://github.com/Zoinkwiz/quest-helper/blob/06da90f982518a093f2fe1c9cfac5547fa7053d3/src/main/java/com/questhelper/helpers/quests/eaglespeak/EaglesPeak.java)
- [Enlightened Journey](https://github.com/Zoinkwiz/quest-helper/blob/06da90f982518a093f2fe1c9cfac5547fa7053d3/src/main/java/com/questhelper/helpers/quests/enlightenedjourney/EnlightenedJourney.java)
- [Eyes of Glouphrie](https://github.com/Zoinkwiz/quest-helper/blob/06da90f982518a093f2fe1c9cfac5547fa7053d3/src/main/java/com/questhelper/helpers/quests/theeyesofglouphrie/TheEyesOfGlouphrie.java)
- [Forgettable Tale](https://github.com/Zoinkwiz/quest-helper/blob/06da90f982518a093f2fe1c9cfac5547fa7053d3/src/main/java/com/questhelper/helpers/quests/forgettabletale/ForgettableTale.java)
- [Fremennik Trials](https://github.com/Zoinkwiz/quest-helper/blob/06da90f982518a093f2fe1c9cfac5547fa7053d3/src/main/java/com/questhelper/helpers/quests/thefremenniktrials/TheFremennikTrials.java)

- [Mourning's End Part I](https://github.com/Zoinkwiz/quest-helper/blob/06da90f982518a093f2fe1c9cfac5547fa7053d3/src/main/java/com/questhelper/helpers/quests/mourningsendparti/MourningsEndPartI.java)
- [Dream Mentor](https://github.com/Zoinkwiz/quest-helper/blob/06da90f982518a093f2fe1c9cfac5547fa7053d3/src/main/java/com/questhelper/helpers/quests/dreammentor/DreamMentor.java)

A separate full cache scan found no direct NPC/loc morph using mourning_quest517,
and exactly two NPC morphs using dream_prog3618 (6126 and6163). Sibling controls and
server encounter predicates continue using their existing saved fields.

No packet capture establishes every intermediate transition here; the guide is progression
evidence, not packet-for-packet timing proof. Existing quest mechanics and their recorded
limitations remain outside this state translation repair.

## Verification

`client/tests/native-quest-state-a.test.ts` uses real Player and PacketSender writes, forwards
the final parent varp image into the actual cache VM, and calls stock script4029. It checks
every authored phase, all unstarted/in-progress/completed statuses, preserved callbacks,
legacy completed login/bootstrap replay, numeric/string flag checkpoints, sibling bits,
immediate dialogue-flag sync and Dondakan/Nickolaus morphs. Run after server build:

```sh
client/node_modules/.bin/tsx --tsconfig client/tsconfig.json --test client/tests/native-quest-state-a.test.ts
```

Checkpoint MCP verification on this branch's own port49806 used `login(nativea1)`, then
`command {player:"nativea1",text:"quest <key> <saved-completed-stage>",ticks:1}` for the
seven rows above. `observe {varbits:[299,11479,2780,2866,2497,822],varps:[347]}` returned
110/60/40/200/60/140 and10. Normal logout/login restored the same values, followed by logout.
This proves real stage commands and persistence replay; it is not a fresh playthrough.
Before-state stock VM checks showed yellow at Rock299=100 and Eagles2780=8 and green at
the native110/40 values. No GPU visual claim is made by these state tests.
