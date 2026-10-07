# Edgeville Dungeon

The Edgeville Dungeon's monsters, spawns, kill drops and agility shortcuts come from the general data. This page covers what two plugins add:
- `EdgevilleDungeon` (`server/plugins/areas/EdgevilleDungeon.plugin.js`, units in `edgevilledungeon/`): the brass key door and the area's diary tasks (data: `edgeville-dungeon.json`);
- `GiantLairs` (`server/plugins/bosses/GiantLairs.plugin.js`, units in `giantlairs/`): Obor's and Bryophyta's lairs, with their bosses and chests, and giant bones (data: `giant-boss-lairs.json`).

## Sources

- **rsprox captures:**
  - entering the shed with and without the brass key;
  - Obor's gate, his fight and his chest;
  - Bryophyta's gate, her fight (with growthlings and the logs' axe) and three chest opens.
- **The Wiki:** both bosses' stats and max hits; the chest tables (Chest (Obor's lair), Chest (Bryophyta's lair)); the growthling rules; giant bones' 150 Prayer XP.
- **The cache's map:** the gates, rocks, chests, exits and logs.

## The brass key door

| Tick | What happens |
| --- | --- |
| The click, without the key | "The door is locked." |
| The click, with the key | "You unlock the door." and sound 2402 |
| +1 | An invisible wall (38848) replaces the door and the open door (1539) appears beside it. Sound 62, and the player steps through |
| +3 | The door is shut again |

The key is kept. The capture went in; the way out is assumed to work the same.

## The lairs

Each player gets their own lair: a private area over the lair's real tiles, with its own boss. Obor's lair shares the dungeon's map region, so on arrival it sends its own song (26, as captured), and the region's song comes back when the lair ends. Bryophyta's lair has a region of its own (554). Leaving, teleporting, dying or logging out ends it. A player who logs back in inside a lair is put outside its gate.

**The gate:**
- **Without a key, before the first unlock:** "The gate is locked shut." (Obor) or "It's locked!" (Bryophyta).
- **With a key:** the key is kept, and from then on the gate opens without one (Wiki).
- **Obor:** "Enter Obor's Lair?" (Yes./No.).
  1. On Yes: the fade and `busy`.
  2. 2 ticks later: in the lair at 3091,9815, with Obor already there.
  3. A tick later: the fade back and "Your key fits the gate, causing it to swing open."
- **Bryophyta:**
  1. The instanced-area warning, then "Are you sure you wish to open it?".
  2. Then straight in, at 3214,9937, with her attacking at once.

**The chest:**

| Situation | Response |
| --- | --- |
| The boss is alive | "You can't loot the chest whilst Bryophyta is still attacking you!" (Obor's uses his name) |
| The first click after a kill | "You hear the ground rumble..." (Obor) or "You hear the leaves stir..." (Bryophyta); the boss returns 15 ticks later, key or not |
| No key | "You need a Mossy key to open this chest." (Obor's names the Giant key) |
| A key, once per kill | See below |

Opening it:
1. The key is used up, with animation 536 and sound 52.
2. A tick later: "The loot spills out as you open the chest." and "Your Bryophyta chests opened count is: N." (varp 1529 for Obor, 1733 for Bryophyta). The loot lands beside the chest, and the chest shows open.
3. 19 ticks later it closes.

Chest loot goes to the collection log, whose Obor and Bryophyta pages count chests opened.

The chest tables follow the Wiki, rolled by the NPC drop roller (`npc-drops:roll-table`):
- **Both:** a beginner clue every time.
- **Obor:** an ensouled giant head every time, a 1/16 giant key, and the hill giant club at 1/118.
- **Bryophyta:** Bryophyta's essence at 1/118.
- **Gems:** uncut rubies and diamonds always drop together.

**Leaving:**
- **The exit gate (Obor) or the Rock Pile (Bryophyta)** asks first: "Are you sure you want to leave Obor's Lair?" ("Exit the lair." / "Stay."). Obor's has the fade.
- **Quick-exit** leaves straight away.

## Obor

From the capture; stats from the Wiki: 120 HP, max hits 22 (melee) and 26 (ranged), attack speed 6.

| Attack | What happens |
| --- | --- |
| Punch (in reach) | Animation 4666, the hit a tick later. Sometimes a knockback: a 5-tile slide away from him (12212, under `busy`), stopping at walls, with the hit 2 ticks later |
| Boulder (out of reach) | The same swing. A tick later the earthstrike splash (98) and the player knocked down (7210) |
| Stamp | Animation 7183 and a splash (140) on his tile nearest the player. A tick later, rocks fall on every tile to the player's, a tile every 6 client cycles, the player's rockfall animation (7212) timed to the last, and the camera shakes. The hit lands 2 ticks after the stamp |

His ranged attacks do half damage through Protect from Missiles (Wiki). The stamp, the boulder and the knockback give the player their own animation, not a block. Combat methods can now say so: `playsBlockAnimation()`.

He attacks as the player slides into the pit: his first attack came the next tick, as captured.

How often he stamps, knocks back or stays at range isn't documented. The odds in the data are estimates from the capture.

**The pit:** the rocks (29491) slide the player in or out (1148): "You climb into the pit." / "You climb out of the pit."

## Bryophyta

From the capture; stats and rules from the Wiki: 115 HP, max hits 16 (melee) and 10 (magic), attack speed 6, poison 8. Her lair is multi-combat.

- **Attacks:**
  - **Melee:** animation 4658, sometimes poisoning.
  - **Magic:** animation 7173, an earth blast (139) that lands at 46 + 10 client cycles a tile. Its heights are the capture's 172 and 124, stored as 43 and 31 because the server sends projectile heights times 4.
- **Growthlings:**
  - Each attack has a 1/5 chance to summon three. Only one batch is alive at a time, at least 20 ticks apart.
  - While any lives, she takes no damage.
  - A hit with a woodcutting axe or magic secateurs equipped kills one at once: "You prune the Growthling." Battleaxes, the zombie axe and the blessed axe don't count.
  - Any other attack gets "Cut the growthling down with an axe or secateurs." It can hurt the growthling but never kill it: the last hit point stays.
- **The logs:**
  - With no axe: "You take a bronze axe from the logs." The axe grows back about 49 ticks later.
  - With an axe: "You already have an axe."

## Giant bones

- **Take:** "I don't think those will fit in my backpack..."
- **Bury** (their own ground option):
  1. "Bury the bones? (This grants Prayer XP)" ("Yes." / "Yes, and don't ask again." / "No.").
  2. On yes, they're buried where they lie: animation 827, sound 2738 and 150 Prayer XP, with no message.

**Changes this needs:**
- **Client:** a ground item's options other than Take used to just close the menu. They are now sent with their name and number.
- **Server:**
  - a named option other than Take goes to the item's own handler, even in a private area;
  - the pickup hook fires in private areas, as it did before.

## Diary tasks

| Diary | Task | Trigger |
| --- | --- | --- |
| Varrock hard | Squeeze through an obstacle pipe in Edgeville dungeon | The pipe shortcut (Agility emits `agility:obstacle`) |
| Varrock medium | Get a Slayer task from Vannaka | Any assignment from him (Slayer emits `slayer:task-assigned`) |
| Wilderness easy | Kill an Earth Warrior in the Wilderness beneath Edgeville | A kill in the dungeon's Wilderness part |

## Not modelled

- Combat Achievements, and the music unlock lines.
- The "sneaking suspicion" scroll-box message (no clue system).
- The Bryophyta gate's "Check-Count" option (its response isn't captured).
- Free-to-play drop tables (the members tables are used).
- The giantsoul amulet's teleport, and changing worlds inside a lair.
- The steel key ring.
