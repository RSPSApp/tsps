# Woodcutting Guild

The guild is part of the Woodcutting plugin.

| Part | File |
| --- | --- |
| The gates, the cave, the vine, the roots, the diary tasks | `server/plugins/skills/woodcutting/Guild.Woodcutting.js` |
| Ent trunks | `EntTrunk.Woodcutting.js` |
| The egg shrine | `Shrine.Woodcutting.js` |

Data lives in `server/data/definitions/woodcutting-guild.json`. Praying at a shrine is the Altars plugin's job.

The facts come from rsprox captures (`rsprox/wcguild/`), the OSRS Wiki and the cache's map.

## Gates
There are two pairs of gates, 28851 and 28852:
- **East pair:** at 1657, 3504–3505. The guard Berry (7235) stands beside it.
- **West pair:** at 1562, 3487–3488.

Going in needs 60 Woodcutting. Leaving needs no level.

| Tick | What happens |
| --- | --- |
| The player arrives | — |
| +1 | Each half becomes an invisible wall (38848), with its open gate (28853/28854) beside it. Sound 62 plays. The player steps through. The guard says "Welcome to the Woodcutting Guild, adventurer." |
| +3 | The gates are shut again. |

Going in completes Kourend & Kebos hard "Enter the Woodcutting Guild". The below-60 message is the server's existing one; it hasn't been captured.

## The Ent dungeon
- **The Cave** (28855, "Enter"): the next tick you're in the dungeon at 1596, 9900. There's no animation.
- **The Vine** (28856, "Climb"): animation 828, then the next tick you're back at 1606, 3508.
- **The Roots** (26720 and 26721, "Step-over"; each root is a two-tile piece): animation 1603 and sound 2461, then a slide (15 and 30 cycles) to the tile across the root. There's no Agility requirement.

## Ent trunks
**Becoming a trunk.** A dead Ent stays where it fell: it plays its death animation (12508), and 4 ticks later the same NPC turns into an Ent trunk (9474). This uses a generic core option: an NPC death handler can leave the NPC in the world as remains (`remains` on the death event). The Wiki rules:
- the trunk lasts 101 ticks;
- in the guild the Ent respawns 50 ticks after the trunk is gone; in the Wilderness, 15.

**Chopping it.** Only the Ent's killer may chop its trunk.
1. "You swing your axe at the Ent trunk."
2. An attempt every 3 ticks (captured).
3. Each success gives a noted log, 25 XP, "The ent carcass yields: 1 x Magic logs" and the usual 1/256 bird nest chance. In the Wilderness a success gives 2 logs.

Being attacked doesn't stop the chopping. In the capture an Ent hit the player mid-chop and the chopping went on. So while you chop, auto-retaliate stays off: the player carries the generic `combat:no-retaliate` flag, which the core now honours for players as it already did for NPCs. Walking away ends the chopping, and retaliation comes back.

Ents no longer drop 12 logs when killed: their logs only come from the trunk.

**Ent animations.** Both Ents (guild 7234 and Wilderness 6594) share one rig. They now use their captured animations: attack 12506, block 12504, death 12508, and death sound 824 (`npc-combat-defs.json`). Before this they fell back to the generic human punch and block.

**Which log.** The type depends on your base Woodcutting level and your axe (Wiki):
- plain logs only below 45;
- yew from 61;
- magic from 75.

The Wiki gives the rarity only as "Varies", so two numbers in the data file are estimates from the capture (99 Woodcutting, dragon axe):

| Estimate | From the capture |
| --- | --- |
| The success chart | 17 successes in 31 attempts, about 55% |
| The log weights | 8 magic, 4 oak, 1 yew, 1 maple, 1 willow |

Magic logs get more likely with better axes.

## The shrine
**Praying** (29088, "Pray-at"): the Altars plugin answers "Shrine" as it answers altars. With full Prayer you get the captured line, "You already have full Prayer Points."

**Offering a bird's egg** (red 5076, blue 5077, green 5078):
1. "You offer your bird's egg to the shrine and receive a reward."
2. "You have made <col=ff0000>one</col> offering." (then "...2 offerings.", and so on).
3. Animation 3705.
4. A projectile and sound in the egg's colour:

   | Egg | Projectile | Sound |
   | --- | --- | --- |
   | Red | 1308 | 3047 |
   | Blue | 1307 | 1984 |
   | Green | 1309 | 1986 |

5. The egg becomes a seed bird nest (22798) in the same slot.

The Wiki adds 100 Prayer XP per egg, and a 1/1200 chance of each evil chicken piece instead of the nest. The capture showed no Prayer XP, but the Wiki is followed.

## Other diary task
Chopping redwood logs completes Kourend & Kebos elite "Chop some Redwood logs". The Woodcutting `woodcutting:success` event now carries `logId` for this.

## Not modelled
- The sawmill (Buy-plank): planned as a separate change.
- The redwood ladders: already handled by the generic ladders.
