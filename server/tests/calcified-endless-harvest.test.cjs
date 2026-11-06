// Run after `yarn build`: node --test tests/calcified-endless-harvest.test.cjs
//
// #2618: mining a calcified rock in Cam Torum's mine, the oozing water starts and then stops, and the player
// stops mining. When the water stops, the mine mines every wet rock out (CalcifiedWater.Mining.js, rsprox 1105);
// that path used `exhaustRock` directly, so it never asked "mining:deplete-rock", the question Demonic Pacts'
// Endless Harvest answers "stay standing" (Wiki: rocks and trees no longer deplete while the relic's owner
// gathers from them; ours: league-relics data effects.endlessHarvest). A normal depletion asks it
// (Mining.plugin.js depleteRock). Real engine: every plugin loaded with DISABLE_PLAYER_BOTS=1 and shut down at
// the end, a real Player with the Demonic Pacts Endless Harvest pick (league 6, tier 1 slot 1), the click as the
// "object_option" packet through ClientConnection.dispatch, the real task loop. Math.random is 0 so the
// water takes the first standing rocks of each half and every roll lands.
process.env.DISABLE_PLAYER_BOTS = "1";
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");

let core;
let Water;
let Mining;
let next = 9700;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  core.ObjectDefinition.init();
  core.RegionManager.init();
  PM.emitServerStartup({});
  Water = require("../plugins/skills/mining/CalcifiedWater.Mining")._test;
  Mining = require("../plugins/skills/Mining.plugin");
});
after(() => PM.emitServerShutdown({}));

/**
 * The tile beside `rock` a miner can stand on: the first orthogonal neighbour the map does not block (the
 * first diagnostic runs stood on the west one and got "You can't reach that!", the tile being rock or wall).
 */
function standTile(rock) {
  const at = rock.getLocation();
  const options = [[-1, 0], [1, 0], [0, -1], [0, 1]].map(([dx, dy]) => ({
    x: at.getX() + dx, y: at.getY() + dy, z: at.getZ(),
    blocked: core.RegionManager.blocked(new core.Location(at.getX() + dx, at.getY() + dy, at.getZ()), null),
  }));
  return { tile: options.find((option) => !option.blocked) ?? options[0], options };
}

/** A miner on `stand` beside `rock` (z 1), with 99 Mining; `relic` true gives the Demonic Pacts Endless Harvest pick
 * and a rune pickaxe, "power" the Raging Echoes Power Miner pick (league 5) and its Echo pickaxe, null neither. */
function miner(t, rock, relic, stand) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("calcified" + p.getIndex());
  p.setAttribute("bot-skip-persistence", true);
  if (relic) {
    p.setProfile("league");
    p.setAttribute("league:type", relic === "power" ? 5 : 6);
    p.setAttribute("league:relics", { 0: 1 });
    // A league character is sent back from an area it has not unlocked (Raging Echoes, to Lumbridge 3234,3213):
    // unlock the one the mine is in.
    const owner = require("../plugins/modes/leagueareas/Regions.LeagueAreaUnlocks").areaAt(relic === "power" ? 5 : 6, stand.x, stand.y);
    if (owner !== null) p.setAttribute("league:areas", [owner]);
  }
  p.setRegistered(true);
  p.needsPlacement = false;
  p.getInventory().add(new core.Item(relic === "power" ? core.ItemIdentifiers.ECHO_PICKAXE : core.ItemIdentifiers.RUNE_PICKAXE, 1), false);
  p.getSkillManager().setCurrentLevel(core.Skill.MINING, 99);
  p.getSkillManager().setMaxLevel(core.Skill.MINING, 99);
  PM.emitPlayerLogin({ player: p, username: p.getUsername(), isNewAccount: false, profile: relic ? "league" : "main" });
  // After the login hooks, which may place the character (the first red run found it at 1503,5602, not in the mine).
  p.setLocation(new core.Location(stand.x, stand.y, stand.z));
  // setLocation raises needsPlacement, which makes player.busy() true and the packet listener drop the click
  // until a world tick clears it (the Shilo and #2617 fixtures found the same).
  p.needsPlacement = false;
  const c = new ClientConnection(channel);
  c.player = p;
  t.after(() => {
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    p.setRegistered(false);
    core.TaskManager.cancelTasks(p);
    core.TaskManager.cancelTasks(p.getIndex());
  });
  return { p, c };
}

function tick(f, count = 1) {
  for (let i = 0; i < count; i++) {
    core.World.processCycle++;
    core.TaskManager.process();
    f.c.processTurnPackets();
    f.p.getMovementQueue().process();
    core.TaskManager.processWalkTo(f.p.getIndex());
    f.p.getSession().flushClient(core.World.processCycle);
    f.p.resetUpdating();
  }
}

const items = (f) => f.p.getInventory().getItems().reduce((n, item) => n + (item ? item.getAmount() : 0), 0)
  + f.p.getBank(0).getItems().reduce((n, item) => n + (item ? item.getAmount() : 0), 0);

/** Mines the first rock the water will wet, runs the water until it has stopped, and reports what happened. */
async function throughOneWater(t, relic) {
  t.mock.method(Math, "random", () => 0);
  const rock = Water.pickWetRocks(() => 0)[0];
  const { tile } = standTile(rock);
  const f = miner(t, rock, relic, tile);
  assert.deepEqual([f.p.getLocation().getX(), f.p.getLocation().getY(), f.p.getLocation().getZ()],
    [tile.x, tile.y, tile.z], "the miner stands beside the rock");
  await f.c.dispatch([{ type: "object_option", id: rock.getId(), x: rock.getLocation().getX(), y: rock.getLocation().getY(), clickType: 1 }]);
  tick(f, 4);
  assert.equal(Mining.isMiningActive(f.p), true, "the miner is mining the rock");
  Water.cycle.nextOoze = Water.cycle.tick + 1;
  tick(f, 2);
  assert.equal(Water.isWet(rock), true, "the water is on the player's rock");
  tick(f, Water.cycle.stopAt - Water.cycle.tick + 2);
  const atStop = items(f);
  tick(f, 30);
  return { rock, atStop, later: items(f), standing: core.MapObjects.get(rock.getId(), rock.getLocation(), null) };
}

test("#2618: with Demonic Pacts' Endless Harvest the rock stays standing when the water stops, and the player keeps mining", async (t) => {
  const { atStop, later, standing } = await throughOneWater(t, true);
  assert.ok(standing, "the calcified rock stands");
  assert.ok(later > atStop, `mining went on after the water stopped (${atStop} -> ${later})`);
});

test("control: without the relic the wet rock is mined out when the water stops, as captured (rsprox 1105)", async (t) => {
  const { atStop, later, standing } = await throughOneWater(t, false);
  assert.equal(standing, null, "the rock is mined out");
  assert.equal(later, atStop, "and nothing more is gathered");
});

test("#2621: a Raging Echoes Power Miner's rock is mined out when the water stops, like anyone's (its four-ore count is for ores)", async (t) => {
  const { standing } = await throughOneWater(t, "power");
  assert.equal(standing, null, "the wet rock is mined out");
});

test("#2621: the water's question does not advance a Power Miner's count, and a miner without the relic does not clear it", (t) => {
  t.mock.method(Math, "random", () => 0);
  const rock = Water.pickWetRocks(() => 0)[0];
  const { tile } = standTile(rock);
  const power = miner(t, rock, "power", tile).p;
  const plain = miner(t, rock, null, tile).p;
  const deplete = (player, extra = {}) => {
    const request = { player, object: rock, rock: "Calcified rocks", handled: false, ...extra };
    PM.emitCustomEvent("mining:deplete-rock", request);
    return request.handled;
  };
  // Four ores a rock: three kept, the fourth takes it. Water questions in between change nothing.
  assert.equal(deplete(power), true, "ore 1");
  assert.equal(deplete(power, { water: true }), false, "the water's question: not kept");
  assert.equal(deplete(plain, { water: true }), false, "a miner without the relic asks too");
  assert.equal(deplete(power), true, "ore 2");
  assert.equal(deplete(plain, { water: true }), false);
  assert.equal(deplete(power), true, "ore 3");
  assert.equal(deplete(power), false, "ore 4 takes the rock, the count was never moved by the water");
});
