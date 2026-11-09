// Run after `yarn build`: node --test tests/fletching-cape-search.test.cjs
// rsprox_transcripts/229/02597.txt, 230/00347.txt, 232/03140.txt (normal worlds): the Fletching cape's Search adds a
// bronze crossbow, then the mith grapple with its rope (9419), says "You search the cape and find a
// <col=800000>Bronze crossbow<col=000000> and <col=800000>Mithril grapple<col=000000>." and then how many searches
// are left: "...twice more today.", "...one more time today.", "...for the final time today." (free_grapple 1, 2, 3).
// The cape gave the rope-less grapple (9418) and its own line, with no second one.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const Options = require("../plugins/items/skillcapes/Options.SkillCapes");
let core, next = 9850;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

test("three Fletching cape searches: crossbow then roped grapple, the recorded lines, free_grapple 1-3", (t) => {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++); p.setUsername("fletchcape" + next); p.setRegistered(true); p.setAttribute("bot-skip-persistence", true);
  t.after(() => { p.setRegistered(false); core.TaskManager.cancelTasks(p); });
  const messages = [];
  t.mock.method(p.getPacketSender(), "sendMessage", (m) => { messages.push(m); return p.getPacketSender(); });
  const left = ["You may search the cape twice more today.", "You may search the cape one more time today.", "You search the cape for the final time today."];
  for (let i = 0; i < 3; i++) {
    messages.length = 0;
    Options.searchGrapple(p);
    assert.deepEqual(messages, [
      "You search the cape and find a <col=800000>Bronze crossbow<col=000000> and <col=800000>Mithril grapple<col=000000>.",
      left[i],
    ]);
    assert.equal(p.getPacketSender().getVarbit(core.CacheDefinitions.getVarbitId("free_grapple")), i + 1);
    const inv = p.getInventory();
    assert.equal(inv.getAmount(9419), 1, "the mith grapple with its rope");
    assert.equal(inv.getAmount(9418), 0, "not the rope-less one");
    assert.equal(inv.getItems()[0].getId(), core.ItemIdentifiers.BRONZE_CROSSBOW, "the crossbow comes first");
    // As recorded (232/03140.txt:66491-66494), the next search follows dropping both.
    inv.resetItems();
  }
});

// rsprox_transcripts/232/03140.txt: holding the grapple refuses the search (66219); a full bag says "You need at least
// two inventory spaces to search your cape." (66034).
test("a held grapple or a full bag refuses the search, as recorded", (t) => {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++); p.setUsername("fletchcape" + next); p.setRegistered(true); p.setAttribute("bot-skip-persistence", true);
  t.after(() => { p.setRegistered(false); core.TaskManager.cancelTasks(p); });
  const messages = [];
  t.mock.method(p.getPacketSender(), "sendMessage", (m) => { messages.push(m); return p.getPacketSender(); });
  p.getInventory().add(new core.Item(9419, 1), true);
  Options.searchGrapple(p);
  assert.deepEqual(messages, ["You already have a mithril grapple with you."]);
  assert.equal(p.getInventory().getAmount(core.ItemIdentifiers.BRONZE_CROSSBOW), 0);
  p.getInventory().resetItems();
  for (let slot = 0; slot < 27; slot++) p.getInventory().setItem(slot, new core.Item(core.ItemIdentifiers.LOGS, 1));
  messages.length = 0;
  Options.searchGrapple(p);
  assert.deepEqual(messages, ["You need at least two inventory spaces to search your cape."]);
  // The grapple held and the bag full: the spaces line comes first (232/03140.txt:66034).
  p.getInventory().setItem(0, new core.Item(9419, 1));
  messages.length = 0;
  Options.searchGrapple(p);
  assert.deepEqual(messages, ["You need at least two inventory spaces to search your cape."]);
});

// rsprox captures (2 recordings): a second Agility cape stamina boost in a day says "You have used your stamina boost
// for today. Try again tomorrow."
test("the cape's second stamina boost of the day is refused with the recorded line", (t) => {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++); p.setUsername("staminacape" + next); p.setRegistered(true); p.setAttribute("bot-skip-persistence", true);
  t.after(() => { p.setRegistered(false); core.TaskManager.cancelTasks(p); });
  const messages = [];
  t.mock.method(p.getPacketSender(), "sendMessage", (m) => { messages.push(m); return p.getPacketSender(); });
  Options.staminaBoost(p);
  messages.length = 0;
  Options.staminaBoost(p);
  assert.deepEqual(messages, ["You have used your stamina boost for today. Try again tomorrow."]);
});
