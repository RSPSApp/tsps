# Hunter

`Hunter.plugin.js` attaches hooks only; each activity is a module in this folder and reaches the
server through `api.core`. One shared tick task (`Runtime.Hunter.js`) drives cancellable actions, trap
lifetimes, creature respawns and session timers. Attribute state (birdhouses, crab traps, drift
nets, rumours, pursuit charges) is persisted and restored on login.

## Implemented

- **Trap families** (`Traps.Hunter.js`, `Rabbits.Hunter.js`, `Broavs.Hunter.js`): bird snares, box traps, deadfalls,
  net traps (swamp/orange/red/black/tecu salamanders), magic boxes/imp banking, monkey deadfall,
  rabbit snares flushed by ferret, and pitfalls with teasing (`Pitfalls.Hunter.js`).
- **Bait and scent**: tars, spicy tomato/minced meat, jerboa tail and kebbit baits (3% bonus for
  the matching creature), smoke from a lit/bruma torch or auto-applied anti-odour salt (2%).
  Ownership, per-kind trap limits (extra in the Wilderness), expiry/collapse and preflighted
  inventory transactions are enforced centrally.
- **Tracking** (`Tracking.Hunter.js`): five pursuit species, noose wand catches, ring of pursuit with
  10 persisted charges, trail varbits sent to the client.
- **Catching** (`Catching.Hunter.js`, `LuckyLoot.Hunter.js`): falconry, four butterflies, sunlight/moonlight
  moths with barehand and net curves, twelve impling species with rebuilt Wiki loot tables,
  released-butterfly boosts, and Lucky jars resolved through `hunter:lucky-loot` or the local
  reward-casket tables.
- **Birdhouses** (`Birdhouses.Hunter.js`): nine tiers, crafting, seeding (hop/herb/allotment/flower/
  bush), 50-minute wall-clock growth, nest/ring/egg/clue-nest/scroll-box rewards, reset.
- **Aerial fishing** (`Aerial.Hunter.js`): cormorant hire, king worms/fish offcuts/whole-fish feeding,
  Molch pearls, golden tench, spirit flakes, Rada's blessing, fish cutting and clue bottles.
- **Herbiboar** (`Herbiboar.Hunter.js`): five starts, cache-derived trail graph, fossil/numulite
  inspections, tunnel flush, 1-4 herbs by Herblore level with magic secateurs, Herbi pet.
- **Drift net fishing** (`DriftNets.Hunter.js`): Ceto access (daily/permanent numulite), two anchors,
  Annette's 2,000-net storage, active chase and passive capture, fish/fossil/clue rewards and
  bank-for-5-numulite, 44 Hunter/47 Fishing level-gated.
- **Crab traps** (`Crabs.Hunter.js`): red/blue/rainbow traps built with Construction, baiting,
  auto-rebait, crab meat/paste cutting.
- **Dungeon** (`Dungeon.Hunter.js`): seven Chambers of Xeric bats and the Neypotzli moss-lizard rope trap.
- **Rumours** (`Rumours.Hunter.js`): six guild hunters, eligibility and consecutive-rumour settings,
  rare-part pity/outfit rates, four loot sacks, quetzal-whistle blueprints and guild armour.
- **Broavs** (`Broavs.Hunter.js`): While Guthix Sleeps pit trapping, wild broav capture, hunting-expert
  training, release and pick-up.
- **Pets**: baby chinchompas, Herbi and Quetzin roll from `hunter:success`; spawns for the
  Varlamore creatures/moths, guild NPCs and tecu salamanders live in `npc-spawns.json`.

## Approximations and known limits

Catch curves use the Wiki's published success-chart low/high values with the 256-roll
interpolation in `Context.probability`. Where the Wiki publishes no numbers, the code carries a
`ponytail:` comment naming the estimate:

- Tatty-fur quality, Herbiboar's 1/100 tracking failure, birdhouse clue-nest pre-rolls
  (1-30/1500, marked approximate on the Wiki), drift-net scare odds/passive timing/fossil
  amounts, aerial pearl and clue rates, and rumour rare-part rates are estimates.
- Drift-net shoals are scared into swimming to the nearest non-full net and caught on arrival;
  they cannot get stuck on rocks, each other or the player.
- Pitfall prey follows the player and attacks on contact; leap graphics are validated against
  rev237 (`dump:spotanim`). Sunlight/moonlight antelopes use the Wiki's flat 255/255 chart.
- Lucky jars only give one clue-table roll; another plugin may answer `hunter:lucky-loot`.
- Wyrmscraig goats, Letvek and Stymphalak have no usable rev237 assets and are excluded. Aerial
  fishing uses king worms/fish offcuts because fish chunks and javelin heads are absent.
- Box traps require Eagles' Peak; quest plugins answer `quest:is-complete` or the fallback reads
  `quest.<key>.stage >= 2`. No live in-game playthrough has been done yet.

## Sources

Requirements, drop tables and success charts come from the [OSRS Wiki](https://oldschool.runescape.wiki/w/Hunter)
and were checked against the rev237 cache with the `dump:*` scripts. Tracking trail
coordinates/varbits adapt [Void](https://github.com/GregHib/void)'s data (BSD-3, see
`Tracking.LICENSE`); Herbiboar search coordinates adapt RuneLite's herbiboar plugin (BSD-2, see
`Herbiboar.LICENSE`); leap/rabbit spotanims use RuneLite `SpotanimID` ids. Earlier trap work used
Near-Reality as a behaviour sketch; no code from it is used (it has no license).

Check: `yarn build && node --test tests/skill-max-level.test.cjs` from `server/`.
