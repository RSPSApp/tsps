# Araxxor

Araxxor in the Morytania spider lair, built from the [OSRS Wiki](https://oldschool.runescape.wiki/w/Araxxor) and checked against live rsprox captures (<https://rsprox.net/database>, recordings 1077-1095 on rev 237 and 1442, 1445 and 1508 on rev 224; Leagues worlds left out). The plugin is `server/plugins/bosses/Araxxor.plugin.js`, with one unit per part of the fight in `server/plugins/bosses/araxxor/`.

| File | What it owns |
| --- | --- |
| `Shared.Araxxor.js` | Ids, tiles, captured projectile shapes and sounds, pure helpers. |
| `Area.Araxxor.js` | The per-player instance and the encounter's spawn. |
| `Combat.Araxxor.js` | Standard attacks, the enrage and the cleave, prayer caps and drains. |
| `Specials.Araxxor.js` | The three specials and the per-tick engine: ball, drips, pools. |
| `Minions.Araxxor.js` | Eggs, hatching and the three araxytes. |
| `Corpse.Araxxor.js` | Death, kill count, Harvest and Destroy. |

Ticks below count from the action named; the captured gamevals are in brackets.

## Spawn

- **Timing:** the lair is empty when the player arrives. The tunnel (54161) shows "You crawl through the webbed tunnel." in a message box with a fade, and puts them at (3647, 9815). The boss and eggs appear exactly five ticks after that box closes (busy 1 to 0) in every capture: 7-8 ticks after arrival when the box is left to close itself, later when it is held open. Here the tunnel is an agility crawl with no message box, so the timer starts when the crawl releases the player (or a dialogue closes).
- **Boss:** (3631, 9814), animation 11482 (`npc_araxxor_01_spawn_01`), in every captured spawn. No options for two ticks, then Attack. The first attack comes 6 ticks after the spawn.
- **Eggs:** spawn with the boss and play 11506 (`egg_araxyte_spawn_01`). They are 2x2, and a tick later each gets an invisible blocking loc 47348 (`invisible_type8_blocking_size2`). Their south-west tiles in hatch order (south-east first, then clockwise) are (3643, 9805), (3637, 9802), (3630, 9803), (3625, 9806), (3620, 9813), (3621, 9822), (3629, 9827), (3637, 9827), (3644, 9823). The colours follow one of three fixed patterns, and the first egg picks the special.

## Attacks

| Attack | Animation | Projectile | Sound | Hit lands |
| --- | --- | --- | --- | --- |
| Melee | 11480 | none | 9413, delay 40 | +1 |
| Ranged | 11493 (`acid_cannon_01`) | 2360, cycles 30-120, height 296 to 50, angle 35, progress 0 | 9470, delay 120 | +4 |
| Magic | 11479 | 1622, cycles 30-120, height 69 to 50, angle 35, progress 62 | 9479, delay 120 | +4 |
| Cleave (enraged) | 11487 + "Skree!" | none | none | +2 (mostly) |

- **Cadence:** every 6 ticks, 4 once enraged. Every 7th attack is the special.
- **Ranged and magic:** these projectiles have a fixed 120-cycle end whatever the distance, so they always land four ticks later.
- **Enrage at 25%:** 11488, then two ticks later 11489 with the body change (model 54288 in slot 0, 54290 in slot 1). No sound packet goes with either; the screech is in the animations. The first cleave comes about 5 ticks after the enrage starts.
- **Cleave pools:** three acid pools land two ticks after the swing, in a line *across* the blow. A player west or east of her gets a north-south line, a player north or south an east-west one.

## Specials

- **Acid ball (Acidic first):**
  - **Throw:** 11476 (`attack_ranged_01`, delay 30) and sound 9488.
  - **Landing:** two ticks later the 3x3 ball NPC 13676 appears, centred on the tile the player stood on at the cast. A player under it takes 14-18 venom the next tick, even after running out.
  - **Rolling:** from then on it jumps two tiles a tick (teleport steps, 11491) away from Araxxor's middle, pooling its middle and the tile behind it each tick. There's no range cap: it goes until the next step is blocked.
  - **Burst:** that tick it throws six blobs within two tiles (projectile 2924, height 254, angle 35, progress 0, end 100-110), bursts (11492) the tick after, and is removed the tick after that.
- **Acid spray (Mirrorback first):**
  - **Cast:** 11478 and nine blobs (projectile 2924, height 170 to 0, angle 35, progress 200) onto tiles around the player.
  - **Landing:** each blob's end is 100 + 10 per tile from her middle (130-160), so the pools appear 5-6 ticks after the cast, each on its own tick. The splash graphic 2923 and sound 4135 (radius 2) are sent with the cast, delayed to the arrival.
- **Acid leak (Ruptura first):**
  - **Cast:** 11477 and one blob (2924, cycles 30-120, height 170 to 30) at the player.
  - **Landing:** four ticks later comes "<col=ff3045>Araxxor covers you in venom. It slowly drips off you and covers the floor." The player then shows graphic 1626 (`araxxor_venom_drip`, slot 2) for seven ticks.
  - **Trail:** from the tick after landing, every tile they stood on or ran through on the tick before gets a pool.
- **Pools:** loc 54148 (`araxxor_acidpool`, shape 10). Standing in one deals a flat 4-5 venom (hitsplat 5) every tick. Captured runs of 16 ticks never ramp. Pools stay until the fight ends, when they are replaced by the non-blocking invisible loc 29733.

## Eggs and araxytes

- **Hatching:** after the 3rd standard attack, then every 6th. The hatch comes 3 ticks after the attack that triggers it. Animation 11503 (`npc_araxyte02_hatch`) with graphic 2929 (Mirrorback), 2928 (Ruptura) or 2927 (Acidic); the egg's blocking loc becomes 29733. The araxyte faces the player 3 ticks later and starts walking at 5.
- **Mirrorback:**
  - **Attack:** melee 11500, every 6 ticks.
  - **Damage share:** while it lives it takes a fifth of the damage dealt to Araxxor (captured pairs: 9+2, 16+3, 16+4, 17+4).
  - **Death:** 11510 (`npc_araxyte_mirror_back_death`) the tick after it reaches 0, gone two ticks later.
- **Ruptura:**
  - **Explosion:** walks to the player and explodes with 11504 (`npc_araxyte_explode`) and graphic 2925 (`araxyte_explosive_spider_explosion`).
  - **Damage:** two ticks later Araxxor takes damage by distance (80 and 48 captured; the Wiki's 80/64/48/33). It's removed two ticks after that.
- **Acidic:**
  - **Attack:** ranged 11498 with projectile 1560 (cycles 39 to 39 + 10 per tile, height 32 to 64, angle 16, progress 40) and sound 9378 (delay 25, radius 5) on the player's tile, every 6 ticks.
  - **Death:** 11504 with graphic 2926 and 13 blobs (2924, height 140, angle 35, progress 20, end 90 + 10 per tile) within four tiles, which pool 4-5 ticks later.

## Death and the corpse

- **Death animation:** 11481. The eggs crumble (11508) the next tick and go two ticks later.
- **Corpse:** five ticks into the death she turns into the corpse 13669 (Harvest, Destroy).
- **Kill messages:** on the same tick come "Your Araxxor kill count is: <col=ff0000>N</col>." (varp 4260, `total_araxxor_kills`) and "Fight duration: <col=ff0000>m:ss.cc</col>. Personal best: m:ss.cc". The duration runs from the spawn to three ticks into the death.
- **Harvest:** the player plays 2282 on the click. The loot comes two ticks later, the corpse sinks (11486) the tick after, and it goes two ticks after that.

## Combat Achievements

`CombatAchievements.Araxxor.js` decides all twelve of her tasks. The kill count is Combat Achievements' own. Each kill is reported with `combat-achievements:kill`, and its `announce(total)` sends the kill-count and fight-duration messages before any task message, which is live's order (rsprox recording 91: kill count, duration, then tasks). The boss page's varp 4260 and the kill message therefore always agree. The plugin keeps its own count as well (`araxxor:kills`), answers `combat-achievements:kill-count` at login, and answers the personal best and its reset.

| Task | How it is decided |
| --- | --- |
| Araxxor Veteran, Master (25, 75) | The kill count. |
| Speed-Trialist, -Chaser, -Runner (4, 5, 6 kills in 10:00) | The last N kills of one stay in the lair, from the first of them spawning to the last dying. |
| Perfect Araxxor | No damage from her ranged or magic, from her melee or cleave while not praying Protect from Melee, from any araxyte (attacks, Ruptura explosions, the Mirrorback's reflection, the share of damage it reflects) or from acid (pools, blobs, the ball). |
| Perfect Araxxor 2 | Perfect Araxxor, and no hit on her while she is enraged. |
| Relaxxor | Six eggs killed before they hatch, in the fight. Eggs she tries to hatch while overdamaged don't count (Wiki strategy). |
| Let it seep in | The poison/venom immunity timer (antipoison, antivenom, serpentine helm) never running during the fight. |
| Araxyte Betrayal | One Ruptura explosion killing three other hatched araxytes. |
| Arachnid Lover | Ten kills in one stay. |
| Swimming in Venom | Her tile never changing from spawn to death. |

Where the task text is open (how the speed tasks are timed, whether Betrayal needs one explosion), these are our readings; the Wiki doesn't say.

## Not captured yet

- **Destroy:** the clue roll and the corpse's timing after Destroy.
- **Ruptura player damage:** how much the explosion deals to the player (the Wiki's 70/49/28/7 is used).
