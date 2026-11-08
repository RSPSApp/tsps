const assert = require("node:assert/strict");
const {test} = require("node:test");
const {Server} = require("../dist/Server");
Server.installProductionPathResolver();
require("../dist/game/cache/CachePipeline").CachePipeline.initialize();
const core = require("../dist/plugins/PluginManager").PluginManager.getCoreApi();
const {Inventory} = require("../dist/game/model/container/impl/Inventory");

// Both plugins in the game's load order; an item click stops at the first handler that returns true, as PluginManager does.
function fixture() {
  const actions = [], events = new Map(), attributes = new Map();
  const banks = Array.from({length: core.Bank.TOTAL_BANK_TABS}, () => []);
  const sender = new Proxy({}, {get: () => () => {}});
  const messages = [];
  const player = {getAttribute: key => attributes.get(key), setAttribute: (key, value) => attributes.set(key, value),
    getPacketSender: () => sender, sendMessage: message => messages.push(message), getBank: tab => ({getItems: () => banks[tab]}),
    getUsername: () => "BeginnerBox"};
  const inventory = new Inventory(player);
  player.getInventory = () => inventory;
  const api = {core, persistAttribute() {},
    onItemAction(name, handlers) { actions.push([name, handlers]); },
    onCustomEvent(name, fn) { if (!events.has(name)) events.set(name, []); events.get(name).push(fn); },
    emitCustomEvent(name, request) { for (const fn of events.get(name) ?? []) fn(request); }};
  api.onCustomEvent("quest:is-complete", request => { if (request.key === "x_marks_the_spot") request.complete = true; });
  const proxy = new Proxy(api, {get: (target, key) => key in target ? target[key] : () => {}});
  for (const plugin of ["BeginnerTreasureTrails.plugin", "ClueCapacity.plugin"]) require(`../plugins/treasuretrails/${plugin}`).register(proxy);
  function open(slot) {
    const item = inventory.getItems()[slot], event = {player, slot, item, itemId: item.getId()};
    for (const [name, handlers] of actions) if (name === core.ItemDefinition.forId(item.getId()).getName() && handlers.Open?.(event) === true) return true;
    return false;
  }
  return {inventory, banks, messages, open};
}

test("a beginner scroll box refuses to open while a beginner clue is held or banked", () => {
  const box = core.ItemIdentifiers.SCROLL_BOX_BEGINNER_, scroll = core.ItemIdentifiers.CLUE_SCROLL_BEGINNER_;
  const f = fixture();
  f.inventory.setItem(0, new core.Item(box, 3));
  assert.equal(f.open(0), true);
  assert.equal(f.inventory.getItems()[0].getAmount(), 2);
  assert.equal(f.inventory.getAmount(scroll), 1);
  assert.equal(f.open(0), true);
  assert.equal(f.inventory.getItems()[0].getAmount(), 2, "second box stays shut with a beginner clue in the backpack");
  assert.equal(f.inventory.getAmount(scroll), 1);
  assert.match(f.messages.at(-1), /already have a clue/);
  f.inventory.delete(scroll, 1);
  f.banks[0] = [new core.Item(scroll, 1)];
  f.open(0);
  assert.equal(f.inventory.getItems()[0].getAmount(), 2, "a banked beginner clue also keeps the box shut");
});
