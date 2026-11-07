# The Hueycoatl

The Hueycoatl, the serpent coiled through the Darkfrost in Varlamore, built from the OSRS Wiki ([The Hueycoatl](https://oldschool.runescape.wiki/w/The_Hueycoatl), [The Hueycoatl/Strategies](https://oldschool.runescape.wiki/w/The_Hueycoatl/Strategies), the transcripts of Taala, the Seer and the Workers in `data/definitions/npc-dialogues.json`) and checked against live rsprox captures (<https://rsprox.net/database>; recordings 837, 3274 on rev 234, 3399, 3400 on rev 235 and 4052, 4054 on rev 237, with camp visits in 1102-1107). Every Hueycoatl capture is from a Leagues or event world, so damage numbers and kill times in them are no guide; animations, tiles, timings, locs and messages are. Every id below was checked against the rev 241 cache (they are unchanged from the recordings).

The plugin is `server/plugins/bosses/Hueycoatl.plugin.js`, with its units in `server/plugins/bosses/hueycoatl/` and its captured data in `server/plugins/bosses/data/hueycoatl.json`.

| File | What it owns |
| --- | --- |
| `Shared.Hueycoatl.js` | Ids, tiles, animations, graphics, sounds, messages, small helpers. |
| `Session.Hueycoatl.js` | One fight's space (public or private): tile mapping, locs, NPCs, graphics, sounds, its event queue. |
| `Area.Hueycoatl.js` | The public arena, private instances, the chain, the slope, the meeting flag, logins and graves. |
| `Fight.Hueycoatl.js` | The phases, the tail's cycle, the kill, the respawn; the one task that runs every fight. |
| `Attacks.Hueycoatl.js` | Rain Fire, glowing symbols, the tail's slam. |
| `Pillars.Hueycoatl.js` | The pillars, the seer's charge bar and the braziers. |
| `Seer.Hueycoatl.js` | The arena seer's runs and lines. |
| `Kills.Hueycoatl.js` | Hit rules, contribution, the kill count and loot. |
| `Hud.Hueycoatl.js` | The boss health bar (BossHud events). |
| `Lobby.Hueycoatl.js` | Taala's dialogue and the scoreboard. |
| `CombatAchievements.Hueycoatl.js` | The tasks the fight decides. |
| `Commands.Hueycoatl.js` | `::huey` for testing. |

Ticks count from the action named; captured gamevals are in brackets.

## The camp and the arena

- **The public fight** is on the world map: an Area over the arena beyond the chain (x 1496-1520, y 3262-3299 and x 1521-1535, y 3262-3284). Up to 20 players (Wiki); everyone in it counts for the team.
- **The chain** (55401, `huey_fight_entrance`) at (1527, 3285) is a multiloc on varbit 11362 (`huey_in_area`): Climb, Quick-climb and Peek from the camp, Climb and Quick-climb inside.
  - Before Taala has explained the fight (varbit 11413 `huey_intro`), Climb plays her line "Excuse me, human! Perhaps you shouldn't just go wandering through there without knowing what you're dealing with!" and nothing else.
  - Otherwise the player lands at (1528, 3284) (captured 1528 or 1529) a tick after arriving, with `huey_in_area` = 1, the multiway icon and The Feathered Serpent (801). The first time, varbit 11363 (`huey_encountered`) = 1 and the track unlocks.
  - Inside, Climb asks "Leave the encounter? Your perfect streak (N) will be lost." (Leave. / Stay., captured on the slope; the chain's own menu was seen but not its text) and Quick-climb doesn't. Where the climb back lands, (1528, 3287), is an estimate.
- **Peek:** a message box "There are N adventurers ascending the mountain.<br>The Hueycoatl has been subdued!" while she recovers (captured). The lines for the other phases were not captured; ours say the body blocks the way, she fights at the summit, she has shielded herself, or her shield has fallen.
- **The slope** (55234, `huey_fight_exit_shortcut`) at (1520, 3290): Slide asks the leave question, Quick-slide doesn't. The player says "Weeee!", slides from the slope's tile to (1524, 3290) (exact move over 100 cycles, `human_knockdown_loop_nodelay` 11589, sound 7572 twice, delay 10) with "You slide down the slope..."; 3 ticks later "... and land skillfully.", sound 2485 and Whispering Wind (813).
- **The meeting flag** (55203) at (1525, 3295), Fight-privately: "Select an option" with "Start a public/friends fight (based on privacy setting).", "Start a solo fight.", "Join a public/friends fight." and "Cancel." (captured). A private fight costs 50,000 coins, or 25,000 while the player meets the current Hard Combat Achievement reward threshold ([Wiki](https://oldschool.runescape.wiki/w/The_Hueycoatl/Strategies)); claiming the reward is not required. A friends fight takes anyone on the owner's friends list (Join asks for the owner's name).
- **A private fight** is a templated instance copying chunks 187-192 x 408-412 (the camp and the arena), with the camp's people copied in. The fade (as captured): overlay 174 with script 948, the minimap hidden a tick later, the move to (1524, 3294) on +2, the fade back on +3, closed on +5. Inside, the flag is Meeting flag (private) (55204) and a Rockslide (private) (55205) stands at (1522, 3295); both Leave-group with the same fade back to (1524, 3294). An instance ends with its last player.
- **Deaths** are unsafe; the grave is left at the base camp, (1524, 3290) (Wiki: base camp; the tile is ours). Logging out of a private fight lands the player outside it.
- **The scoreboard** (55198) opens interface 884: "The Hueycoatl - Statistics", the player's kill count, deaths and best time, and the world's since startup (captured).

## Taala

Taala (13996) plays the Wiki transcript, which matches the capture word for word. The first talk is the initial dialogue; its conditions are answered from Perilous Moons and a combat level of 85. At "But I'm sure you'll figure it out!" (captured on that line) `huey_intro` is set and the chain opens; a player below 85 combat gets "To face the Hueycoatl, it's recommended you have a combat level of 85 and a Prayer level of 43." instead of the tips, which opens it too (Wiki: they may still climb). Later talks are the subsequent dialogue.

## The fight

All ticks below are from rsprox 3399 (a solo fight, two kills) and agree with 3274, 3400 and 4054.

### Phase 1: the body

- Five segments (14017 `huey_body_part`, 250 hitpoints, passive) lie in their caves: (1530, 3276) in the cave at (1530, 3275), (1524, 3277) at (1523, 3276), (1527, 3273) at (1527, 3271) (diagonal art), (1520, 3273) at (1519, 3273) and (1524, 3270) at (1523, 3269). The caves are `df_cave_snow01_entrance03_huey` (55243, diagonal 55246).
- A segment beaten turns to rubble (14018) on the spot; its cave plays `huey_body_death` (11687, diagonal 11688) with sound 9664, and 3 ticks later becomes a plain cave (55242, 55245). The barrier (55206, `huey_p2_barrier`, 3x6, solid) at (1515, 3268) plays `huey_p2_barrier_damage_01` (11706).
- The last one: the barrier's `huey_p2_barrier_transition` (11700), "The Hueycoatl shifts, opening a path up the mountain." and a camera shake; 9 ticks later the barrier becomes `huey_p2_barrier_retracted` (55207, walkable). The barrier is what keeps the summit closed: the map has no other block on the way up.
- The head attacks during the body phase too, every 20 ticks.

### Phase 2: the head

- The head (14009, 7x7, 2500 hitpoints) lies at (1509, 3290) and never moves. It attacks every 18, 18, 24 ticks.
- At half health (1250) it shields itself on the same tick: "The Hueycoatl shields itself!", `huey_shield_activation` (11676) and the change to 14011 (`huey_head_invulnerable`), which takes no damage. The tail (14014, 5x5, 300 hitpoints) spawns at (1518, 3281) and shows west at (1502, 3281) a tick later.

### Phase 3: the tail

- The tail plays `npc_huey_tail_appear_01` (11720) and slams 2 ticks later; it stays 36 ticks, plays `npc_huey_tail_disappear_01` (11721) and shows on the other side 2 ticks later. While it rises and sinks it takes no damage (Wiki).
- Its hits are capped at 4, or 9 when the attacker's crush attack bonus is their highest; a miss still deals 1 (Wiki; the captured hits were 1, 4, 5 and 9).
- The shielded head attacks every 15 ticks (`huey_shield_attack_*`, 11673-11675).
- The tail broken: `npc_huey_tail_break_01` (11723) and the change to 14015 (`huey_tail_broken`), sound 9678, the head's `huey_screech` (11677). A tick later "The Hueycoatl's shield falls!"; 3 ticks after the break `huey_screech_reset` (11678) and the head is 14009 again. The broken tail sinks 4 ticks after it broke.

### Phase 4: the final phase

- The head attacks every 11 ticks, with a 16 after every fourth.
- The broken tail shows 18 ticks after it broke, on the other side, slams 2 ticks later and sinks 6 ticks after showing; it shows again every 24 ticks, alternating sides.

### The kill and the respawn

- The head beaten: `huey_knockout` (11679) and the change to 14012 (`huey_head_defeated`); the broken tail sinks. The kill count, duration and loot come on that tick (below). Two workers (14005, 14006) run in from (1510, 3275) and (1511, 3275) with a line each and leave 7 ticks later.
- +38: the workers run out again ("It's coming back!", "Prepare yourselves!", ...); +39: "The Hueycoatl begins to awaken..." and `huey_awaken` (11681).
- +50: a fresh set replaces everything: the head (`huey_awaken_reset`, 11682), five segments and the seer. Anyone on the summit or the mountainside is knocked back to (1530, 3283) (`human_knockdown_loop` 7211, `human_getup` 534 a tick later). The caves show `df_cave_snow01_entrance03_huey_respawn` (55244, diagonal 55247) and turn back 2 ticks later; the barrier shows `huey_p2_barrier_respawn` (55208) and turns back 9 ticks later.

## Attacks

- **Rain Fire:** the head rears with `huey_attack_<style>` (11669 melee, 11670 ranged, 11671 magic) and its charge spotanim (2968, 2971, 2974). 4 ticks later a feather falls on every player in the arena, each seeing their own: from the tile above them, start height 900, end height 200, angle 80, landing 150 cycles later on the summit and 210 on the mountainside (2969, 2972, 2975), with the impact (2970, 2973, 2976). Launch sounds 9652 / 9671 / 9607, impact sounds 9655 / 9608 / 9642 (melee / ranged / magic). The matching protection prayer holds it to 0-2 damage, else up to 14 (Wiki). One style per volley for everyone is ours; the capture only shows each player their own.
- **Glowing symbols** every 26 ticks (body and head), 36 (tail) and 24 (final): `huey_attack_tiles_loc` (55209) with `vfx_hueycoatl_prayer_02` (3001, delay 120) on each tile, removed 4 ticks later with lightning (sound 9612) striking whoever still stands on one, up to 16 (Wiki). A cast lights the fixed tiles of each part of the mountain with players on it, and enough others from its pool to make 15 on the mountainside and 22 on the summit (the captured medians; the fixed tiles were in every one of 53 and 130 casts). The tiles are in the data file.
- **The tail's slam:** two waves, identical every time (82 of 82 recorded): 195 tiles from the west side, 190 from the east, each tile's spotanim (the wave's direction, 2977-2984) delayed 15 cycles per tile of distance from the tail (30-270). Whoever stands on a tile as the wave arrives (delay / 30 ticks after the slam) takes 20-25 (Wiki) with the impact spotanim (2993-3000); moving through it dodges it. Sounds 9568 and 9573. The waves are in the data file.

## The pillars and the seer

- **The seer** (14008) waits at (1530, 3284); when the fight starts she runs to (1527, 3276) with a body-phase line. When the body is beaten she says "Nicely done!" and runs to (1518, 3271); "Steady now!" 5 ticks later, "Let's go!" 9 ticks later, and runs to the pillars, reaching (1506, 3288) 22 ticks after the path opened ("Keep praying to bolster your strength!"). Her other lines (shield, tail, final phase, the kill) are the transcript's, on their captured moments.
- **The pillars** at (1504, 3287) magic, (1505, 3289) ranged, (1507, 3290) melee: an engraving (empty, s1-s5) with a brazier (off / on). From the seer's arrival until the kill, every 2 ticks each pillar climbs a stage while enough players in the arena hold its protection prayer, and drops one while not (captured: s1 to s5 in 8 ticks with Protect from Missiles on). Required prayers per pillar by team size (Wiki): 1-5 players 1, 6-8 2, 9-11 3, 12-14 4, 15-17 5, 18-20 6.
- **The charge bar:** headbar 34 on the seer, 0 to 60 over 900 cycles, every 30 ticks; she plays `npc_dwarf_summon_orb` (11698) every 5 ticks while charging and `npc_dwarf_summon_orb_end` (11699) at the kill. When it fills, three full pillars light the braziers ("Excellent! The pillars are boosting your strength!", `human_sun_prayer` 8321) or keep them lit; anything less puts them out ("We need to charge all of the pillars using our prayers!"). Lit braziers add 30% to every player's hit (Wiki).

## Kill count and loot

- On the kill: "Your Hueycoatl kill count is: N." (varp 4404 `total_huey_kills`, counted by Combat Achievements), then "Fight duration: m:ss.cc (new personal best)" or "Fight duration: m:ss.cc. Personal best: m:ss.cc". The duration runs from when the player reached the arena, or from the tick after the set spawned if they were already there (captured: 221 and 246 ticks for 2:12.60 and 2:27.60).
- **Qualifying** (Wiki): teams of five or fewer need 25 damage to the body and 75 to the head and tail; larger teams 25 to the body or 75 in all. Under 25 body damage: "As you didn't damage the Hueycoatl's body enough, you will receive fewer rewards." (captured) and quantities cut to 5% (at least 1).
- **Loot** (Wiki): the main roll's quantities scale with the share of the fight's 4,050 hitpoints the player dealt (solo is the full table); each player rolls the uniques on their own, as likely as their share, and the pet the same; Big bones go to the MVP. The loot lands on one tile in front of the head, x 1510-1514, y 3287-3289 (captured), seen only by its owner, with the loot beam (3002) and "The Hueycoatl dropped: N x Item" for the main drop. A unique is announced to the team as "<name> received a drop: ...".

## Combat Achievements

Champion, Adept and Veteran finish from the kill count. The fight decides the rest (descriptions from the cache): You're a wizard (only earth spells), Is it a bird? (only the dragon hunter weapons), Pillar Lover ("whilst it is vulnerable": the braziers lit at the kill, our reading), I'm your son (two pieces of Hueycoatl hide armour worn), Speed-Trialist, Speed-Chaser and Speed-Runner (2:30, with five and three players or fewer), Perfect Hueycoatl (five kills in a row without leaving and without avoidable damage: lightning, the slam, an off-prayer feather).

## Testing

`node --test tests/hueycoatl.test.cjs` (after `yarn build`). In game, `::huey body | shield | tail | hp <n> | braziers | intro` move the fight of the player's camp along; `::huey symbol [glow|strike]` lights symbols on the 3x3 around the player (no damage), for looking at the effect. Checked with the agent MCP: Taala's gate and dialogue, the chain into the arena with its varbits and music, a segment fight, the path opening (barrier, caves, seer), walking to the summit, the shield and the tail's 36-tick cycle, the tail's cap (hits of 1-4), the pillars charging, the kill count and loot, the respawn and knockback, a solo private fight from the flag and leaving it, the slide, the boss HUD and saving.

## Open

- The glowing symbol's circle (loc 55209, model 54454, animation 11730) lies at ground level (model y 0 to +3). The OSRS client paints scenery over the terrain without a depth test; our GPU client depth-tests it, so on sloped ground the circle sinks under the terrain and only its rising parts show. A client fix, not this plugin's.

- The peek lines for the running phases, where the chain's climb back lands, and the private fight's fee messages were not captured.
- The seer's body- and tail-phase lines play on segment deaths and tail swaps; live's exact cadence was not worked out.
- Tome of Earth, the dragon hunter wand and the hide armour are items of their own; this covers only dropping them.
