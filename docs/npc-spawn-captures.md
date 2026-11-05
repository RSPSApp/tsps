# NPC spawns from captures

`yarn refine:npc-spawns` (`server/scripts/refine-npc-spawns.ts`) corrects how existing spawns in `server/data/definitions/npc-spawns.json` stand, from what live OSRS shows in rsprox captures. It never adds or removes spawns.

## The captures

The capture index builds a sites file from every recording ([rsprox.net capture database](https://rsprox.net/database)):

```sh
python3 rsprox_index.py npc-sites --out npc-sites.json
```

Each **site** is one NPC at one place, gathered across recordings from the game's NPC updates: where it appears, the direction it faces when it comes into view, and every step it takes. Per site:
- **`watched`:** how often it was in view for 20+ ticks without engaging a player.
- **`still_share`:** how often it never left its tile.
- **`facing`, `facing_share`:** the direction it stood facing, and how many sightings agree.
- **`range_p90`:** how far from the site 90% of its sightings were, in tiles (the larger axis).
- **`labels`:** followers, roaming NPCs, props, instances and special-world-only NPCs. These are never used to change a spawn, except `unnamed`, which only says the NPC is a nameless multinpc parent (Aubury's `aubury_3op`).

The file holds NPC data only, no player names.

## The refinement

```sh
cd server
yarn refine:npc-spawns --sites npc-sites.json           # dry run: what would change
yarn refine:npc-spawns --sites npc-sites.json --write   # change it
```

1. **Pairing:** each spawn is paired with the site of the same NPC (same id, or same name for interchangeable copies) nearest to it on its plane, within 2 tiles (`--reach`), one to one.
2. **Stand still:** when the NPC stood still in at least 90% of 3+ watched sightings, the spawn gets `wanderRadius: 0`.
3. **Facing:** when, standing still, more than half of the sightings agree on a facing that differs from what the spawn gets now (its own `direction`, else south, the default), the spawn gets that `direction`. A majority is enough because NPCs that serve players turn towards them, so sightings catch them turned: the Grand Exchange's north clerks face north in only 61–65% of them, and its west banker faces west in 79%.

4. **Wander range:** an NPC that walks and can't be attacked (no form offers Attack) gets its `range_p90` as `wanderRadius`, at least 1, when that's less than what it has now (the loader's default is 5). A monster's sightings include chasing players, so they don't measure its wander; and no radius is widened.

Options: `--min-watched`, `--min-facing` (default 0.5), `--reach`, `--only still|facing|wander`, and `--spawns <file>` to refine another copy of the spawn file.

**Directions** are in the spawn numbering, counted from south-west: 0 south-west, 1 south, 2 south-east, 3 west, 4 east, 5 north-west, 6 north, 7 north-east.

## The first run

On the spawns from before the Wiki batches, from 4,282 recordings (2026-10-08):
- 10,826 of 24,385 spawns paired with a site;
- **302 now stand still:** Iffie in Varrock, the Grand Exchange clerks, tool leprechauns, soldiers, guards, bakers, bartenders, the Sawmill operator and more. Without a `wanderRadius` they had wandered up to 5 tiles;
- **238 got a facing** other than south: soldiers and Shantay guards at their posts, ghost guards, thrower trolls, bankers (the Grand Exchange's face out of their booths), shopkeepers, fishing spots and disguised crabs.

## The second run

On the spawns the Wiki batches added (Varlamore, the Sailing islands, Varlamore's underground, the dungeons), once those were merged: **134 changed**, all Wiki spawns.
- **108 now stand still:** Varlamore's guards, capybaras, frogs, bartenders, the Hunter Guild, the shipwrights and others.
- **96 got a facing:** guards, bankers and bartenders at their posts, the disguised sand crabs, Pellem and Guildmaster Apatura facing north at the Hunter Guild, Shipwright Scott facing west at Port Roberts.

The port masters from the courier tasks were already placed from captures, so nothing changed for them.

## The Shayzien drill formation

The soldiers drilling in Shayzien (the cache's `shayzien_exercise_*` NPCs) now stand still, set by hand. They had wandered and faced south, so the formation fell apart.
- **The rows:** 31 soldiers in four rows at x 1503–1517, y 3639–3645 (the second row has a gap at 1505, as in live OSRS). They face north (`direction` 6).
- **The Drill Sergeant:** (1510, 3647), in front of the rows, faces south towards them (the default).
- **Evidence:** one recording, 32 sightings, one per NPC. All stood still the whole time; the soldiers faced north while punching and kicking (`human_unarmedpunch`, `human_unarmedkick`), and the sergeant faced south.
- **Why by hand:** the capture index counts an NPC facing another NPC as engaged, and drilling soldiers face whoever leads the drill. So it has no usable sightings of them, and `refine:npc-spawns` leaves them alone; a rerun doesn't undo this.
- **The drilling itself** (the punches and kicks) is ambient behaviour, for a later feature.

## Wander ranges

Issue #1706: the Blue Moon Inn's bartender and Aubury walked out from behind the counter and out of the shop, on the default `wanderRadius` 5. Live they stay within 2 and 3 tiles (44 and 32 recordings). The wander step (4 above) ran with `--only wander` on 4,282 recordings: **1,598 spawns** got a tighter radius, all NPCs that can't be attacked: shopkeepers and bartenders, citizens, workers, squires, Trader Crewmembers, butterflies, sheep and so on. A second run changes nothing.

**Not done yet:**
- **wander ranges for monsters**, which need sightings that leave out their fights;
- **ambient lines and animations**, which need a small feature to play them.
