# The Gauntlet

The Gauntlet and the Corrupted Gauntlet, ported from Near-Reality's implementation and checked against the OSRS Wiki and the cache. It is one plugin, `server/plugins/minigames/Gauntlet.plugin.js`, which delegates to one unit per area in `server/plugins/minigames/gauntlet/`.

Status: done so far are the maze, the lobby, the run (entry, timer, exits, death) and preparing (resources, stations, the singing bowl, potions, cooking). monsters (with their drops), the Gauntlet weapons, the Hunllef, the reward chest, the scoreboard and stats.

## Layout

| File | What it owns |
| --- | --- |
| `GauntletShared.js` | Ids, varbits, tiles and helpers such as fades and dialogues. |
| `GauntletMap.js` | The maze: its layout, the room templates and turns, and lighting rooms. |
| `GauntletRun.js` | One player's run: the starting kit, the preparation timer, the boss phase, ending a run, and stats. |
| `Lobby.*` | The Gauntlet Portal in Prifddinas, the lobby's teleport platform, Bryn and the entrance. |
| `Run.*` | Nodes, the exit platform, the teleport crystal, the barrier, death, teleports and login recovery. |
| `GauntletItems.js` | Item ids per mode and the singing bowl's recipes. |
| `GauntletResources.js` | Stocking lit rooms with resources, and gathering. |
| `Prep.*` | The start room's stations, gathering hooks and Egniol potions. |
| `GauntletMonsters.js` | Monsters in lit rooms, demi-bosses, and the run's drop rules. |
| `GauntletHunllef.js` | The Hunllef fight. |
| `Weapons.*` | The halberds, bows and staffs in combat. |
| `GauntletRewards.js` | Run points, the reward chest and its loot tables. |
| `GauntletScoreboard.js` | The lobby scoreboard and the world's totals. |
| `Commands.*` | Developer commands. |

## The maze

The maze is a 7x7 grid of rooms, each 2x2 chunks:
- The Hunllef's room is in the centre.
- The start room sits on a random side of it (Wiki).
- Six rim rooms hold demi-bosses: the bear, the dragon and the dark beast, twice each (Near-Reality).

It is built with the core `TemplatedInstanceArea` (`server/src/main/typescript/elvarg/game/model/areas/impl/`), which:
- copies cache template chunks, turned, into an allocated grid at tile 8192+;
- builds server collision and locs from those templates;
- streams a REBUILD_REGION palette to the players inside, from `PlayerSession`.

Tiles no chunk has been copied to are blocked.

Templates (Near-Reality's, checked against the cache):

| Room | Source chunk |
| --- | --- |
| Four exits (middle) | x 232, y 704 / 706 / 708 / 710 |
| Three exits (rim) | x 234, same four variants |
| Two exits (corner) | x 236, same four variants |
| Start room | (238, 708) |
| Hunllef room | (238, 710) |

The Corrupted Gauntlet uses the same layout 8 chunks east. Rim and corner rooms are turned so their closed sides face out; middle rooms turn at random. A test walks every doorway of a fully lit maze to check this.

**Revealing rooms:**
- The whole layout is decided when the maze is made.
- A room is only drawn once lit, from a Node on the edge of a lit room (Wiki: nodes are lit "to visit new rooms"). The node's side of its room gives the direction.
- Lighting copies the room's chunks and sends the new scene to the player.

## A run

**Entry.** The entrance (37340) is a multiloc on varp 2353: it shows "Enter", plus "Enter-corrupted" after any completion. Bryn turns players away if they:
- haven't spoken to him (his first talk sets this);
- have a pet out;
- have a reward waiting (varbit 9179).

His lines come from the Wiki transcript. You must also have an empty inventory and equipment, because nothing can be taken in or out.

**Starting kit** (Wiki): a crystal sceptre (wielded), then an axe, pickaxe, harpoon, pestle and mortar, and a teleport crystal. The Corrupted kit uses the corrupted versions. Near-Reality also gave a weapon frame and 50 shards; that isn't on the Wiki, so it's left out.

**Timer.** You get 10 minutes to prepare, or 7:30 in the Corrupted Gauntlet:
- interface 637 sits on the HUD overlay (161:8);
- script 2914(ticks) runs the countdown;
- script 2916 shows "Final Encounter".

When time runs out, you are taken into the boss room.

**Maze varbits:**

| Varbit | Meaning |
| --- | --- |
| 9178 | Maze map |
| 9292 | Corrupted |
| 9291 | Start room |
| 9289 / 9290 | Current room |
| 9240 + y * 7 + x | A lit room |
| 9177 | Boss phase |

**Barrier** (37339, corrupted 37337, a multiloc on varbit 9177):
- During preparation it offers Pass (asks first) and Quick-pass, which take you two tiles in and start the fight.
- During the fight it offers Escape.

**Leaving:**
- The start room's platform (36062 / 35965): Exit asks first, Quick-exit doesn't.
- Escape at the barrier, death, or logging out.

Every exit takes everything you carry and returns you to the lobby at (3032, 6127, 1). Dying drops nothing and counts a death. Teleports are blocked inside. A player saved inside a maze (after a server stop) is returned to the lobby on login.

**Lobby:**
- The Gauntlet Portal (36081) at (3229, 6114) in Prifddinas leads down.
- The lobby's Teleport Platform (36082) channels back up.
- `::teleports` has a Minigames entry for the lobby.

## Preparing

**Resources.** Gauntlet resources aren't in the room templates: they are spawned into a room when it is lit. Yields are from the Wiki; no level is needed.

| Node (corrupted) | Gives | Yields | Tool |
| --- | --- | --- | --- |
| Crystal Deposit 36064 (35967) | crystal ore | 3 | pickaxe |
| Phren Roots 36066 (35969) | phren bark | 3 | axe |
| Fishing Spot 36068 (35971), 2x2 | raw paddlefish | 4 | harpoon |
| Linum Tirinum 36072 (35975) | linum tirinum | 3 | none |
| Grym Root 36070 (35973) | grym leaf | 1 | none |

A spent node turns into its depleted version (the next id). Rooms are stocked as Near-Reality does it:
- three rooms in four get 1-3 gathering nodes (at most 2 when monsters share the room);
- one in five also gets a few grym roots;
- nodes go on inner floor beside a wall or object, apart from each other and clear of the doorways;
- demi-boss rooms hold only their demi-boss;
- the other rooms are marked for monsters (phase 4).

Gathering also follows Near-Reality, since the Wiki gives no rates: a yield every 2 ticks, 1 XP, and a 1 in 5 chance of 5-30 shards.

**Nodes.** When a room is lit, the nodes on both sides of each passage to a lit neighbour turn to their lit, unclickable versions (id + 2). The symbols (36097, "Inactive Symbol") are left as they are: Near-Reality swaps them to 36096, but the cache's named "Illuminated Symbol" is 36095, and which one the game uses isn't confirmed.

**Stations in the start room:**
- Tool Storage gives back missing tools (Wiki: sceptre, axe, pickaxe, harpoon, pestle and mortar).
- Water Pump, or a vial used on a fishing spot, fills vials.
- Range cooks raw paddlefish for 15 XP. Paddlefish heals 20; Near-Reality's burn chance is used.
- Singing Bowl opens the make-X menu of what you can make next.
- Crystal Singing Recipes opens interface 640; Egniol Potions explains the recipe.

**Singing bowl** (Wiki recipes, Crafting and Smithing XP each):

| Product | Needs | Shards |
| --- | --- | --- |
| Vial | none | 10 |
| Teleport crystal | none | 50 |
| Escape crystal | none | 200 |
| Crystal paddlefish | paddlefish | 10 |
| Helm / legs | ore, bark, linum: 1 / 1 / 2 by tier | 50 / 50 / 100 |
| Body | ore, bark, linum: 1 / 2 / 2 by tier | 50 / 100 / 100 |
| Weapons (basic) | weapon frame | 0 |
| Weapons (attuned) | the basic weapon | 50 |
| Weapons (perfected) | attuned + spike / orb / bowstring | 0 |

Armour totals come to 150 / 350 / 650 shards and 3 / 7 / 13 of each resource for a full set, as the Wiki's Gauntlet page states. A worn piece is upgraded where it is worn.

Crystal and corrupted paddlefish heal 16 and combo-eat like karambwan (Wiki).

**Egniol potion** (Wiki):
1. Fill a vial with water.
2. Add a grym leaf to make a grym potion (unf).
3. Grind 10 shards into 10 dust with the pestle and mortar.
4. Add the 10 dust to make an Egniol potion (3), for 10 Herblore XP.

It restores prayer like a prayer potion, gives 40% run energy, and works as a stamina potion. The Wiki doesn't say whether a vial is left after the last dose. Guides have players make a vial per potion, so the last dose leaves nothing.

**Teleport crystal** (Wiki): it doesn't work in the start room. Once the fight has begun it says: "That won't help you now. At this point in the Gauntlet, you win or you die."

## Monsters

| Tier | Crystalline (corrupted) |
| --- | --- |
| Weak | Rat 9026 (9040), Spider 9027 (9041), Bat 9028 (9042) |
| Strong | Unicorn 9029 (9043), Scorpion 9030 (9044), Wolf 9031 (9045) |
| Demi-boss | Bear 9032 (9046), Dragon 9033 (9047), Dark Beast 9034 (9048) |

**Data sources:**
- Stats, attack styles, aggression and sizes: `monsters-complete.json` (Wiki). Near-Reality's own numbers differ in places (the rat has 14 HP there, 12 on the Wiki), so they aren't used.
- Animations and projectiles: `npc-combat-defs.json`, Near-Reality's ids. Each lies in the same range as that NPC's cache idle and walk animations.
  - The dragon's projectile is 1701 (corrupted 1702), the dark beast's 1610 (corrupted 1606).
  - The spider has no block animation.
  - The dragon's impact graphic (1703/1704) isn't shown yet.

**Rooms** (Near-Reality): a room marked for monsters when it was stocked gets:
- three times in four, away from the rim, 1–4 weak monsters;
- otherwise 2 strong ones.

Each demi-boss stands alone in the middle of its room. Monsters don't respawn, and they're removed with the maze. Nothing attacks a player in the start room.

**Drops.** The plugin replaces the general tables for a run's monsters (the `npc-drops:roll` event). The weights are the Corrupted Gauntlet Wiki pages', which are exact; the crystalline pages only say common/uncommon.

| Tier | Always | Then one of (weight) | Weapon frame |
| --- | --- | --- | --- |
| Weak | 20–30 shards | nothing 9, 3–7 shards 9, 1–3 raw paddlefish 3, grym leaf 2, teleport crystal 1 | 1/4; always from the first weak kill of a run |
| Strong | 80–100 shards | 7–14 shards 9, nothing 6, 2–4 paddlefish 3, grym leaf 2, teleport crystal 1 | 2/7; always by the second strong kill |
| Demi-boss | 50–60 shards and a weapon frame | nothing 3, 10–21 shards 9, 3–5 paddlefish 3, grym leaf 2, teleport crystal 1 | always |

A demi-boss also drops its own component (bear: spike, dragon: orb, dark beast: bowstring) if the player doesn't own it. Otherwise it drops any component they don't own, at an equal chance; once all three are owned, none.

## Weapons (Wiki)

| Weapon | Speed | Range | Notes |
| --- | --- | --- | --- |
| Halberd | 4 (not 7) | 2 | |
| Bow | 5 | 10 | No arrows; the strength is on the bow. Core `RangedWeapon.GAUNTLET_BOW` plus a plugin ammo handler that uses none. |
| Staff | 4 | 10 | Powered staff with a built-in spell. Max hit 23 / 31 / 39 by tier, regardless of level. The cast is Near-Reality's: animation 1167, graphics 1719/1720/1721 (corrupted 1722/1723/1724). |

## The Hunllef

The Hunllef waits in the boss room from the start of a run. It fights once the boss phase begins: through the barrier, or when the timer runs out. Killing it completes the run.

**Mechanics from the Wiki** (both versions share them):

| | |
| --- | --- |
| Hitpoints | 600 / 1000 |
| Attack speed | every 5 ticks |
| Attack style | Ranged first; switches every 4 attacks (tornado and prayer-disabling attacks count, the stomp doesn't), with animation 8754 |
| Protection prayer | Protects against one style (forms 9021 / 9022 / 9023: melee / ranged / magic; corrupted 9035–9037). Every 6th off-prayer hit, zeros included, switches it to that hit's style. Hits it protects against do nothing. |
| Stomp | If you stand under it when it attacks |
| Tornadoes | Crystalline 1 / 2 / 3, Corrupted 2 / 3 / 4, above 66% / 33–66% / below 33% HP. They chase you for 20 ticks; damage by armour tier is in the table below. |
| Floor | Three pattern sets by those thirds. Tiles turn blue (crimson) then orange, faster each phase; orange tiles deal 10–20 a tick. Floor loc 36149 (36046), +1 blue, +2 orange. |

**Max hits** by the lowest tier of a full crystal set (none / basic / attuned / perfected):

| | Correct prayer | No prayer | Tornado |
| --- | --- | --- | --- |
| Crystalline | 12 / 10 / 8 / 6 | 51 / 42 / 36 / 26 | 10–20 / 10–16 / 7–13 / 5–10 |
| Corrupted | 16 / 13 / 10 / 8 | 68 / 55 / 45 / 35 | 15–30 / 15–25 / 10–20 / 7–15 |

The Crystalline no-prayer maxes aren't on the Wiki: they're the Corrupted ratio per tier. The stomp hits up to the unprayed, unarmoured max.

**Near-Reality's values** (the Wiki gives none):
- the ids, animations (attack 8419, tornado 8418, stomp 8420, death 8421) and projectiles (ranged 1711, magic 1707, prayer-disabling 1713; corrupted +1);
- a tornado summon every 56 ticks;
- a floor pattern every 30 ticks, orange for 6 ticks;
- a 15% chance for a magic attack to disable prayers.

The Hunllef and its tornadoes are scripted: no default combat, and no drops (the reward is the chest).

## Rewards (Wiki, Reward Chest (The Gauntlet))

When a run ends, a reward waits in the lobby's Reward Chest (37341, a multiloc on varbit 9179). It's kept in the save, and Bryn won't let you back in until you've collected it.

| How the run ended | Reward |
| --- | --- |
| Hunllef killed | 5–9 crystal shards and two rolls on the regular table |
| Corrupted Hunllef killed | 7–12 crystal shards, the Gauntlet cape if you don't own one, and three rolls on the corrupted table |
| Anything else, 50+ points | One item from the incomplete table (27 items, 1/27 each) |
| Anything else, 1–49 points | One item from the junk table (Iwan's flyer, potion, rotten tomato) |
| Anything else, 0 points | Nothing |
| Left by the teleport platform | Nothing |

Death, escaping at the barrier and logging out are all "anything else". The main tables are the Wiki's x/24 weights. Each tertiary item is rolled on its own: elite clue, crystal weapon and armour seeds, the enhanced seed, Youngllef.

**Points** (Wiki):
- 10: a demi-boss, or an attuned-to-perfected upgrade;
- 5: a strong monster, or a basic-to-attuned upgrade;
- 2: a weak monster, or a basic item;
- 1: cooking a paddlefish, or adding crystals to one. The Wiki lists that last one at 2 in one place, but its worked example counts 1.

The chest needs one free slot; anything that doesn't fit goes on the ground.

## Stats and the scoreboard

A completion prints:
- the challenge duration (with your personal best),
- the preparation and Hunllef kill times,
- your completion count.

Your stats are saved in `gauntlet:stats`: completions, deaths and best times per mode.

The lobby Scoreboard (36060) opens interface 639, which has your numbers next to the world's for both modes (the Wiki). The world's totals are kept in `server/data/saves/gauntlet-scoreboard.json`, which is gitignored; plugins have no world store.

## Developer commands

| Command | Does |
| --- | --- |
| `::gauntlet` | Teleports to the lobby. |
| `::gauntletmap [corrupted] [all]` | A maze without a run, to inspect; `all` lights every room. |
| `::gauntletstart [corrupted]` | Starts a run without Bryn's checks; your hands must be empty. |
| `::gauntletboss` | Ends preparation and takes you to the Hunllef. |
| `::gauntlettime <seconds>` | Sets the preparation time left. |
| `::gauntletgear [basic\|attuned\|perfected]` | During a run: a Hunllef loadout of that tier (default perfected): the armour worn, the bow wielded, the staff, the halberd, 4 Egniol potions, 4 crystal paddlefish and paddlefish in the rest. |
| `::gauntletreward [corrupted] [incomplete\|junk]` | Puts a reward in the lobby chest as if a run just ended: a Gauntlet kill by default. |

## Tests

`server/tests/templated-instance.test.cjs`: turned copies collide like the cache map turned with them, and locs are found where the client draws them.

`server/tests/gauntlet.test.cjs`:
- the layout;
- doorways and the closed rim;
- lighting rooms;
- entry checks and the starting kit;
- the timer, the barrier and Escape;
- death, teleports and logout;
- stocking rooms and lit nodes;
- gathering;
- the singing bowl's costs and in-place upgrades;
- the Egniol chain;
- the teleport crystal's rules;
- monster animations, rooms and demi-bosses, the drop rules, and the safe start room;
- the Hunllef: its style cycle and stomp, max hits by armour and prayer, the protection switch, tornado counts, the floor tiles, and completion;
- the weapons and `::gauntletgear`;
- the reward rule and loot tables, points, the chest, completion messages and stats, and the scoreboard.
