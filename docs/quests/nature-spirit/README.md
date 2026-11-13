---
quest: Nature Spirit
key: nature_spirit
status: untested
tested:
tester:
model:
commit:
cache:
start:
travel:
---

# Nature Spirit

Aligned with the user's whole-quest rsprox capture `NatureSpirit` (revision 242.1, one account,
start to finish, SHA-256 `4af3abdc91ff8cd2d63ad9de20f875455a9260c08f4b8ffb77a16db1b259eb33`).
Ticks below are that capture's. The plugin is `server/plugins/quests/quests/NatureSpirit.Quest.js`;
the words come from the Wiki transcript as `osrsreboxed-db`'s capture sources correct it
(RSPSApp/osrsreboxed-db, `data/dialogues/capture-sources.json`, entry "Nature Spirit").

## Stages (varp 307)

Live's own values, each moved where live moves it:

| Stage | When (tick) |
| --- | --- |
| 5 | Drezel's "Now, please be aware of the ghasts..." continued (75), with the food box |
| 10 | through the swamp gate (223) |
| 20 | Filliman's "Don't be silly now! That in no way reflects the truth!" continued (381) |
| 25 | "It must be a sign..." continued (514) |
| 30 | "It's all coming back to me now..." shows, the journal goes (549) |
| 35 | the papyrus box continued, the spell given (584) |
| 40 | three ticks into Drezel's blessing (750) |
| 45 | the Bloom spell's effect, two ticks after the cast (868) |
| 50 | the first fungus picked (873) |
| 55 | "Wonderful, the mushroom represents..." continued (939) |
| 60 | four ticks after the ritual try closes (1042) |
| 65 | entering the grotto (1057) |
| 70 | three ticks after "I must complete the transformation now..." (1075) |
| 75 | two ticks into the sickle's blessing (1117) |
| 80 | a tick after the first sickle Bloom (1235) |
| 85 | the first produce picked after it (1238) |
| 90 | the first pouch filling (1248) |
| 95/100/105 | each revealed ghast's death (1288, 1341, 1384) |
| 110 | nine ticks after "Many thanks my friend..." (1474) |

15 (talking without the amulet) is the Wiki's; the capture always wore it.

## Filliman

- He is owner-only and comes on demand: the grotto entrance (3516) before the ritual brings him
  to 3440,3336 with sound 432 (364, 473, 607, 933); Searching the grotto water (3520) brings him
  to 3443,9738 before and after the transformation (1069), and to 3441,9736 with sound 1490 once
  the ghasts are dead (1460).
- He stays 100 ticks after he appears or transforms (364-464, 473-573, 933-1033, 1075-1175), and
  goes when his owner crosses back off the island (607-639). Ours: the island's bounds.
- The first entrance, at stage 10, sends "You prepare to enter the Druid's grotto.", the
  statement box "A shifting apparition appears in front of you." and his first talk. Later
  entrances send the prepare line and his Talk-to conversation; from 60 on the player goes down
  with "You see a beautifully tended small grotto area." and lands on 3442,9734 (plane 1 after
  the quest, 1614).

## Scenes

All the chat closes for the scene, then the next line shows on the given tick.

- **Drezel's blessing** (746-750): on the continue the player kneels (645), Drezel casts (811)
  and chants "Ashustru, blessidium, adverturasi, fidum!" overhead; a tick later a star (268)
  from Drezel to the player and sound 2674; a tick later spotanim 259 on the player; a tick
  later 40 and "There you go my friend...".
- **The ritual** (958-962, 1037-1042): "Oh really.. lets try! ~ The druid attempts to cast a
  spell. ~" closes by itself, two ticks on when it fails (Filliman casts, sound 1495, "Hmm,
  something still doesn't seem right..." two ticks later) and one tick on when both offerings
  are placed (sound 1495; two ticks later stars from 3440,3334, 3442,3336 and 3438,3336 to him;
  two ticks later 60, three spotanim 266 bursts, sound 1492 and "Aha, everything seems to be in
  place!...").
- **The transformation** (1072-1075): a tick after the line Filliman casts (811, delay 5) and
  seven stars fly at him with sound 1490; a tick later three 266 bursts; a tick later 70, 266 on
  him and he changes to the Nature Spirit (944) in place, which speaks next.
- **The sickle** (1113-1120): stars from the grotto water at the player, 264 on the player, the
  spirit casts, sound 2674; a tick later the player's 1100; a tick later 75 and the blessed
  sickle; the box five ticks after the continue. The pouch box hands over the empty pouch; the
  stage stays 75.
- **The altar** (1464-1482): the spirit casts as his line closes; two ticks later three stars and
  sound 1495; a tick later three 266 bursts, 1492 and two 2340; he casts again on the sixth tick;
  on the ninth 110, "You see a beautifully tended small grotto area.", the quest scroll and the
  move to plane 1, and his "Welcome to my Altar to Nature!...".

## Items and places

- **Washing bowl** (462-466): taking it sends "You find a small mirror under the washing bowl."
  and leaves the mirror on the bench for its finder (200 ticks), to pick up.
- **Grotto tree** (3517): Look-at "It looks like a tree on a large rock with roots trailing down
  to the ground."; Search at 25 gives the journal in its box (527), else "You find nothing
  interesting." (602).
- **Bloom spell** (643, 866-868, 985-987): unblessed "You need to be blessed before you can cast
  this spell."; blessed, "You cast the spell in the swamp." at once and two ticks later the cast
  (811), the bloom around the player (263, delay 30, height 46), sound 1493, and the rotting logs
  beside the player turn to fungi (1491 each) with the spell used up; with none, "There is no
  suitable material to be affected in this area." and the spell is kept.
- **Picking** (873, 1240): "You pick a mushroom from the log." / "You take a cutting from the
  budding branch.", 827 and sound 2581.
- **Stones** (1005-1021): the fungus on the brown (west) stone, "The stone seems to absorb the
  fungus."; an unused bloom spell on the grey (east) stone, "The stone seems to absorb the spell
  scroll." (the used spell keeps the Wiki's "used spell scroll"); each followed by Filliman's
  "Aha, yes, that seems right well done!".
- **Sickle Bloom** (1234-1235): 1100, 264 and sound 1493 at once; a tick later the bloom around
  the player (263, delay 15, height 150), the Prayer drain (2 and 3 points in the capture) and
  the plants with their sounds (1491 fungi, 1489 branch).
- **Pouch** (1130, 1248-1299): Fill before any harvest shows "You've not been told how to use this
  item yet." with the pouch; three items, the first three in the pack, go in, one charge a
  fungus and two a stem: "You add five harvested items to your druid pouch."; with fewer, "You
  need at least three blossomed items to add something to the druid pouch.".
- **Ghasts** (233, 285, 499, 1257, 1310): a miss is "An attacking Ghast just misses you.", the
  player's block, the ghast's 1093, "OOooooohhh" and sound 433; a rot is "You feel something
  attacking your backpack, and smell a terrible stench.", "Oouuaarrr!" and sounds 433 and 1494,
  a pie leaving its dish in its slot and the rotten food in a free one. On the island the camp's
  aura turns it away ("The aura of Fillimans camp protects you from the swamp.", 255). With a
  filled pouch, "The druid pouch makes the Ghast visible.", the player's block, 269 on the player,
  a star at the ghast and sound 432; the level 30 ghast two ticks later.
- **Altar of nature** (1494, 1516): "You recharge your prayer points at the altar of nature." up
  to two above the level, then "You have already boosted your prayer points.".

## Not covered

- The stepping-stone bridge (3522) still uses the generic crossing; live jumps with 769 and an
  exact move and can fall in (770, "You nearly drown in the disgusting swamp.", 325-330).
- "The blessed sickle prevents the swamp from decaying you." (1400) and "The swamp decay effect is
  now over." (1635): their trigger is not clear from one capture.
- The offering lies on its stone for three ticks as a ground item (1008, 1021).
- The ghast stays the same NPC and changes type in place (1259); ours spawns an owner-only form.

## Runs

No natural run recorded yet. Earlier work: issue [#728](https://github.com/RSPSApp/tsps/issues/728)
(q082), PRs [#1147](https://github.com/RSPSApp/tsps/pull/1147), #1954, #2216; issue #1913.
