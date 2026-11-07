// Real Slayer assignment and diary event composition. Run after yarn build.
const assert = require("node:assert/strict");
const path = require("node:path");
const { test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { NPCOptionPacketListener } = require("../dist/net/packet/impl/NPCOptionPacketListener");

test("a real Chaeldar assignment credits the Lumbridge medium diary", async (t) => {
  const core = PM.getCoreApi(), { World, RegionManager, Location, NPC, Skill, SkillManager, TaskManager } = core;
  const oldBots = process.env.DISABLE_PLAYER_BOTS, oldSubmit = TaskManager.submit, oldError = console.error;
  const tasks = new Set(), players = [], npcs = [], errors = [], events = []; let started = false;
  process.env.DISABLE_PLAYER_BOTS = "1";
  TaskManager.submit = function (task, ...args) { tasks.add(task); return oldSubmit.call(this, task, ...args); };
  console.error = (...args) => { errors.push(args.map(String).join(" ")); oldError(...args); };
  t.after(() => {
    const failures = [], safely = (fn) => { try { fn(); } catch (error) { failures.push(String(error)); } };
    try {
      for (const p of players) safely(() => { if (p.isRegistered()) World.getPlayers().removes(p); });
      for (const n of npcs) safely(() => { if (n.isRegistered()) World.getNpcs().removes(n); });
      if (started) safely(() => PM.emitServerShutdown({}));
      for (const task of tasks) safely(() => { if (task.isRunning()) task.stop(); });
      safely(() => World.process());
      for (const task of tasks) safely(() => { if (task.isRunning()) task.stop(); });
    } finally {
      TaskManager.submit = oldSubmit; console.error = oldError;
      if (oldBots === undefined) delete process.env.DISABLE_PLAYER_BOTS; else process.env.DISABLE_PLAYER_BOTS = oldBots;
    }
    assert.deepEqual(failures, []); assert.deepEqual(errors, []);
  });
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  RegionManager.init(); RegionManager.loadMapFiles(2444, 4431); RegionManager.loadMapFiles(3147, 9914);
  PM.emitServerStartup({}); started = true;
  PM.createApi("ChaeldarAssignmentControl").onCustomEvent("slayer:task-assigned", (event) => {
    if (players.includes(event.player)) events.push({ player: event.player, master: event.master, task: event.task, taskId: event.taskId });
  });
  const Data = require("../plugins/skills/slayer/Data.Slayer"), Tasks = require("../plugins/skills/slayer/Tasks.Slayer");
  const State = require("../plugins/skills/slayer/State.Slayer"), Choice = require("../plugins/skills/slayer/Choice.Slayer");
  const Progress = require("../plugins/achievements/diaries/Progress.AchievementDiaries");
  const diary = require("../plugins/achievements/diaries/Data.AchievementDiaries").BY_KEY.get("lumbridge");
  const quest = require("../plugins/quests/QuestRuntime").questNamed("Lost City"); assert.ok(quest);
  const channel = () => ({ kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} });
  // NPCs are fixture-placed at source spawn coordinates, not naturally reached.
  function spawn(id, name, x, y) {
    const loc = new Location(x, y, 0), npc = NPC.create(id, loc); npcs.push(npc); npc.setScriptedMovement(true);
    assert.equal(World.getNpcs().add(npc), true); npc.needsPlacement = false;
    const def = npc.getCurrentDefinition(); assert.equal(def.getName(), name);
    assert.equal(def.getActions()[2], "Assignment", "active cache exposes Assignment at option 3");
    const candidates = [[x-1,y],[x+1,y],[x,y-1],[x,y+1]].map(([a,b]) => new Location(a,b,0));
    const standing = candidates.find((at) => !RegionManager.blocked(at, null)); assert.ok(standing);
    return { npc, standing };
  }
  const chaeldar = spawn(core.NpcIdentifiers.CHAELDAR, "Chaeldar", 2444, 4431);
  const vannaka = spawn(core.NpcIdentifiers.VANNAKA, "Vannaka", 3147, 9914);
  const master = Data.masterForNpcName("Chaeldar"); assert.equal(master.id, 4); assert.ok(master.tasks.length > 0);
  assert.equal(Data.masterForNpcName("Vannaka").id, 3);
  function actor(name, standing, strong) {
    const p = new Player(new PlayerSession(channel())); players.push(p);
    p.setUsername(name); p.setLongUsername(core.Misc.stringToLongBigInt(name));
    p.setAttribute("bot-skip-persistence", true); p.setLocation(standing.clone());
    assert.equal(World.getPlayers().add(p), true); p.needsPlacement = false;
    if (strong) for (const skill of Skill.values()) {
      p.getSkillManager().setExperiences(skill, SkillManager.getExperienceForLevel(99), false);
      p.getSkillManager().setMaxLevel(skill, 99); p.getSkillManager().setCurrentLevels(skill, 99);
    }
    // Seed completed access quest; this is not a Lost City playthrough.
    quest.setStage(p, 6); assert.equal(quest.isComplete(p), true);
    p.getInventory().add(new core.Item(core.ItemIdentifiers.DRAMEN_STAFF, 1), true);
    assert.equal(Tasks.current(p), null);
    return p;
  }
  function assign(p, n) {
    let queued; const movement = p.getMovementQueue(), original = movement.walkToEntity;
    movement.walkToEntity = (_target, callback) => { queued = callback; return true; };
    try { new NPCOptionPacketListener().executeOption(p, n.getIndex(), 3); }
    finally { movement.walkToEntity = original; }
    assert.equal(typeof queued, "function", "real NPC listener queued Assignment");
    queued(); // Captured walk callback; no natural walking claim.
  }
  function snapshot(p) {
    return { inventory: p.getInventory().getItems().map((item) => [item.getId(), item.getAmount(), structuredClone(item.getMeta())]),
      xp: Skill.values().map((skill) => p.getSkillManager().getExperience(skill)),
      points: State.varbit(p, "slayer_points"), streak: State.varbit(p, "slayer_tasks_completed") };
  }
  const player = actor("chaeldardiary", chaeldar.standing, true);
  assert.ok(player.getSkillManager().getCombatLevel() >= 70);
  assert.equal(Tasks.meetsMaster(player, master), true); assert.equal(Choice.pending(player), false);
  assert.equal(Progress.doneTasks(player, diary).has("get-a-slayer-task-from-chaeldar"), false);
  const before = snapshot(player); assign(player, chaeldar.npc);
  const assigned = Tasks.current(player), observed = events.filter((event) => event.player === player);
  assert.ok(assigned && assigned.count > 0, "actual Slayer assignment was stored"); assert.equal(assigned.masterId, 4);
  assert.equal(observed.length, 1); assert.equal(observed[0].master, 4); assert.equal(observed[0].taskId, assigned.taskId);
  assert.equal(Progress.doneTasks(player, diary).has("get-a-slayer-task-from-chaeldar"), true, "Chaeldar assignment credits the diary");
  assert.deepEqual(snapshot(player), before, "assignment conserves items, XP, points and streak");
  player.closeInterruptibleInterfaces(); const stored = structuredClone(Tasks.current(player)), repeatBefore = snapshot(player);
  const doneBefore = [...Progress.doneTasks(player, diary)];
  assign(player, chaeldar.npc); assert.deepEqual(Tasks.current(player), stored); assert.equal(events.filter((e) => e.player === player).length, 1);
  assert.deepEqual(snapshot(player), repeatBefore); assert.deepEqual([...Progress.doneTasks(player, diary)], doneBefore);
  const wrong = actor("wrongmaster", vannaka.standing, true), wrongBefore = snapshot(wrong);
  assign(wrong, vannaka.npc); assert.equal(Tasks.current(wrong)?.masterId, 3);
  const wrongEvents = events.filter((e) => e.player === wrong); assert.equal(wrongEvents.length, 1); assert.equal(wrongEvents[0].master, 3);
  assert.equal(Progress.doneTasks(wrong, diary).has("get-a-slayer-task-from-chaeldar"), false); assert.deepEqual(snapshot(wrong), wrongBefore);
  const weak = actor("weakslayer", chaeldar.standing, false), weakBefore = snapshot(weak);
  assert.ok(weak.getSkillManager().getCombatLevel() < 70); assign(weak, chaeldar.npc);
  assert.equal(Tasks.current(weak), null); assert.equal(events.filter((e) => e.player === weak).length, 0);
  assert.equal(Progress.doneTasks(weak, diary).has("get-a-slayer-task-from-chaeldar"), false); assert.deepEqual(snapshot(weak), weakBefore);
});
