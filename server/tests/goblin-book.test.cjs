const assert = require("node:assert/strict");
const { test, before } = require("node:test");
const path = require("node:path");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { ItemActionPacketListener } = require("../dist/net/packet/impl/ItemActionPacketListener");
const runtime = require("../plugins/quests/QuestRuntime");
const buttons = new Map();
const itemActions = new Map();
const api = new Proxy({
  core: {},
  onItemAction: (name, actions) => itemActions.set(name, actions),
  onInterfaceActionButton: (ids, handler) => ids.forEach(id => buttons.set(id, handler)),
}, { get: (target, key) => target[key] ?? (() => {}) });
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  runtime.registerQuest(api, { key: "book-ui-fixture", name: "Book UI Fixture" });
});
test("Goblin book Read uses the shared book UI, turns pages and closes without consuming anything", () => {
  const plugin = require("../plugins/items/GoblinBook.plugin");
  assert.equal(plugin.members, true);
  plugin.register(api);
  const actions = itemActions.get("Goblin book");
  assert.deepEqual(Object.keys(actions), ["Read"]);
  const inventory = [{ id: 10999, amount: 1 }];
  const initial = structuredClone(inventory);
  let open = -1;
  const texts = new Map();
  const hidden = new Map();
  const sender = {
    sendInterface: (group) => { open = group; return sender; },
    sendString: (text, uid) => { texts.set(uid, text); return sender; },
    sendInterfaceDisplayState: (uid, hide) => { hidden.set(uid, hide); return sender; },
    sendInterfaceScript: () => sender,
    sendInterfaceRemoval: () => { open = -1; return sender; },
  };
  const player = { getPacketSender: () => sender, getInventory: () => inventory };
  actions.Read({ player, itemId: 10999 });
  assert.equal(open, 392);
  assert.match(texts.get((392 << 16) | 6), /Big High War God/);
  assert.equal(texts.get((392 << 16) | 9), "1");
  assert.equal(hidden.get((392 << 16) | 75), true);
  const first = texts.get((392 << 16) | 44);
  buttons.get((392 << 16) | 77)({ player, buttonId: (392 << 16) | 77 });
  assert.equal(texts.get((392 << 16) | 9), "3");
  assert.notEqual(texts.get((392 << 16) | 44), first);
  buttons.get((392 << 16) | 77)({ player, buttonId: (392 << 16) | 77 });
  assert.equal(texts.get((392 << 16) | 9), "5");
  assert.equal(hidden.get((392 << 16) | 77), true);
  buttons.get((392 << 16) | 75)({ player, buttonId: (392 << 16) | 75 });
  assert.equal(texts.get((392 << 16) | 9), "3");
  buttons.get((392 << 16) | 7)({ player, buttonId: (392 << 16) | 7 });
  assert.equal(open, -1);
  assert.deepEqual(inventory, initial);
});
test("cache inventory operations expose Read only on the actual book", () => {
  assert.deepEqual(ItemActionPacketListener.resolveInventoryWidgetAction(10999, 2), { optionIndex: 1, option: "Read" });
  assert.equal(ItemActionPacketListener.resolveInventoryWidgetAction(11000, 2), null);
  assert.equal(ItemActionPacketListener.resolveInventoryWidgetAction(17850, 2), null);
});
