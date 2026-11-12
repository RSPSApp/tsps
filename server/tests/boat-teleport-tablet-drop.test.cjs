// Run after `yarn build`: node --test tests/boat-teleport-tablet-drop.test.cjs
// A Teleport to boat tablet is used up at the teleport's middle tick. The Summon boat tablet had a free summon from
// dropping the tablet in its windup; here a Drop sent during the windup must not give a teleport and keep the tablet.
// Real engine: every plugin loaded, a real Player, the Drop through ClientConnection.dispatch.
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

let core, plugin, facilities;
const START = [3222, 3218, 0];
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(START[0], START[1]);
  PM.emitServerStartup({});
  plugin = require("../plugins/skills/sailing/BoatTeleport.Sailing");
  facilities = require("../plugins/skills/sailing/BoatFacilities.Sailing");
});
after(() => PM.emitServerShutdown({}));

function actor(t) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(9710);
  p.setUsername("boattab" + p.getIndex());
  p.setRegistered(true);
  p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(...START));
  p.needsPlacement = false;
  const owned = { slot: 0, type: "sloop", name: [], cargo: [], location: { kind: "docked", dock: "port_sarim" } };
  facilities.setFacility(owned, 0, facilities.facilityNamed("Greater teleport focus"));
  p.getSailing().boats = [owned];
  const c = new ClientConnection(channel);
  c.player = p;
  t.after(() => { core.TaskManager.cancelTasks(p); core.TaskManager.cancelTasks(p.getIndex()); p.setRegistered(false); });
  return { p, c };
}

const tick = () => {
  core.World.processCycle = (core.World.processCycle + 1) & 0x7fffffff;
  core.TaskManager.process();
};

test("dropping the tablet during the teleport windup doesn't give a free teleport", async (t) => {
  for (const dropAt of [0, 1, 2]) {
    const { p, c } = actor(t);
    const TABLET = core.ItemIdentifiers.TELEPORT_TO_BOAT;
    p.getInventory().setItem(0, new core.Item(TABLET, 1));
    plugin._test.teleportToBoat(p, TABLET, 0);
    assert.equal(p.isTeleportingReturn(), true, "the teleport starts");
    for (let i = 0; i < dropAt; i++) tick();
    await c.dispatch([{ type: "inventory_action", widgetId: 149 << 16, itemId: TABLET, slot: 0, option: "Drop", optionIndex: 5 }]);
    c.processTurnPackets();
    for (let i = 0; i < 10; i++) tick();
    const held = p.getInventory().getAmount(TABLET);
    const onGround = core.World.getItems().some((g) => g?.getItem?.().getId?.() === TABLET && !g.isPendingRemoval?.());
    const moved = p.getLocation().getX() !== START[0] || p.getLocation().getY() !== START[1];
    assert.ok(!(moved && (held > 0 || onGround)), `drop after ${dropAt} ticks: teleported and kept the tablet (held ${held}, ground ${onGround})`);
    assert.equal(held + (onGround ? 1 : 0) + (moved ? 1 : 0), 1, `drop after ${dropAt} ticks: exactly one of tablet or teleport`);
    for (const g of core.World.getItems().filter((g) => g?.getItem?.().getId?.() === TABLET)) core.World.getItems().splice(core.World.getItems().indexOf(g), 1);
    core.TaskManager.cancelTasks(p);
    p.setTeleporting(false);
    p.getMovementQueue().setBlockMovement(false);
  }
});

test("the standard teleport tablets share the absorb: a Drop in the windup leaves it to the teleport", async (t) => {
  const { p, c } = actor(t);
  const TABLET = core.ItemIdentifiers.VARROCK_TELEPORT;
  p.getInventory().setItem(0, new core.Item(TABLET, 1));
  await c.dispatch([{ type: "inventory_action", widgetId: 149 << 16, itemId: TABLET, slot: 0, option: "Break", optionIndex: 1 }]);
  c.processTurnPackets();
  assert.equal(p.isTeleportingReturn(), true, "Break starts the teleport");
  await c.dispatch([{ type: "inventory_action", widgetId: 149 << 16, itemId: TABLET, slot: 0, option: "Drop", optionIndex: 5 }]);
  c.processTurnPackets();
  for (let i = 0; i < 10; i++) tick();
  assert.equal(p.getInventory().getAmount(TABLET), 0, "the tablet is used up");
  assert.equal(core.World.getItems().some((g) => g?.getItem?.().getId?.() === TABLET), false, "and not on the ground");
  assert.notEqual(p.getLocation().getX(), START[0], "the teleport went ahead");
});
