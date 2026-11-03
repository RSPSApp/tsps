// Run with: node --test tests/table-items.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");

const TableItems = require("../plugins/world/TableItems.plugin");

const TABLE_LOCATION = { x: 3222, y: 3218, z: 0 };

class FakeItem {
  constructor(id, amount = 1, { tradeable = true, dropable = true } = {}) {
    this.id = id;
    this.amount = amount;
    this.tradeable = tradeable;
    this.dropable = dropable;
    this.meta = new Map();
  }
  getId() { return this.id; }
  getAmount() { return this.amount; }
  isTradeable() { return this.tradeable; }
  isDropable() { return this.dropable; }
  clone() { return new FakeItem(this.id, this.amount, { tradeable: this.tradeable, dropable: this.dropable }); }
  setAmount(amount) { this.amount = amount; return this; }
}

function setup({ items = [], groundItems = [] } = {}) {
  const placed = [];
  const messages = [];
  const inventory = { items, deleted: [] };
  const player = {
    getPrivateArea: () => "area",
    getInventory: () => ({
      getItems: () => inventory.items,
      deleteAtSlot: (slot, amount) => {
        inventory.deleted.push([slot, amount]);
        const item = inventory.items[slot];
        if (item.amount > amount) item.amount -= amount;
        else inventory.items.splice(slot, 1);
        return inventory;
      },
    }),
    sendMessage: (message) => messages.push(message),
  };
  const core = {
    Item: FakeItem,
    Location: { isSameTile: (a, b) => a.x === b.x && a.y === b.y && a.z === b.z },
    World: { getItems: () => groundItems },
    ItemOnGroundManager: { registerLocation: (...args) => placed.push(args) },
  };
  const hooks = [];
  TableItems.register({ core, onItemOnObject: (handler, filter) => hooks.push({ handler, filter }) });
  return { player, placed, messages, groundItems, hooks, inventory };
}

function table(name = "Table") {
  return {
    getDefinition: () => ({ getName: () => name }),
    getLocation: () => ({ ...TABLE_LOCATION, clone() { return { ...this }; } }),
  };
}

function useOn(player, object, item, slot = 0) {
  const event = { player, object, item, itemId: item.getId(), itemSlot: slot, handled: false };
  player.__handler(event);
  return event;
}

test("registers as a fallback item-on-object handler", () => {
  const { hooks } = setup();
  assert.equal(hooks.length, 1);
  assert.equal(hooks[0].filter.fallback, true);
});

test("places a tradeable item on a table for ten minutes", () => {
  const item = new FakeItem(995, 5);
  const { player, placed, hooks, messages, inventory } = setup({ items: [item] });
  player.__handler = hooks[0].handler;

  const event = useOn(player, table(), item);

  assert.equal(event.handled, true);
  assert.deepEqual(inventory.deleted, [[0, 1]]);
  assert.equal(messages.length, 0);
  assert.equal(placed.length, 1);
  const [owner, groundItem, location, privateArea, options] = placed[0];
  assert.equal(owner, player);
  assert.equal(groundItem.getId(), 995);
  assert.equal(groundItem.getAmount(), 1);
  assert.deepEqual({ x: location.x, y: location.y, z: location.z }, TABLE_LOCATION);
  assert.equal(privateArea, "area");
  assert.equal(options.despawnDelay, 1000);
});

test("accepts table name variants", () => {
  for (const name of ["Table", "Oak table", "Stone Table", "Gnome table"]) {
    const item = new FakeItem(995);
    const { player, placed, hooks } = setup({ items: [item] });
    player.__handler = hooks[0].handler;
    const event = useOn(player, table(name), item);
    assert.equal(event.handled, true, name);
    assert.equal(placed.length, 1, name);
  }
});

test("leaves non-tables alone", () => {
  for (const name of ["Chair", "Crate", "Tablet", "Charred remains of a table", "Table hotspot", "Table space", "Table parts", "Table saw", "Table blockade"]) {
    const item = new FakeItem(995);
    const { player, placed, hooks, inventory } = setup({ items: [item] });
    player.__handler = hooks[0].handler;
    const event = useOn(player, table(name), item);
    assert.equal(event.handled, false, name);
    assert.equal(inventory.deleted.length, 0, name);
    assert.equal(placed.length, 0, name);
  }
});

test("only tradeable, droppable items are placed", () => {
  for (const flags of [{ tradeable: false }, { dropable: false }]) {
    const item = new FakeItem(995, 1, flags);
    const { player, placed, hooks, inventory } = setup({ items: [item] });
    player.__handler = hooks[0].handler;
    const event = useOn(player, table(), item);
    assert.equal(event.handled, false);
    assert.equal(inventory.deleted.length, 0);
    assert.equal(placed.length, 0);
  }
});

test("ignores a use whose inventory slot changed while walking", () => {
  const clicked = new FakeItem(995);
  const other = new FakeItem(526);
  const { player, placed, hooks, inventory } = setup({ items: [other] });
  player.__handler = hooks[0].handler;

  const event = useOn(player, table(), clicked);

  assert.equal(event.handled, true);
  assert.equal(inventory.deleted.length, 0);
  assert.equal(placed.length, 0);
});

test("one item stack per table spot", () => {
  const item = new FakeItem(995);
  const occupied = {
    isPendingRemoval: () => false,
    getPrivateArea: () => "area",
    getPosition: () => ({ ...TABLE_LOCATION }),
  };
  const { player, placed, hooks, messages, inventory } = setup({ items: [item], groundItems: [occupied] });
  player.__handler = hooks[0].handler;

  const event = useOn(player, table(), item);

  assert.equal(event.handled, true);
  assert.equal(messages.length, 1);
  assert.equal(inventory.deleted.length, 0);
  assert.equal(placed.length, 0);
});

test("a stack in another private area does not block the table", () => {
  const item = new FakeItem(995);
  const elsewhere = {
    isPendingRemoval: () => false,
    getPrivateArea: () => "other-area",
    getPosition: () => ({ ...TABLE_LOCATION }),
  };
  const { player, placed, hooks } = setup({ items: [item], groundItems: [elsewhere] });
  player.__handler = hooks[0].handler;

  assert.equal(useOn(player, table(), item).handled, true);
  assert.equal(placed.length, 1);
});
