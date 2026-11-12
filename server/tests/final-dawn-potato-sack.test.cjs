// Run after `yarn build`: node --test tests/final-dawn-potato-sack.test.cjs
// Emptying The Final Dawn's sack of potatoes took the sack and added an empty sack and three potatoes with no space
// check, so a full inventory lost the potatoes. Real engine: every plugin loaded, a real Player, the item's own Empty
// option through PluginManager.emitItemAction with its cache option index.
process.env.DISABLE_PLAYER_BOTS = "1";
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");

const SACK = 5424, EMPTY_SACK = 5418, POTATO = 1942;
let core, next = 9450;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function farmer(t, filler) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++); p.setUsername("potato" + p.getIndex()); p.setRegistered(true); p.setAttribute("bot-skip-persistence", true);
  t.after(() => p.setRegistered(false));
  const q = require("../plugins/quests/QuestRuntime").getRegisteredQuests().find((x) => x.key === "the_final_dawn");
  assert.ok(q); q.setStage(p, 16);
  p.getInventory().add(new core.Item(SACK, 1), false);
  for (let i = 0; i < filler; i++) p.getInventory().add(new core.Item(1511, 1), false); // logs
  const messages = [];
  t.mock.method(p.getPacketSender(), "sendMessage", (m) => { messages.push(m); return p.getPacketSender(); });
  return { p, messages };
}

function empty(f) {
  const slot = f.p.getInventory().getSlotForItemId(SACK);
  const clickType = (core.CacheDefinitions.getItem(SACK).inventoryActions ?? []).indexOf("Empty") + 1;
  assert.ok(clickType > 0);
  PM.emitItemAction({ player: f.p, itemId: SACK, slot, item: f.p.getInventory().getItems()[slot], option: "Empty", clickType, handled: false });
}

test("with too little space the sack is kept and nothing is lost", (t) => {
  const f = farmer(t, 25); // 2 free slots
  empty(f);
  assert.equal(f.p.getInventory().getAmount(SACK), 1, "the sack is kept");
  assert.equal(f.p.getInventory().getAmount(POTATO), 0);
  assert.ok(f.messages.includes("You don't have enough inventory space."), f.messages.join(" | "));
});

test("with room it empties into an empty sack and three potatoes", (t) => {
  const f = farmer(t, 24); // 3 free slots
  empty(f);
  assert.equal(f.p.getInventory().getAmount(SACK), 0);
  assert.equal(f.p.getInventory().getAmount(EMPTY_SACK), 1);
  assert.equal(f.p.getInventory().getAmount(POTATO), 3);
});

// Farming's Fill, Remove-one and use-potato turn the safehouse Potatoes(3) into another count. The ground sack only
// checked for Potatoes(3) or an empty sack, so any other count respawned it: an endless supply of potatoes.
test("a safehouse sack at another count still stops the ground sack respawning", (t) => {
  const { ItemOnGroundManager } = require("../dist/game/entity/impl/grounditem/ItemOnGroundManager");
  const registered = [];
  t.mock.method(ItemOnGroundManager, "registerLocation", (_p, item) => { registered.push(item.getId()); });
  t.mock.method(ItemOnGroundManager, "getGroundItem", () => null);
  for (const [held, expectRespawn] of [["sack_potato_2", false], ["sack_potato_10", false], [null, true]]) {
    const f = farmer(t, 0);
    f.p.getInventory().deleteNumber(SACK, 1);
    if (held) f.p.getInventory().add(new core.Item(core.CacheDefinitions.getObjId(held), 1), false);
    registered.length = 0;
    PM.emitPlayerLogin({ player: f.p, username: f.p.getUsername() });
    assert.equal(registered.includes(SACK), expectRespawn, `holding ${held ?? "no sack"}`);
  }
});
