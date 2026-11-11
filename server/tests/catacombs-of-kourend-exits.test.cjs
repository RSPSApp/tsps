// Run after `yarn build`: node --test tests/catacombs-of-kourend-exits.test.cjs
// The Catacombs of Kourend's exits (docs/catacombs-of-kourend.md, #4256): each corner vine climbs
// to the surface and opens its way back in (a hole, or the Forthos Dungeon's strange passage), the
// Giants' Den vine opens the Giants' Den's passage, and the opened exits come back at login.
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSave } = require("../dist/game/entity/impl/player/persistence/PlayerSave");
const { ObjectActionPacketListener } = require("../dist/net/packet/impl/ObjectActionPacketListener");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { MapObjects } = require("../dist/game/entity/impl/object/MapObjects");

const Catacombs = require("../plugins/areas/CatacombsOfKourend.plugin");
const LocTeleports = require("../plugins/world/LocTeleports.plugin");

const EXITS_ATTRIBUTE = "catacombs-of-kourend:exits";
// Each exit as the cache places it (vine, multiloc tile, varbit) and the Wiki names it; the landing
// tiles are Shortest Path's transports.
const EXITS = [
  { name: "Demon's Run", varbit: "cata_hole3", vine: { x: 1719, y: 10102 }, top: [1696, 3864, 0], entrance: { x: 1696, y: 3865 }, hole: true, bottom: [1719, 10101, 0] },
  { name: "Dragon's Den", varbit: "cata_hole4", vine: { x: 1617, y: 10102 }, top: [1562, 3791, 0], entrance: { x: 1563, y: 3791 }, hole: true, bottom: [1617, 10101, 0] },
  { name: "Reeking Cove", varbit: "cata_hole2", vine: { x: 1650, y: 9986 }, top: [1469, 3653, 0], entrance: { x: 1470, y: 3653 }, hole: true, bottom: [1650, 9987, 0] },
  { name: "The Shallows", varbit: "cata_hole1", vine: { x: 1726, y: 9993 }, top: [1803, 9968, 0], entrance: { x: 1804, y: 9967 }, hole: false, bottom: [1726, 9994, 0] },
];
const GIANTS_DEN = { varbit: "cata_hole_giants_den", vine: { x: 1639, y: 10047 }, entrance: { x: 1462, y: 9878 }, bottom: [1639, 10046, 0] };
let core;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  core.RegionManager.init();
  Catacombs.register(PluginManager.createApi("CatacombsOfKourend"));
  LocTeleports.register(PluginManager.createApi("LocTeleports"));
});

let index = 1600;
function explorer(at) {
  const player = new Player(new PlayerSession({
    kind: "test", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  }));
  player.setUsername(`catacombs${index}`).setIndex(index++);
  player.setRegistered(true);
  player.setLocation(new core.Location(...at));
  const animations = [];
  const perform = player.performAnimation.bind(player);
  player.performAnimation = (animation) => (animations.push(animation.getId()), perform(animation));
  return { player, animations };
}

function ticks(player, count) {
  for (let tick = 0; tick < count; tick++) {
    core.World.processCycle++;
    core.TaskManager.process();
    player.getMovementQueue().process();
    core.TaskManager.processRemainingWalkTo();
    player.resetUpdating();
  }
}

function placed(id, { x, y }) {
  core.RegionManager.loadMapFiles(x, y);
  return MapObjects.get(id, new core.Location(x, y, 0), null) !== null;
}

function click(player, id, { x, y }) {
  core.RegionManager.loadMapFiles(x, y);
  new ObjectActionPacketListener().executeAction(player, id, x, y, 1);
}

const where = (player) => [player.getLocation().getX(), player.getLocation().getY(), player.getLocation().getZ()];
const varbit = (player, name) => player.getPacketSender().getVarbit(CacheDefinitions.getVarbitId(name));
const loc = (name) => CacheDefinitions.getLocId(name);

// Vine gamevals by exit, and the multiloc that shows each way back in (cache: locs and their varbits).
const VINES = { cata_hole1: "zeah_cata_exit_03", cata_hole2: "zeah_cata_exit_02", cata_hole3: "zeah_cata_exit_04", cata_hole4: "zeah_cata_exit_01" };
const ENTRANCES = { cata_hole1: "cata_hole1_multi", cata_hole2: "cata_hole2_multi", cata_hole3: "cata_hole3_multi", cata_hole4: "cata_hole4_multi" };

test("the exits match the cache: each vine, multiloc and varbit where the table puts it", () => {
  for (const exit of EXITS) {
    const vine = CacheDefinitions.getObject(loc(VINES[exit.varbit]));
    assert.equal(vine.name, "Vine");
    assert.equal(vine.actions[0], "Climb-up");
    assert.ok(placed(loc(VINES[exit.varbit]), exit.vine), `${exit.name}'s vine is at ${exit.vine.x},${exit.vine.y}`);
    assert.ok(placed(loc(ENTRANCES[exit.varbit]), exit.entrance), `${exit.name}'s way back in is at ${exit.entrance.x},${exit.entrance.y}`);
    const entrance = CacheDefinitions.getObject(loc(ENTRANCES[exit.varbit]));
    assert.equal(entrance.transformVarbit, CacheDefinitions.getVarbitId(exit.varbit), `${exit.varbit} drives its way back in`);
    const shown = CacheDefinitions.getObject(entrance.transforms[1]);
    assert.equal(shown.name, exit.hole ? "Hole" : "Strange passage");
    assert.equal(shown.actions[0], "Enter");
  }
  const passage = CacheDefinitions.getObject(loc("cata_hole_giants_den_multi"));
  assert.equal(passage.transformVarbit, CacheDefinitions.getVarbitId(GIANTS_DEN.varbit));
  assert.ok(placed(loc("cata_hole_giants_den_multi"), GIANTS_DEN.entrance));
  assert.ok(placed(loc("zeah_cata_exit_giants_den"), GIANTS_DEN.vine));
  assert.equal(CacheDefinitions.getObject(passage.transforms[1]).name, "Strange passage");
});

for (const exit of EXITS) {
  test(`${exit.name} (${VINES[exit.varbit]}): the climb opens ${exit.varbit}, its way back in leads down beside the vine`, () => {
    const { player, animations } = explorer(exit.bottom);
    const entranceId = loc(ENTRANCES[exit.varbit]);

    // Shut: the multiloc shows no way in, and Enter does nothing.
    assert.notEqual(core.ObjectDefinition.forPlayer(entranceId, player)?.getName(), exit.hole ? "Hole" : "Strange passage");

    click(player, loc(VINES[exit.varbit]), exit.vine);
    ticks(player, 8);
    assert.deepEqual(where(player), exit.top);
    assert.ok(animations.includes(828), "human_reachforladder");
    assert.equal(varbit(player, exit.varbit), 1);
    assert.deepEqual(player.getAttribute(EXITS_ATTRIBUTE), [exit.varbit]);

    // Open: the multiloc is the hole or passage now, and Enter goes back down.
    assert.equal(core.ObjectDefinition.forPlayer(entranceId, player).getName(), exit.hole ? "Hole" : "Strange passage");
    click(player, entranceId, exit.entrance);
    ticks(player, 10);
    assert.deepEqual(where(player), exit.bottom);
  });
}

test("a way back in that was never opened does nothing", () => {
  const exit = EXITS.find((candidate) => candidate.hole);
  const { player } = explorer(exit.top);
  click(player, loc(ENTRANCES[exit.varbit]), exit.entrance);
  ticks(player, 8);
  assert.deepEqual(where(player), exit.top);
});

test("the Giants' Den vine (a captured loc teleport) opens the Giants' Den's strange passage", () => {
  const { player } = explorer([1639, 10046, 0]);
  click(player, loc("zeah_cata_exit_giants_den"), GIANTS_DEN.vine);
  ticks(player, 8);
  assert.deepEqual(where(player), [1461, 9879, 0], "rsprox captures, recording 3024");
  assert.equal(varbit(player, GIANTS_DEN.varbit), 1);
  const passage = loc("cata_hole_giants_den_multi");
  assert.equal(core.ObjectDefinition.forPlayer(passage, player).getName(), "Strange passage");
  click(player, passage, GIANTS_DEN.entrance);
  ticks(player, 10);
  assert.deepEqual(where(player), GIANTS_DEN.bottom);
});

test("opened exits are saved and sent again at login", () => {
  const { player } = explorer([1640, 3673, 0]);
  assert.ok(PlayerSave.persistentAttributeKeys.has(EXITS_ATTRIBUTE));
  player.setAttribute(EXITS_ATTRIBUTE, ["cata_hole2", "cata_hole_giants_den"]);
  PluginManager.emitPlayerLogin({ player, username: player.getUsername() });
  assert.equal(varbit(player, "cata_hole2"), 1);
  assert.equal(varbit(player, "cata_hole_giants_den"), 1);
  assert.equal(varbit(player, "cata_hole1"), 0);
});
