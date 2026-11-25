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
(content 9, code 3: the 644 projectile, the 14-tick respawn and the 100k private-room
fee come from there) and ReasonPS' boss sources (checked for
the same mechanics; no Thermy-specific behaviour is taken from either without a Wiki
or capture behind it).

| File | What it owns |
| --- | --- |
| `Common.ThermonuclearSmokeDevil.js` | Ids, tiles, animations, projectile, sound, small helpers. |
| `Fight.ThermonuclearSmokeDevil.js` | The combat method: the single typeless magic style. |
| `Typeless.ThermonuclearSmokeDevil.js` | Prayer bypass (100% prayer penetration). |
| `Area.ThermonuclearSmokeDevil.js` | The multicombat boss room, walk-through flag and smoke devil task gate. |
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

## The Slayer task gate

- **Who may attack:** Wiki (Smoke Devil Dungeon, Smoke devil): the boss and every smoke
devil "can both only be killed while on a Slayer task"; players may enter without one.
Two Areas enforce it through `slayer:on-task`: the boss room (multicombat) and the
dungeon outside it (`dungeon` in `data/thermonuclear-smoke-devil.json`, three boxes,
x 2377-2431, y 9408-9471, padded around the cache map's walkable tiles x 2377-2427,
y 9415-9468, flood-filled from the entrance landing (2404, 9415); the crevice keeps the room out). The dungeon
is multicombat too (Wiki: Smoke devil; rsprox 1510 turns `multiway_indicator` on at the entrance landing
and it stays on into the room). The Western Provinces
off-task boss kill is the room's only exception.
- **Breive's refusal (rsprox 1510, rev 224, tick 198):** an off-task Attack on the boss
sends, on the same tick, the game message "Breive wants you to stick to your Slayer
assignments." and Breive's chat head (`smoke_devil_guardian`, 7654, `chatcon1`) with
`<col=0000ff>*cough*</col> that isn't your assignment <col=0000ff>*wheeze*</col>`. The
same refusal is used for the dungeon's smoke devils (Wiki Transcript:Breive: the line
is his answer to attacking "monsters" without a task; uncaptured for them). As with
Weve in the Wyvern Cave, only the player's own pending attack hears it: auto-retaliation
and permission probes are refused silently.

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
- **Task gate:** the boss and the room's smoke devils can only be attacked on a smoke
  devil task (Wiki), so `Area.canAttack` asks `slayer:on-task` and refuses an off-task hit.
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

- The Western Provinces diary's single off-task kill (Wiki: at 93 without boosting): the
  task is not wired to the boss, so the room refuses every off-task attack.
- Rented private instances (NR: 100k from bank/inventory via the crevice) and the
Peek/private wording.
- The exact per-cast projectile ends (they vary a little capture to capture); the fitted
delay (2 ticks) reproduces the typical landing.
- Cannon destruction (live destroys a cannon set up in the room; here setup is refused).
- Wind-spell 20% weakness (Wiki, 2025) and the walk-under/safespot/redemption methods -
player-side choices, no server behaviour.
# Leagues VI Echo Thermonuclear smoke devil

The matching orb opens an isolated private fight with the normal boss, which
EchoBosses dresses in the Echo appearance and Wiki profile (1,200 HP) for that instance only
([echo-bosses.md](echo-bosses.md)). Ordinary public fights keep their existing task and diary
rules. Echo requires base 93 Slayer but no assignment.

## The fight, as recorded

`plugins/bosses/thermonuclear/EchoFight.ThermonuclearSmokeDevil.js` runs the fight from
[rsprox.net 1161](https://rsprox.net/download/1161) (rev 237.1, 31 Echo kills); every id, tick and
number is in `data/thermonuclear-smoke-devil.json` (`echo`). The [Wiki](https://oldschool.runescape.wiki/w/Thermonuclear_smoke_devil_(Echo))
describes the same fight; where the two differ the recording is followed. The Echo stands on
(2362, 9448), in the middle of its pools, and never moves; the normal boss's attack turn does nothing
for it. Ticks below count from its spawn.

| Tick | What happens |
| --- | --- |
| 0 | The Echo appears (`leagues_6_lore_dust_devil_spawn_spotanim`, `lore_lust_devil_spawn`, synth 10072) |
| 3 | Twelve smoke pools appear around it (`leagues_6_vfx_smoke_devil_pool_spawn`, synth 10071 each); from the next tick each live pool's idle loop is sent every tick |
| 6, 18, 30, 42 | A set of three shots, one every 2 ticks: ranged, magic, ranged, magic (`lore_dust_devil_attack`; projectiles `..._attack_ranged_projanim` / `..._magic_projanim`, starttime 29, endtime 150; synth 272, and 10076 for magic) |
| 54 | The special charges: the pools go (`..._pool_despawn`), `lore_dust_devil_attack_special_01` every 2 ticks for 8 ticks, head bar 34 filling over 240 cycles |
| 62 | The blast: `..._attack_special_02`, area sound 5200, projectile `..._attack_special_projanim` |
| 68 | The pools come back |
| 72 | The next cycle's first set |

**A shot** lands 5 ticks after it is fired, on the player wherever they stand then. A live pool
under them is used up:

| Pool | Prayer against the shot's style | Damage | Shown |
| --- | --- | --- | --- |
| live | right | none | `..._pool_shield`, spam "The power resonating here protects you from the blast.", synth 10074 |
| live | wrong | half | the shot's impact (area sound 1418) |
| none | right | half | the shot's impact |
| none | wrong | whole | the shot's impact |

That is 816 protected shots of 816, and 22 of 22 halved on a pool with the wrong prayer. A hit is
48-62 (the Wiki's maximum hit is 51); about one in seven misses, either style alike (12 of the 88
off-pool shots), so the miss is a flat chance rather than an accuracy roll on the Echo's levels
(its magic level is 15). Shots still in flight when it dies never land.

**The special** is typeless, its damage and flight fixed when it is cast: 13 a tile of Chebyshev
distance from the Echo's footprint, 13 x (11 - tiles), at least 9 and at most 130 (recorded at 4-12
tiles: 91, 78, 39, 26, 13, 9, 9; the Wiki's 130 underneath). Its flight is 10 cycles a tile, 60 at
least; it lands round(cycles / 30) ticks later (2 to 4 recorded).

**Its prayer**: as the special lands the Echo prays against the style of the last of the player's
hits to land on it (head icon 1 ranged, 2 magic, 0 melee), and that style does a quarter of its
damage (recorded: protected magic peaked at 7 against 31 unprotected).

**The enrage**: once the Echo is below 660 HP when a set is decided, 8 ticks before it (when the set
before it, or the special, fires its last shot), every set alternates, starting with the style it
would have had: RMR or MRM. This fits 186 of the 187 recorded sets; the Wiki says 50% HP, which
fits fewer.

The Slayer facemask rule's unprotected hit (15 for this boss) no longer lowers a bigger hit, so a
bare face takes the Echo's shots whole (`Equipment.Slayer.js`).

## Not verified

- Damage and flight of the special closer than 4 tiles (none recorded; 130 at most, from the Wiki).
- The fight without a facemask (no capture).
- Prayer reduction for melee (only ranged and magic were recorded against the Echo's prayer).
- The enrage's one recorded exception: a set started at 630 HP stayed normal.

The central Echo service owns rewards/progression and suppresses normal orb rolls.
The adapter completes once, never respawns, and clears its actors/pending damage
on departure, death, logout and shutdown. Disconnected players recover outside
the crevice. Each player receives a separate instance.

Source: [Echo Thermonuclear smoke devil](https://oldschool.runescape.wiki/w/Thermonuclear_smoke_devil_(Echo)).
