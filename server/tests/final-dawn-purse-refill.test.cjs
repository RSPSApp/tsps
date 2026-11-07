// Run after `yarn build`: node --test tests/final-dawn-purse-refill.test.cjs
// The Final Dawn: the sandy coin purse can be emptied at any stage, but the plant pot filled it only at the stage
// before it was first filled; emptied after that, it could never be filled again and the makeshift blackjack never
// made. Real engine: every plugin loaded, a real Player at the quest's own stage, its Empty item action and its
// item-on-object handler.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");

let core;
let I;
let QuestRuntime;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  QuestRuntime = require("../plugins/quests/QuestRuntime");
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

const SAND_POT = 56472;
const PURSE_SAND = 21;

test("a sandy purse emptied after it was first filled can be filled again at the pot", (t) => {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(9040); p.setUsername("dawn9040"); p.setRegistered(true); p.setAttribute("bot-skip-persistence", true);
  t.after(() => p.setRegistered(false));
  const quest = QuestRuntime.questNamed("The Final Dawn");
  quest.setStage(p, PURSE_SAND);
  const inv = p.getInventory();
  inv.setItem(0, new core.Item(I.EMPTY_COIN_PURSE, 1)); // the sandy purse, emptied (Empty works at any stage)
  const pot = { getId: () => SAND_POT, getLocation: () => p.getLocation(), getDefinition: () => null };
  PM.emitItemOnObject({ player: p, itemId: I.EMPTY_COIN_PURSE, item: inv.getItems()[0], slot: 0, objectId: SAND_POT, object: pot, location: p.getLocation(), handled: false });
  assert.equal(inv.getAmount(I.SANDY_COIN_PURSE), 1, "filled again");
  assert.equal(inv.getAmount(I.EMPTY_COIN_PURSE), 0);
  assert.equal(quest.getStage(p), PURSE_SAND, "the stage does not move back or on");
});
