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
  // The area's base maps template tiles one to one, so siteAt finds the mast at its own tile.
  const base = { x: Shared.DATA.cove.sourceChunkX * Shared.CHUNK, y: Shared.DATA.cove.sourceChunkY * Shared.CHUNK };
  const cove = Object.assign(Object.create(Cove.prototype), {
    players: new Set(), crew: 0, area: { enter() {}, getBaseX: () => base.x, getBaseY: () => base.y },
    tile: () => new Location(3200, 3200, 0),
  });
  const tethers = new Tethers({ cove });
  cove.fight = { tethers };
  cove.arrive(player, 0);
  const site = { data: { kind: "mast", varbit: 2, tile: [3200, 3199] }, loc: { getLocation: () => new Location(3200, 3199, 0) } };
  tethers.sites.push(site);
  player.getMovementQueue().requestWalk(new Location(3205, 3200, 0));
  assert.ok(player.getMovementQueue().size() > 0);
  tethers.tether(player, site);
  return { player, tethers, site, messages, queue: player.getMovementQueue() };
}

function worldInput(player, type, fields = {}) {
  const event = { player, packet: { type, ...fields }, handled: false };
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

test("a click in the same tick as a refused walk keeps the tether and can't reach (rsprox 227/01858.txt tick 4744)", () => {
  const { player, tethers, site, messages } = fixture();
  assert.equal(worldInput(player, "move").handled, true);
  assert.equal(worldInput(player, "npc_option").handled, true);
  assert.equal(tethers.siteOf(player), site, "still tethered");
  assert.deepEqual(messages, ["You must untether yourself to move away.", "I can't reach that!"]);
  core.World.processCycle++;
  assert.equal(worldInput(player, "npc_option").handled, false, "a later click untethers (227/00552.txt tick 16915)");
  assert.equal(tethers.siteOf(player), null);
});

test("after a refused walk only an NPC or a non-mast object is refused; the mast's own ops and the inventory still let go", () => {
  // Refused in the same tick (227/01858.txt tick 4744 an NPC; 00552 tick 16618 an object).
  for (const [type, fields] of [["npc_option", { index: 1 }], ["object_option", { id: 1, x: 3210, y: 3210 }]]) {
    const { player, tethers, site, messages } = fixture();
    worldInput(player, "move");
    assert.equal(worldInput(player, type, fields).handled, true, type);
    assert.equal(tethers.siteOf(player), site, `${type}: still tethered`);
    assert.equal(messages.at(-1), "I can't reach that!");
  }
  // Move, then the mast's own Untether in the same tick: it lets go.
  {
    const { player, tethers, messages } = fixture();
    worldInput(player, "move");
    assert.equal(worldInput(player, "object_option", { id: 1, x: 3200, y: 3199 }).handled, false, "the mast's op is not refused");
    assert.equal(objects.get("Mast").Untether({ player }), true);
    assert.equal(tethers.siteOf(player), null);
    assert.equal(messages.includes("I can't reach that!"), false);
  }
  // Move, then an inventory action (eat, drop) in the same tick: it is not swallowed.
  for (const type of ["inventory_action", "inventory_use_on", "item_on_npc", "spell_on_npc", "ground_item_action", "player_option", "teleport"]) {
    const { player, tethers, messages } = fixture();
    worldInput(player, "move");
    assert.equal(worldInput(player, type).handled, false, `${type} is not swallowed`);
    assert.equal(tethers.siteOf(player), null, `${type} lets go`);
    assert.equal(messages.includes("I can't reach that!"), false, type);
  }
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
