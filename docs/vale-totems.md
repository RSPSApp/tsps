# Vale Totems

The Fletching minigame in the Auburn Valley, built from the OSRS Wiki ("Vale Totems", "Totem site", "Vale offerings", the Vale Totem creation template), rsprox captures (recordings 1098, 1100, 1105, 1108, 3127 and 3276 on https://rsprox.net/database) and the cache. It is one plugin, `server/plugins/minigames/ValeTotems.plugin.js`, with its units in `server/plugins/minigames/valetotems/` and its data in `server/plugins/minigames/data/vale-totems.json`.

The captures were all recorded on Leagues VI and Grid Master worlds. Leagues multiplies the offerings a player collects by 4 (the Wiki calculator's "League offering multiplier"): the captured pile varbit held 10 for a decorated oak totem and "You collect 40 offerings." followed. Everything else matched the Wiki, so the plugin follows the varbit and the Wiki.

Status:
- **Done:**
  - building, carving and decorating at all eight sites, with the Fletching level per wood, run energy and Construction xp;
  - the ents' visit every 80 ticks: offerings, durability, collapse and new spirits;
  - the spirit NPCs at each site;
  - claiming and inspecting offerings;
  - Rummage, Hasty-rummage and Inspect on Vale offerings, with the loot table, research points and collection log;
  - `::entvisit` for testing.
- **Not done:**
  - the Vale Totems miniquest (Ranulph and Isadora). Until it exists, anyone with the Fletching level can play;
  - the ents walking their route, ent trails (double offerings and +15% xp for four actions, `ent_totems_trail_*`), and admiring beautiful scenery for run energy;
  - the durability leaves above a totem (a head icon on `ent_totems_site_icon`) and the spirits' spawn and despawn animations;
  - Ranulph's Vale Research Exchange (research points to spend);
  - the fletching knife's faster actions, the Carpenter's outfit bonus, ent seeds and the clue nests;
  - filterable ("spam") chat messages, which the server doesn't support yet.

## Layout

| File | What it owns |
| --- | --- |
| `Shared.ValeTotems.js` | The data, ids by cache gameval, captured animations and sounds, dialogue helpers and the one repeated action per player. |
| `State.ValeTotems.js` | The ent_totems varps and varbits: reading, writing, saving, restoring at login, and which players the visits apply to. |
| `Totems.ValeTotems.js` | Build, Carve and Decorate. |
| `Offerings.ValeTotems.js` | The offerings pile (Claim, Inspect) and the Vale offerings item (Rummage, Hasty-rummage, Inspect). |
| `Loot.ValeTotems.js` | One roll of the rummage loot table. |
| `Ents.ValeTotems.js` | The 80-tick visit cycle and the spirit NPC spawns. |
| `Commands.ValeTotems.js` | `::entvisit`. |

## State

A player's state is the client's own varps, which the cache's multilocs and multi-NPCs read: `ent_totems_site_N_a` and `_b` for each site, and `ent_totems_research_points`. They are saved as one attribute (`vale-totems:varps`) and sent again at login.

| Varbit | Values |
| --- | --- |
| `site_N_base` | The totem's wood: 0 none, 1 oak, 2 willow, 3 maple, 4 yew, 5 magic, 6 redwood. |
| `site_N_base_carved` | 1 once all three animals are carved. |
| `site_N_base_multiloc` | Spans both: 0 shows the Totem site (Build), 1-6 the uncarved totem (Carve), 9-14 the carved one (Decorate). |
| `site_N_low`, `_mid`, `_top` | 1-6 uncarved (the wood), 10-14 carved: 9 + the animal (1 buffalo, 2 jaguar, 3 eagle, 4 snake, 5 scorpion). |
| `site_N_decorations` | 0-4. |
| `site_N_decay` | The durability left: oak 2, willow 3, maple 4, yew 5, magic 6, redwood 7. |
| `site_N_points` | The offerings pile; above 0 it shows the Offerings loc (Claim, Inspect). |
| `site_N_animal_1..3` | The three spirits at the site. |
| `site_N_multianimal_a..e_1` | 1 shows that spirit's NPC (`ent_totems_site_N_animal_X_1`). |

The sites' base locs are `ent_totems_site_N_base` (57016 + 6 × (N − 1)), with the offerings loc beside it. Sites 2 and 6 were never clicked in the captures; their tiles are the Wiki's two remaining Totem site locations.

## Captured behaviour

- **Build:** a tick after arriving, the log is used, with `human_pickupfloor` and sound 1739 and the message "You erect an oak totem.". The carve menu opens on the same tick. "You don't have any logs to build a totem with." when there are none.
- **Carve:** skillmulti mode 34, one at a time: "What animal would you like to carve?" with Buffalo, Jaguar, Eagle, Snake and Scorpion and their `ent_totems_animal_icon_X` items. Carved ones show the `_disabled` icon.
  - Choosing one plays `human_pickuptable_walkmerge` with sound 10384 (delay 15) and says "You carve a buffalo into the totem.".
  - The third carving sets `base_carved`, the carved `base_multiloc` and the durability.
- **Decorate:** `human_pickuptable_walkmerge` with sound 2739 (delay 20). A tick later the item goes and "You decorate the totem." shows. The next decoration starts the tick after that.
  - The fourth says "You add the final decoration to the totem.".
  - A fifth gets the mesbox "You have already added as many decorations as possible to the totem.".
  - With nothing to use: "You don't have anything to decorate the totem with.".
- **Ent visits:** every 80 ticks every site is visited at once.
  - A fully carved totem gets its offerings and loses a point of durability. At 0 it collapses, with every site varbit back to 0, on the same visit.
  - A site with no totem gets three new spirits. A built totem, carved or not, keeps its spirits.
- **Offerings per visit:** the Wiki's table, the wood's base plus an amount per decoration: oak, willow and maple 2 + 2, yew 3 + 2.5 (rounded down), magic and redwood 3 + 3. Recorded visits matched it for oak, maple, yew and magic.
- **Claim:** a tick after arriving, `human_pickupfloor` with sound 2582 and "You collect 40 offerings.". **Inspect:** "There are ten offerings here." (mesbox).
- **Rummage:**
  - Uses 100 offerings every 2 ticks while there are enough. Each plays sound 1412 with "You rummage through the offerings..." and "You find some loot: 26 x Dirty arrowtips" ("You find some loot: Bird nest" for one), and gives a research point.
  - The first point ever also says "You now have 1 Vale Research Point!" (green) and "Ranulph offers rewards to those who help with his research.".
  - With fewer than 100, an objectbox: "You don't have enough offerings to rummage through.<br>You need at least 100.".
- **Hasty-rummage:** up to 500 at once: "You rummage through the offerings four times..." then a loot line per rummage.
- **Inspect (item):** an objectbox, "You have enough offerings to rummage through them<br>once. You've earned 0 Vale Research Points." (green numbers, "4<br>times" for more).

## Estimates

These are not in the captures or the Wiki:

- **Wrong animals:** one maple totem with one wrong animal got 6 offerings instead of 10, the only sample. Each wrong animal takes 40% off here. The Wiki only says "significantly fewer".
- **Messages:** "You need a Fletching level of 50 to build a maple totem.", "You need a knife to carve the totem.", "Hasty-rummage twice/three times/five times", and the pile's Inspect above twenty, which shows digits.
- **Log choice:** with several logs, the best one the player has the level for is used.

## Checking it

- `node --test server/tests/vale-totems.test.cjs` (after `yarn build`) covers building, carving, decorating, visits, claiming and rummaging.
- With the agent MCP: teleport to site 3 (`tele 1386 3276 0`), give oak logs, a knife and four oak shortbows (u), then `object_option` Build, Carve and Decorate on loc 57028 at 1385, 3274. `::entvisit` runs a visit at once.
