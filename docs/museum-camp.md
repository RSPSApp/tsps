# Museum Camp improvements

`server/plugins/areas/MuseumCamp.plugin.js` builds Fossil Island's Museum Camp improvements;
its data is `server/plugins/areas/data/museum-camp.json`. The cleaning bench, the sixth
improvement, is built in `FossilStorage.plugin.js`.

## What the player does

Each improvement starts unbuilt in the camp's tents. Its Build (or Build on) option, with a
hammer (any hammer, carried or wielded: `items/Hammers.js`), the Construction level and the
materials, builds it. From then on the player sees the built form, and its own option is the
ordinary handler for that kind of loc.

| Unbuilt (option) | Built (option, handler) | Level | Materials | XP |
|---|---|---:|---|---:|
| Chest pieces (Build) | Bank chest (Use, `objects/BankBooths`) | 21 | 2 oak planks, iron bar, 5 nails | 250 |
| Ring of Stones (Build on) | Well (no option) | 22 | 2 oak planks, bucket, rope, 5 nails | 500 |
| Fire pit (Build on) | Cooking pot (Cook, `skills/cooking/Cookers`) | 24 | 2 logs, iron bar, 3 soft clay; a tinderbox is kept | 800 |
| Broken Spinning Wheel (Build on) | Spinning Wheel (Spin, `skills/crafting/Spinning`) | 28 | 4 oak planks, 5 nails | 1,000 |
| Half-built Loom (Build on) | Loom (Weave, `skills/crafting/Spinning`) | 29 | 2 oak planks, rope, 5 nails | 1,000 |
| Table parts (Build) | Fossil cleaning bench (`areas/FossilStorage`) | 5 | 5 planks, 5 nails | 100 |

Levels, materials and experience are the Wiki's ([Museum Camp](https://oldschool.runescape.wiki/w/Museum_Camp)).

## Cache

Each improvement is a multiloc (`fossil_bank_chest`, `fossil_cleaning_bench`, `fossil_well`,
`fossil_range`, `fossil_spinning_wheel`, `fossil_loom`) on its own 1-bit varbit (`fossil_bank`,
`fossil_bench`, `fossil_well`, `fossil_range`, `fossil_spinning_wheel`, `fossil_loom`): bits 0-5 of
varp 1632. `fossil_camp` is the same six bits read together, so it follows on its own. The built
set is saved in the `museum-camp:built` attribute and its varbits are sent at login.

## Recorded behaviour

From rsprox captures 73, local 1000187, 1000189 and 1000410 (rev 227, Leagues V worlds):

- The build animation (`human_poh_build`) plays on the arrival tick; the materials go, the line
  "You build the cooking pot." / "You build the well." / "You build the spinning wheel." is sent and
  the varbit turns 1 the tick after. The level-up, if any, follows on the next tick.
- Refusals are a game message and the same line in a message box:
  "You need at least level 28 Construction to build that.",
  "You need a tinderbox to build the cooking pot.",
  "You need 1 x Iron bar, 2 x Logs, 3 x Soft clay to build that.",
  "You need 2 x Oak plank, 1 x Bucket, 1 x Rope to build that." The missing list keeps that order.
- The tinderbox is kept. Any nails do (recorded: steel and iron).

## Ours

- No recording builds the bank chest or the loom: their lines follow the recorded pattern.
- The hammer line ("You need a hammer to build that.") and "5 x Nails" in the missing list are not
  recorded. Whether the list gives the full amount or only the shortfall is not recorded either;
  it gives the full amount.
- The order of the checks (level, tinderbox, hammer, materials) is ours beyond the recorded
  tinderbox-before-materials.
- The personally built spinning wheel uses the existing one-tile, clear-line approach contract
  for Spin and material-on-wheel input. Its placed parent (31431 at 3732, 3823, rotation 3)
  otherwise turns the built child's (30934) ordinary access mask toward blocked scenery.
  This is a local integration choice; no recording establishes a retail approach tile.
  Construction costs, personal built state, map collision and the shared spinning recipe are unchanged.
