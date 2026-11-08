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
