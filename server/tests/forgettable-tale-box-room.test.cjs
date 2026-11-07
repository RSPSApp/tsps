// Run after `yarn build`: node --test tests/forgettable-tale-box-room.test.cjs
// Forgettable Tale...: the tunnel box gives square stones (2 green and 2 yellow at the final search) with no room
// check, then moves the puzzle on (each colour stacks, so it needs two free slots); on a full inventory the stones were lost and the box only said "searching again",
// so the puzzle could not be finished. Real engine: every plugin loaded, a real Player at the quest's own stage and
// puzzle step, the quest's own object handler.
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

const PUZZLE = "quest.forgettable_tale.puzzle";
const FINAL_SEARCH = 4;

test("a full inventory leaves the final stones in the box, to be searched for again with room", (t) => {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(9050); p.setUsername("tale9050"); p.setRegistered(true); p.setAttribute("bot-skip-persistence", true);
  t.after(() => p.setRegistered(false));
  QuestRuntime.questNamed("Forgettable Tale...").setStage(p, 13);
  p.setAttribute(PUZZLE, FINAL_SEARCH);
  const inv = p.getInventory();
  for (let slot = 0; slot < 27; slot++) inv.setItem(slot, new core.Item(I.LOGS, 1));
  const box = { getId: () => core.ObjectIdentifiers.BOX, getLocation: () => p.getLocation() };
  const search = () => PM.emitObjectInteraction({ player: p, object: box, objectId: core.ObjectIdentifiers.BOX,
    definition: { getActions: () => ["Search"], getName: () => "Box" }, clickType: 1, location: p.getLocation(), handled: false });
  search();
  assert.deepEqual([inv.getAmount(I.SQUARE_STONE_2), inv.getAmount(I.SQUARE_STONE)], [0, 0], "one free slot cannot take both stacks, so neither is given");
  assert.equal(p.getAttribute(PUZZLE), FINAL_SEARCH, "the puzzle waits");
  inv.setItem(26, new core.Item(-1, 0)); // a second free slot: one for each stack
  search();
  assert.deepEqual([inv.getAmount(I.SQUARE_STONE_2), inv.getAmount(I.SQUARE_STONE)], [2, 2]);
  assert.notEqual(p.getAttribute(PUZZLE), FINAL_SEARCH, "and the puzzle moves on");
});
