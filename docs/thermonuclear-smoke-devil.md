# Thermonuclear Smoke Devil

The Thermonuclear smoke devil (`thermonuclear_smoke_devil`, NPC 499), the smoke devil
boss south-west of Castle Wars, built from the OSRS Wiki
([Thermonuclear smoke devil](https://oldschool.runescape.wiki/w/Thermonuclear_smoke_devil),
[Strategies](https://oldschool.runescape.wiki/w/Thermonuclear_smoke_devil/Strategies))
and checked tick by tick against live rsprox captures (<https://rsprox.net/database>;
submissions 1158 (11.10 MB, ~114 boss hits, rev 237, Leagues VI) and 1510 (rev 224)).
The plugin is `server/plugins/bosses/ThermonuclearSmokeDevil.plugin.js`, with its units
in `server/plugins/bosses/thermonuclear/`. Ticks count from the attack unless stated.

Reference implementations in other private servers (behaviour oracles only, never
justification on their own): Near-Reality's `SmokeDevil.java`/`ThermonuclearBossArea.java`/
`ThermonuclearSmokeDevilEntrance.java`/`ThermonuclearSmokeDevilProcessor.java`
(content 9, code 3: the 644 projectile, the 14-tick respawn, the 100k private-room fee
and the Slayer-task gate all come from there) and ReasonPS' boss sources (checked for
the same mechanics; no Thermy-specific behaviour is taken from either without a Wiki
or capture behind it).

| File | What it owns |
| --- | --- |
| `Common.ThermonuclearSmokeDevil.js` | Ids, tiles, animations, projectile, sound, small helpers. |
| `Fight.ThermonuclearSmokeDevil.js` | The combat method: the single typeless magic style. |
| `Typeless.ThermonuclearSmokeDevil.js` | Prayer bypass (100% prayer penetration). |
| `Area.ThermonuclearSmokeDevil.js` | The multicombat boss room and walk-through flag. |
| `Entrance.ThermonuclearSmokeDevil.js` | The crevice in and out, with Peek. |

## Evidence

- **rsprox:** `NPC 499 smoke_devil_boss` matches only submissions 1158 (114 matches) and
1510 (2 matches). Submission 1158 fights the boss at its world spawn (2360, 9452) - the
same tile as `npc-spawns.json` - with the player one tile south at (2364, 9452).
- **Attack (1158, ticks 389-398):** every second tick the boss plays
`lore_dust_devil_attack (3847)` with `map_projanim_v2 smoke_devil_smoke_proj (644,
starttime 32, endtime 56, angle 5, startheight 246, endheight 160)`; the player answers
the same tick with `human_shield_defence (1156)` plus `smoke_devil_smoke_player_spotanim
(643, height 92)`, and damage lands about a tick later (`tracking_damage_taken_from_npcs`
+2 at tick 392 after the tick-391 cast). Regular smoke devils fire the identical shot
(4099, tick 3007: 3847 with 644, starttime 32, angle 5, heights 246 to 160, endtime
scaling with distance at 106/116/126, and 643 with height 92 on the player), so the
engine default draws it from `npc-combat-defs.json` (projectile 644) with no custom
method of its own. Defend anim `lore_dust_devil_defend (3848)`
between casts; death anim `lore_dust_devil_death (3849)` at tick 399 with removal, drops
(ashes + rune battleaxe at (2363, 9455), under the 4x4 body) and the kill count at tick
404 - 5 ticks of death, then the next spawn ~20 ticks later (15-tick respawn + death).
- **Kill:** "Your Thermonuclear Smoke Devil kill count is: 1", varp
`total_thermy_kills (1524)` 0 to 1, plus the Leagues "Defeat the Thermonuclear Smoke
Devil" task. One fight also failed `Spec'd Out` ("took damage from something that wasn't
a special attack"), confirming the Combat Achievement exists live.
- **Entrance:** `oploc1 smokedevil_cave_entrance (30176)` at (2411, 3061) is the dungeon
mouth (the fairy-ring / Castle Wars approach on the Wiki); entering it is a plain
teleport to (2404, 9415) with no animation. The boss-room crevice is clicked in 1158:
`oploc1 slayer_cave_smokedevil_boss_entrance (535)` at (2378, 9452), then a plain
teleport (2379, 9452) to (2376, 9452) with only a face_angle - no player animation,
spotanim or sound - so the pass-through is a plain move, as implemented. The exit is
`slayer_cave_smokedevil_boss_exit (536)` at (2377, 9452), clicked the same way.
- **Cache (rev 241):** NPC 499 `thermonuclear_smoke_devil`; SEQs 3847/3848/3849
(`lore_dust_devil_attack/defend/death`, via `npc-animations.json`); spotanims 644/643;
locs 535/536 `crevice`; `monsters-complete.json`: 240 HP, max 8, speed 2, size 4,
Slayer 93, poison/venom immune.
- **Wiki corrections applied:** respawn 15 ticks (9s) over NR's 14; multicombat room (the
Wiki's "can be fought with another player", as with the Kraken) over an unknown NR
flag; cannon blocked in the room (Wiki; live destroys a set-up cannon, here setup is
refused like the other restricted rooms).

## The way in

- **Smoke Devil Dungeon:** fairy ring `BKP` then north-east, or Castle Wars then
south-west (Wiki). The dungeon mouth (30176 at (2411, 3061)) is captured.
- **Crevice (535/536):** outside (2379, 9452) to inside (2376, 9452) and back (NR tiles).
Cache: 535 offers Use/Peek, 536 offers Use - only those options are registered. Peek
counts the room's Area player list ("...no adventurers inside." when empty,
"1 adventurer"/"N adventurers" otherwise - wording follows the other bosses' Peek
lines, uncaptured). Private instances (NR: 100k) are not implemented.
- **::teleports** lands outside at (2379, 9452), so every entry starts on the right side
of the crevice (as with Sarachnis landing outside its web).

## The fight

| Style | Animation | Projectile | Speed | Range | Max |
| --- | --- | --- | --- | --- | --- |
| Typeless magical ranged | 3847 | 644, impact 643 | 2 | 8 | 8 |

- **Typeless:** protection prayers give no damage reduction (Wiki's "100% prayer
penetration"; `Typeless.ThermonuclearSmokeDevil.js`, as with the Kraken).
- **Facemask rule:** gas mask, facemask or Slayer helmet, or the smoke hits harder and
drains stats (Wiki Strategies; `slayer-gear.json`: unprotected boss hits land for 15
with the dust-devil drain shape - ATTACK/STRENGTH/RANGED/MAGIC to 0, AGILITY/DEFENCE/
PRAYER to half. The 15 and the drain shape are NR-sourced and marked as such; the
direction (above its max 8) is Wiki-confirmed. Regular smoke devils carry no hit
override: their protected max is 20 and the Wiki documents no unprotected number, so
unprotected regulars stay accurate with the drain and Protect from Missiles keeps
negating them, as the Wiki states). The punishment fires when the NPC lands a hit -
there is no ambient smoke tick for standing in the cave (both devils are non-aggressive
per the definitions, as are dust devils elsewhere).
- **93 Slayer** to damage it (Wiki; enforced by `Combat.Slayer` from the definition).
- **Max hit 8** comes from the engine (`monsters-complete.json` via
`NpcDefinition.getMaxHit()`); the plugin creates a plain `PendingHit` and the test
pins definition and data record together.
- **Walk-through:** the boss moves through other monsters/players (Wiki, anti-safespot;
`NPC.WALK_THROUGH_ENTITIES_FLAG`, as with Vardorvis) - ensured for every room boss on
every tick by `Area.process`, so fresh and respawned bosses never stick.
- **Death:** 3849, drops and removal 5 ticks later (`deathTicks: 5` in
`npc-combat-defs.json`, captured 399 to 404); respawn 15 ticks after removal
(`respawn: 15`, Wiki's 9s; captured re-spawn ~20 ticks after the death tick).
- **Loot:** the standard `thermonuclear_smoke_devil` table in
`data/definitions/npc-drops.json`.

## Combat Achievements (cache names, rev 241)

- "Thermonuclear Veteran" (Elite): 20 kills.
- "Spec'd Out" (Elite): only special attacks damage it (failed live in 1158 when a
non-special hit landed).
- "Hazard Prevention" (Elite): it hits nobody (NR tracks an untouched-room flag).
- Kill counting for the Veteran task rides the existing slayer/boss-kill plumbing; the
Spec'd Out and Hazard Prevention rules are follow-ups, not implemented here.

## Not built

- Slayer-task-only attacks (Wiki: smoke devil task, or one diary kill via the Western
Provinces diary at 93 without boosting) - as with the Kraken's task rule, a follow-up.
- Rented private instances (NR: 100k from bank/inventory via the crevice) and the
Peek/private wording.
- The exact per-cast projectile ends (they vary a little capture to capture); the fitted
delay (2 ticks) reproduces the typical landing.
- Cannon destruction (live destroys a cannon set up in the room; here setup is refused).
- Wind-spell 20% weakness (Wiki, 2025) and the walk-under/safespot/redemption methods -
player-side choices, no server behaviour.
