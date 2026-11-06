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
let attackRoll;

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
    onPlayerDealtDamage(handler) { attackRoll = handler; },
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
        getCombat: () => ({ setTarget(target) { npc.attackTarget = target; } }),
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
  Progress(api);
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
  return new core.GameObject(Crane._test.BROKEN, at, 10, 1, null);
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


test("the randomized library origin moves books and wraps around the shelf list", () => {
  const data = require("../plugins/world/data/arceuus-library.json");
  let rolls = [0, 0, 0];
  Library._test.resetArrangement(() => rolls.shift());
  const before = data.bookcases.map(([x, y, z]) => Library._test.bookAt({ x, y, z }));
  rolls = [0, 0.999999, 0];
  Library._test.resetArrangement(() => rolls.shift());
  assert.equal(Library._test.arrangement.zero, 352);
  const after = data.bookcases.map(([x, y, z]) => Library._test.bookAt({ x, y, z }));
  assert.notDeepEqual(after, before);
  for (const [x, y, z, index] of data.bookcases) {
    const offset = (index - 352 + data.bookcases.length) % data.bookcases.length;
    if (offset === 0 || offset === data.step) {
      assert.equal(Library._test.bookAt({ x, y, z }), Library._test.arrangement.sequence[offset / data.step]);
    }
  }
});

for (const missing of [2347, 960, 4819, "level"]) {
  test(`a crane retry cannot pay after losing ${missing}`, (t) => {
    resetCrane();
    const player = fixture(t, [1817, 3727, 0]);
    level99(player);
    give(player, 2347);
    give(player, 960, 3);
    give(player, 4819, 18);
    withRandom(0.99, () => Crane._test.repair({ player, object: craneObject(player.getLocation()), objectId: Crane._test.BROKEN }));
    if (missing === "level") player.getSkillManager().setCurrentLevel(core.Skill.CRAFTING, 29, false);
    else player.getInventory().deleteNumber(missing, player.getInventory().getAmount(missing));
    withRandom(0, () => advance(10));
    assert.equal(player.getSkillManager().getExperience(core.Skill.CRAFTING), 0);
    assert.equal(done(player, TASKS.crane), false);
    assert.equal(Crane._test.sessions.has(player), false);
  });
}

test("a shared crane completion excludes a repairer who banked their supplies", (t) => {
  resetCrane();
  const actor = fixture(t, [1817, 3727, 0]);
  const nearby = fixture(t, [1818, 3727, 0]);
  for (const player of [actor, nearby]) {
    level99(player);
    give(player, 2347);
    give(player, 960, 3);
    give(player, 4819, 18);
    withRandom(0.99, () => Crane._test.repair({ player, object: craneObject(player.getLocation()), objectId: Crane._test.BROKEN }));
  }
  nearby.getInventory().deleteNumber(960, 3);
  withRandom(0, () => Crane._test.attempt(actor, Crane._test.sessions.get(actor), 10));
  assert.equal(done(actor, TASKS.crane), true);
  assert.equal(done(nearby, TASKS.crane), false);
  assert.equal(nearby.getSkillManager().getExperience(core.Skill.CRAFTING), 0);
  assert.equal(nearby.getInventory().getAmount(4819), 17);
  assert.equal(Crane._test.sessions.has(nearby), false);
});


test("queuing a hit against a gang member makes the rest of the meeting retaliate", (t) => {
  const player = fixture(t);
  Ginea._test.despawn();
  const start = Math.ceil(Date.now() / Ginea._test.SLOT_MS) * Ginea._test.SLOT_MS;
  const meeting = Ginea._test.tick(start, () => 0);
  const [target, ...others] = meeting.members;
  assert.equal(typeof attackRoll, "function");
  const { CombatFactory } = require("../dist/game/content/combat/CombatFactory");
  const original = PluginManager.emitPlayerDealtDamage;
  PluginManager.emitPlayerDealtDamage = attackRoll;
  target.isUntargetable = () => false;
  target.isNeedsPlacement = () => false;
  target.isPlayer = () => false;
  const queued = [];
  const combat = target.getCombat();
  combat.getHitQueue = () => ({ addPendingHit: (hit) => queued.push(hit) });
  target.getCombat = () => combat;
  const hit = {
    getAttacker: () => player, getTarget: () => target,
    capDamageToBudget() {}, rewardsExperience: () => false, getDelay: () => 0,
  };
  try { CombatFactory.addPendingHit(hit); } finally { PluginManager.emitPlayerDealtDamage = original; }
  assert.deepEqual(queued, [hit]);
  assert.ok(others.every((npc) => npc.attackTarget === player));
  assert.equal(target.attackTarget, undefined);
  Ginea._test.despawn();
});


test("the activity ids resolve to their cache names and actions", () => {
  core.ObjectDefinition.init();
  assert.equal(core.ObjectDefinition.forId(Crane._test.BROKEN).getName(), "Fishing Crane");
  assert.ok(core.ObjectDefinition.forId(Crane._test.BROKEN).getActions().includes("Repair"));
  assert.equal(core.ObjectDefinition.forId(Ginea._test.INFORMATION).getName(), "Information");
  assert.ok(core.ObjectDefinition.forId(Ginea._test.INFORMATION).getActions().includes("Check"));
  for (const [id, name] of [[Library._test.SAM, "Sam"], [Library._test.PROFESSOR_GRACKLEBONE, "Professor Gracklebone"], [Library._test.VILLIA, "Villia"], [Ginea._test.GINEA, "Captain Ginea"]]) {
    assert.equal(core.NpcDefinition.forId(id).getName(), name);
  }
  for (const id of [...Ginea._test.GANGSTERS, ...Ginea._test.BOSS_FEMALE, ...Ginea._test.BOSS_MALE]) {
    assert.match(core.NpcDefinition.forId(id).getName(), /Gangster|Gang boss/);
  }
});


test("every randomized library layout makes all sixteen requested books reachable", () => {
  const data = require("../plugins/world/data/arceuus-library.json");
  for (let sequence = 0; sequence < data.sequences.length; sequence++) {
    for (let origin = 0; origin < data.bookcases.length; origin++) {
      const rolls = [sequence / data.sequences.length, origin / data.bookcases.length, 0];
      Library._test.resetArrangement(() => rolls.shift());
      const reachable = new Set(data.bookcases.map(([x, y, z]) => Library._test.bookAt({ x, y, z })).filter((id) => id != null));
      assert.deepEqual(reachable, new Set(data.sequences[sequence]));
    }
  }
});
