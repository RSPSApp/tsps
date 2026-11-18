// Run after `yarn build`: node --test tests/gotr-deposit-pool-can-bank.test.cjs
// The Deposit Pool banks runes, so the bank's vetoes apply: an Ultimate Ironman can't bank (Wiki, Ultimate Ironman
// Mode: "Cannot withdraw, deposit or note items at a bank"), as at a deposit box or the Forestry leprechaun. Real
// engine: every plugin loaded, real Players, the pool's Deposit-runes on its real loc.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");

let core, Pool, pool;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  PM.emitServerStartup({});
  Pool = require("../plugins/minigames/guardiansoftherift/DepositPool.GuardiansOfTheRift");
  pool = core.CacheDefinitions.getLocId?.("gotr_depositchest") ?? core.CacheDefinitions.getObjectId?.("gotr_depositchest");
});
after(() => PM.emitServerShutdown({}));

let next = 9990;
function runecrafter(t, mode) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++); p.setUsername("pooler" + p.getIndex()); p.setRegistered(true); p.setAttribute("bot-skip-persistence", true);
  t.after(() => p.setRegistered(false));
  if (mode) p.setAttribute("ironman:mode", mode);
  p.getInventory().add(new core.Item(core.ItemIdentifiers.NATURE_RUNE, 40), false);
  const messages = [];
  t.mock.method(p.getPacketSender(), "sendMessage", (m) => { messages.push(m); return p.getPacketSender(); });
  return { p, messages };
}

test("an Ultimate Ironman's runes stay in the backpack at the Deposit Pool; anyone else's are banked", (t) => {
  assert.ok(Number.isInteger(pool), "the pool's loc");
  const uim = runecrafter(t, "ultimate");
  Pool._test.depositRunes({ player: uim.p, objectId: pool });
  assert.equal(uim.p.getInventory().getAmount(core.ItemIdentifiers.NATURE_RUNE), 40, "kept");
  assert.equal(uim.p.getBank(0).getAmount(core.ItemIdentifiers.NATURE_RUNE), 0, "nothing banked");
  assert.ok(!uim.messages.includes("You deposit all of your runes into the pool."), "and the pool doesn't claim it");
  const main = runecrafter(t, null);
  Pool._test.depositRunes({ player: main.p, objectId: pool });
  assert.equal(main.p.getInventory().getAmount(core.ItemIdentifiers.NATURE_RUNE), 0);
  assert.equal(main.p.getBank(0).getAmount(core.ItemIdentifiers.NATURE_RUNE), 40);
  assert.ok(main.messages.includes("You deposit all of your runes into the pool."));
});

const ALL = "You deposit all of your runes into the pool.";
function withRunes(t, capacity, runes) {
  const { p, messages } = runecrafter(t, null);
  for (const id of runes) p.getInventory().add(new core.Item(id, 10), false);
  t.mock.method(core.Bank, "getCapacity", () => capacity);
  return { p, messages };
}
// The bank's full line; a bank-space plugin may reword it ("Set a Bank PIN to unlock more bank space.").
function fullOnce(messages) {
  assert.equal(messages.length, 1, "one full-bank line: " + JSON.stringify(messages));
  assert.notEqual(messages[0], ALL);
}

test("a full bank keeps every rune type and says so once, not once per rune type", (t) => {
  const runes = [core.ItemIdentifiers.LAW_RUNE, core.ItemIdentifiers.COSMIC_RUNE, core.ItemIdentifiers.DEATH_RUNE];
  const { p, messages } = withRunes(t, 0, runes);
  Pool._test.depositRunes({ player: p, objectId: pool });
  assert.equal(p.getInventory().getAmount(core.ItemIdentifiers.NATURE_RUNE), 40, "kept");
  for (const id of runes) assert.equal(p.getInventory().getAmount(id), 10, "kept");
  fullOnce(messages);
});

test("runes that stay behind for lack of space mean the pool doesn't claim all of them", (t) => {
  const { p, messages } = withRunes(t, 1, [core.ItemIdentifiers.LAW_RUNE, core.ItemIdentifiers.COSMIC_RUNE]);
  Pool._test.depositRunes({ player: p, objectId: pool });
  assert.equal(p.getInventory().getAmount(core.ItemIdentifiers.NATURE_RUNE), 0, "the first type fits");
  assert.equal(p.getBank(0).getAmount(core.ItemIdentifiers.NATURE_RUNE), 40);
  assert.equal(p.getInventory().getAmount(core.ItemIdentifiers.LAW_RUNE), 10, "kept");
  assert.equal(p.getInventory().getAmount(core.ItemIdentifiers.COSMIC_RUNE), 10, "kept");
  fullOnce(messages);
});

test("runes joining stacks already in a full bank still go, and then the pool claims them all", (t) => {
  const { p, messages } = withRunes(t, 1, []);
  p.getBank(0).add(new core.Item(core.ItemIdentifiers.NATURE_RUNE, 1), false);
  Pool._test.depositRunes({ player: p, objectId: pool });
  assert.equal(p.getBank(0).getAmount(core.ItemIdentifiers.NATURE_RUNE), 41);
  assert.deepEqual(messages, [ALL]);
});

test("Deposit-runes respects inventory slot locks until the locks are disabled", (t) => {
  const { p, messages } = runecrafter(t, null);
  const I = core.ItemIdentifiers;
  const inventory = p.getInventory();
  inventory.add(new core.Item(I.AIR_RUNE, 30), false);
  p.setAttribute("bank-settings:deposit-locks", 1);
  Pool._test.depositRunes({ player: p, objectId: pool });
  assert.equal(inventory.forSlot(0).getId(), I.NATURE_RUNE);
  assert.equal(inventory.forSlot(0).getAmount(), 40);
  assert.equal(p.getBank(0).getAmount(I.NATURE_RUNE), 0);
  assert.equal(inventory.getAmount(I.AIR_RUNE), 0);
  assert.equal(p.getBank(0).getAmount(I.AIR_RUNE), 30);
  assert.ok(!messages.includes(ALL), "the pool does not claim all runes while a locked stack remains");

  p.setAttribute("bank-settings:deposit-locks-off", 1);
  Pool._test.depositRunes({ player: p, objectId: pool });
  assert.equal(inventory.getAmount(I.NATURE_RUNE), 0);
  assert.equal(p.getBank(0).getAmount(I.NATURE_RUNE), 40);
  assert.equal(messages.at(-1), ALL);
});
