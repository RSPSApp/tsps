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

function talePlayer(t, index) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(index); p.setUsername(`tale${index}`); p.setRegistered(true); p.setAttribute("bot-skip-persistence", true);
  t.after(() => p.setRegistered(false));
  return p;
}

function fillInventory(p, free = 0) {
  const inv = p.getInventory();
  for (let slot = 0; slot < 28 - free; slot++) inv.setItem(slot, new core.Item(I.LOGS, 1));
  return inv;
}

test("harvesting the kelda hops with a full inventory leaves them on the patch", (t) => {
  const p = talePlayer(t, 9051);
  const quest = QuestRuntime.questNamed("Forgettable Tale...");
  quest.setStage(p, 6);
  p.setAttribute("quest.forgettable_tale.farming", 8);
  const inv = fillInventory(p);
  const patchId = core.ObjectIdentifiers.KELDA_HOPS;
  const harvest = () => PM.emitObjectInteraction({ player: p, object: { getId: () => patchId, getLocation: () => p.getLocation() },
    objectId: patchId, definition: { getActions: () => ["Harvest"], getName: () => "Kelda hops" }, clickType: 1,
    location: p.getLocation(), handled: false });
  harvest();
  assert.equal(inv.getAmount(I.KELDA_HOPS), 0);
  assert.equal(p.getAttribute("quest.forgettable_tale.farming"), 8, "the hops stay grown");
  assert.equal(quest.getStage(p), 6, "the quest does not move on");
  inv.setItem(27, new core.Item(-1, 0));
  harvest();
  assert.equal(inv.getAmount(I.KELDA_HOPS), 1);
  assert.equal(quest.getStage(p), 7);
});

test("dialogue hand-outs with a full inventory go to the floor, not nowhere", (t) => {
  const p = talePlayer(t, 9052);
  QuestRuntime.questNamed("Forgettable Tale...").setStage(p, 8);
  const inv = fillInventory(p);
  const registered = [];
  const ground = require("../dist/game/entity/impl/grounditem/ItemOnGroundManager").ItemOnGroundManager;
  const original = ground.registers;
  ground.registers = (player, item) => { registered.push([item.getId(), item.getAmount()]); };
  t.after(() => { ground.registers = original; });
  for (const stepId of ["Z9bb9f", "oKT26B", "QDUHsY", "5-Cvcz"]) {
    PM.emitCustomEvent("npc-dialogue:action", { player: p, npcId: -1, stepId, handled: false });
  }
  assert.deepEqual(registered, [[I.KELDA_STOUT, 1], [I.KELDA_HOPS, 1], [I.MARRENTILL_SEED, 2], [I.KELDA_SEED, 1]]);
  assert.equal(inv.getFreeSlots(), 0);
});
