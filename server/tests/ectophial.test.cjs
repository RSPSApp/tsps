const assert = require("node:assert/strict");
const { test, before, beforeEach } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { HitDamage } = require("../dist/game/content/combat/hit/HitDamage");
const { HitMask } = require("../dist/game/content/combat/hit/HitMask");
const Common = require("../plugins/skills/ectofuntus/Common.Ectofuntus");
let core, hooks, tasks, areaSounds;

before(async () => {
  await CachePipeline.initialize();
  core = PluginManager.getCoreApi();
});

beforeEach(() => {
  PluginManager.customEventHooks.delete("combat:damage-apply");
  tasks = [];
  areaSounds = [];
  hooks = { hit: [] };
  const api = {
    core: {
      ...core,
      TeleportHandler: { checkReqs: (p) => p.allowed },
      TaskManager: { submit(t) { t.setRunning(true); tasks.push(t); } },
      Sounds: { playAreaSound: (s) => areaSounds.push(s) },
    },
    onItemAction(name, actions) { assert.equal(name, "Ectophial"); hooks.empty = actions.Empty; },
    onItemOnObject(item, object, handler) { hooks.refill = handler; },
    onPlayerHitModify(handler) { hooks.hit.push(handler); },
    onCustomEvent(name, handler) { PluginManager.createApi("EctophialTest").onCustomEvent(name, handler); },
    emitCustomEvent() {},
  };
  Common.init(api);
  require("../plugins/skills/ectofuntus/Ectophial.Ectofuntus")(api);
});

function player(ids = [core.ItemIdentifiers.ECTOPHIAL]) {
  const slots = ids.map((id) => new core.Item(id, 1));
  const p = {
    allowed: true, registered: true, blocked: false, location: new core.Location(3222, 3218, 0),
    messages: [], animations: [], graphics: [], sounds: [], varbits: [],
    getIndex: () => 1,
    isRegistered: () => p.registered,
    getLocation: () => p.location,
    moveTo: (at) => { p.location = at; },
    getInventory: () => inventory,
    getMovementQueue: () => movement,
    getHitpoints: () => 99,
    performAnimation: (a) => p.animations.push(a),
    performGraphic: (g) => p.graphics.push(g),
    setPositionToFace: (at) => { p.facing = at; },
    getPacketSender: () => ({
      sendTypedMessage: (type, text) => p.messages.push(text),
      sendSound: (...args) => p.sounds.push(args),
      sendVarbit: (...args) => p.varbits.push(args),
    }),
  };
  const movement = {
    setBlockMovement(b) { p.blocked = b; return this; },
    reset() { return this; },
  };
  const inventory = {
    get: (slot) => slots[slot],
    setItem(slot, item) { slots[slot] = item; return this; },
    getSlotForItemId: (id) => slots.findIndex((item) => item?.getId() === id),
    refreshItems() { return this; },
  };
  return p;
}

function ticks(n) {
  for (let i = 0; i < n; i++) for (const task of tasks) task.tick();
}

// The impact hook runs after combat XP was awarded at launch. Keep the same hit object,
// changing its damage rather than rejecting the attack or altering its accuracy/XP flags.
function impact(p, values = [12, 7]) {
  const hits = values.map((v) => new HitDamage(v, HitMask.RED));
  const hit = {
    getHits: () => hits,
    getTotalDamage: () => hits.reduce((sum, h) => sum + h.getDamage(), 0),
    setTotalDamage: (n) => hits.forEach((h) => h.setDamage(n)),
  };
  const event = { player: p, hit };
  for (const fn of hooks.hit) fn(event);
  assert.equal(event.hit, hit);
  return hits.map((h) => h.getDamage());
}

test("arrival/refill keep the captured inventory, messages and tick boundaries (361/3929)", () => {
  const p = player();
  hooks.empty({ player: p, slot: 0 });
  assert.equal(p.getInventory().get(0).getId(), core.ItemIdentifiers.ECTOPHIAL_2);
  assert.equal(p.blocked, true);
  assert.equal(p.animations[0].getId(), core.CacheDefinitions.getSeqId("ahoy_ecto_teleport"));
  assert.equal(p.graphics[0].getId(), core.CacheDefinitions.getSpotanimId("ectophial_pour_spotanim"));
  ticks(2);
  assert.equal(p.location.getX(), 3222);
  ticks(1);
  assert.ok([3658, 3659, 3660, 3661].includes(p.location.getX()));
  assert.equal(p.location.getY(), 3522);
  ticks(1);
  assert.equal(p.getInventory().get(0).getId(), core.ItemIdentifiers.ECTOPHIAL_2);
  ticks(1);
  assert.equal(p.getInventory().get(0).getId(), core.ItemIdentifiers.ECTOPHIAL);
  assert.equal(p.blocked, false);
  assert.deepEqual(p.messages, [
    "You empty the ectoplasm onto the ground around your feet...",
    "...and the world changes around you.",
    "You refill the ectophial from the Ectofuntus.",
  ]);
  assert.equal(p.animations.at(-1).getId(), core.Animation.DEFAULT_RESET_ANIMATION.getId());
});

test("damage is zero during automatic refill, with normal damage before arrival and after completion (Wiki)", () => {
  const p = player();
  hooks.empty({ player: p, slot: 0 });
  ticks(2);
  assert.deepEqual(impact(p), [12, 7]);
  ticks(1);
  assert.deepEqual(impact(p), [0, 0]);
  ticks(1);
  assert.deepEqual(impact(p), [0, 0]);
  assert.deepEqual(impact(player()), [12, 7], "another player is not protected");
  ticks(1);
  assert.deepEqual(impact(p), [12, 7]);
});

test("the busy varbit brackets the complete teleport/refill action (3929)", () => {
  const p = player();
  const busy = core.CacheDefinitions.getVarbitId("busy");
  assert.ok(Number.isInteger(busy));
  hooks.empty({ player: p, slot: 0 });
  assert.deepEqual(p.varbits, [[busy, 1]]);
  ticks(4);
  assert.deepEqual(p.varbits, [[busy, 1]]);
  ticks(1);
  assert.deepEqual(p.varbits, [[busy, 1], [busy, 0]]);
});

test("teleport refill kneeling has the captured 10-cycle delay (361/703/3929)", () => {
  const p = player();
  hooks.empty({ player: p, slot: 0 });
  ticks(4);
  const kneel = p.animations.at(-1);
  assert.equal(kneel.getId(), core.CacheDefinitions.getSeqId("human_pickupfloor"));
  assert.equal(kneel.getDelay(), 10);
  assert.deepEqual([p.facing.getX(), p.facing.getY()], [3659, 3520]);
});

test("automatic refill sound has the captured 30-cycle delay (361/703/3929)", () => {
  const p = player();
  hooks.empty({ player: p, slot: 0 });
  ticks(4);
  assert.deepEqual(p.sounds, [[1132, 1, 30]]);
});

test("pouring sends the captured liquid area sound (361/703/3929)", () => {
  hooks.empty({ player: player(), slot: 0 });
  assert.equal(areaSounds.length, 1);
  assert.equal(areaSounds[0].soundId, 2401);
  assert.equal(areaSounds[0].x, 3222);
  assert.equal(areaSounds[0].y, 3218);
  assert.equal(areaSounds[0].radius, 5);
});

test("direct poison/venom-style damage is blocked only during refill (Wiki)", () => {
  const p = player();
  let hp = 99;
  Object.assign(p, {
    getHitpoints: () => hp, setHitpoints: (n) => { hp = n; },
    isNpc: () => false, isPlayer: () => true, getAsPlayer: () => p,
    getRights: () => core.PlayerRights.NONE,
  });
  const { Mobile } = require("../dist/game/entity/impl/Mobile");
  const damage = () => Mobile.prototype.decrementHealth.call(p, new HitDamage(6, HitMask.GREEN));
  hooks.empty({ player: p, slot: 0 });
  ticks(2);
  assert.equal(damage().getDamage(), 6);
  assert.equal(hp, 93);
  ticks(2);
  assert.equal(damage().getDamage(), 0);
  assert.equal(hp, 93);
  ticks(1);
  assert.equal(damage().getDamage(), 6);
  assert.equal(hp, 87);
});

test("failed teleport requirements and wrong slots do not consume the phial or start effects", () => {
  const p = player();
  p.allowed = false;
  hooks.empty({ player: p, slot: 0 });
  hooks.empty({ player: p, slot: 1 });
  assert.equal(p.getInventory().get(0).getId(), core.ItemIdentifiers.ECTOPHIAL);
  assert.equal(tasks.length, 0);
  assert.equal(p.blocked, false);
  assert.deepEqual(p.varbits, []);
  assert.deepEqual(p.animations, []);
  assert.deepEqual(impact(p), [12, 7]);
});

test("stopping the teleport on removal clears refill protection and movement lock", () => {
  const p = player();
  hooks.empty({ player: p, slot: 0 });
  ticks(4);
  p.registered = false;
  ticks(1);
  assert.equal(p.blocked, false);
  assert.deepEqual(impact(p), [12, 7]);
});

test("manual filling still swaps an empty phial on the next tick without granting teleport protection", () => {
  const p = player([core.ItemIdentifiers.ECTOPHIAL_2]);
  assert.equal(hooks.refill({ player: p, itemId: core.ItemIdentifiers.ECTOPHIAL_2 }), true);
  assert.deepEqual(impact(p), [12, 7]);
  ticks(1);
  assert.equal(p.getInventory().get(0).getId(), core.ItemIdentifiers.ECTOPHIAL);
  assert.equal(hooks.refill({ player: p, itemId: core.ItemIdentifiers.COINS }), false);
});
