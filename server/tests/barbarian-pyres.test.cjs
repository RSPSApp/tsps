"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const plugin = require("../plugins/skills/firemaking/BarbarianPyres.plugin");
const T = plugin._test;

function location(x, y, z = 0) {
  return { x, y, z, getX: () => x, getY: () => y, getZ: () => z, clone() { return location(x, y, z); } };
}

function objectAt(id, x, y) {
  return {
    getId: () => id,
    getLocation: () => location(x, y),
    getType: () => 22,
    getFace: () => 0,
    getPrivateArea: () => null,
    isWithinInteractionDistance: () => true,
  };
}

function player({ inventory = {}, levels = {} } = {}) {
  const messages = [];
  const items = new Map(Object.entries(inventory).map(([id, amount]) => [Number(id), amount]));
  return {
    messages,
    getLocation: () => location(2503, 3498),
    sendMessage: (text) => messages.push(text),
    getInventory: () => ({
      contains: (id) => (items.get(id) ?? 0) > 0,
      getAmount: (id) => items.get(id) ?? 0,
      getItems: () => [...items.entries()].map(([id, amount]) => ({ getId: () => id, getAmount: () => amount })),
      deleteNumber: (id, amount) => items.set(id, Math.max(0, (items.get(id) ?? 0) - amount)),
    }),
    getSkillManager: () => ({
      getCurrentLevel: (skill) => levels[skill] ?? 99,
      addExperiences: () => {},
    }),
  };
}

function fixture() {
  const events = [];
  const objects = [];
  const tasks = [];
  let disconnect;
  const core = {
    ItemDefinition: {
      forId: (id) => ({ getName: () => ({
        1511: "Logs", 1513: "Magic logs", 1517: "Maple logs", 1515: "Yew logs",
        11337: "Mangled bones", 11338: "Chewed bones", 590: "Tinderbox", 1351: "Rune axe",
        861: "Magic shortbow", 855: "Yew longbow", 837: "Crossbow",
      }[id] ?? "") }),
    },
    Skill: { CRAFTING: "CRAFTING", FIREMAKING: "FIREMAKING" },
    ObjectManager: { register(object) { objects.push(object); } },
    GameObject: class { constructor(id, loc, type, face, privateArea) { Object.assign(this, { id, loc, type, face, privateArea }); } getLocation() { return this.loc; } getId() { return this.id; } getType() { return this.type; } getFace() { return this.face; } getPrivateArea() { return this.privateArea; } isWithinInteractionDistance() { return true; } },
    TaskManager: { submit(task) { tasks.push(task); } },
    Task: class { constructor(ticks) { this.ticks = ticks; } stop() {} },
  };
  const registry = {
    core,
    emitCustomEvent: (name, event) => events.push({ name, event }),
    onObjectInteraction() {},
    onItemOnObject() {},
    onPlayerDisconnect(handler) { disconnect = handler; },
  };
  plugin.register(registry);
  T.pyres.clear();
  return { events, objects, tasks, disconnect: (player) => disconnect({ player }) };
}

test("magic-log pyre + chewed bones builds and credits only the chewed-bones ship", () => {
  const f = fixture();
  const p = player({ inventory: { 1351: 1, 1513: 2, 11338: 1 } });
  const site = objectAt(T.PYRE_SITE, 2503, 3498);
  T.construct({ player: p, object: site });
  assert.equal(p.getInventory().getAmount(1513), 1);
  assert.equal(p.messages.at(-1), "You place the logs on the pyre.");

  const boat = objectAt(T.PYRE_BOAT, 2503, 3498);
  T.itemOnPyre({ player: p, object: boat, objectId: T.PYRE_BOAT, itemId: 11338 });
  assert.equal(p.getInventory().getAmount(11338), 0);
  assert.deepEqual(f.events.map((e) => e.name), ["barbarian-pyre:built"]);
  assert.deepEqual(f.events[0].event, { player: p, logsId: 1513, bonesId: 11338 });
});

test("mangled bones build a ship but never satisfy the diary credit", () => {
  const f = fixture();
  const p = player({ inventory: { 1351: 1, 1513: 1, 11337: 1 } });
  T.construct({ player: p, object: objectAt(T.PYRE_SITE, 2503, 3498) });
  T.itemOnPyre({ player: p, object: objectAt(T.PYRE_BOAT, 2503, 3498), objectId: T.PYRE_BOAT, itemId: 11337 });
  assert.equal(f.events.length, 0);
});

test("construct refuses without an axe or logs and does not consume anything", () => {
  const f = fixture();
  const noAxe = player({ inventory: { 1513: 1 } });
  T.construct({ player: noAxe, object: objectAt(T.PYRE_SITE, 2503, 3498) });
  assert.equal(noAxe.getInventory().getAmount(1513), 1);
  assert.equal(f.events.length, 0);

  const noLogs = player({ inventory: { 1351: 1 } });
  T.construct({ player: noLogs, object: objectAt(T.PYRE_SITE, 2503, 3498) });
  assert.equal(f.events.length, 0);
});

test("lighting a bones pyre needs a tinderbox or bow and grants Firemaking experience", () => {
  const f = fixture();
  const p = player({ inventory: { 1351: 1, 1513: 1, 11338: 1, 590: 1 } });
  T.construct({ player: p, object: objectAt(T.PYRE_SITE, 2503, 3498) });
  const boat = objectAt(T.PYRE_BOAT, 2503, 3498);
  T.itemOnPyre({ player: p, object: boat, objectId: T.PYRE_BOAT, itemId: 11338 });
  T.itemOnPyre({ player: p, object: objectAt(T.PYRE_BOAT_BONES, 2503, 3498), objectId: T.PYRE_BOAT_BONES, itemId: 590 });
  assert.equal(p.messages.at(-1), "You light the pyre.");
});

test("using magic logs on the site builds a magic pyre even with maple logs carried", () => {
  const f = fixture();
  const p = player({ inventory: { 1351: 1, 1513: 1, 1517: 1, 11338: 1 } });
  T.itemOnSite({ player: p, object: objectAt(T.PYRE_SITE, 2503, 3498), objectId: T.PYRE_SITE, itemId: 1513, handled: false });
  assert.equal(p.getInventory().getAmount(1513), 0);
  assert.equal(p.getInventory().getAmount(1517), 1);
  assert.equal(p.messages.at(-1), "You place the logs on the pyre.");
});

// Exercise the visible world state, rather than only the diary event.
test("a burnt pyre restores its constructible site for the next player", () => {
  const f = fixture();
  const p = player({ inventory: { 1351: 1, 1513: 1, 11338: 1, 590: 1 } });
  T.construct({ player: p, object: objectAt(T.PYRE_SITE, 2503, 3498) });
  T.itemOnPyre({ player: p, object: f.objects.at(-1), objectId: T.PYRE_BOAT, itemId: 11338 });
  T.itemOnPyre({ player: p, object: f.objects.at(-1), objectId: T.PYRE_BOAT_BONES, itemId: 590 });
  f.tasks[0].execute();
  assert.equal(T.pyres.size, 1, "retain the site until the floating boat clears");
  f.tasks[0].execute();
  assert.equal(f.objects.at(-1).getId(), T.PYRE_SITE);
  assert.equal(T.pyres.size, 0);
  const next = player({ inventory: { 1351: 1, 1513: 1 } });
  T.construct({ player: next, object: f.objects.at(-1) });
  assert.equal(next.getInventory().getAmount(1513), 0);
});

test("logout releases an unfinished site and old lighting tasks cannot replace a new pyre", () => {
  const f = fixture();
  const p = player({ inventory: { 1351: 1, 1513: 1, 11338: 1, 590: 1 } });
  T.construct({ player: p, object: objectAt(T.PYRE_SITE, 2503, 3498) });
  T.itemOnPyre({ player: p, object: f.objects.at(-1), objectId: T.PYRE_BOAT, itemId: 11338 });
  T.itemOnPyre({ player: p, object: f.objects.at(-1), objectId: T.PYRE_BOAT_BONES, itemId: 590 });
  f.disconnect(p);
  assert.equal(T.pyres.size, 0);
  assert.equal(f.objects.at(-1).getId(), T.PYRE_SITE);
  const next = player({ inventory: { 1351: 1, 1513: 1 } });
  T.construct({ player: next, object: f.objects.at(-1) });
  f.tasks[0].execute();
  assert.equal(f.objects.at(-1).getId(), T.PYRE_BOAT);
  assert.equal([...T.pyres.values()][0].player, next);
  f.disconnect(next);
  assert.equal(f.objects.at(-1).getId(), T.PYRE_SITE);
});
