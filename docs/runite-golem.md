# Runite Golem

Runite Golems in the Wilderness Resource Area (spawns at 3191,3934 and 3178,3938), and the Wilderness Diary elite task "Smith a rune scimitar from scratch in the Resource Area" built on them. Built from the OSRS Wiki and the cache. No rsprox capture shows a golem's death or its rock, and no client has run this, so the sections below say which parts are the Wiki's and which are ours.

| File | What it owns |
| --- | --- |
| `server/plugins/npcs/RuniteGolem.plugin.js` | The death, the rock, its spent form, who killed it. |
| `server/plugins/skills/Mining.plugin.js` | The `mining:mine-npc-rock` seam, which mines an NPC by a named rock's rules. |
| `server/plugins/achievements/diaries/WildernessResourceDiary.plugin.js` | The task's steps. |

## The golem

From the Wiki:

- A killed golem's head becomes a rock, minable by anyone with 85 Mining for 125 Mining XP.
- The rock lasts 1 minute. The golem respawns 5 minutes afterward.

| What | How |
| --- | --- |
| Forms | 6600 the golem, 6601 the rock (Mine), 7722 the spent rock (no options). All from the cache. |
| Mining | Through Mining's own loop as "Runite rocks": pickaxes, gem rolls, an infernal pickaxe, pets and clue geodes all apply. |
| While it's a rock | 1 hitpoint, locked. In the cache, neither form has Attack or is attackable, which refuses clicks and combat spells. The lock stops anything killing it again, such as a poison tick, and stops it regenerating. The death cures poison, so no splat shows. |

Ours, with no source:

- **One ore per rock**, then form 7722 for what's left of the minute. Supported, not stated, by the Wiki's 14 October 2026 change, which speaks of "successfully mining" and of "at least one Runite Ore from a Runite Golem before it respawns".
- **The chance per swing** is the Runite rocks chart, as the golem's Mining info gives only the level and XP. The same change says the chance "has been increased" with no number, so this may understate it.
- **One ore each time.** The Wiki gives diary tiers a chance of 2, 3 and 4 total ores, with no rate.
- **The rock stays where the golem died.** The death task's movement block is never lifted on this NPC.
- **A second miner's session stops silently** when the rock is spent, and the spent rock has nothing to click.

Not built:

- Mining's effect on melee against the golem.
- Varrock armour 4's doubling.
- Expert Mining Gloves' chance to prevent depletion.
- The dark bow bug.

## The diary task

From the Wiki, in order:

1. Kill two separate Runite Golems and mine each. Ore an infernal pickaxe destroys still counts.
2. Smelt two runite bars in the nearby furnace. Superheat Item doesn't count.
3. Smith the rune scimitar on the anvil.

Completing or updating any other task in between resets the progress. This also applies to "Cut and burn some magic logs", which now resets when another task takes a step, as well as when one completes.

Mining a rock another player's kill left gives the ore, but no step, as the Wiki says "you must kill".

Ours, with no source:

- **"Separate"** is each golem's spawn tile.
- **The killer** is the player who did the most damage, as for drops.
- **The steps count in that order.** Bars count only after the second golem.
- **The progress survives a logout**, like the file's other two-step tasks.
- **Steps are the actions, not the items.** A bought bar can't stand in for a smelt, but two other bars can be the ones hammered.

## Tests

`server/tests/runite-golem.test.cjs` drives the rock, the furnace and the anvil by real packets. The killer is mocked into a real `NPCDeathTask` rather than fought, `Math.random` is held low inside Mining's task alone so a swing lands, and golems are made at the spawn tiles rather than taken from the world's own spawns. Its header lists what's emitted directly.
