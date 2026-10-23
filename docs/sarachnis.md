# Sarachnis

Sarachnis, mother of the temple spiders, in the Forthos Dungeon burial tomb, built from the
OSRS Wiki ([Sarachnis](https://oldschool.runescape.wiki/w/Sarachnis),
[Sarachnis/Strategies](https://oldschool.runescape.wiki/w/Sarachnis/Strategies)) and checked
tick by tick against live rsprox captures (<https://rsprox.net/database>; submissions 3932
(1.61 MB, ~65 kills), 3926 and 3927 on rev 236). The plugin is
`server/plugins/bosses/Sarachnis.plugin.js`, with its units in
`server/plugins/bosses/sarachnis/`. Ticks count from the attack unless stated.

Reference implementations in other private servers (behaviour oracles only, never
justification on their own): Near-Reality's `Sarachnis.java`/`SarachnisMinion.java`/
`SarachnisInstance.java`/`SarachnisArea.java`/`SarachnisDropTable.kt` and ReasonPS'
`bosses/sarachnis/Sarachnis.java`/`SarachnisLair.java`/`SarachnisMapHandler.java`/
`SarachnisSpawn.java`. Where they disagree with the captures, the captures win:
NR's melee animation 8339 is the SotE gauntlet spider's (`sote_gauntlet_spider_attack_melee`)
- the cache, the captures (`npc-animations.json`: 8713 seen with 8147) and ReasonPS all agree
her melee is 8147. (Submission 3932 sampled the spawn waves a little lower, around half
and a quarter - likely tick attribution against her constant self-healing - but the Wiki,
NR and ReasonPS all agree on 66%/33%, so the Wiki wins; see the spawn note below.)

| File | What owns |
| --- | --- |
| `Common.Sarachnis.js` | Ids, tiles, animations, projectile shapes, sounds, small helpers. |
| `Fight.Sarachnis.js` | The combat method: standards, the web every fourth attack, the heal, the spawns. |
| `Lair.Sarachnis.js` | The multi-combat lair Area, the boss HUD, and private instances. |
| `Entrance.Sarachnis.js` | The dungeon webs, the peek, and the thick-web entrance with rented instances. |

## Evidence

- **rsprox:** `NPC 8713 sarachnis` matches only submissions 3932 (240 matches), 3927 and 3926;
combined `ANY 8713+8714+8715` gives 3932 = 496 matches. `MESSAGE_GAME "Sarachnis"` matches
only 3932 (86 matches: the leech line). `SEQ 4410` (ranged), `SEQ 8318` (death) and
`SEQ 8147` (melee) all hit 3932; `SPOTANIM 1686/1687` (rangeproj/web_proj) hit 3932;
`LOC 34858` (entrance) hits only 3932; combined `ALL NPC 8713 + SEQ 4410 + SPOT 1687 +
LOC 34858` leaves only 3932 (2191 matches). 8712 is not her (0 matches).
- **Minions:** 128 melee-spawn adds + 128 mage-spawn adds over ~64 kills in 3932 = one pair
per threshold per kill (solo), always one 8714 + one 8715 on random lair tiles.
- **Cache (rev 241):** NPCs 8713 `sarachnis`, 8714 `sarachnis_melee_spawn`, 8715
`sarachnis_mage_spawn`; SEQs 4410 `hosdun_spider_boss_attack_ranged`, 8147
`hosdun_spider_boss_attack_melee`, 8318 `hosdun_spider_boss_death`, 11511
`human_aranea_boots_wade`, 8833 `human_cutting`; spotanims 1686 `sarachnis_rangeproj`,
1687 `sarachnis_web_proj`, 1682 `hosdun_spider_bolt_travel`; locs 34858
`hosdun_sarachnis_entrance` (Enter-crypt/Quick-enter/Fight-privately), 34859
`hosdun_sarachnis_exit` (Exit/Quick-Exit), 34895 `sarachnis_web`, 34898 `sarachnis_web_peek`
(Slash/Peek), 34899 `slashed_web_peek` (Pass-through/Peek), 733 `bigweb_slashable`
(Slash). Music region 7322 (the tomb) plays 641 `Sarachnis`.
- **Wiki corrections applied:** the spawn thresholds follow the Wiki at 66%/33% (the one
place the captures read lower - submission 3932 samples the waves around half and a
quarter, noted below); she sprints 2 tiles a tick after the web (the captures' teleport hops); the thick
webs need no tool to pass; an instance costs 25k from the bank (12.5k with the hard
Combat Achievement tier done).

## The way in

- **Dungeon webs** (733 at (1841, 9933) and (1833, 9944)) and the **tomb web** (34898 at
(1847, 9919), Slash/Peek): with Aranea boots, Slash wades through - anim 11511 with the
forced 1-tile step onto the web's tile, web unchanged (captured for both locs). Without
boots, a slash weapon or knife slashes a way through (Wiki; anim 8833 `human_cutting`,
uncaptured); with neither, "You need a slash weapon or a knife to get through the dense
web." (Wiki-based wording, uncaptured).
- **Peek** (op2 on 34898): "You listen and hear no adventurers inside the crypt" with nobody
inside (captured); "1 adventurer"/"N adventurers" variants follow the other bosses' Peek
lines (inferred, uncaptured).
- **Thick Web** (34858 at (1842, 9912)): Quick-enter walks straight in to (1842, 9911) with no anim, sound or fade (captured); Enter-crypt asks first - public
walk-in or rented instance (the question is inferred, only Quick-enter was captured);
Fight-privately rents at once. From inside the tomb every option on it just walks back
out to (1842, 9913) (inferred: live's own exit is the separate 34859 face). The way out
(34859, Exit/Quick-Exit) steps back outside to (1842, 9913). ::teleports lands outside
too, at (1842, 9913), so every entry starts on the right side of the web.
- **Private instances** (Wiki, never bought in the logs): 25,000 coins from the bank,
12,500 once `ca_tier_status_hard` (12865) is at least unlocked; the fee is taken outside,
then the player walks in through the web; the instance (a PrivateArea over the tomb's
tiles) with its own Sarachnis at (1840, 9900) is created in the same tick as the payment,
respawning every 16 ticks while it
has players, ending when empty (leaving, teleporting, dying or logging out, which puts
the player back outside).

## The fight

| Cycle | Attacks | Speed |
| --- | --- | --- |
| Four standards | Melee 8147 next to her (lands same tick, 543 + 541), ranged 4410 with 1686 (sound 555) further out | 4 |
| Web (5th) | 4410 + "Hsss!" with no facing, 1687 at everyone (sound 543), bind 6 ticks under loc 34895 (shape 10, rotation 2) or the boots message, then the sprint to another node at 2 a tick | 4 |

- **Projectiles** (map_projanim_v2, submission 3932): start cycle 39, heights 32 to 64,
angle 16 everywhere; ranged progress 48 with the end growing 10 a tile of travel
(captured 66-186, implemented as 76 + 10/tile), web progress 16 with the end growing 10
a tile (captured 51-116, implemented as 51 + 10/tile capped at 116), minion bolt
progress 48 with heights 120 to 120. The per-cast ends vary a little capture to capture,
so the fitted ends are estimates; the hit always lands from the end (30 cycles a tick),
which is what the fight uses. The web loc only ever appears under bound players - 269
webs in 3932 with boots on left no loc behind.
- **Heal:** an accurate hit heals 5 (melee) or 10 (ranged), even for 0 damage - misses
never do (Wiki's successful-hit rule). The heal shows gfx 1542 (captured 419 times on her
over 65 kills, while the player never touches a sang staff) plus the magenta splat;
"Sarachnis leeches some health as she damages you." only lands with damage (captured
10 times, matching its wording).
- **Spawns:** at 66% and 33% of 400 HP (Wiki, NR and ReasonPS; submission 3932 sampled
the waves a little lower, around half and a quarter - likely tick attribution against her
constant self-healing - so the Wiki wins), one 8714 + one 8715 per player in the room
on random walkable lair tiles, attacking that player; they die with her (8318 each).
A threshold is only consumed when its wave actually appears (crossing it with an empty
room keeps the wave), and a room left empty for a while resets to a fresh fight so the
next group is not met by stale minions plus full new waves.
Minion visuals come from `npc-combat-defs.json` (8147, 4410 with bolt 1682); their exact
attack sounds (543, and 227 with delay 116 for the bolt) are not wired.
- **Leaving ends the fight:** stepping out of the tomb breaks combat both ways (boss and
minions drop the leaver, the leaver drops them), and nothing out there re-aggros her.
- **Sprint:** 2 tiles a tick to one of four lair nodes - (1835, 9895), (1844, 9895),
(1835, 9904), (1844, 9904) base tiles - picked at random excluding the one she stands on
(10 sampled webs: always moves, 3-5 hops, destinations only ever these four; Wiki's
"short distance" is loose). The hops go out as bare teleports - no sequence, no spotanim,
no run mask anywhere in 3932 - with the 543 spider sound on most of them. No facing or
retaliation while sprinting; attacks pause until she arrives, about a tick later. Aranea
boots negate the bind only - she still relocates (captured with the boots message up).
- **Death:** 8318, drops and removal 7 ticks later ("Your Sarachnis kill count is: ..." on
that tick, generic Combat Achievements count), area sound 539 at every corpse plus synth
542 and 537, area 538 one tick later (captured per-NPC positions); respawn 16 ticks
later at (1840, 9900) (captured deltas, three cycles). She is simply present when the
player arrives - no spawn animation anywhere in the logs (respawns pop in with jump=true);
the world spawn wanders the tomb unaggroed (captured, radius 5).
- **Prayers:** melee next to her, ranged further out (Wiki); her melee reach is
edge-adjacent on the 5x5 body. She wanders the tomb unaggroed (captured, radius 5).
- **Loot:** the standard `sarachnis` table in `data/definitions/npc-drops.json`.

## Combat Achievements (cache names, rev 241)

- "Sarachnis Novice" (Easy): 10 kills. "Sarachnis Champion" (Medium): 25 kills. Both finish
from kill counts on their own. (ReasonPS's "Sarachnis Adept (1 kill)" and NR/ReasonPS
"Insect Repellent"/25-kc "Champion" naming do not match live.)
- "Newspaper Enthusiast" (Medium): kill with a crush weapon - every recorded hit melee
crush (`Fights.onKill`, cf. KBD Hide Penetration).
- "Ready to Pounce" (Hard): no two ranged attacks in a row - tracked on the NPC (the web
breaks the sequence), judged for the whole room, since one player's double-ranged ruins
everyone's.
- "Inspect Repellent" (Hard): she deals no damage to anyone - tracked on the NPC (boss
hits only, not minions).

## Not built

- The exact per-cast projectile ends (they vary ±10 cycles capture to capture); the fitted
distance formulae reproduce the typical values and the landing ticks.
- The non-boots slash anim/message wording and the N-adventurer peek wording (Wiki-based
and inferred; no capture exists - all three logs wear Aranea boots).
- The Enter-crypt question and instance fee messages (inferred; Wiki-based amounts).
- Minion attack sounds (captured ids documented above, engine defaults play instead).
- Drops lasting longer in instances (Wiki) and the egg-sac examine.
