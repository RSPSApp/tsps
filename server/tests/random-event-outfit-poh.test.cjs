// Run after `yarn build`: node --test tests/random-event-outfit-poh.test.cjs
// Random event outfit pieces stored in the house's costume room count as owned, so an event pays
// the next missing piece (or the lamp) instead of a duplicate. Wiki (Camouflage outfit): the camo
// top comes first "If players do not have any pieces stored in a bank, in their player-owned
// house, or inventory"; Wiki (Drill Demon): pieces kept "inside their fancy dress box" count.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const Teleports = require("../plugins/npcs/random-events/Teleports.RandomEvents");
const { HOUSE_ATTRIBUTE, createDefaultHouseSave } = require("../plugins/skills/construction/StorageState.Construction");

// Fancy dress box (enum 3291) representatives: mime mask, zombie shirt, camo top, lederhosen top,
// beekeeper's hat; and camo helmet/bottoms, the next Drill Demon pieces.
const MIME_MASK = 3057, ZOMBIE_SHIRT = 7592, CAMO_TOP = 6654, CAMO_BOTTOMS = 6655, CAMO_HELMET = 6656;
const LEDERHOSEN_TOP = 6180, BEEKEEPER_HAT = 25129;

let core;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function player(t, name) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {} };
  const session = new PlayerSession(channel);
  const p = new Player(session);
  session.setPlayer(p);
  p.setIndex(9901);
  p.setUsername(name);
  p.setRegistered(true);
  p.setLocation(new core.Location(3222, 3218, 0));
  p.needsPlacement = false;
  t.after(() => { PM.emitPlayerLogout({ player: p, username: p.getUsername() }); p.setRegistered(false); core.TaskManager.cancelTasks(p); });
  return p;
}

function storeInHouse(p, storage) {
  const save = { ...createDefaultHouseSave(), owned: true };
  save.rooms[1][4][5] = { roomKey: "COSTUME_ROOM", rotation: 0, furniture: {},
    furnitureByLocation: { box: { hotspotKey: "FANCY_DRESS_BOX", buildableKey: "MAHOGANY_FANCY_DRESS_BOX", storage } } };
  p.setAttribute(HOUSE_ATTRIBUTE, save);
  return save;
}

test("outfit pieces in the house's fancy dress box count as owned, and checking leaves them there", (t) => {
  const p = player(t, "outfitpoh");
  const storage = { [CAMO_TOP]: 1, [MIME_MASK]: 1, [ZOMBIE_SHIRT]: 1, [LEDERHOSEN_TOP]: 1, [BEEKEEPER_HAT]: 1 };
  storeInHouse(p, storage);
  for (const id of [CAMO_TOP, MIME_MASK, ZOMBIE_SHIRT, LEDERHOSEN_TOP, BEEKEEPER_HAT]) {
    assert.equal(Teleports.owns(p, id), true, `stored ${id} is owned`);
  }
  assert.equal(Teleports.owns(p, CAMO_HELMET), false, "a piece the house does not hold is still missing");
  assert.deepEqual(storage, { [CAMO_TOP]: 1, [MIME_MASK]: 1, [ZOMBIE_SHIRT]: 1, [LEDERHOSEN_TOP]: 1, [BEEKEEPER_HAT]: 1 });
  assert.equal(p.getInventory().containsNumber(CAMO_TOP), false, "inspecting never withdraws");
});

test("the Drill Demon's next piece skips a camo top kept in the house", (t) => {
  const p = player(t, "outfitdrill");
  storeInHouse(p, { [CAMO_TOP]: 1 });
  p.getInventory().addItem(new core.Item(CAMO_HELMET, 1));
  // DrillDemon.RandomEvents.js: OUTFIT = [top, helmet, bottoms], first one not owned.
  const missing = [CAMO_TOP, CAMO_HELMET, CAMO_BOTTOMS].find(piece => !Teleports.owns(p, piece));
  assert.equal(missing, CAMO_BOTTOMS);
});

test("without a house, ownership still comes from the inventory, equipment and bank alone", (t) => {
  const p = player(t, "outfitnohouse");
  assert.equal(Teleports.owns(p, CAMO_TOP), false);
  p.getBank(0).add(new core.Item(CAMO_TOP, 1));
  assert.equal(Teleports.owns(p, CAMO_TOP), true);
});
