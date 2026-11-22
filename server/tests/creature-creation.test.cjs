const test = require("node:test");
const assert = require("node:assert/strict");
const drops = require("../data/definitions/npc-drops.json");

const ITEM_NAMES = [
  "EYE_OF_NEWT", "FEATHER", "COWHIDE", "UNICORN_HORN", "RAW_SWORDFISH", "RAW_CHICKEN",
  "RED_SPIDERS_EGGS", "RAW_SARDINE", "RAW_CAVE_EEL", "GIANT_FROG_LEGS", "RAW_JUBBLY", "RAW_LOBSTER",
];
const itemIds = Object.fromEntries(ITEM_NAMES.map((name, index) => [name, 2000 + index]));
const npcIds = { FROGEEL: 3600, UNICOW: 3601, SPIDINE: 3602, SWORDCHICK: 3603, JUBSTER: 3604, NEWTROOST: 3605 };
const objectIds = { SYMBOL_OF_LIFE: 21893, SYMBOL_OF_LIFE_2: 21894 };

class Item {
  constructor(id, amount = 1) { this.id = id; this.amount = amount; }
  getId() { return this.id; }
  getAmount() { return this.amount; }
}

function harness(options = {}) {
  delete require.cache[require.resolve("../plugins/minigames/CreatureCreation.plugin")];
  const plugin = require("../plugins/minigames/CreatureCreation.plugin");
  const hooks = {};
  const spawned = [];
  const removed = [];
  const addQueue = [];
  const persisted = [];
  const diaries = { easy: false, medium: false };
  const core = {
    ItemIdentifiers: itemIds,
    NpcIdentifiers: npcIds,
    ObjectIdentifiers: objectIds,
    ChatType: { SPAM: 0 },
    ItemDefinition: { forId: (id) => ({ getName: () => `item ${id}` }) },
    Area: class { constructor(boundaries) { this.boundaries = boundaries; } },
    Boundary: class { constructor(...values) { this.values = values; } },
    World: { getAddNPCQueue: () => addQueue },
  };
  const api = {
    core,
    persistAttribute: (name, value) => persisted.push([name, value]),
    onServerStartup: (handler) => { hooks.startup = handler; },
    onItemOnObject: (handler, filter) => { hooks.item = handler; hooks.itemFilter = filter; },
    onObjectInteraction: (_name, actions) => { hooks.activate = actions.Activate; },
    onNpcDeath: (handler) => { hooks.npcDeath = handler; },
    onPlayerLogout: (handler) => { hooks.logout = handler; },
    onPlayerDeath: (handler) => { hooks.playerDeath = handler; },
    onServerShutdown: (handler) => { hooks.shutdown = handler; },
    onCustomEvent: (name, handler) => { if (name === "npc-drops:roll") hooks.dropRoll = handler; },
    registerArea: (area) => { hooks.area = area; },
    emitCustomEvent(name, request) {
      if (name === "quest:is-complete") request.complete = options.questComplete ?? true;
      if (name === "diary:is-complete") request.complete = diaries[request.tier];
    },
    spawnNpc(definition) {
      if (options.spawnThrows) throw new Error("spawn failed");
      if (options.spawnReturnsFalse) return null;
      const npc = { definition, registered: !options.spawnQueued, isRegistered() { return this.registered; } };
      if (options.spawnQueued) addQueue.push(npc);
      spawned.push(npc);
      return npc;
    },
    removeNpc: (npc) => removed.push(npc),
  };
  plugin.register(api);
  assert.equal(hooks.area, undefined, "registration only attaches hooks; setup belongs to server startup");
  hooks.startup({ timestamp: 0 });

  function player({ attributes = new Map(), items = [], x = 3057, y = 4409 } = {}) {
    const location = { getX: () => x, getY: () => y, getZ: () => 0 };
    const inventory = {
      items: items.map(([id, amount]) => new Item(id, amount)),
      getItems() { return this.items; },
      getAmount(id) { return this.items.reduce((n, item) => n + (item.id === id ? item.amount : 0), 0); },
      deleteAtSlot(slot, amount = 1) {
        const item = this.items[slot];
        if (!item) return this;
        item.amount -= amount;
        if (item.amount <= 0) this.items.splice(slot, 1);
        return this;
      },
      adds(id, amount) {
        const item = this.items.find((candidate) => candidate.id === id);
        if (item) item.amount += amount;
        else this.items.push(new Item(id, amount));
      },
    };
    const messages = [];
    return {
      location, inventory, messages,
      getLocation: () => location,
      getAttribute: (name) => attributes.get(name),
      setAttribute: (name, value) => attributes.set(name, value),
      getInventory: () => inventory,
      getPacketSender: () => ({ sendTypedMessage: (_type, text) => messages.push(text) }),
      isPlayer: () => true,
      getAsPlayer() { return this; },
      attributes,
    };
  }
  function objectEvent(player, itemId, itemSlot = 0, objectId = objectIds.SYMBOL_OF_LIFE, location = { x: 3058, y: 4410, z: 0 }) {
    return { player, objectId, location, itemId, itemSlot, handled: false };
  }
  const altarEvent = (player, objectId = objectIds.SYMBOL_OF_LIFE, location = { x: 3058, y: 4410, z: 0 }) => ({ player, objectId, location });
  return { hooks, spawned, removed, addQueue, persisted, diaries, player, objectEvent, altarEvent, plugin };
}

function put(h, player, id, slot = 0) {
  const event = h.objectEvent(player, id, slot);
  h.hooks.item(event);
  return event;
}

function primeNewtroost(h, player) {
  player.inventory.items.push(new Item(itemIds.EYE_OF_NEWT), new Item(itemIds.FEATHER));
  put(h, player, itemIds.EYE_OF_NEWT, player.inventory.items.length - 2);
  put(h, player, itemIds.FEATHER, player.inventory.items.length - 1);
}

test("startup registers persistent altar state and six cache altars map to Wiki recipes", () => {
  const h = harness();
  assert.equal(h.persisted.length, 12);
  assert.deepEqual(h.plugin._test.ALTARS.map(({ tile, creature, npc, ingredients }) => [tile, creature, npc, ingredients]), [
    ["3058,4410", "Newtroost", "NEWTROOST", ["EYE_OF_NEWT", "FEATHER"]],
    ["3018,4410", "Unicow", "UNICOW", ["COWHIDE", "UNICORN_HORN"]],
    ["3012,4380", "Swordchick", "SWORDCHICK", ["RAW_SWORDFISH", "RAW_CHICKEN"]],
    ["3066,4380", "Spidine", "SPIDINE", ["RED_SPIDERS_EGGS", "RAW_SARDINE"]],
    ["3034,4361", "Frogeel", "FROGEEL", ["RAW_CAVE_EEL", "GIANT_FROG_LEGS"]],
    ["3043,4361", "Jubster", "JUBSTER", ["RAW_JUBBLY", "RAW_LOBSTER"]],
  ]);
  assert.deepEqual(h.hooks.itemFilter, { noted: false });
});

test("canonical cache NPCs have their corresponding Wiki drop tables", () => {
  for (const [name, id] of Object.entries(npcIds)) {
    const npc = drops.npcs[String(id)];
    assert.ok(npc, `missing canonical NPC ${name} (${id})`);
    assert.equal(npc.name.toUpperCase(), name);
    assert.ok(npc.tables.length > 0);
    for (const tableId of npc.tables) assert.ok(drops.tables[tableId], `${name} references missing table ${tableId}`);
  }
});

test("item-on-Symbol-of-life accepts either unnoted recipe item once and activates one owner-only NPC", () => {
  const h = harness();
  const p = h.player({ items: [[itemIds.FEATHER, 1], [itemIds.EYE_OF_NEWT, 1]] });
  assert.equal(put(h, p, itemIds.FEATHER, 0).handled, true);
  assert.equal(put(h, p, itemIds.FEATHER, 0).handled, true);
  assert.equal(p.inventory.getAmount(itemIds.FEATHER), 0, "duplicate recipe input did not remove a second item");
  assert.equal(p.inventory.getAmount(itemIds.EYE_OF_NEWT), 1);
  assert.equal(put(h, p, itemIds.EYE_OF_NEWT, 0).handled, true);
  assert.equal(p.inventory.items.length, 0);

  assert.equal(h.hooks.activate(h.altarEvent(p)), true);
  assert.equal(h.hooks.activate(h.altarEvent(p)), true);
  assert.equal(h.spawned.length, 1, "fast activate cannot duplicate the primed ingredients");
  assert.equal(h.spawned[0].definition.id, npcIds.NEWTROOST);
  assert.equal(h.spawned[0].definition.owner, p);
  assert.equal(h.spawned[0].definition.ownerOnly, true);
  assert.equal(p.getAttribute("creature-creation:newtroost"), 0);
  assert.equal(p.getAttribute("creature-creation:newtroost-second"), 0);
});

test("Activate takes each altar's missing ingredients from inventory and spawns its creature", () => {
  const h = harness();
  for (const altar of h.plugin._test.ALTARS) {
    const [x, y] = altar.tile.split(",").map(Number);
    const items = altar.ingredients.map((name) => [itemIds[name], 1]);
    const p = h.player({ items, x, y });
    assert.equal(h.hooks.activate(h.altarEvent(p, objectIds.SYMBOL_OF_LIFE, { x, y, z: 0 })), true, altar.creature);
    assert.equal(p.inventory.items.length, 0, `${altar.creature} consumes its inventory ingredients`);
    assert.equal(h.spawned.at(-1).definition.id, npcIds[altar.npc], `${altar.creature} spawns from Activate`);
    assert.equal(p.getAttribute(`creature-creation:${altar.key}`), 0);
    assert.equal(p.getAttribute(`creature-creation:${altar.key}-second`), 0);
    h.hooks.npcDeath({ npc: h.spawned.at(-1) });
  }
  assert.equal(h.spawned.length, h.plugin._test.ALTARS.length);
});

test("Activate adds only missing ingredients to an already primed altar", () => {
  const h = harness();
  const p = h.player({ items: [[itemIds.COWHIDE, 1], [itemIds.UNICORN_HORN, 1]] });
  p.setAttribute("creature-creation:unicow", itemIds.COWHIDE);

  h.hooks.activate(h.altarEvent(p, objectIds.SYMBOL_OF_LIFE, { x: 3018, y: 4410, z: 0 }));

  assert.equal(p.inventory.getAmount(itemIds.COWHIDE), 1, "the ingredient already on the altar is not consumed again");
  assert.equal(p.inventory.getAmount(itemIds.UNICORN_HORN), 0);
  assert.equal(h.spawned[0].definition.id, npcIds.UNICOW);
});

test("wrong and non-recipe items, and an uncompleted quest, do not consume ingredients", () => {
  const wrong = harness();
  const p1 = wrong.player({ items: [[itemIds.RAW_LOBSTER, 1]] });
  assert.equal(put(wrong, p1, itemIds.RAW_LOBSTER).handled, false);
  assert.equal(p1.inventory.getAmount(itemIds.RAW_LOBSTER), 1);
  const nonRecipe = wrong.player({ items: [[99999, 1]] });
  assert.equal(put(wrong, nonRecipe, 99999).handled, false);
  assert.equal(nonRecipe.inventory.getAmount(99999), 1);

  const quest = harness({ questComplete: false });
  const p2 = quest.player({ items: [[itemIds.EYE_OF_NEWT, 1]] });
  assert.equal(put(quest, p2, itemIds.EYE_OF_NEWT).handled, true);
  assert.equal(p2.inventory.getAmount(itemIds.EYE_OF_NEWT), 1);
  assert.equal(p2.getAttribute("creature-creation:newtroost"), undefined);
});

test("partial priming survives a save and re-login before the other ingredient is placed", () => {
  const h = harness();
  const original = h.player({ items: [[itemIds.EYE_OF_NEWT, 1]] });
  put(h, original, itemIds.EYE_OF_NEWT);
  const savedAttributes = new Map(original.attributes);
  const reloaded = h.player({ attributes: savedAttributes, items: [[itemIds.FEATHER, 1]] });
  put(h, reloaded, itemIds.FEATHER);
  assert.equal(h.hooks.activate(h.altarEvent(reloaded)), true);
  assert.equal(h.spawned.length, 1);
  assert.equal(h.spawned[0].definition.owner, reloaded);
});

test("deletion failure leaves altar state empty; spawn false or throw restores both ingredients", () => {
  const h = harness({ spawnReturnsFalse: true });
  const p = h.player({ items: [[itemIds.EYE_OF_NEWT, 1], [itemIds.FEATHER, 1]] });
  p.inventory.deleteAtSlot = () => p.inventory;
  assert.equal(put(h, p, itemIds.EYE_OF_NEWT).handled, true);
  assert.equal(p.getAttribute("creature-creation:newtroost"), undefined);
  assert.equal(p.inventory.getAmount(itemIds.EYE_OF_NEWT), 1);

  const falseSpawn = harness({ spawnReturnsFalse: true });
  const p2 = falseSpawn.player({ items: [[itemIds.EYE_OF_NEWT, 1], [itemIds.FEATHER, 1]] });
  put(falseSpawn, p2, itemIds.EYE_OF_NEWT);
  put(falseSpawn, p2, itemIds.FEATHER);
  falseSpawn.hooks.activate(falseSpawn.altarEvent(p2));
  assert.equal(p2.getAttribute("creature-creation:newtroost"), itemIds.EYE_OF_NEWT);
  assert.equal(p2.getAttribute("creature-creation:newtroost-second"), itemIds.FEATHER);

  const thrown = harness({ spawnThrows: true });
  const p3 = thrown.player({ items: [[itemIds.EYE_OF_NEWT, 1], [itemIds.FEATHER, 1]] });
  put(thrown, p3, itemIds.EYE_OF_NEWT);
  put(thrown, p3, itemIds.FEATHER);
  assert.throws(() => thrown.hooks.activate(thrown.altarEvent(p3)), /spawn failed/);
  assert.equal(p3.getAttribute("creature-creation:newtroost"), itemIds.EYE_OF_NEWT);
  assert.equal(p3.getAttribute("creature-creation:newtroost-second"), itemIds.FEATHER);
  assert.equal(thrown.spawned.length, 0);
});

test("one living creature per player per altar preserves priming until that creature dies", () => {
  const h = harness();
  const p = h.player({ items: [[itemIds.EYE_OF_NEWT, 1], [itemIds.FEATHER, 1], [itemIds.EYE_OF_NEWT, 1], [itemIds.FEATHER, 1]] });
  put(h, p, itemIds.EYE_OF_NEWT, 0);
  put(h, p, itemIds.FEATHER, 0);
  h.hooks.activate(h.altarEvent(p));
  put(h, p, itemIds.EYE_OF_NEWT, 0);
  put(h, p, itemIds.FEATHER, 0);
  h.hooks.activate(h.altarEvent(p));
  assert.equal(h.spawned.length, 1);
  assert.equal(p.getAttribute("creature-creation:newtroost"), itemIds.EYE_OF_NEWT);
  assert.equal(p.getAttribute("creature-creation:newtroost-second"), itemIds.FEATHER);
  h.hooks.npcDeath({ npc: h.spawned[0] });
  h.hooks.activate(h.altarEvent(p));
  assert.equal(h.spawned.length, 2);
});

test("a creature removed without dying releases its altar on activation and is forgotten by cleanup", () => {
  const h = harness();
  const p = h.player();
  primeNewtroost(h, p);
  h.hooks.activate(h.altarEvent(p));
  const removed = h.spawned[0];
  removed.registered = false;
  primeNewtroost(h, p);
  h.hooks.activate(h.altarEvent(p));
  assert.equal(h.spawned.length, 2);
  assert.equal(p.getAttribute("creature-creation:newtroost"), 0);
  assert.equal(p.getAttribute("creature-creation:newtroost-second"), 0);
  h.hooks.logout({ player: p });
  assert.deepEqual(h.removed, [h.spawned[1]], "the removed creature no longer retains owned cleanup state");
});

test("a creature queued for registration still blocks duplicate activation", () => {
  const h = harness({ spawnQueued: true });
  const p = h.player();
  primeNewtroost(h, p);
  h.hooks.activate(h.altarEvent(p));
  assert.equal(h.spawned[0].isRegistered(), false);
  primeNewtroost(h, p);
  h.hooks.activate(h.altarEvent(p));
  assert.equal(h.spawned.length, 1);
  assert.equal(p.getAttribute("creature-creation:newtroost"), itemIds.EYE_OF_NEWT);
  assert.equal(p.getAttribute("creature-creation:newtroost-second"), itemIds.FEATHER);
  h.addQueue.length = 0;
  h.hooks.activate(h.altarEvent(p));
  assert.equal(h.spawned.length, 2, "cancelling the queued spawn releases the altar too");
});

test("drop hook notes only Wiki diary ingredient drops; unrelated creatures are untouched", () => {
  const h = harness();
  const p = h.player();
  primeNewtroost(h, p);
  h.hooks.activate(h.altarEvent(p));
  const npc = h.spawned[0];
  const dropsIn = [itemIds.RAW_JUBBLY, itemIds.RAW_CAVE_EEL, itemIds.EYE_OF_NEWT, itemIds.UNICORN_HORN, itemIds.RED_SPIDERS_EGGS, itemIds.FEATHER].map((itemId) => ({ itemId }));
  // CreatureCreation's death listener may run before NpcDrops emits this event.
  h.hooks.npcDeath({ npc });
  h.diaries.easy = true;
  const foreign = { npc, player: h.player(), drops: [{ itemId: itemIds.EYE_OF_NEWT }] };
  h.hooks.dropRoll(foreign);
  assert.equal(foreign.drops[0].noted, undefined, "only the NPC owner can receive diary noting");
  const easy = { npc, player: p, drops: dropsIn.map((drop) => ({ ...drop })) };
  h.hooks.dropRoll(easy);
  assert.deepEqual(easy.drops.map((drop) => drop.noted === true), [true, true, false, false, false, false]);
  h.diaries.medium = true;
  const medium = { npc, player: p, drops: dropsIn.map((drop) => ({ ...drop })) };
  h.hooks.dropRoll(medium);
  assert.deepEqual(medium.drops.map((drop) => drop.noted === true), [true, true, true, true, true, false]);
  const unrelated = { npc: {}, player: p, drops: [{ itemId: itemIds.EYE_OF_NEWT }] };
  h.hooks.dropRoll(unrelated);
  assert.equal(unrelated.drops[0].noted, undefined);
});

test("logout, player death, area leave, and server shutdown remove owned creatures", () => {
  for (const cleanup of ["logout", "playerDeath", "area", "shutdown"]) {
    const h = harness();
    const p = h.player({ items: [[itemIds.EYE_OF_NEWT, 1], [itemIds.FEATHER, 1]] });
    put(h, p, itemIds.EYE_OF_NEWT);
    put(h, p, itemIds.FEATHER);
    h.hooks.activate(h.altarEvent(p));
    const npc = h.spawned[0];
    if (cleanup === "area") h.hooks.area.postLeave(p);
    else if (cleanup === "shutdown") h.hooks.shutdown({ timestamp: 1 });
    else h.hooks[cleanup]({ player: p });
    assert.deepEqual(h.removed, [npc], `${cleanup} removes the owned NPC exactly once`);
  }
});
