# Volcanic Mine

The team mining minigame inside Fossil Island's volcano. Behaviour comes from three solo games in rsprox 1858 (Leagues V, rev 227: one finished, one left early, one that collapsed) and Petrified Pete's dialogue and payment in 1854. The OSRS Wiki supplies the rest: the boulder stages and odds, the eruption, the shop and the requirements.

The recordings' XP is Leagues x16 and their shop points x8; both are divided out. Where neither source gives a formula, the value is calibrated to the recordings and marked `_calibrated` in `data/volcanic-mine.json`.

It covers the whole game, the hazards and Pete's item retrieval included.

## Layout

| File | What it owns |
| --- | --- |
| `VolcanicMine.plugin.js` | Registers the parts. |
| `volcanicmine/Common.VolcanicMine.js` | The data, the HUD (interface 611), chat helpers, hits, the best pickaxe. |
| `volcanicmine/Game.VolcanicMine.js` | One game a world: the instance, the lobby, the clock, the vents' gas, stability, the warning, eruption and collapse, leaving and rewards. |
| `volcanicmine/Entry.VolcanicMine.js` | Petrified Pete's Talk-to (every recorded branch), Pay, Retrieve and the Volcano Entrance. |
| `volcanicmine/Mine.VolcanicMine.js` | Stairs, the exit ladder, chambers and large rocks, vents, gas holes, and the vessel's water on the lava. |
| `volcanicmine/Boulder.VolcanicMine.js` | The boulder down the central channel: stages, chips, fragments and side finds, the vortex. |
| `volcanicmine/Hazards.VolcanicMine.js` | Lava beasts (their own ranged attack), earthquakes with stalactites, and meteors. |
| `volcanicmine/Retrieval.VolcanicMine.js` | Pete keeping a dead player's items, and Retrieve for 150 Numulite. |
| `data/volcanic-mine.json` | Tiles, ids, varbits, timings, points and XP, messages, dialogue and odds, each noted by its source. |

The shop is Petrified Pete's Ore Shop (1457, generated data, opened by Shopkeepers on Pete's Trade). Its currency is Shopkeepers' "Volcanic Mine points" attribute, which the exit ladder pays into.

## A game (recorded)

- **Entering.**
  - Pay Pete 30 Numulites (or 3,000 for permanent access, per the Wiki). Mining 50 is required.
  - Climb down: "Pete quickly hands you a heat-proof vessel filled with some water." and "The mine is currently dormant, and will awaken within the next 30 seconds."
  - The player is put in an instance of the mine (3776-3839 x 10112-10239, every plane) at (3808,10193,3), with music 507 and the HUD.
- **One game a world.** Whoever comes down in the 51-tick lobby joins it. Once "The volcano awakens!" Pete turns newcomers away ("…mid way through a mine out session…") until the game is over.
- **The clock.**
  - 1000 ticks: the time is sent every 6 ticks, the vents every 10, stability every 25.
  - At 50 left: "The volcano is going to erupt soon!", and stability drops to 5.
  - At 0 the volcano erupts and kills anyone still inside (Wiki).
- **Chambers.**
  - Take a large rock (two ticks after the click, like Block; it's back in 24 ticks) and block a chamber: +50.
  - Mine the blocked one clear: +50 and 25 Mining XP. The swing comes the tick after the click, the first roll a tick later, then one every pickaxe interval; a missed roll replays the swing, and the clear stops it with sound 3600 (recording 1858).
  - These points stop at 300 a player (Wiki).
- **Vents.** Inspecting one gives the recorded box with the gas % and shows it on everyone's HUD (+50, once until the gas next shifts). A vent belongs to the chamber with the nearest x.
- **Gas drift and stability** (calibrated).
  - A blocked chamber's gas rises 1-2 every 10 ticks; an open one's falls 1-2. It all re-randomises at 5 minutes.
  - Stability: +20 a step with all three vents within 40-60%, nothing within 25-75%, falling beyond that.
  - At 0: "The mine has become too unstable! It's collapsing in!", and death 5 ticks later.
- **Gas holes.** "Ouch! Hot hot!", over to the recorded far tile, and a 3-6 hit.
- **Water.**
  - The existing base vessel permits 36 successful throws in TSPS (the Wiki says 35). Pete's 10,000-point upgrade persists and permits 70 successful throws in later games. A throw hardens the lava in front (+1 point); it isn't allowed on the boulder channel.
  - The existing generic shop presents its heat-proof vessel row as the upgrade and consumes the delivered vessel into the unlock. Its Buy action and inventory-space check are TSPS policy, not confirmed retail behavior; the Large water container is the collection-log entry.
  - The crust lasts 74 + 65 + 10 ticks, then is lava again. Hardened lava can be walked on.
- **The boulder.**
  - Five stages of 40 HP a player (the small one 60).
  - The swing the tick after the click, then a chip with sound 3600 every pickaxe interval (3 ticks with a dragon pickaxe, sometimes 2; recording 1858): +1 point and 5 XP. A fragment by the Wiki's per-stage chance, with the ore by Mining level. A fragment's side find is calcite, pyrophosphite, Numulite or a fossil.
  - When it reaches the vortex, everyone gets +100.
- **Leaving.**
  - The exit ladder: the HUD reset, Pete's "I'll give you a bit of minin' trainin'…", out at (3816,3808,0).
  - Mining XP of points × level ÷ 24.2 (calibrated), and the points go to Pete's shop.
  - Logging out or dying pays nothing. The vessel, rocks and fragments never leave the mine.

## Hazards and retrieval (recorded)

- **Lava beasts** on the mine floor.
  - 65 HP. A lava bomb (projectile 1403) every 6 ticks, its hit 5 ticks later (Wiki max 18).
  - Fighting one pays a point a 10 damage, and +3 for the kill.
  - The next comes 0-20 ticks after one dies, one per 5 players.
- **Earthquakes.**
  - "A sudden earthquake strikes the cavern!" at a 5-tick step, more often at low stability.
  - A stalactite falls on each player's tile 2-15 ticks later; still there a tick after, 13-25.
- **Meteors.** A throw from nearby lava, and the blast 8 ticks later within 4 tiles of the player. Anyone in its 3x3 takes 15-17.
- **A death in the mine.**
  - The mine's items are gone; Pete keeps everything else, with nothing left in a grave.
  - "Petrified Pete has retrieved some of your items…"
  - Retrieve: "You need 150 x Numulite to retrieve your items." or "Death charges you 150 x Numulite." The fee comes from the pack first, then from what he holds.
  - Dying in the mine again replaces the lot (Wiki).

## Not yet

- Multi-player boulder scaling beyond HP (the extra channels for 10+ and 20+ players).
- The ore pack unlock from the shop.

## Tests

`server/tests/volcanic-mine.test.cjs` uses real instances of the mine and covers:
- the entrance's gates and the lobby; payment; the start and refusals; stairs;
- chambers and rocks; vents and drift;
- stability calibrated against G1's rise and G2's hold;
- the warning, eruption and collapse;
- gas holes;
- water: crust timing, and lava blocking, walkable when hardened, blocking again when melted;
- the boulder: chips, fragments, the next stage's float, and lava still blocking after a break;
- the exit's reward, and logout;
- an abandoned lobby ending, vents paying once, clicks not stacking, and no exit during a collapse;
- the hazards: a beast's HP, attack and points, earthquake and meteor hits, nothing in the lobby;
- retrieval: refusal, the fee from the pack or Pete's lot, meta kept, a second death replacing the lot, nothing outside the mine.
