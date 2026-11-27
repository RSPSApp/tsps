# Dormant NPCs and aggression tolerance

`server/plugins/npcs/DormantNpcs.plugin.js`, with data in `server/data/definitions/dormant-npcs.json`: NPCs that lie dormant until woken, rise as their awake form, fight, and sink back after resting. Each family in the data has its dormant and awake ids, its rise and sink animations (with their lengths in ticks), and what wakes it:
- `approach`: the disguised crabs below, woken by a player stepping next to them;
- `attacked`: wyrms and wyrmlings, woken when a player attacks them ([wyrms.md](wyrms.md));
- `picked`: Zanaris' zygomites, woken when a player picks their Fungi (below).

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

## Zygomites (Zanaris)

Zanaris spawns only the caps, as live does: placeholders that show a "Fungi" with Pick (cache transforms, varp 1306) and stand still (`wanderRadius` 0). The combat forms aren't spawned; a cap turns into one in place.

| Cap (spawns as) | Shows as | Zygomite | Where |
| --- | --- | --- | --- |
| 536 | 533 (no-op form 535) | 537, level 74 | south patch, (2412-2419, 4467-4475) |
| 1023 | 538 (no-op form 637) | 1024, level 86 | north patch, (2412-2421, 4370-4377) |

**Picking** (rsprox captures: a rev 243 recording of the north patch; tick 0 is the player's arrival next to the cap):
1. Tick 1: the player plays `human_fungicide_pick_zygomite` (3335), with sound `pick` (2581).
2. Tick 2: the cap transforms into the zygomite and plays `zygomite_leap_out_npc` (12340), with sound `zygo_grow` (1963). It has the zygomite's hitpoints. Live disables all its options for that tick; here it can't be attacked until it has risen.
3. Tick 4 (12340 lasts 56 client cycles): it has risen, steps towards the picker and attacks them.

Picking needs no Slayer level: the capture's player had under 57 Slayer and still picked it, then was refused attacking it with "You need a Slayer level of 57 to know how to wound this monster." Other Slayer monsters get the generic line (`plugins/skills/data/slayer-level-messages.json`).

**While fighting**, Pick on another cap gives "You should probably concentrate on the monster you're fighting!" and nothing else. The capture shows it twice, after the arrival step, while the zygomite was attacking the player. Here, "fighting" means `CombatFactory.inCombat`.

**Ours** (not captured, not on the Wiki):
- a second player's Pick on a cap that is already rising does nothing, and a picker who has walked off before the pick's tick doesn't pick;
- out of combat, a zygomite rests like the other families, walks home, and turns back into its cap with no animation. The recording ends before that. One left on 0 hitpoints without fungicide (Finishers keeps it alive) does the same, healed, and its last-legs line is said again in its next fight (`dormant-npcs:slept`).

**Captured but not modelled yet:** the zygomite's combat itself. In the capture it attacks with `zygomite_attack` (3326) both ways:
- melee, with sound `unarmed_punch` (2566);
- ranged, with the spore projectile `slayer_zygomite_spores_spotanim` (576; start 35, end 40-45, heights 92 to 124) and sounds `zygo_spore_cast_and_fire` (1965) and `zygo_spore_impact` (1966, delay 40-45).

Fossil Island's Ancient Fungi (471 to 7797) work the same way, but have only Leagues captures, so they aren't in the data yet.

## Aggression tolerance (core)

`server/src/main/typescript/elvarg/game/entity/impl/npc/AggressionTolerance.ts` follows the Wiki's Tolerance page.

**The regions.** Each player has two 21×21 tolerance regions (10 tiles each way).
- **Ten minutes** (1000 ticks) inside the combined regions makes monsters tolerant: they stop being aggressive towards that player.
- **Leaving both regions,** or changing plane, drops the older region, keeps the newer one, and centres a new region on the tile the player left from. This restarts the ten minutes. The region bookkeeping matches RuneLite's NPC aggression timer.

**Logging out isn't leaving.** The state is the persisted attribute `npc-aggression:tolerance`.

**Exceptions.** Monsters whose definition doesn't build tolerance stay aggressive, as before.

**`::aggro`** (`plugins/npcs/AggressionToggle.plugin.js`) is a cheat with no live equivalent: it toggles the saved attribute `npc-aggression:ignore-tolerance`, and while it's on, monsters stay aggressive after the ten minutes, crabs included (they ask the same `onNpcAggressionTolerance` hook). Administrators can run it; a world opens it to everyone with `"commands:permissions": { "aggro": "NONE" }`.

**Wake range.** The Wiki only says crabs "attack when walked by", which is what stepping next to one does; the range stays at one tile.

Before this, the timer started at login and never reset, so ten minutes after logging in every tolerance-building monster everywhere stopped being aggressive. The old rock crab plugin worked around that by keeping rock crabs aggressive forever. Crabs now follow tolerance like everything else, and walking well away and back resets it.
