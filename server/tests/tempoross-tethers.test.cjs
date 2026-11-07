// Run after yarn build: node --test tests/tempoross-tethers.test.cjs
const assert = require("node:assert/strict");
const { before, test } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { Location } = require("../dist/game/model/Location");
const Shared = require("../plugins/minigames/tempoross/Shared.Tempoross");
const { Cove } = require("../plugins/minigames/tempoross/Cove.Tempoross");
const { Tethers, attachTethers } = require("../plugins/minigames/tempoross/Tethers.Tempoross");
const FreeMovement = require("../plugins/world/FreeMovement.plugin");
const hooks = new Map();
const objects = new Map();
const core = PluginManager.getCoreApi();
let pending = [];

before(async () => {
  await CachePipeline.initialize();
  Shared.bind({ core });
  Shared.animate = Shared.graphic = () => {};
  Shared.later = (_key, _ticks, action) => {
    pending.push(action);
    return { stop() {} };
  };
  Shared.repeat = () => ({ stop() {} });
  attachTethers({
    onObjectInteraction: (name, handlers) => objects.set(name, handlers),
    onWalkRoute: (handler) => hooks.set("walk", handler),
    onCustomEvent: (name, handler) => hooks.set(name, handler),
  });
  FreeMovement.register({ core,
    onCustomEvent: (name, handler) => { if (name === "player:movement-input") hooks.set(name, handler); },
    onPlayerProcess() {}, onPlayerLogout() {},
  });
});

function fixture() {
  pending = [];
  const player = new Player(null);
  player.getSession = () => ({ sendClientPacket() {}, write() {} });
  player.isRegistered = () => true;
  player.moveTo = (location) => player.setLocation(location);
  const messages = [];
  player.sendMessage = (message) => messages.push(message);
  const cove = Object.assign(Object.create(Cove.prototype), {
    players: new Set(), crew: 0, area: { enter() {} },
    tile: () => new Location(3200, 3200, 0),
  });
  const tethers = new Tethers({ cove });
  cove.fight = { tethers };
  cove.arrive(player, 0);
  const site = { data: { kind: "mast", varbit: 2 }, loc: { getLocation: () => new Location(3200, 3199, 0) } };
  player.getMovementQueue().requestWalk(new Location(3205, 3200, 0));
  assert.ok(player.getMovementQueue().size() > 0);
  tethers.tether(player, site);
  return { player, tethers, site, messages, queue: player.getMovementQueue() };
}

function worldInput(player, type) {
  const event = { player, packet: { type }, handled: false };
  hooks.get("player:world-input")(event);
  return event;
}

test("queued walks and repeated continuous input cannot move a tethered player", () => {
  const { player, tethers, site, queue, messages } = fixture();
  assert.equal(queue.getMobility().canMove(), false);
  for (let seq = 0; seq < 20; seq++) {
    assert.equal(worldInput(player, "move").handled, true);
    queue.requestWalk(new Location(3205, 3200, 0));
    hooks.get("player:movement-input")({ player, packet: {
      seq, dx: 32767, dy: 0, rotation: 512, duration: 40, active: true,
    } });
    queue.process();
    assert.equal(queue.size(), 0);
    assert.equal(player.getLocation().getX(), 3200);
    assert.equal(tethers.siteOf(player), site);
  }
  assert.equal(messages.length, 20);
  assert.ok(messages.every((message) => message === "You must untether yourself to move away."));
});

test("manual untether and other action routing release the lock first", () => {
  for (const type of ["object_option", "npc_option", "inventory_action"]) {
    const { player, tethers, queue } = fixture();
    assert.equal(worldInput(player, type).handled, false);
    assert.equal(tethers.siteOf(player), null);
    assert.equal(queue.getMobility().canMove(), true);
    assert.equal(objects.get("Mast").Untether({ player }), true);
    queue.requestWalk(new Location(3205, 3200, 0));
    assert.ok(queue.size() > 0);
  }
});

test("wave untether releases movement and stale tether callbacks cannot reattach it", () => {
  const { player, tethers, queue } = fixture();
  const tetherCallbacks = pending.slice();
  assert.equal(tethers.untether(player), true);
  for (const callback of tetherCallbacks) callback();
  assert.equal(tethers.siteOf(player), null);
  assert.equal(player.getPacketSender().getVarbit(Shared.VARBIT.TETHERED), 0);
  assert.equal(queue.getMobility().canMove(), true);
  assert.equal(tethers.untether(player), false);
});

test("leave, logout and death cleanup release movement even after unregistering", () => {
  for (const registered of [true, false]) {
    const { player, tethers, queue } = fixture();
    player.isRegistered = () => registered;
    player.setHitpoints(0);
    tethers.onLeave(player);
    assert.equal(tethers.siteOf(player), null);
    assert.equal(queue.isMovementBlocked(), false);
  }
});


test("blocked continuous input discards inactive coordinates from before a teleport", () => {
  const { player, tethers, site, queue } = fixture();
  tethers.untether(player, { quiet: true });
  const continuous = hooks.get("player:movement-input");
  continuous({ player, packet: { seq: 0, dx: 32767, dy: 0, rotation: 512, duration: 40, active: true } });
  continuous({ player, packet: { seq: 1, dx: 0, dy: 0, rotation: 512, duration: 0, active: false } });
  // An inactive controller is not teleported by FreeMovement.teleport; its old fine tile remains.
  player.setLocation(new Location(3210, 3210, 0));
  tethers.tether(player, site);
  continuous({ player, packet: { seq: 2, dx: 32767, dy: 0, rotation: 512, duration: 40, active: true } });
  assert.equal(player.getLocation().getX(), 3210);
  assert.equal(player.getLocation().getY(), 3210);
  assert.equal(queue.hasPendingWork(), false);
  assert.equal(tethers.siteOf(player), site);
});
