# Royal Titans

Branda the Fire Queen and Eldric the Ice King in the Asgarnian Ice Dungeon.

**Status: implemented and playtested.** All units in `server/plugins/bosses/royaltitans/` + teleports entry; unit tests 18/18 (`server/tests/royal-titans.test.cjs`). Live-verified via agent MCP (solo + duo to full kills, all three claim paths, respawn, grave, scoreboard opens, exit, logout/login): see Testing. Open assumptions are listed at the end, each with how to confirm it; visually unconfirmed (needs a manual look): boss-HUD bar rendering (values verified on the wire), scoreboard text values, blast/safe-tile visuals.

## Sources and honesty labels

Every claim below carries one label:

| Label | Meaning |
| --- | --- |
| [WIKI] | The OSRS Wiki (Royal Titans, Branda the Fire Queen, Eldric the Ice King, Fire/Ice elemental pages; fetched Oct 2026). |
| [LOG] | rsprox captures (https://rsprox.net/database), revs 223-237. Only three recordings hold arena fights: 228/02283 (solo, 5:20 kill), 235/03398 and 235/03402 (solo, longer); the entrance Join prompt is in 235/03402. The rest are entrance/scoreboard clicks, pets and unrelated activity. Ticks are recording ticks. |
| [EST] | Our reasoned assumption where neither source speaks. Each one says what would confirm it. |
| [CACHE] | Verifiable from the game cache (`dump_ops.ts`, `dump-loc`, identifiers). Not yet run. |

There is no third titan: both the Wiki and every capture show the duo only [WIKI] [LOG].

The plugin will be `server/plugins/bosses/RoyalTitans.plugin.js`, with one unit per part of
the fight in `server/plugins/bosses/royaltitans/`.

| File | What it owns |
| --- | --- |
| `Shared.RoyalTitans.js` | Ids, tiles, captured anim/projectile/sound shapes, pure helpers. |
| `Area.RoyalTitans.js` | Instance, entry/exit/scoreboard/shortcut, join rules, teleport landing, logout/death handling. |
| `Combat.RoyalTitans.js` | Melee stomps, cadence, accuracy/defence rules. |
| `Specials.RoyalTitans.js` | Rows, elementals, teleport, arena-wide blast. |
| `Minions.RoyalTitans.js` | Fire/ice elementals: spawn, attacks, fuse/explode, death. |
| `Corpse.RoyalTitans.js` | Deaths, kill count, Loot / Sacrifice / Take pages, contribution. |
| `Hud.RoyalTitans.js` | Boss HUD switching between the two titans. |
| `CombatAchievements.RoyalTitans.js` | All eleven tasks, kill-count/PB plumbing. |
| `Commands.RoyalTitans.js` | Developer commands for testing (proposal, see Testing). |

## Stats [WIKI]

Both titans share one stat block (NPC ids `12596` Branda, `14147` Eldric):

- Combat 350, size 3x3, **600 HP**. The 35% teleport threshold is ~210 HP; the no-join rule is 25% damage = 450 HP remaining (changelog: lowered from 510 to 450).
- Attack speed **7 ticks**, crush, aggressive. Max hit **26 melee**, **12 wall**.
- Melee defence +12/+12/+0; magic +700 with a **50% elemental weakness** (Branda: water/ice, Eldric: fire); implemented as +50% spell damage for the weak element (x2 + max-hit on elementals, so one Wave kills) **and +50% magic accuracy on the titans** (maxed mages were splashing every other cast without it). Ranged +700/+700/+700, but the player's **ranged accuracy is x6 while a titan is out of melee distance**, until it walks back; the boost also holds for the whole Elemental Blast charge and attack.
- Immune poison, venom, cannon, freeze. **Burn works.**
- No block animation: hits never flinch them (captured; `block: -1` in `npc-combat-defs.json`, same as Yama/Doom/Araxxor). Minions neither.
- No healing: HP never regenerates (wander radius + per-tick attack-timer suppression).
- Slayer Fire/Ice Giants categories, 735 xp each. Respawn 30 ticks (18 s).

Elementals (NPC ids `14150` fire, `14151` ice) [WIKI]: combat 37, size 1x1, **40 HP**, max **4** melee (slash fire / stab ice), speed **4 ticks**, aggressive, 100% elemental weakness (fire↔water spells, ice↔fire spells). Spell hit chance = magic accuracy bonus + 30 (min 30%); void mage set x1.45; Wind Strike always hits. One Fire/Water Wave kills (75 Magic for the water-wave max). Not immune to poison/venom/cannon/thralls.

All four combat NPCs already have matching entries in `server/data/definitions/monsters-complete.json` (600 HP, speed 7, max 26, 50% weakness types; elementals 40 HP, max 4, 100%) — no data work needed there. The ranged-x6 rule and the elemental spell-accuracy formula are plugin mechanics (`Combat`/`Minions` units). Slayer categories (fire/ice giants) and the collection log are likewise data/cache-driven — no per-boss wiring.

## Instance, entry, exit [LOG] [WIKI]

- **Instanced** [LOG]: live builds a dynamic region from base (2880-2952, 9536+) to (15680+, 2560+); we copy the same authored map instead — a `TemplatedInstanceArea` of 4x4 chunks (source chunk 362,1194, unturned), allocated a slot outside the real map (tile 8192+/1600+, 7x60 slots, 20-chunk stride, released when the instance empties). Each party gets its own drawn copy and its own collision/locs, the client is sent the REBUILD_REGION palette, and everything the fight spawns is area-scoped. Party 1-2 [WIKI]. A second player can join a solo fight only while the titans are still fresh (see Assumptions).
  - The arena tiles are authored space (2896-2927 x 9552-9583); the instance lands them at `base + (tile - 2896, tile - 9552)` via `Shared.instanceTile`.
  - The exit loc (55987) is part of the copied chunks, so it exists per-instance; the entrance tunnel and scoreboard stay in the real world (2948/2954), outside the copy.
  - Both exit options route the click onto the player's own tile first, so they work from anywhere in the arena (the tunnel sits in the wall) instead of pathing to it.
- **Getting there** [WIKI]: western Asgarnian Ice Dungeon (fairy ring `AIQ`); giantsoul amulet teleports outside the entrance tunnel.
- **Entrance** [LOG]: loc `royal_titans_entrance` (55986) at (2948, 9573).
  - op1 **Enter**: chatmenu "Select an option": `Start a fight (Your friends will be able to join you).|Join a fight.|Do nothing.` (runclientscript 58). "Join a fight." asks for the name like op2.
  - op2 **Join** [LOG 235/03402]: name input (meslayer_mode8, script 109) "Whose fight would you like to join? You must be on their friends' list." The named player must be in a fight they started, have the joiner on their friends' list, have room (1-2 players) and still be joinable (Assumption 1); the replies to a name were never captured (Assumption 19).
  - op3 **Quick-start** [WIKI changelog]: skips the menu, never the warning, and always starts your own fresh fight.
  - Starting or joining shows messagebox 229: "You are about to begin an encounter with the Royal Titans. Dying during this encounter will not be considered a safe death. To leave, you'll need to use <col=ff0000>'Quick-escape'</col> via the tunnel", then the chatmenu "Are you sure you wish to proceed?" `Yes.|Yes, and don't ask again.|No.` [LOG 228/02283]. "Yes, and don't ask again." sets varbit `royal_titans_enter_warning` (16089), saved and sent at login (live sends it with the login varbits); with it set, both are skipped [EST: that the warning box goes too].
  - A join past the join point gets the messagebox "The fight with the Royal Titans is in a critical stage. You'll have to wait until the next fight begins." (see Assumptions). Starting your own fight is never refused.
- **Entry** [LOG 228/02283]: on Yes, the crawl (`human_longcrawl` 2796, sound 2454 x2 delay 4) and the fade out; +1 `minimap_state` (6719) 0→2; +3 the move to (2911, 9573) with Branda's spawn; +4 minimap 2→0, fade in, music "In the Pits" (midi 469); +6 the fade overlay closes. The minimap is only hidden during the fade, both ways.
- **Exit** [LOG]: loc `royal_titans_exit` (55987) at (2910, 9578), arena north wall.
  - op2 Quick-escape [LOG 228/02283]: fade out and HUD cleared, +1 minimap 0→2, +2 the move to **(2950, 9574)** (outside, by the entrance), +4 minimap 2→0 and fade in, +6 overlay closed.
  - op1 Inspect: "You should be able to escape from here."
  - Teleporting out nullifies incoming damage [WIKI changelog].
- **Death** [WIKI]: unsafe; gravestone outside the entrance, standard retrieval.
- **Scoreboard** [LOG]: loc `royal_titans_scoreboard` (56004) at (2954, 9577), op1 opens interface 909 as the main modal (161:16): title "Royal Titans Statistics"; `pkc` personal KC, `pd` personal deaths, `pbt` personal best, `gkc` global KC (58,395,586 seen), `gd` global deaths (967,404 seen), `gbt` global best (0:37.80 seen). Personal best is persisted per player (attribute) and also answers the CA `personal-best`/`reset-best` requests, Araxxor-style.

## ::teleports menu

- Add `Royal Titans` to the boss teleports in `server/plugins/interface/Teleports.plugin.js` (same `BOSS_TELEPORT_DESTINATIONS` + page pattern as Araxxor). The dialogue button id must be read from the cache (28151–28159 are taken) [CACHE].
- **Destination: (2950, 9574)** [LOG]: the exact tile live's own exit teleports to, so it is walkable and connected; the player walks south-west to the entrance (2948, 9573) and scoreboard (2954, 9577) from it. Never inside the arena: the fight is instanced and entered only through the entrance loc.
- No pending-instance attribute needed (entry is via the entrance loc, like Araxxor) [EST, follows the Araxxor precedent in the same file].

## Agility shortcut [LOG] [WIKI]

- `cavewall_shortcut_royal_titans_east` (55988) at (2990, 9546), op1; west end `cavewall_shortcut_royal_titans_west` (55989) at (2968, 9549) [LOG] [CACHE for op names].
- Captured run: click east → walk to (2991, 9547) → 5 ticks later teleport to (2969, 9551), then walk on [LOG]. No anim, no message in the captures. Requirement 60 Agility [WIKI].
- Already in `server/plugins/skills/data/agility-shortcuts.json` as "Tunnel (Asgarnian Ice Dungeon, level 60)" (objects 55988/55989, ends [2992,9547]→[2969,9551], note `rsprox captures 362, 2283`): crawl + messages from recording 362, matching our landing. No data work.

## Options observed (op numbers [LOG], names [CACHE]/[WIKI])

| NPC / loc | op1 | op2 | op3 | op4 |
| --- | --- | --- | --- | --- |
| Live titans (12596/14147) | Examine? [CACHE] | Attack | — | — |
| Elementals (14150/14151) | ? [CACHE] | Attack (seen) | — | — |
| Row hitboxes (14152/14153) | Douse / Melt → hint, no effect (live names seen) | — (spells clear via cast-on-NPC) | — | — |
| Corpses (14148/14149) | Loot | — (absent, cache dump confirms) | Sacrifice | Take pages |
| Entrance (55986, "Tunnel") | Enter (menu) | Join (name input) | Quick-start (direct) | — |
| Exit (55987, "Tunnel") | Inspect → hint, always | Quick-escape → leave to (2950, 9574) | — | — |
| Shortcut (55988/55989) | Traverse (already wired) | — | — | — |
| Scoreboard (56004, "Scoreboard") | Read → interface 909 | — | — | — |

Corpse opnames [WIKI infoboxes] and order [CACHE dump]; live ops verified in testing; entrance/exit/scoreboard names [LOG, live-observed]. Live-titan op1 and minion op1 still [CACHE].

## Boss HUD [LOG]

After a kill the HUD clears (varp 1683 → -1, `cc_deleteall` on the container). The client's open script (2376 → 2377) remembers the npc it opened on (varc 1259) and only rebuilds the bar for that npc, so the HUD reopens on the titan it was last opened on and switches after.

The HUD follows the player's engagement, switching between the titans: varp 1683 `hpbar_hud_npc` = 14147 → 12596 → -1 → 14147 … as the player changes target, with `hp_hud_open` (2376) each switch; current/max via the standard varbits (see `docs/boss-hud.md`). Reuse the `BossHud` plugin events (`boss-hud:show/update/hide/reset`) from `Hud.RoyalTitans.js`; exit clears it (hide + container empty, captured). Minions and rows never show it.

## Cache elements used

Every id below is captured live on revs 223-235 [LOG]. The server cache is newer (rev 241 per `dump_ops.ts`); ids are assumed stable — spot-check each kind at implementation with the dump scripts (`server/scripts/dump-seq.ts`, `dump-spotanim.ts`, `dump-loc.ts`, `dump-widget.ts`, osrs-captures `dump_ops.ts`; AGENTS.md rule 9). Per AGENTS.md rule 4, hooks use these **names**, numeric ids only in named constants.

### NPCs

| Id | Gameval | Role |
| --- | --- | --- |
| 12596 | `rt_fire_queen` | Branda, live |
| 14147 | `rt_ice_king` | Eldric, live |
| 14148 | `rt_fire_queen_inactive` | Branda, corpse |
| 14149 | `rt_ice_king_inactive` | Eldric, corpse |
| 14150 | `rt_summon_elemental_fire` | Fire elemental |
| 14151 | `rt_summon_elemental_ice` | Ice elemental |
| 14152 | `rs_loc_attack_fire_hitbox` | Fire row tiles (5 per row) |
| 14153 | `rs_loc_attack_ice_hitbox` | Ice row tiles (5 per row) |
| 12593 | `rtbranda_pet` | Branda pet variant [CACHE: ops/size] |
| 12595 | `rteldric_pet` | Eldric pet variant [CACHE: ops/size] |

Bran (boss pet) id [CACHE — never appeared in captures]. Sizes: titans 3x3, elementals/rows 1x1 [WIKI/LOG].

### Locs (objects)

| Id | Gameval | Role |
| --- | --- | --- |
| 55986 | `royal_titans_entrance` | Tunnel entrance, (2948, 9573) |
| 55987 | `royal_titans_exit` | Arena exit, (2910, 9578) |
| 55988/55989 | `cavewall_shortcut_royal_titans_east/west` | Agility shortcut |
| 55993/55994 | `fire_giant_branda_queen_spawn01_floor01/02` | Branda static/teleport floors |
| 55997/55998 | `ice_giant_eldric_king_spawn01_floor01/02` | Eldric static/teleport floors |
| 55995/55996 | `loc_fire_giant_branda_queen_death01_floor01/02` (seq names 11993/11994) | Branda death floors |
| 55999/56000 | `loc_ice_giant_eldric_king_death01_floor01/02` (seq names 11988/11989) | Eldric death floors |
| 56001 | `vfx_branda_queen_loc01_idle01` | Fire row tile vfx (shape 10) |
| 56002 | `vfx_eldric_king_loc01_idle01` | Ice row tile vfx (shape 10) |
| 56003 | `vfx_giant_attack_aoe_protection01` | Blast safe tile (shape 22) |
| 56004 | `royal_titans_scoreboard` | Scoreboard, (2954, 9577) |
| 26209 | `invisible_type8_blocking` | Under static titans |
| 29733 | `invisible_type8_nonblocking` | Cleared row tiles, teardown |

Fire-side loc gamevals inferred from the Eldric-side names + seq table [CACHE to confirm].

### Seqs (animations 11945-12015, full table captured [LOG])

Titans — spawn 11966/11963, idle 11970/11969, walk 11972/11971, melee 11974/11973, summon01 (rows) 11976/11975, summon02 (minions) 11978/11977, aoe01 (charge) 11981/11979, aoe02 (fire) 11982/11980, teleport 11984/11983, inactive01/02 11990-11991/11985-11986, death 11992/11987. Minions — idle/walk/attack 11945-11947 (fire) / 11948-11950 (ice), spawn 11956/11954, death 11957/11951, explode 11961/11959 (+ their spotanim seqs 11952-11955/11958/11960/11962). VFX loc seqs 11995-12015 (spawn/teleport/aoe/despawn/idle, melee01_proj01 12012, aoe locs 12013/12014, protection 12015).

### Spotanims (graphics)

On-NPC (slot 2) — only Branda's exist in the captures; Eldric casts with **no** slot-2 graphic (absent from packets across both fights, and no ice-side names in the captured seq table either): summon01 3212, summon02 3213, aoe01 3214, aoe02 3215, teleport 3216, spawn 3217, death 3224 [LOG absence — confirm [CACHE]]. Minion spawns 3204/3202, deaths 3205/3203 (death = on-NPC spot), explodes as map anims 3207/3206.

Map anims (tiles) — row spawn rows 3218/3221, teleport grids 3219/3222, row despawns 3220/3223, Eldric melee telegraph 3211 (Branda's stomp has **no** telegraph tiles in either fight [LOG]), blast grids fire 3209 / ice 3210, explode spots 3207/3206. Player spells: surge casts 1464/1458, travels 1465/1459 (`map_projanim`), impacts 1466/1460; miss graphic 85 `failedspell_impact`; Fire Wave works too (impact 157 seen once [LOG]).

### Sounds (area sounds with tile + delay [LOG])

Captured [LOG 02283, 03398, 03402]. Area sounds, per row tile at range 1: fire rows (Branda) 10147 (delay 5) + 10148 (delay 120) as they appear and 10146 as a tile clears or runs out; ice rows (Eldric) 10116 (delay 5) + 10118 (delay 122), 10119 (delay 4) as a spell clears a tile, 10117 (delay 4) as the row runs out. Elementals: 10190 (fire) / 10172 (ice) on each one's tile at range 5 as it stands up; an exploding elemental 10042/10041/10039/10038 (delays 6/18/27/40, range 10). Player sounds: 10139 whenever a titan takes a hit, 10155 three times (delays 28/88/148) with the blast's aoe02, and as a claim's loot lands 10102 (Branda's corpse) or 10108 (Eldric's). No sound with the stomp or the teleport (227/1460/4029/4031 are the player's own spell sounds).

### Interfaces, varps/varbits, music, maps, items

- Interfaces: 909 scoreboard (components :2 close, :6 title, :9 pkc, :11 pd, :13 pbt, :15 gkc, :17 gd, :19 gbt) opened as mainmodal 161:16; 229 messagebox; 219 chatmenu (script 58 options); 174 fade_overlay (script 948); 303 boss HUD [LOG].
- Varps/varbits: 4648 `total_royal_titan_kills`, 16089 `royal_titans_enter_warning`, 1683 `hpbar_hud_npc` (+6099/6100, boss-hud doc), 6719 `minimap_state`, 4605 `multiway_indicator`, CA system bits (existing) [LOG].
- Music: 469 "In the Pits" on entry [LOG].
- Map squares for the instance base: 11669/11670/11925/11926 (keys in the build) [LOG].
- Items: all drops exist in `npc-drops.json` incl. desiccated pages (30640), crowns (30631…); surge/wave runes are existing content. Giantsoul amulet item + pet `Bran` need no new ids (existing/standard systems) unless the cache lacks them [CACHE].

## Placement

Approximate arena layout, north up [LOG roam/row tiles; bounds EST]:

```
y=9578  exit (2910,9578)
y=9573  player lands (2911,9573) ── arena north edge
y=9571  Branda static (2910,9571)      rows span x=2909-2913 (y varies)
y=9567  mid (safe tile e.g. 2912,9567)
y=9561  Eldric static (2910,9561)
```

- **Spawn** [LOG]: Branda (2906, 9566) facing east, `fire_giant_branda_queen_spawn01` (11966); one tick later Eldric (2914, 9566) facing west, `ice_giant_eldric_king_spawn01` (11963). First player-attackable ~2 ticks later (see Assumptions on duration).
- **Roam** [LOG 02283, 03398, 03402]: before the teleport each titan keeps to its own side of the 5-wide lane (x 2909-2913) and never enters it. It attacks from one of two spots: its **lane edge** (SW x 2906 Branda / 2914 Eldric) or the **back** (2904 / 2916), any y 9561-9571; x 2905/2915 is only walked through. After a stomp at the edge it stays (83%); otherwise, 9 ticks after the attack, it walks a tile a tick 2-6 tiles: from the edge back out, from the back up to the edge (45%) or along the back. It attacks 2 ticks after arriving. Coming up to the edge it calls out a flavour line as it sets off ("You can't escape me!", "Here I come!", ...); 96 of 105 mobile shouts are at the back. It never faces the player (face angles): mobile, straight across the lane (Branda 1536 east, Eldric 512 west); static, toward the arena (Branda 0 south, Eldric 1024 north); corpses the same as static.
- **Static (post-teleport)** [LOG]: Branda (2910, 9571), Eldric (2910, 9561), floor locs 55993/55994 and 55997/55998 plus `invisible_type8_blocking` (26209) under them.
- **Corpses** [LOG]: a dying titan plays `..._inactive01` (Branda 11990, Eldric 11985) and becomes `rt_fire_queen_inactive` (14148) / `rt_ice_king_inactive` (14149) where it stands, mobile or static, and stays there until the claim schedule's death anims (both corpses visible). Death floors 55995/55996 and 55999/56000 come with the death anims.
- **Rows** [LOG]: always x=2909-2913; y varies per cast with no player correlation over 27 sampled casts (e.g. row 9570 while the player stands at 9567; 9562 while at 9569). Implemented as a random y band in 9562-9572 [EST — verify live whether uniform].
- **Safe tile** [LOG 03398, 03402]: `vfx_giant_attack_aoe_protection01` (56003, shape 22). Both titans fighting: any tile of the blast area (x 2909-2913, y 9564-9570; 18 different tiles captured). One left: the row farthest from it, random x (Branda alone: y 9564; Eldric alone: y 9570). Examine: "This looks like a safe spot." [WIKI trivia].

## Attacks (mobile phases) [LOG] [WIKI]

- **Cadence and movement** [LOG]: 7 ticks after a stomp, 10 + walk steps (12-16) after a walk. The choice follows the spot over 273 mobile attacks: lane edge 82% stomp / 15% rows / 3% elementals; back 75% rows / 25% elementals, never a stomp. A titan never summons while its own elementals are alive (0 of 69 captured summons).
- **Melee stomp** (`..._attack_melee01`: Branda 11974, Eldric 11973): graphic 3211 (`vfx_ice_giant_eldric_king_melee01_proj01`, either caster) over the whole lane width (x 2909-2913) on the **caster's own three rows** (93 of 93 mobile stomps), delayed +2 client cycles per tile beyond the first from its body (0-8 from the edge, 4-12 from the back). The caster lines its middle row up with the player first (64 of 93 exactly, the rest within a row): at the edge it steps along y between attacks. After the teleport the stomp covers the whole arena (y 9564-9570). Wiki: fully blocked by Protect from Melee, crush, max 26 [LOG].
- **Ranged/magic:** the titans have none; all distance pressure is rows, elementals, then the blast. Melee + Protect from Melee is the whole prayer game until the enrage [WIKI] [LOG].

## NPC shouts [LOG]

`[say]` nests under each titan's own npc block, so speakers are captured. Shouts are overhead text with no sound. Three groups:

**Teleport shouts** (always followed by that titan's `..._teleport01` within ticks; deterministic):

| Branda | Eldric |
| --- | --- |
| Your time is up! (4) | Your time is up! (4) |
| The real battle begins now! (4) | The real battle begins now! (1) |
| Let's end this fight! (3) | Let's end this fight! (2) |
| Time to finish this! (3) | Time to finish this! (1) |
| This is no game anymore! (2) | This is no game anymore! (1) |
| Time to meet your end! (1) | Time to meet your end! (1) |
| No more holding back! (1) | No more holding back! (1) |
| — | You'll regret provoking me! (3) |

**Blast shouts.** Charge (`..._aoe01`): "Be prepare for the true power of fire/ice!", "At last, I can unleash my true power!", "Finally I can unleash my true power!" (Branda), "Now, there's nothing holding me back!", "Time to show you my full strength!", "Feel the full strength of my wrath now!" (Eldric). Firing (`..._aoe02`): "Face the force of my fury!" (5+1), "Time to face your doom!" (4), "Time to taste my wrath!" (3+1), "Can you withstand this power?" (4+1), "Let's see how you handle this!" (3+2), "Behold the power of fire!" (5) / "Behold the power of ice!" (2), "Feel the wrath of the ice!" (2+1), "Time to feel my flames!" (3), "Prepare to be scorched!" (2), "Feel the heat of my wrath!" (1).

**Flavor shouts** (before any of melee/summon, no fixed mapping; either titan): "You can't escape me!" (Eldric 9, Branda 1), "No more running, face me now!" (Branda 5, Eldric 1), "Ready to face my power!" (Branda 5, Eldric 3), "I'm coming for you!" (Branda 4, Eldric 1 in 02283), "I'll crush you now!" (Branda 3, Eldric 1), "Here I come!" (both 3), "Time to feel the strength of fire!" (Branda 4) / "...ice!" (Eldric 2), "Time to see the power of ice!" (Eldric 3), "Time to feel my strength!" (both).

## Specials (mobile phases) [LOG]

Either titan casts either special. Told apart by anim + slot-2 spotanim (fire summon01: 3212, summon02: 3213; ice equivalents in the same family).

- **Elemental row (`..._attack_summon01`: Branda 11976, Eldric 11977):**
  - Same tick: 5-wide `..._loc01_spawn01` vfx row (fire 3218, ice 3221) at x=2909-2913. **+4 ticks:** five hitbox NPCs on it: `rs_loc_attack_fire_hitbox` (14152) / `rs_loc_attack_ice_hitbox` (14153). Standing on a tile at formation blocks that tile (no NPC, no loc, no despawn vfx) and deals the wall hit once, max 12 [WIKI; LOG 02283 T1352, 03398]; passing through earlier does not block.
  - **Clearing:** a strong-enough opposite-element spell removes tiles early — Blast tier or greater for water/fire (every ice spell qualifies), Fire Blast or greater on ice [WIKI]: the tile hit and the row's tiles either side of it (captured: hits on x 2911 despawn 2910-2912 together, +2-3 ticks after the impact). Live-verified: casting the right surge at a row tile clears that tile (the hit-interception path), and clicking Douse/Melt with the right spell in hand clears it too; anything else hints. Cleared tiles play `..._loc01_despawn01` (Branda 3220, Eldric 3223) and become `invisible_type8_nonblocking` (29733); overlapping rows track their own graphics, so one row clearing never strips another's. Fire and ice cancel out: when a row's hitboxes would stand up on the other element's row, that row's tiles despawn (grid, sound, marker) and the new row never appears beyond its cast grid [LOG 02283]. Same-element rows overlap. Each tile has one shape-10 loc, the element's `..._loc01_idle01` while a row stands there. Live then swaps a cleared tile to `invisible_type8_nonblocking` (29733); we remove the loc instead, which looks the same, because our client drew later ground graphics (the stomp telegraph) under that marker.
  - **Lifetime ~40 ticks** if left alone (captured lives 34-40); spell-cleared rows die in 2-10. Walking/standing on a live tile deals the wall hit (max 12 [WIKI]; 10/12 player-hits in 02283 [LOG]); rows never vanish under your feet and don't physically block (OSRS NPCs are walk-through). Contact damage pulses about every 3 ticks — rate estimated [EST], Wiki gives no interval. Overlapping rows are tracked one by one, so each expires on its own.
  - **Sounds:** see Sounds above (fire 10147/10148, ice 10116/10118, per tile).
- **Summon elementals (`..._attack_summon02`: Branda 11978, Eldric 11977):**
  - **+2 ticks:** three `rt_summon_elemental_fire` (14150) / `rt_summon_elemental_ice` (14151) in a column at a random lane x, independent of where the caster stands [LOG]: mobile, fire at the north end (first tile y 9569-9571), ice at the south end (y 9561-9563); static, against the caster's footprint (fire y 9568-9570, ice y 9564-9566). Spawn anims 11956/11954 + spotanims 3204/3202, sounds above.
  - Walk to the player, `..._attack01` (fire 11947, ice 11950) about every 4 ticks, max 4 [WIKI]. Spawn sounds 10190/10172 [LOG].

## Minion fuse and explode [LOG] [WIKI]

- Unkilled elementals **detonate ~18 ticks after spawning** (captured spawn 840 → `fire_minion_explode01` 11961 + `fire_minion_explode_spotanim` 3207 at 858 → del 860-864; ice 11959/3206 mirror). Usually one plays the explode anim; the whole trio is gone within ~4 ticks. Median group lifespan 15-18 ticks across both fights (shorter = player-killed).
- Explode damage is small and avoidable by distance (player-hits +1 tick after explodes: 1-12, often nothing when the player moved off) [LOG]. Exact max — see Assumptions. It is the CA "explosion" damage [WIKI].
- Player-killed elementals instead play `..._death01` (fire 11957, ice 11951) + death spotanim (fire 3205, ice 3203), all three on one tick when AoE'd [LOG]. Wiki: one Wave one-shots with the accuracy rules above.

## Player spells: splash, wall clears, kill credit

- **Splash** [WIKI: Royal Titans/Strategies]: water and fire spells "uniquely attack in a 3x3 area around its primary target during this fight". Each other live elemental on the 3x3 takes the spell with its own roll, under the same accuracy and weakness rules as the primary target (`Minions.spellOnElemental`). Wind, earth and Ancient ice spells hit only their target; bursts and barrages keep their own spread.
- **Walls judged by the cast spell**: a wall tile is cleared by the spell its hit carries, not whatever is selected when it lands. Icicle walls take fire spells; fire walls take water or ice spells.
- **Wall-clear pacing** [custom]: a spell that clears a wall tile delays the caster's next attack by 1 tick instead of 5, and ends the attack on that tile. The tile and the two the spell takes with it refuse more casts until it lands (10 ticks at most).
- **Kill credit** [custom]: each elemental a cast will kill (counted at the cast, when damage is rolled) takes 1 tick off the caster's attack delay, so a whole trio leaves 2.

## Twinflame staff (`server/plugins/items/TwinflameStaff.plugin.js`) [WIKI: Twinflame staff]

- Speed 6; 10% standard-spellbook accuracy and damage (`SmokeStaves.EquipmentEffects.js`).
- Autocasting a standard elemental spell at an NPC weak to another element casts that element's spell of the same tier, given the level and runes. At the walls (named through `twinflame:weakness`), a Wave autocast with death runes in the inventory casts the wall's Blast spell instead (Water Blast at fire walls, Fire Blast at icicle walls), saving blood runes.
- Bolt, Blast and Wave spells fire a second spell a tick later for floor(40%) of the first's damage, with no XP, runes or tome charges (`SecondSpell.ElementalSpells.js`, shared with the Shadowflame quadrant). Strike and Surge don't.
- **Creation** [WIKI ticks; LOG 235/03398]: a battlestaff and both element staff crowns, any two used on each other with the third carried, make the staff in the battlestaff's slot after 4 ticks, with `human_castsuperheatitem` (725), `vfx_human_twin_flame_craft01` (3227), sound 10107 and the captured objectbox message; a missing part gives the captured game message. The capture made it 1 tick after the use; the Wiki's 4 ticks are kept.

## Enrage at 35% [LOG] [WIKI]

When either titan first reaches ~210 HP:

- **Teleport** [LOG]: Branda anim 11984 → `vfx_branda_queen_loc01_spawn02` (3219) grid over x=2909-2913, y=9571-9573 + 29733 markers → 3 ticks later telejump to (2910, 9571), spawn anim 11966 + slot-2 3217, floors 55993/55994, blocking 26209 tiles. Eldric mirrors (teleport 11983, spawn02 vfx 3222 over y=9561-9563, telejump (2910, 9561), spawn 11963, floors 55997/55998).
- **Landing knockback** [WIKI: Royal Titans/Strategies]: a player "standing on the position a Titan will occupy" (its 3x3 from the static tile, not the wider 5x3 grid graphic) is knocked back for 15-30 damage as it lands, a jump attack (avoidable damage for Perfect). Thrown to the arena centre (2911, 9567) [EST]: neither the Wiki nor a capture gives the destination. The landing clears any wall on the titan's 3x3, no wall forms there again, and the titan's movement is blocked.
- **Static** for the rest of the fight: no rows; stomps and elementals 2:1 between blasts [LOG]. When one titan dies before the teleport, the survivor teleports on the next tick and fights on alone from its static tile [LOG 03398].
- **Elemental Blast, periodic** [LOG]: every 22, 29 or 36 ticks (one to three other attacks between; 5/11/6 captured), the first 10 ticks after the teleport.
  - **Charge (`..._aoe01`: Branda 11981, Eldric 11979):** slot-2 charge spotanims (fire 3214); the safe tile 56003 appears the same tick (never on a live wall tile, nor on one still forming: 0 overlaps in 58 captured blasts, at charge and at fire), with `royal_titans_area_attack_timer_handler` (NPC 14154) on it carrying the progress bar: headbar 78 filling 0 → 30 over 210 client cycles, the NPC gone 7 ticks later [LOG, 58 of 58 blasts]. Ranged x6 holds through charge and attack [WIKI].
  - **Fire (`..._aoe02`: Branda 11982, Eldric 11980), 6 ticks later:** slot-2 spotanims (fire 3215) and the pulse sounds; then at +1/+3/+5 the grids and the damage together. The grids cover the blast area except the safe tile: with both titans, fire (3209) on the rows north of the safe tile's row and ice (3210) on that row and south; a lone titan draws only its own grid, over the whole area.
  - **Damage: three pulses at +1/+3/+5 after AoE02** (e.g. 830→831/833/835 = 14/23/18; max 26 seen) [LOG]. Empty windows (808, 987, 1592, 1614, 1643, 1679, 1730, 1795, 1824, 2388 in 03402) = player on the safe tile, no damage. Off-tile damage numbers — see Assumptions.
- **One titan down first** [LOG 03398, 03402]: the survivor teleports (if it hadn't), casts alone (only its own animations, shouts and grid), and the safe tile goes to the row farthest from it. The corpse stays until both are down and can't be claimed before. Wiki: its melee pierces protection prayers (unwitnessed).

## Death, corpses, loot [LOG] [WIKI]

- **Kill tick** [LOG 02283]: final blows at 1806 → same tick: "Your Royal Titans kill count is: <col=ff0000>N</col>." (varp `total_royal_titan_kills`), "Fight duration: <col=ff0000>5:20.40</col> (new personal best)" (or ". Personal best: m:ss.cc"), "You are eligible to take loot from either Branda the Fire Queen or Eldric the Ice King." Both swap to corpses (Eldric's `[transformation]` logged at 1806).
- **One claim per kill** [LOG behavior + WIKI "choose to loot either"]: each player claims ONE corpse with one option; the other corpse then refuses. Captured: op1 on Eldric at 1825 → drops at 1830 (5 ticks); op1/op3/op4 on Branda at 1838-46 → "You do not feel worthy enough to loot/sacrifice/take pages from Branda the Fire Queen."
- **Corpse ops** (verified live + cache dump: Loot, null, Sacrifice, Take pages); live-titan op2 = Attack [LOG]; row ops Douse/Melt [LOG]; entrance/exit/scoreboard names [LOG, live-observed]. Live-titan op1 and minion op1 still [CACHE].
  - **Loot:** two primary rolls on that titan's table (`branda_the_fire_queen` / `eldric_the_ice_king` already in `data/definitions/npc-drops.json`).
  - **Sacrifice:** no loot, double pet rate; miss message "You don't feel lucky during your sacrifice" [WIKI changelog].
  - **Take pages:** 10-19 desiccated pages + tertiary (clues, pet) [WIKI].
- **Contribution** [WIKI]: quantities and unique rates scale linearly with whole-percent damage share (recoil counts; elemental damage does not; poison/burn/thralls do not since Aug 2025). 100% solo = full table (280-320 coal over two rolls, 1/75 staff crown). <1% (1-11 damage) still rolls twice but yields 1 of each. One page needs ~72+ damage, guaranteed at 120. Pet/clue rates ignore contribution.
- **Uniques** [WIKI]: Branda — fire element staff crown (1/75), mystic vigour scroll (1/75, once); Eldric — ice element staff crown, deadeye scroll; both — giantsoul amulet (1/16), Bran pet (1/3000, 1/1500 sacrificed), hard clue (1/25, 1/23 with hard CA tier) / elite clue (1/100, 1/95 with elite CA tier).
- **Cleanup and respawn are claim-anchored** [LOG 02283 + 03402]: the countdown starts at the corpse click (any option), not the kill. Captured offsets from the claim: reinvigorate message +3/+5, loot drops +5, corpse death anims + floors +23/+26, corpse dels +5 later (+28/+31), fresh live spawns +2/+3 after that (+31/+34). 02283: claim 1825 → msg/drops 1830 → anims 1851 → dels 1856 → spawn 1859. 03402: claim 908 → msg 911 → anims 931 → dels 936 → spawn 938. A reinvigorate with no kill (03402:1205, after the player left mid-fight) restarts the same way — leaving resets the fight and the timer. Unclaimed-corpses timing unwitnessed [EST: same schedule from kill+19, the only observed claim delay].

## Game messages (complete, captured) [LOG]

Warning/eligibility: the encounter warning (messagebox, Quick-escape); "You are eligible to take loot from either Branda the Fire Queen or Eldric the Ice King."; "You do not feel worthy enough to loot/sacrifice/take pages from ..."; "The Royal Titans will reinvigorate themselves in 18 seconds."; "The fight with the Royal Titans is in a critical stage. You'll have to wait until the next fight begins." (messagebox); "You should be able to escape from here." (exit op1 from afar). Row clearing: the three "strong enough" spell messages above. Kill: KC / duration / PB lines. Loot: "<col=ef1020>Valuable drop: ...</col>", "<col=005f00>... received a drop: ... (Branda/Eldric)</col>", "You are eligible to drink from the Tears of Guthix." Safespot examine: "This looks like a safe spot." [WIKI].

## Combat Achievements (11 tasks, 25 points) [WIKI]

Kill-count tasks read varp 4648 `total_royal_titan_kills` [LOG numeric id]; `ca_total_tasks_completed_royal_titans` tracks completion [LOG varbit exists]. Task completions are emitted by task name ("One by one", "Let them fight", … — names [WIKI], confirm against the cache enums). The plugin keeps its own count, answers `kill-count` at login, and persists/answers the personal best, Araxxor-style (see `docs/combat-achievements.md`).

| Task | How it is decided |
| --- | --- |
| One by one (Easy) | Kill one titan at a time: attacking a titan (a miss included) while the other, already attacked, still fights fails it; once that one is dead the other is fair game. |
| Let them fight (Easy) | The titans destroy 10+ elementals in the fight. An elemental is destroyed outright by a forming wall of the other element under it, or by a blast pulse of the other element's grid on its tile; its own element leaves it be [WIKI: Royal Titans/Strategies]. |
| Elemental Company (Easy) | No attacks on any elemental all fight. |
| Royal Titan Champion (Medium) | 10 kills. |
| Royal Titan Adept (Medium) | 25 kills. |
| It takes too long (Medium) | Both titans die inside the same blast charge phase. |
| Titan Killer (Hard) | 15 kills in one instance without anyone leaving; a join resets the streak to 0, a leave fails it [WIKI]. |
| I need room (Hard) | Every row tile spell-cleared before its ~40-tick natural despawn (lifetime [LOG], rule [WIKI]). |
| Royal Titan Speed-Runner (Hard) | Kill in under 1:30. |
| Perfect Royal Titans (Hard) | No avoidable damage: titan melee, elemental explosions, row spawn damage, blast pulses [WIKI categories; sources all [LOG]]. |
| No time to pray (Elite) | Zero prayer points lost all fight. |

## Data and shared changes (mirroring zulrah's section)

- ADD `server/plugins/skills/data/agility-shortcuts.json` entry (shortcut, 60 Agility). [DONE — already present, see Agility shortcut]
- ADD `Royal Titans` + destination (2950, 9574) in `server/plugins/interface/Teleports.plugin.js` (button id from cache).
- PRESENT: `monsters-complete.json` stats (12596/14147/14150/14151), `npc-drops.json` tables, agility shortcut, collection log + Slayer (cache/data-driven).
- No `npc-spawns.json` changes (all fight NPCs spawn instanced; the ice-dungeon exterior already spawns).
- New test `server/tests/royal-titans.test.cjs` + `Commands.RoyalTitans.js`.

## Death handling, logout, multicombat

- **Death is unsafe** [WIKI]: the gravestone goes outside the entrance at (2950, 9574) (`gravestones:grave-location`) [EST: live grave tile].
- **Logout inside** keeps the player's place while a partner is still in the fight: the relog lands back in it. A solo logout ends the instance, and the relog lands outside the entrance [EST, repo pattern].
- **Multicombat assumed** [EST]: the instance inherits the ice-dungeon base map (multicombat outside, `multiway_indicator` 4605 = 1 in the dungeon [LOG]); duo + minions require it. Verify the indicator shows inside the arena.

## Out of scope (separate content)

Desiccated-page conversion at plinths, Deadeye/Mystic Vigour prayer unlocks, the giantsoul amulet item, Tears of Guthix (message only, no mechanic), hiscores. Duo fights are IN scope (entrance Join flow + contribution exist); only their scaling is estimated (Assumption 12).

## Testing

Unit: `server/tests/royal-titans.test.cjs`, 24 tests (helpers, safe tile incl. wall and in-flight avoidance, spell tiers, row clearing incl. the strength gate, formation blocking, weakness, shares, loot scaling, CA decisions incl. Let them fight, streaks, the join rule) — all pass. Developer commands: `::royalhp <n>`, `::royalkill` (leaves 1 HP — engine deaths need a killer), `::royalblast`.

Live playtest (agent MCP, solo + duo, invulnerable + mortal): entry/menu/Quick-start/warning/instance/music/minimap/multiway/fades; spawns; melee both ways to deaths; rows (Douse/Melt) + minion trios; teleport at 210 to exact tiles; blast damage; HUD target-switching (values on the wire); duo join same instance; exit reversal (minimap/multiway/HUD cleared); scoreboard opens 909; KC/duration/eligible messages; CA completions through the real path (One by one, Elemental Company, No time to pray, Perfect); Loot (2 rolls scaled), Sacrifice-miss, Take pages (11); one-claim-per-player + corpse validity stamps; grave redirect (sharks outside); gated respawn (no mid-fight or post-kill doubles); logout/login incl. duo rejoin to live fights. Second-claim refusal seen in captures; live re-check pending.

Still needing eyes/alive checks: boss-HUD bar rendering (values verified, never seen drawn), scoreboard text values, blast/safe-tile visuals, row-clearing by spell (logic unit-tested; live casts kept failing on range/busy/accuracy — needs a patient manual run), minion spell-accuracy rates, ranged-x6 rates, explode max, Titan Killer 15-streak, Take-pages thresholds (72/120 estimate held once: 11 pages at 272+ damage).

## Assumptions (all [EST]; confirm in implementation via MCP)

1. **Join rule.** Wiki: "as long as one of the Titans has not lost more than 25%". Implemented as: join allowed while **both** titans are above 450 HP. The literal "one" reading (either above 450) would let players join nearly-finished fights, which the Titan Killer reset rule suggests is unintended. Confirm: try joining at various HP states live.
2. **Critical-stage block.** A join is refused once **either titan has teleported** (phase 3) with the critical-stage mesbox; before that, Join works under rule 1. The captures show the message but not the exact trigger state. Confirm live.
3. **Titan walking.** Modelled from the captured timeline: walks only after rows/elementals, 2-6 random tiles on the titan's side. Whether live weights the destination (it often steps back out to x 2904/2916) is not modelled. Confirm live.
4. **Row y-selection.** No correlation with player position over 27 casts [LOG]. Implemented as random y in 9562-9572 [EST]. Confirm live (uniform? caster-side bands?).
5. **Blast damage.** Three pulses +1/+3/+5 after AoE02, max ~26, safe tile avoids all. Assumed: each pulse rolls independently per player off the tile (not distance-scaled). Confirm numbers with Protect prayers off.
6. **Explode damage.** Small (≤12 seen), single roll on the minion's tile + adjacents at explode+1, avoided by moving 2+ tiles away. Confirm max live.
7. **Corpse op2.** Absent — cache dump confirms [Loot, null, Sacrifice, Take pages], and live clicks offer exactly those three. Resolved.
8. **Loot delay.** Drops arrive +5 ticks after the click (observed repeatedly). Resolved.
9. **Fight duration.** kill_tick − spawn_tick − 3 holds across samples (394/397, 90/93, 58/59, 29/30 [LOG] plus live 0:24.60, 1:35.40, 4:35.40, 5:31.80 all consistent). Resolved.
10. **Exit op1.** Live options are Inspect / Quick-escape: op1 always shows the hint, op2 leaves. Resolved.
11. **Let them fight.** Assumed: elemental deaths to row-tile damage (standing/fuse possessions don't count) — implement as elemental killed while on/near a live enemy row tile; minion-vs-minion never happens. Confirm live which titan damage counts.
12. **Duo scaling.** No duo captures exist: assume titan HP/damage do NOT scale with party size (wiki never mentions scaling; only loot contribution scales). Confirm live.
13. **Melee shape.** Telegraph is the captured 5x3 player-centred block, delays +2/tile from the caster [LOG]; damage assumed on the same tiles as delays expire (wiki 3x5 agrees on shape). Confirm per-tile damage timing live.
14. **Teleport landing.** (2950, 9574): verified walkable and connected live (exit lands there; walked to entrance/scoreboard). Resolved.
15. **Row-clear spell gate.** Dropped: any opposite-element spell clears (the captures show the hint only after physical clicks; Yama precedent). Resolved.
16. **Duo join flow.** Join by name, friends' list required (captured prompt). Verified live: refused without the friend entry, joined with it. Scaling per Assumption 12.
17. **Unclaimed-corpses schedule.** All corpse timings are claim-anchored (see Death section); a player who never clicks is unwitnessed. Assumed: same offsets from kill+19. Confirm live (or that nothing stalls).
18. **Respawn while looting.** Fresh spawns arrive ~31-34 ticks after the claim even if the player is still in the arena — assumed they do not aggro/interfere until attacked (no capture shows the overlap). Confirm live.
19. **Join replies.** Only the prompt is captured. The replies are ours: "That player isn't fighting the Royal Titans.", "You must be on their friends' list to join their fight.", "That fight is already full." Confirm live.
20. **Movement.** The titans stand on blocked floor (lava/ice) beside the lane, so their own steps ignore clipping; the combat engine never chases with them and they never wander. After the teleport they stay on their static tiles.
