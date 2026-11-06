# Agility

`Agility.plugin.js` plays the courses (`courses/`, code) and the shortcuts
(`plugins/skills/data/agility-shortcuts.json`, data) through `ObstacleRunner.Agility.js`, a step list run one
game tick at a time.

An explicit `{ merge: { start, end, minX, minZ, maxX, maxZ } }` step schedules
the legacy merge packet for the player and its current observers. Delays are
20ms client cycles; signed bounds are relative to the loc anchor and may be reversed.
The active revision241 client consumes it without a rendering change. Collision, the map object and saved state remain intact.

## Shortcuts

Each entry in `agility-shortcuts.json`'s `shortcuts`:

| Field | |
| --- | --- |
| `name` | The Wiki's name and the place: `"Stepping stones (Lumbridge Swamp Caves)"` |
| `object` | Cache loc id, or a list of ids (`yarn dump:loc <id\|name>` lists where they are placed) |
| `at` | Optional: the loc's tile, or a list of tiles, when one id is several shortcuts |
| `level`, `xp` | Agility level and experience (Wiki) |
| `start`, `end` | Optional messages at the start and on success |
| `render` | Optional walk animation for the whole crossing (`"BALANCE_WALK"`) |
| `route` | Optional tile the player walks to before starting |
| `requires` | Optional: alternatives, any one of which lets the player use it (below). Without it, `level` is the Agility needed |
| `fail` | Optional: the chance (`low`/`high`, the Wiki's success chart), `xp` and `steps` of a failure, or `cross: true` and `hit` (a range, or `{ "percent": 5, "plus": 1 }` of the player's Hitpoints) and `hits` (how many) when a failed attempt still gets across |
| `unverified`, `note` | What has no capture behind it, or where a value comes from (`rsprox captures <ids>`: see `docs/agility-shortcuts.md`) |

and one way to play it:

| Kind | |
| --- | --- |
| `steps` | A step list (below) |
| `between` | A two-way crossing: `ends` (two tiles), optional `via` (tiles in between, listed from the first end) and `cross`, the steps from one end to the other, or `{ "forward": [...], "back": [...] }` when the two directions differ |
| `stile` | A two-tile stile: `axis` (`"x"`/`"y"`), `before`, `after`, `anim` |
| `script` | A named script from `shortcuts/<Region>.Agility.js` or `shortcuts/Common.Agility.js`, given the entry's `params`, for what a template can't say (which way the player faces, which rock they clicked). Its `route`, `precondition` and `steps` replace the data's |
| `refuse` | A message: the loc can't be used from there, or `{ "mesbox": text }` when the game also shows it in a message box |

### Requirements

`requires` is a list; the first alternative the player meets is used, and its `steps` (and
`start`, `end`) replace the entry's. On a `between` entry an alternative can give its own
`cross` instead, played between the same two ends (a barehanded climb beside a grapple).
Otherwise the player gets the first alternative's refusal.

| Key | |
| --- | --- |
| `skills` | `{ "agility": 11, "strength": 37, "ranged": 19 }`, current (boosted) levels |
| `equipped` | `[{ "slot": "weapon", "name": "crossbow", "message": ... }, { "slot": "ammunition", "ids": [9419], "message": ... }]` |
| `items` | `[{ "ids": [...], "message": ... }]`, carried |
| `quest` | `{ "key": "regicide", "stage": "complete" \| "started", "message": ... }`, or a list; asked through `quest:is-complete` / `quest:is-started`. A quest no plugin answers for is no bar |
| `diary` | `{ "key": "falador", "tier": "medium", "enforce": false, "message": ... }`; checked through `diary:is-complete` only once `enforce` is true, when that tier's tasks can all be done here |

### Failing

With `low` and `high`, success is the OSRS skilling roll the Wiki's success charts plot:
`(1 + floor(low × (99 − L) / 98 + high × (L − 1) / 98 + 0.5)) / 256` at Agility level `L`.

### Steps

The runner's steps (see the top of `ObstacleRunner.Agility.js`): `anim`, `render`, `walk`, `move`, `tele`,
`wait`, `face`, `faceDir`, `hit`, `msg`, `sound`, `areaSound`, `gfx`, `objAnim`, `varbit`, `complete`. A `msg`,
and an obstacle's `start` and `end`, is a game message, or `{ "spam": text }` or `{ "mesbox": text }`. In the data:

- **Animations by name**, from `Constants.Agility.js` (`Anim`) and `shortcuts/Builders.Agility.js` (`ShortcutAnim`):
  `{ "anim": "CLIMB_ROCKS" }`; `-1` resets.
- **Builders as macros**: `{ "use": "hops", "args": ["object", "to"] }`. `climbOver`, `jump`,
  `hops`, `pipe`, `tunnel`, `crevice`, `crawlDown`, `crawlUp`, `ropeSwing`, `hurdle`, `climb`.
- **Tokens**: `"object"` (the clicked loc's tile), `"to"` and `"from"` (a crossing's ends),
  `"via0"`, `"via1"` ... and `"...via"` (its `via` tiles in travel order), single coordinates
  (`"pos.x"`, `"object.y"`).
- **Relative tiles**: `{ "object": [0, 1] }` from the loc, `{ "pos": [0, 4, 0] }` from the player;
  with a third number the tile carries a plane.
