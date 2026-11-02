# Dormant NPCs and aggression tolerance

`server/plugins/npcs/DormantNpcs.plugin.js`, with data in `server/data/definitions/dormant-npcs.json`: NPCs that lie dormant until woken, rise as their awake form, fight, and sink back after resting. Each family in the data has its dormant and awake ids, its rise and sink animations (with their lengths in ticks), and what wakes it:
- `approach`: the disguised crabs below, woken by a player stepping next to them;
- `attacked`: wyrms and wyrmlings, woken when a player attacks them ([wyrms.md](wyrms.md)).

Anything still rising can't attack (a `canAttack` check). Before this, the plugin only handled crabs (`DisguisedCrabs`); the persisted rock-crab kill count keeps its old name, `disguised-crabs:rock-crab-kills`.

## Crabs

It replaces the old rock-crab-only plugin.

| Disguise (spawns as) | Crab | Ids (cache) |
| --- | --- | --- |
| Rocks | Rock Crab | 101→100, 103→102 |
| Boulder | Giant Rock Crab | 2262→2261, 5941→5940 |
| Sandy rocks | Sand Crab | 5936→5935, 7207→7206 |
| Fossil Rock | Ammonite Crab | 7800→7799 |
| Swampy log | Swamp Crab | 8299→8297 |
| Sandy Boulder | King Sand Crab | 7267→7266 |

**Waking.** A player who steps next to a disguise wakes it, unless the crab has become tolerant of them: per the Wiki, crabs can only be fought while they're aggressive.
Diagonal counts as next to.
1. Every crab beside the player rises (seq 1316) as its crab form.
2. It takes that form's hitpoints, so a giant rock crab has 180, not its Boulder's 10.
3. It stands still while it rises: 1316 lasts 74 client cycles, so 3 ticks.
4. Then it attacks. Whether each crab may attack (single-way or multi) is the normal combat rules' call.

**Coastal multicombat.** The shipped `world.json` covers Rellekka's rock-crab
coast and the Hosidius/Crabclaw Isle sand-crab coast with surface-only
`multi-combat` tags. Their edges use the live-game measurements in
[Multi-Lines at 694b258744a4dcb2c9d19b18a7aae38875eb9113](https://github.com/tsbreuer/Multi-Lines/blob/694b258744a4dcb2c9d19b18a7aae38875eb9113/src/main/java/com/tsbreuer/multilines/MultiLinesData.json),
whose [author describes mapping non-Wilderness zones](https://github.com/tsbreuer/Multi-Lines/blob/694b258744a4dcb2c9d19b18a7aae38875eb9113/README.md).
Java rectangles exclude their maximum edges; world-zone maxima are inclusive.
The converted rectangles preserve exactly the source's 22,253 tiles and cover
all 34 Rellekka and 125 Hosidius/island crab spawns in this checkout.

These are community measurements, not a replayed native boundary capture.
Other crab locations and explicit custom world-zone lists retain their existing
configuration. In particular, the Wiki identifies Outer Fortis sand crabs as
[single-combat and non-aggressive](https://oldschool.runescape.wiki/w/Sand_Crab).

**Resting** (every family):
1. Out of combat for 20 ticks, a crab walks back to where it lay.
2. Back home, or after 10 more ticks, it sinks (seq 1314; a wyrm's 8269).
3. When the sink is over (1 tick for crabs, as before; 2 for wyrms), it's dormant again, healed.

The 20 ticks aren't documented anywhere: they're an estimate, kept in the data file.

**Animations, from the cache:** every crab is built on one skeleton (frame groups 8286–8291).
- 1312/1313 attack and defend.
- 1314 sinks the crab; it's also the death animation.
- 1316 is 1314's frames reversed.

**Where it runs.** Crabs lie on coasts all over the map, so the plugin doesn't hook every player's tick:
- At startup it collects the 64×64 map squares that hold a disguise spawn.
- It follows players into and out of those squares (`onPlayerMapSquareChange`, plus login).
- One task, each tick, visits only those players and the crabs awake right now.

**Also:**
- **Slayer** matches a task by the npc's current form, so a woken Sand Crab counts for a crabs task, and gives the crab's hitpoints in XP.
- **Diary tasks:** Kourend & Kebos easy "Kill a Sandcrab", and Fremennik easy "Kill 5 Rock crabs" (the kills are counted).

**Not modelled:**
- King Sand Crab spawns (npc-spawns.json has none; the pair is in the data).
- Crab sounds (no capture).

## Aggression tolerance (core)

`server/src/main/typescript/elvarg/game/entity/impl/npc/AggressionTolerance.ts` follows the Wiki's Tolerance page.

**The regions.** Each player has two 21×21 tolerance regions (10 tiles each way).
- **Ten minutes** (1000 ticks) inside the combined regions makes monsters tolerant: they stop being aggressive towards that player.
- **Leaving both regions,** or changing plane, drops the older region, keeps the newer one, and centres a new region on the tile the player left from. This restarts the ten minutes. The region bookkeeping matches RuneLite's NPC aggression timer.

**Logging out isn't leaving.** The state is the persisted attribute `npc-aggression:tolerance`.

**Exceptions.** Monsters whose definition doesn't build tolerance stay aggressive, as before.

Before this, the timer started at login and never reset, so ten minutes after logging in every tolerance-building monster everywhere stopped being aggressive. The old rock crab plugin worked around that by keeping rock crabs aggressive forever. Crabs now follow tolerance like everything else, and walking well away and back resets it.
