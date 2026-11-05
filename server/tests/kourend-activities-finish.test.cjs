const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const Diaries = require("../plugins/achievements/AchievementDiaries.plugin");
const DiaryData = require("../plugins/achievements/diaries/Data.AchievementDiaries");
const Progress = require("../plugins/achievements/diaries/Progress.AchievementDiaries");
const Finish = require("../plugins/achievements/diaries/KourendDiaryActivitiesFinish.plugin");
const Crane = require("../plugins/world/FishingCrane.plugin");
const Ginea = require("../plugins/world/IntelligenceGathering.plugin");
const Library = require("../plugins/world/ArceuusLibrary.plugin");
const Stealing = require("../plugins/minigames/stealingartefacts/Common.StealingArtefacts");

let core;
let emit;

const diary = DiaryData.BY_KEY.get("kourend");
const { TASKS } = Finish._test;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  const listeners = new Map();
  emit = (name, event) => (listeners.get(name) ?? []).forEach((handler) => handler(event));
  const api = new Proxy({
    core,
    onCustomEvent(name, handler) {
      const entries = listeners.get(name) ?? [];
      entries.push(handler);
      listeners.set(name, entries);
    },
    emitCustomEvent: emit,
    persistAttribute() {},
    getTaskManager: () => ({ submit() {} }),
  }, { get: (target, key) => key in target ? target[key] : () => {} });
  Progress(api);
  api.onCustomEvent("diary:task", Diaries._test.onTask);
  Finish.register(api);
  Crane.register(api);
  Ginea.register(api);
  Library.register(api);
  Stealing.bind(api);
  PluginManager.emitCustomEvent = emit;
});

function fixture(t, at = [1367, 3631, 0]) {
  const player = new Player(null, new core.Location(...at));
  player.setIndex(2400 + Math.floor(Math.random() * 1000));
  player.setUsername("kourend-activities-finish-test");
  player.setRegistered(true);
  player.setNeedsPlacement(false);
  player.getSession = () => ({ sendClientPacket: () => true, write() {} });
  player.getPrivateArea = () => null;
  player.setAttribute(Progress.TASKS_ATTRIBUTE, {});
  t.after(() => player.setRegistered(false));
  return player;
}

function done(player, task) {
  return Progress.doneTasks(player, diary).has(task);
}

function give(player, itemId, amount = 1) {
  player.getInventory().addItem(new core.Item(itemId, amount));
}

function withRandom(value, run) {
  const saved = Math.random;
  Math.random = () => value;
  try { return run(); } finally { Math.random = saved; }
}

test("a bluegill caught on Molch Island credits the task, elsewhere or another fish does not", (t) => {
  const player = fixture(t);
  emit("fishing:success", { player, itemId: core.ItemIdentifiers.BLUEGILL });
  assert.equal(done(player, TASKS.bluegill), true);

  const elsewhere = fixture(t, [3200, 3200, 0]);
  emit("fishing:success", { player: elsewhere, itemId: core.ItemIdentifiers.BLUEGILL });
  emit("fishing:success", { player: elsewhere, itemId: core.ItemIdentifiers.SHARK });
  assert.equal(done(elsewhere, TASKS.bluegill), false);
});

test("a successful crane repair consumes the materials, grants both XP and credits once", (t) => {
  const player = fixture(t, [1817, 3727, 0]);
  player.getSkillManager().setCurrentLevel(core.Skill.CRAFTING, 99, false);
  player.getSkillManager().setCurrentLevel(core.Skill.CONSTRUCTION, 99, false);
  give(player, 2347);
  give(player, 960, 3);
  give(player, 4819, 9);
  const object = {
    getId: () => Crane._test.BROKEN,
    getLocation: () => player.getLocation(),
    getType: () => 10,
    getFace: () => 1,
  };
  withRandom(0, () => Crane._test.repair({ player, object, objectId: Crane._test.BROKEN }));
  assert.equal(done(player, TASKS.crane), true);
  assert.equal(player.getInventory().getAmount(960), 0);
  assert.equal(player.getInventory().getAmount(4819), 0);
  assert.equal(player.getSkillManager().getExperience(core.Skill.CRAFTING), 396);
  assert.equal(player.getSkillManager().getExperience(core.Skill.CONSTRUCTION), 396);
});

test("a failed crane repair bends one nail and a low level repairs nothing", (t) => {
  const player = fixture(t, [1817, 3727, 0]);
  player.getSkillManager().setCurrentLevel(core.Skill.CRAFTING, 99, false);
  player.getSkillManager().setCurrentLevel(core.Skill.CONSTRUCTION, 99, false);
  give(player, 2347);
  give(player, 960, 3);
  give(player, 4819, 9);
  const object = {
    getId: () => Crane._test.BROKEN,
    getLocation: () => player.getLocation(),
    getType: () => 10,
    getFace: () => 1,
  };
  withRandom(0.99, () => Crane._test.repair({ player, object, objectId: Crane._test.BROKEN }));
  assert.equal(done(player, TASKS.crane), false);
  assert.equal(player.getInventory().getAmount(960), 3);
  assert.equal(player.getInventory().getAmount(4819), 8);

  const novice = fixture(t, [1817, 3727, 0]);
  novice.getSkillManager().setCurrentLevel(core.Skill.CRAFTING, 29, false);
  novice.getSkillManager().setCurrentLevel(core.Skill.CONSTRUCTION, 29, false);
  give(novice, 2347);
  give(novice, 960, 3);
  give(novice, 4819, 9);
  Crane._test.repair({ player: novice, object, objectId: Crane._test.BROKEN });
  assert.equal(done(novice, TASKS.crane), false);
});

test("delivering intelligence to Captain Ginea swaps it for training manuals and credits", (t) => {
  const player = fixture(t);
  give(player, Ginea._test.INTELLIGENCE, 2);
  assert.equal(Ginea._test.onDialogueVariant({ player, npcId: Ginea._test.GINEA }), Ginea._test.DELIVERING_VARIANT);
  const request = { player, npcId: Ginea._test.GINEA, stepId: Ginea._test.DELIVER_STEP, text: "" };
  Ginea._test.onDialogueAction(request);
  assert.equal(player.getInventory().getAmount(Ginea._test.INTELLIGENCE), 0);
  assert.equal(player.getInventory().getAmount(Ginea._test.TRAINING_MANUAL), 2);
  assert.equal(request.handled, true);
  assert.equal(done(player, TASKS.intelligence), true);

  const empty = fixture(t);
  assert.equal(Ginea._test.onDialogueVariant({ player: empty, npcId: Ginea._test.GINEA }), null);
  Ginea._test.onDialogueAction({ player: empty, npcId: Ginea._test.GINEA, stepId: Ginea._test.DELIVER_STEP });
  assert.equal(done(empty, TASKS.intelligence), false);
});

test("only the requester accepts their requested library book and gives arcane knowledge", (t) => {
  const player = fixture(t, [1639, 3801, 0]);
  Library._test.onChoice({ player, npcId: Library._test.SAM, option: Library._test.REQUEST_OPTION });
  withRandom(0, () => Library._test.onChoice({ player, npcId: Library._test.SAM, option: Library._test.REQUEST_OPTION }));
  const request = player.getAttribute(Library._test.REQUEST_ATTRIBUTE);
  assert.ok(request && request.npcId === Library._test.SAM);

  const line = { player, npcId: Library._test.SAM, text: "I think I'd like to read: '[book name]'" };
  Library._test.onLine(line);
  assert.equal(line.text, `I think I'd like to read: '${Library._test.BOOKS.get(request.itemId)}'`);

  give(player, request.itemId);
  Library._test.onItemOnNpc({ player, npcId: Library._test.SAM, itemId: request.itemId, target: {}, handled: false });
  assert.equal(done(player, TASKS.libraryBook), true);
  assert.equal(player.getInventory().getAmount(request.itemId), 0);
  assert.equal(player.getInventory().getAmount(Library._test.BOOK_OF_ARCANE_KNOWLEDGE), 1);
  assert.equal(player.getAttribute(Library._test.REQUEST_ATTRIBUTE), null);

  const wrong = fixture(t, [1639, 3801, 0]);
  Library._test.onChoice({ player: wrong, npcId: Library._test.SAM, option: Library._test.REQUEST_OPTION });
  const wrongRequest = wrong.getAttribute(Library._test.REQUEST_ATTRIBUTE);
  const wrongBook = [...Library._test.BOOKS.keys()].find((id) => id !== wrongRequest.itemId);
  give(wrong, wrongBook);
  Library._test.onItemOnNpc({ player: wrong, npcId: Library._test.SAM, itemId: wrongBook, target: {}, handled: false });
  assert.equal(done(wrong, TASKS.libraryBook), false);
});

test("handing Captain Khaled a stolen artefact credits the delivery; empty-handed does not", (t) => {
  const player = fixture(t);
  Stealing.assignTask(player, Stealing.houseByName("North"));
  Stealing.giveArtefact(player, Stealing._test.state.artefacts[0]);
  assert.equal(Stealing.handIn(player, () => 0) > 0, true);
  assert.equal(done(player, TASKS.artefact), true);

  const empty = fixture(t);
  Stealing.forgetSession(empty);
  assert.equal(Stealing.handIn(empty, () => 0), 0);
  assert.equal(done(empty, TASKS.artefact), false);
});
