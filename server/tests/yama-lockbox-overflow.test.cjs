// node --test tests/yama-lockbox-overflow.test.cjs
// The Forgotten lockbox's coin reward at the item-stack cap, through the production Inventory.
const assert = require("node:assert/strict");
const { before, test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { Item } = require("../dist/game/model/Item");
const { ItemOnGroundManager } = require("../dist/game/entity/impl/grounditem/ItemOnGroundManager");
const { ItemIdentifiers: I } = require("../dist/util/ItemIdentifiers");
const { MAX_STACK_AMOUNT } = require("../dist/game/model/container/StackType");

const Common = require("../plugins/bosses/yama/Common.Yama");
const Lockbox = require("../plugins/bosses/yama/Lockbox.Yama");

let actions;

before(async () => {
  await CachePipeline.initialize(process.cwd());
  const api = {
    core: PluginManager.getCoreApi(),
    onItemAction(_name, handlers) {
      actions = handlers;
    },
  };
  Common.init(api);
  Lockbox.attachLockbox(api);
});

function player(t, coins) {
  const p = new Player(null);
  const sender = new Proxy({}, { get: () => () => sender });
  t.mock.method(p, "getPacketSender", () => sender);
  p.getInventory().setItem(0, new Item(I.COINS, coins));
  p.getInventory().setItem(1, new Item(Common.data.lockbox.item, 1));
  return p;
}

test("a capped coin stack keeps the lockbox's whole reward", (t) => {
  const drops = [];
  t.mock.method(ItemOnGroundManager, "registers", (owner, item) => drops.push({ owner, item }));
  const messages = [];
  const p = player(t, MAX_STACK_AMOUNT - 1);
  t.mock.method(p, "sendMessage", (message) => messages.push(message));

  const originalRandom = Math.random;
  Math.random = () => 390 / 403; // the 20/403 coin interval
  try {
    assert.equal(actions.Open({ player: p, itemId: Common.data.lockbox.item }), true);
  } finally {
    Math.random = originalRandom;
  }

  assert.equal(p.getInventory().getAmount(I.COINS), MAX_STACK_AMOUNT);
  assert.equal(p.getInventory().getAmount(Common.data.lockbox.item), 0);
  assert.equal(drops.length, 1, "the overflow is on the ground");
  assert.equal(drops[0].owner, p);
  assert.equal(drops[0].item.getId(), I.COINS);
  assert.equal(drops[0].item.getAmount(), 233_332);
  assert.equal(messages.at(-1), Common.data.lockbox.entries.find((entry) => entry.itemId === I.COINS).message);
});
