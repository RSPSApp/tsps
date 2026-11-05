const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { before, test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const Diaries = require("../plugins/achievements/AchievementDiaries.plugin");
const Progress = require("../plugins/achievements/diaries/Progress.AchievementDiaries");
const Finish = require("../plugins/achievements/diaries/KourendDiaryActivitiesFinish.plugin");
const Crane = require("../plugins/world/FishingCrane.plugin");
const Ginea = require("../plugins/world/IntelligenceGathering.plugin");
const Library = require("../plugins/world/ArceuusLibrary.plugin");

let core;
let emit;
let taskManager;
let tasks;
let spawned;
let removed;
let questStage;

const { TASKS } = Finish._test;
const diary = Diaries && require("../plugins/achievements/diaries/Data.AchievementDiaries").BY_KEY.get("kourend");

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  tasks = [];
  spawned = [];
  removed = [];
  questStage = new Map();
  const listeners = new Map();
  emit = (name, event) => (listeners.get(name) ?? []).forEach((handler) => handler(event));
  taskManager = {
    submit(task) {
      task.setRunning(true);
      tasks.push(task);
    },
  };
  const api = new Proxy({
    core,
    onCustomEvent(name, handler) {
      const entries = listeners.get(name) ?? [];
      entries.push(handler);
      listeners.set(name, entries);
    },
    emitCustomEvent: emit,
    persistAttribute() {},
    getTaskManager: () => taskManager,
    spawnNpc(definition) {
      const npc = {
        id: definition.id,
        definition,
        removed: false,
        getId: () => definition.id,
        getLocation: () => new core.Location(definition.x, definition.y, definition.z ?? 0),
        isDying: () => false,
        getHitpoints: () => 100,
        getCombat: () => ({ setTarget() {} }),
      };
      spawned.push(npc);
      return npc;
    },
    removeNpc(npc) {
      npc.removed = true;
      removed.push(npc);
    },
  }, { get: (target, key) => key in target ? target[key] : () => {} });
  api.onCustomEvent("quest:get-stage", (request) => {
    const stage = questStage.get(request.player);
    request.stage = stage ?? null;
  });
  api.onCustomEvent("diary:task", Diaries._test.onTask);
  Finish.register(api);
  Crane.register(api);
  Ginea.register(api);
  Library.register(api);
  PluginManager.emitCustomEvent = emit;
});

function advance(ticks = 1) {
  for (let i = 0; i < ticks; i++) {
    for (const task of [...tasks]) {
      if (task.isRunning()) task.tick();
    }
  }
}

function fixture(t, at = [1608, 3790, 0]) {
  const player = new Player(null, new core.Location(...at));
  player.setIndex(3400 + Math.floor(Math.random() * 1000));
  player.setUsername("kourend-activities-native-test");
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

function craneObject(at) {
  return {
    getId: () => Crane._test.BROKEN,
    getLocation: () => at,
    getType: () => 10,
    getFace: () => 1,
  };
}

function resetCrane() {
  Crane._test.setTick(0);
  Crane._test.sessions.clear();
  Crane._test.lastAttempt.clear();
}

function level99(player) {
  player.getSkillManager().setCurrentLevel(core.Skill.CRAFTING, 99, false);
  player.getSkillManager().setCurrentLevel(core.Skill.CONSTRUCTION, 99, false);
}

test("a library shelf holds the sequenced book and the search hands it over for the request", (t) => {
  Library._test.resetArrangement(() => 0);
  const requested = Library._test.bookAt({ x: 1626, y: 3795, z: 0 });
  assert.ok(requested);
  assert.equal(requested, Library._test.arrangement.sequence[0]);

  const player = fixture(t, [1626, 3795, 0]);
  player.setAttribute(Library._test.REQUEST_ATTRIBUTE, { npcId: Library._test.SAM, itemId: requested });
  const search = { player, location: player.getLocation(), handled: false };
  assert.equal(Library._test.search(search), true);
  assert.equal(search.handled, true);
  assert.equal(player.getInventory().getAmount(requested), 0);
  advance(1);
  assert.equal(player.getInventory().getAmount(requested), 1);
  assert.equal(player.getDialogueManager().getDialogue?.().getItemId?.() ?? player.getDialogueManager().getCurrent?.()?.getItemId?.(), requested);

  Library._test.onItemOnNpc({ player, npcId: Library._test.SAM, itemId: requested, target: {}, handled: false });
  assert.equal(done(player, TASKS.libraryBook), true);
});

test("a shelf with no sequenced book says so and a Varlamore request waits for its quest", (t) => {
  Library._test.resetArrangement(() => 0);
  const player = fixture(t, [1626, 3796, 0]);
  const search = { player, location: player.getLocation(), handled: false };
  assert.equal(Library._test.search(search), true);
  assert.equal(player.getInventory().getAmount(Library._test.VARLAMORE_ENVOY), 0);
  assert.equal(search.handled, true);

  const gated = fixture(t, [1626, 3795, 0]);
  const withGate = Library._test.assignRequest(gated, Library._test.SAM, () => 0.999);
  assert.notEqual(withGate, Library._test.VARLAMORE_ENVOY);
  questStage.set(gated, 9);
  const unlocked = Library._test.assignRequest(gated, Library._test.SAM, () => 0.999);
  assert.equal(unlocked, Library._test.VARLAMORE_ENVOY);
  questStage.delete(gated);
});

test("a failed crane attempt repeats after ten ticks and pays on the retry", (t) => {
  resetCrane();
  const player = fixture(t, [1817, 3727, 0]);
  level99(player);
  give(player, 2347);
  give(player, 960, 3);
  give(player, 4819, 18);
  const object = craneObject(player.getLocation());

  withRandom(0.99, () => Crane._test.repair({ player, object, objectId: Crane._test.BROKEN }));
  assert.equal(player.getInventory().getAmount(4819), 17);
  assert.equal(Crane._test.sessions.size, 1);
  assert.equal(done(player, TASKS.crane), false);

  advance(9);
  assert.equal(player.getInventory().getAmount(4819), 17);
  withRandom(0, () => advance(1));
  assert.equal(player.getInventory().getAmount(960), 0);
  assert.equal(player.getInventory().getAmount(4819), 8);
  assert.equal(player.getSkillManager().getExperience(core.Skill.CRAFTING), 396);
  assert.equal(done(player, TASKS.crane), true);
  assert.equal(Crane._test.sessions.size, 0);
});

test("a nearby repairer shares the completion; a distant one and a repeated click do not", (t) => {
  resetCrane();
  const actor = fixture(t, [1817, 3727, 0]);
  const nearby = fixture(t, [1818, 3727, 0]);
  const distant = fixture(t, [1850, 3727, 0]);
  for (const player of [actor, nearby, distant]) {
    level99(player);
    give(player, 2347);
    give(player, 960, 3);
    give(player, 4819, 18);
  }
  const actorObject = craneObject(actor.getLocation());
  const nearbyObject = craneObject(nearby.getLocation());
  const distantObject = craneObject(distant.getLocation());
  withRandom(0.99, () => {
    Crane._test.repair({ player: actor, object: actorObject, objectId: Crane._test.BROKEN });
    Crane._test.repair({ player: nearby, object: nearbyObject, objectId: Crane._test.BROKEN });
    Crane._test.repair({ player: distant, object: distantObject, objectId: Crane._test.BROKEN });
  });
  const actorSession = Crane._test.sessions.get(actor);
  Crane._test.complete(actor, actorSession, 10);
  assert.equal(done(actor, TASKS.crane), true);
  assert.equal(done(nearby, TASKS.crane), true);
  assert.equal(done(distant, TASKS.crane), false);
  assert.equal(distant.getSkillManager().getExperience(core.Skill.CRAFTING), 0);

  // A repeated click under seven ticks cancels the automatic attempt.
  resetCrane();
  const cancel = fixture(t, [1817, 3727, 0]);
  level99(cancel);
  give(cancel, 2347);
  give(cancel, 960, 3);
  give(cancel, 4819, 18);
  withRandom(0.99, () => Crane._test.repair({ player: cancel, object: craneObject(cancel.getLocation()), objectId: Crane._test.BROKEN }));
  assert.equal(Crane._test.sessions.size, 1);
  Crane._test.repair({ player: cancel, object: craneObject(cancel.getLocation()), objectId: Crane._test.BROKEN });
  assert.equal(Crane._test.sessions.size, 0);
});

test("death ends a crane attempt and a dead player cannot be paid", (t) => {
  resetCrane();
  const player = fixture(t, [1817, 3727, 0]);
  level99(player);
  give(player, 2347);
  give(player, 960, 3);
  give(player, 4819, 18);
  withRandom(0.99, () => Crane._test.repair({ player, object: craneObject(player.getLocation()), objectId: Crane._test.BROKEN }));
  assert.equal(Crane._test.sessions.size, 1);
  player.setHitpoints(0);
  Crane._test.processTick(1);
  assert.equal(Crane._test.sessions.size, 0);
  assert.equal(done(player, TASKS.crane), false);
});

test("the meeting schedule spawns a boss and gangsters and removes them after five minutes", () => {
  Ginea._test.despawn();
  Ginea._test.bossType = Ginea._test.BOSS_FEMALE;
  const slot = Math.ceil(Date.now() / Ginea._test.SLOT_MS);
  const start = slot * Ginea._test.SLOT_MS;
  const info = Ginea._test.status(start);
  assert.equal(info.active, true);
  const meeting = Ginea._test.tick(start, () => 0);
  assert.ok(meeting);
  assert.equal(spawned.length, 5);
  assert.equal(spawned[0].id, Ginea._test.BOSS_FEMALE[0]);
  assert.ok(spawned.slice(1).every((npc) => Ginea._test.GANGSTERS.includes(npc.id)));

  Ginea._test.tick(start + Ginea._test.MEETING_MS + 1, () => 0);
  assert.equal(removed.length, 5);
  assert.equal(Ginea._test.current, null);
});

test("the information board gives the source line and a note", (t) => {
  const player = fixture(t);
  const saved = Date.now;
  Date.now = () => Math.ceil(saved() / Ginea._test.SLOT_MS) * Ginea._test.SLOT_MS + 1000;
  try {
    assert.equal(Ginea._test.checkBoard({ player, objectId: Ginea._test.INFORMATION, handled: false }), true);
    assert.equal(player.getInventory().getAmount(Ginea._test.GANG_MEETING_INFO), 1);
  } finally {
    Date.now = saved;
  }
});

test("the canonical gang boss drop is always Intelligence", () => {
  const drops = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../data/definitions/npc-drops.json"), "utf8"));
  const entry = drops.tables.gang_boss.entries.find((row) => row.item_id === Ginea._test.INTELLIGENCE);
  assert.ok(entry);
  assert.equal(entry.always, true);
});
