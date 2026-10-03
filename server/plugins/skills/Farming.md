# Farming plugin

The loader entry is `Farming.plugin.js`; the parts are in `farming/`, one file each:
`Patches` (every hook, patch actions), `Data` (crop and patch tables), `Model` (growth),
`Services`, `Spells`, `Tithe`, `Guild` and `Hespori`, all `*.Farming.js`. They read
`api.core` through `Core.Farming.js`, which the plugin fills before loading them.

Implemented: player-owned patches, saved offline growth, raking, planting,
watering, disease and cures, harvesting, regrowth, compost bins and bottomless
buckets, saplings, gardener payments, leprechaun storage/noting, seed vault,
seed boxes/herb sacks, contracts and rewards, anima plants, farming spells,
amulets, barbarian Farming, Tithe Farm, and a private Hespori encounter/retrieval
service. The generated cache data identifies 110 grouped patches and 40 Tithe
plots; gameplay tables contain 82 crops. XP follows the server's configured rate.

## Comparison with TSPS PR #141

Compared against [PR #141](https://github.com/RSPSApp/tsps/pull/141) at
`718cb8b24202f221a335dd89148e11c245a4fda7`:

- Its 58 crops are already covered. Its 48 patch locations are now covered too:
  the exporter previously missed Port Phasmatys's flower patch and compost bin
  because their regional models use different object IDs.
- Patch changes now send private object removal/re-add packets after the varbit,
  rebuilding the client's geometry for every map tile of the patch. Unchanged
  patches stay quiet; first visits and reused transmit varbits also refresh.
- Transformed click IDs already resolve through `MapObjects.getPrivateArea`,
  shared by object clicks, item use, and spells. No duplicate tile-only router
  was added.
- Cure/prune now follows the local cache's action and respects the supplied
  item. Wrong tools do not consume a carried cure. Lunar Cure Plant still
  bypasses physical tools.
- Watering cans support water pumps and house pumps/gold sinks, reject damaged
  Trouble Brewing pumps, and report empty cans when watering patches/seedlings.
  Herb picking and plant-pot filling use the corresponding farming animations.
- Existing ultracompost, gardener payments, leprechauns, sacks/baskets,
  flower/scarecrow protection, amulets, newer crops, Tithe, and Hespori remain
  available. The reference's simplified seed counts, harvest lives, compost-bin
  mixing, and growth rules were not substituted for our existing mechanics.

## Fidelity limits

This is **not a verified 1:1 implementation**. In particular:

- Unpublished disease/watering probabilities, some yield endpoints, Kronos
  skip probability, barbarian training failure probability, and Hespori's
  special/poison scheduling use estimates marked `ponytail:` in the code.
- Tree chopping uses the existing Woodcutting plugin's rates/depletion model.
  Redwood branch depletion does not yet reproduce OSRS's independent timers.
- Geomancy, storage, contracts, and Tithe rewards use existing dialogue menus;
  the original dedicated interfaces and Tithe overlay are not reproduced.
- Spirit-tree travel currently links player-grown trees. The ordinary network,
  quest-specific crops/access restrictions, achievement completion, and the
  wider quest/diary progression systems are not implemented by this plugin.
- The complete Zamorak equipment list for Bologa and the precise nightshade
  glove restrictions still need parity work.
- Region 25287 could not be decoded by the cache export. Its contents are not
  included in the patch coverage claim. No in-game or smoke tests were run.

## Verification

From `server/`:

```powershell
npx.cmd tsc --noEmit
node -r ts-node/register/transpile-only plugins/skills/farming/Model.Farming.test.js
```

The second command checks the state machine and mocked hooks without server startup
or sockets. It covers offline/save equivalence,
disease/death, mature immunity, private stump regrowth, herb formulas, critical
cache states, Tithe growth/scoring, null bank tabs, growth cadence, seedling deadlines
and nearby patch selection across region boundaries. Cache-only audits also checked crop item
resolution and growing, diseased, dead, and mature visual values.

To regenerate `data/definitions/farming-data.json` (one crop, patch type, patch or loc per line):

```powershell
node -r ts-node/register/transpile-only scripts/generate-farming-data.ts ../..\runelite
```

Sources: [Farming](https://oldschool.runescape.wiki/w/Farming),
[Disease](https://oldschool.runescape.wiki/w/Disease_(Farming)),
[herb calculator](https://oldschool.runescape.wiki/w/Calculator:Farming/Herbs),
[Tithe Farm](https://oldschool.runescape.wiki/w/Tithe_Farm),
[Hespori](https://oldschool.runescape.wiki/w/Hespori), and the linked crop/tool
pages (OSRS Index's attributed wiki copies were used where direct access failed).
RuneLite supplies timing/varbit interpretation; the local cache supplies object
transforms and map locations. The BSD-2-Clause attribution for the RuneLite-derived
data is kept in the JSON's `source` field.
