// Run after `yarn build`: node --test tests/shadow-of-the-storm-stairs.test.cjs
//
// #2577, the stairs into the Uzer temple, by real object_option packets through the real plugins.
// Rsprox 3333 (rev 235) ticks 408, 974, 1781, 2001 and 2323, 572 (rev 227) ticks 776 and 1048, and
// 1788 ticks 4073 and 4245: going down has no sound at all. The tenth descent, 572 t1289, has a hit of
// 7 with 518 (human_hit_1) at t1290, after the thirst message: desert heat, and the likely source of
// the value the stairs' entry recorded.
// 3333 tick 1146 and 572 tick 955: going up normally has no sound and no fade. The sandstorm sound
// 1314 and its overlay belong to 3333 t2237 and 572 t1239, with "You must fight your way against a
// sandstorm!" after falling rocks, not to the stairs. The fade LocTeleports sends is overlay 174.
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

const DOWN = { id: 6373, x: 3492, y: 3090, from: [3491, 3090, 0], to: [2721, 4886, 0] };
const UP = { id: 6372, x: 2721, y: 4884, from: [2722, 4886, 0], to: [3491, 3090, 0] };
const FADE_OVERLAY = 174;

let core;
let next = 8900;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(DOWN.x, DOWN.y);
  core.RegionManager.loadMapFiles(UP.x, UP.y);
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

async function climb(t, stairs) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("stairsqa" + p.getIndex());
  p.setRegistered(true);
  p.setLocation(new core.Location(...stairs.from));
  p.needsPlacement = false;
  const c = new ClientConnection(channel);
  c.player = p;
  t.after(() => {
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    p.setRegistered(false);
    core.TaskManager.cancelTasks(p.getIndex());
    core.TaskManager.cancelTasks(p);
  });
  const sounds = [];
  const overlays = [];
  const sender = p.getPacketSender();
  for (const method of ["sendSound", "sendSoundEffect"]) {
    const original = sender[method].bind(sender);
    t.mock.method(sender, method, (id, ...rest) => { sounds.push(id); return original(id, ...rest); });
  }
  const sendSubInterface = sender.sendSubInterface.bind(sender);
  t.mock.method(sender, "sendSubInterface", (uid, id, ...rest) => { overlays.push(id); return sendSubInterface(uid, id, ...rest); });

  await c.dispatch([{ type: "object_option", id: stairs.id, x: stairs.x, y: stairs.y, clickType: 1 }]);
  c.processTurnPackets();
  for (let i = 0; i < 10; i++) {
    core.TaskManager.processWalkTo(p.getIndex());
    p.getMovementQueue().process();
    core.TaskManager.process();
  }
  const at = p.getLocation();
  return { at: [at.getX(), at.getY(), at.getZ()], sounds, overlays };
}

test("going down the stairs lands in the temple with no hurt sound, or any sound", async (t) => {
  const { at, sounds } = await climb(t, DOWN);
  assert.deepEqual(at, DOWN.to, "control: the stairs took the player down");
  assert.deepEqual(sounds, []);
});

test("going up the stairs lands in Uzer with no sandstorm sound or fade", async (t) => {
  const { at, sounds, overlays } = await climb(t, UP);
  assert.deepEqual(at, UP.to, "control: the stairs took the player up");
  assert.deepEqual(sounds, []);
  assert.equal(overlays.includes(FADE_OVERLAY), false);
});
