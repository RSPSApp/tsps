# Leechfin fishing (Vampyrium, The Blood Moon Rises, 30 June 2026)

Two river spots south of the Ruined Village in Vampyrium, fished with a big fishing net by aligning the net with the lane a fish swims in (the same river fishing as Neypotzli's bream spots), the leechfin
that comes of it, cutting it for Cooking XP and blood sacs, and squeezing 50 sacs into a vial of blood.
Code: the river unit `plugins/bosses/moonsofperil/River.MoonsOfPeril.js` (a spot's `method`, data `river.methods.leechfin` and the two spots in `plugins/bosses/data/moons-of-peril.json`) and
`plugins/skills/LeechfinFishing.plugin.js` (cutting and squeezing). Tests: `server/tests/leechfin-fishing.test.cjs`; `server/tests/moons-of-peril-river.test.cjs` pins the bream behaviour on main and on this branch.

## Sources

| Page / evidence | sha256 (first 16) |
| --- | --- |
| [Leechfin](https://oldschool.runescape.wiki/w/Leechfin) raw wikitext (fetched 2026-11-14) | `ff9c4131febcda94` |
| [Fishing spot (river)](https://oldschool.runescape.wiki/w/Fishing_spot_(river)) | `28f5ad02e896f992` |
| [Blood sac](https://oldschool.runescape.wiki/w/Blood_sac) | `87b1e3d831a327cf` |
| [Vial of blood](https://oldschool.runescape.wiki/w/Vial_of_blood) | `81101ef66e49d899` |
| Revision 242 cache (id 2757): locs 62191-62195, varbits 15453/15454, items 33621/33623/22446/229, the map's placements in region 10874 | HF probes |
| RSProx | no recording has the content (searched locs 62193-62195 and the text "leechfin" / "slips past your net": none); the pattern and the numbers are the Wiki's |

## Cache facts

- `river_fishing_spot` (62193) and `river_fishing_clickzone` (62191) are multilocs on varbit `river_fishing_is_fishing` (15454): idle, the spot is 62194 "Fishing spot" (Fish); fishing, spot and click zones are
  62192 "Stream" (Align-net). `river_fishing_dir` (15453) is the lane the net points at. The map has the spot loc at (2710, 7819) and (2721, 7825) with a box of click zones, three columns by four rows, north of each.
- Items by name: `leechfin` 33621 (Eat, Drop), `blood_sac` 33623 (Squeeze, Drop, stackable), `vial_empty` 229, `vial_blood` 22446 (the tradeable vial of blood), `knife` 946, `fletching_knife` 31043.

## What it does

- **Spots.** After The Blood Moon Rises, 78 Fishing and a big fishing net (no bait); the level is only checked when the fishing starts. Align-net in a stream tile points the net at that column.
- **Catch.** Success chart 30 to 220 out of 256 (level 1 to 99): 33.2 XP and a leechfin (the angler's outfit's bonus applies); a fish that gets away gives 3 XP and "The fish slips past your net!".
  The fishing stops on a walk, a full inventory, logout, or 30 seconds without a click.
- **Rhythm.** 22 fish a cycle: the first 7 in different columns, the next 2 in the same, the next 5 in the same, the next 4 different, the next 2 the same and the last 2 different, then a pause.
- **Cutting.** A knife or a fletching knife on a leechfin cuts it: 20 Cooking XP and a 1/3 chance of a blood sac; cutting ends the fishing and then goes on one leechfin a tick.
- **Squeezing.** 50 blood sacs and an empty vial make a vial of blood. Without a vial: a warning, then "You squeeze a sac. It empties onto the floor." and the sac is spent.
- Bream behaviour at Neypotzli is unchanged (the river unit's other spots keep every top-level setting).

## Approximations and what is not done

- **approximation** The fish's timing: one fish a tick, and a 7-tick pause after each cycle; the Wiki gives neither (the pause is "enough time for 6-7 to be cut"). One a tick with the 22-fish cycle reproduces the Wiki's
  best rate of about 131,000 XP an hour at 99 Fishing. The fish's journey (the projectile legs and their distance) is Neypotzli's, and the Vampyrium click zones lie north of the spots, so the fish are drawn swimming in from the north.
- **approximation** "Different" is each fish in a column other than the one before it; "same" is one random column for the whole group (the first of a group may share the column of the fish before it, as the Wiki's own example does).
- **approximation** The messages for a Fishing level under 78 (the bream line with the level changed), the squeeze warning and "You need 50 blood sacs to fill a vial." are ours; the Wiki only says a warning is given.
- **approximation** The angler's outfit bonus applies to a catch, not to the 3 XP of a slip (the Wiki says only that the outfit gives bonus XP).
- **not done** The leechfin's Eat option and its Wiki trivia line ("That would be a unwise. Maybe in a sandwich..."); fish barrels refusing leechfin and fishing enhancers (the Wiki says they do not work on it); the Heron pet roll, the collection log and League tasks; the Hunter-style autocut interface details (the cutting starts from the item on item); blood sacs from Venators and the Maggot King; in-client rendering of the leechfin fish swimming (the cache has a `npc_leechfin_swim01` sequence we do not draw).
