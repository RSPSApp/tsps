# Skotizo

Skotizo beneath the Catacombs of Kourend, built from the [OSRS Wiki](https://oldschool.runescape.wiki/w/Skotizo) and checked against live rsprox captures (<https://rsprox.net/database>, recordings 3323 and 3329, rev 235). Both are event worlds (Leagues V, Grid Master) and no main-game fight was captured. Their kills last under a minute, so no altar ever wakes in them. The plugin is `server/plugins/bosses/Skotizo.plugin.js`, its data `server/plugins/bosses/data/skotizo.json`, and one unit per part in `server/plugins/bosses/skotizo/`.

| File | What it owns |
| --- | --- |
| `Common.Skotizo.js` | The data, tick timing, the fade, the lair's track, saved attributes. |
| `Totems.Skotizo.js` | Joining the totem, totem pieces and shards from the Catacombs, Skotizo's totem table. |
| `Lair.Skotizo.js` | The per-player instance, entering from the altar, the exit portals, login recovery. |
| `Fight.Skotizo.js` | His attacks, the awakened altars and the HUD, the spawns and the dark ankou. |
| `Kills.Skotizo.js` | The death: kill count, the altars and HUD, his helpers. |
| `CombatAchievements.Skotizo.js` | The kill count for Combat Achievements and his fight's tasks. |
| `Commands.Skotizo.js` | `::skotizo`, `::skotizohp <hp>`, `::skotizoaltars [count]` (developer). |

Ticks below count from the action named. Captured gamevals are in brackets.

## The dark totem

- **Joining:** any two pieces used together, with the third in the pack, make a dark totem. Captured: sound 3316 and the item box "You bring the totem pieces together with a click. It looks kind of like an arcane key and pulses with dark power in your hand.".
- **Pieces and shards (Wiki):** every monster but ghosts in the Catacombs (x 1600-1791, y 9984-10111) and the Giants' Den drops a totem piece 1 time in (500 - hitpoints). A superior Slayer monster always drops one (asked through `slayer:is-superior`). They also drop an ancient shard 3 times in 2 x (500 - min(hitpoints, 400)).
- **Which piece:** the one the player has fewest of in their pack and bank, base, middle, top on a tie. The Wiki gives this rule for Skotizo's drop; the totem page's "dropped in that order" gives the same pieces for the Catacombs.
- **How:** NpcDrops now emits `npc-drops:add` { player, npc, npcId, drops } straight after the roll, before `npc-drops:roll`. Listeners of the latter (the Collection Log, Ironman) therefore see these drops too.

## Entering (use the totem on the altar)

The altar is `cata_altar` (28900) in the centre of the Catacombs.

| Tick | Captured |
| --- | --- |
| +0 | The altar plays 1477 (`atar_spawn_and_die`); the player faces it. |
| +1 | 3865 (`arceuus_necromancy_anim`), spotanim 1296 (`arceuus_teleport_spotanim`), area sound 200. |
| +3 | Fade out. |
| +6 | The totem is gone; the player is in their copy of map square 9048 (8x8 chunks, planes 0 and 1, unturned). |
| +7 | Fade in; track 472 "Darkly Altared" (unlocked with "You have unlocked a new music track"). |
| +9 | The fade closes; the altar HUD (308) opens on the HUD overlay, with script 1313 `[0, 0, 0, 0]`. |

- **Spawn tiles:** the player and Skotizo land on random tiles: five different player tiles and five boss tiles across the captures. Here both are random open tiles of the arena.
- **Other spawns:** the four sleeping altars spawn as NPCs (`cata_boss_altar_closed_*`), each in a loc 28924 (`cata_boss_altar_closed`, shape 10).
- **Leaving:** the four corner portals (28925, `cata_boss_exit_portal`, "Use") lead back to the Catacombs (Wiki). This wasn't captured, so the fade and the tile beside the altar (1662, 10049) are ours. Teleporting, dying or logging out also ends the lair. A player saved inside comes back beside the altar.

## The fight

| Attack | Animation | Projectile | Sound | Hit lands |
| --- | --- | --- | --- | --- |
| Stab (in reach) | 4680 (`demon_update_attack_lesser`) | none | 521, delay 20 | +0 |
| Hellfire burst | 69 (`demon_casting`) | 1242 (`hh_hellfire_burst`), from cycle 30, height 300 to 124, angle 16, progress 226 | area 3006 at the cast, 3007 at the impact | floor(end cycle / 30) |

- **Cadence:** 6 ticks between attacks in all three captured gaps.
- **Magic:** the impact spotanim 1243 (`hh_hellfire_hit`) is sent at the cast, delayed to the projectile's end. The captured end cycles were 70-130. Here the end is 30 + 10 per tile, at least 70: an estimate, as the captures' players were running. The hit landed at floor(end / 30) ticks in all four captures.
- **Choosing an attack:** the Wiki says he prefers melee in reach and doesn't step in to use it. Here, in reach he stabs 3 times in 4; otherwise he casts. The 3-in-4 is an estimate.
- **Block:** 4676 (`demon_update_defend`).

## Awakened altars (Wiki)

| Side | Sleeping NPC / awake NPC | Tile here | Captured tile (rev 235) |
| --- | --- | --- | --- |
| West | 7295 / 7294 | (2256, 5664) | (2254, 5664) |
| East | 7291 / 7290 | (2288, 5664) | (2290, 5664) |
| South | 7293 / 7292 | (2272, 5649) | (2272, 5647) |
| North | 7289 / 7288 | (2270, 5678) | (2270, 5680) |

- **Tiles:** the 22 July 2026 update made the arena smaller, and in our rev 241 cache the walkable floor is x 2257-2287, y 5650-5677. The captured tiles are now inside the walls, so each altar here sits one tile outside its wall's walkable edge. **Estimate**: a capture from rev 238+ would settle it.
- **Timers:** each altar picks 50-129 ticks at the start, and again each time its timer runs out. When the timer runs out it wakes if it is asleep and off its one-minute cooldown.
- **Waking:** the NPC turns into the awake one (100 hitpoints, attackable) and the loc into 28923 (`cata_boss_altar_open`). Neither change was captured.
- **Damage on Skotizo:** each awake altar takes 25% off, up to 100%. With Arclight or Emberlight it is 15% each, up to 60%, and one hit from either puts an altar to sleep. An altar hit to nothing goes back to sleep and starts its cooldown.
- **How the share comes off:** it comes off the max hit, before the roll. The engine caps a roll at the target's hitpoints, so scaling the capped hit afterwards would leave Skotizo nearly unkillable at low hitpoints (8 hitpoints with three altars awake: 2 at most). A roll is uniform from 0 to the max, so scaling the max is the same as scaling the hit.
- **The altars themselves:** they never retaliate or step off their tile. A sleeping one can't be attacked, and goes back to full hitpoints.
- **HUD:** script 1313 takes the four in the order west, east, south, north (the icons' positions in interface 308), 1 for awake (sprite 74) and 0 for asleep (sprite 24).

## Helpers

- **Reanimated demon spawns:** at 150 hitpoints or below (two thirds gone, Wiki), at his attack turn, he chants "Gar mulno ful taglo!" instead of attacking.
  - **Spawning:** three spawns (7287) rise within 9 tiles of the player. Each gets a `smokepuff_large` (188) graphic and area sound 1930, as captured.
  - **Chanting again:** once all three are dead, each attack turn has a 1 in 4 chance of another chant. That chance is an estimate.
  - **Combat:** attack 64, block 65, death 67 and sound 403, removed 5 ticks after death (captured).
- **Dark ankou (Wiki):** while an altar is awake, a timer brings one dark ankou (7296), only one at a time. The Wiki only says the timer is random, so the 25-75 ticks here are an estimate. The ankou attacks the player at once; the Wiki's wandering when it spawns out of reach isn't modelled.
- **After the kill:** spawns and an ankou still standing go 5 ticks after Skotizo dies (Wiki: about 3 seconds).

## The kill

| Tick | Captured |
| --- | --- |
| +0 (the killing hit) | 4624 (`qip_ds_delrith_banished`) and sound 403; "Your Skotizo kill count is: N." (varp 1527 `total_cata_boss_kills`); script 1313 `[0, 0, 0, 0]` and the HUD closes. |
| +15 | The loot on his south-west tile, and he is gone (`deathTicks` 15 in npc-combat-defs). |

- **Kill count:** counted through `combat-achievements:kill` (Skotizo is in `countedByEvent`), so the message comes before any task.
- **Tasks:** Skotizo Champion and Skotizo Adept come from the count. Demonic Weakening, Demonbane Weaponry, Up for the Challenge, Demon Evasion and Precise Positioning are judged from the fight.
- **Slayer:** Skotizo counts for black-demon and greater-demon assignments; his lair counts as the Catacombs for Konar's location-specific tasks ([Wiki](https://oldschool.runescape.wiki/w/Skotizo)).
- **Loot (Wiki):** NpcDrops `correctSkotizo` fixes the export. The shard table (75/15/5/4/1 in 100) is one guaranteed roll on top of a main table out of 100; the export had both in one roll out of 199. The totem table (4/128: a whole totem 1 in 4, otherwise the piece the player lacks) moves to the plugin, in place of the four flat tertiaries.

## Not built

- **Shard teleports:** the altar's Teleport option ("Where do you want to go? (1 shard)": Demons' Run, Dragons' Den, Reeking Cove, The Shallows). The menu and the "You need at least 1 ancient shard..." message are captured, but the destinations aren't.
- **Darklight to Arclight, fewer than three shards:** the altar asks and combines as captured (rsprox 3333), and shards used on Darklight away from it are refused in the captured box. What it says at the altar with fewer than three shards isn't captured; `plugins/items/Arclight.plugin.js` keeps its own wording. The mesbox chat line uses type 115, as other plugins do; the capture only says `mesbox`.
