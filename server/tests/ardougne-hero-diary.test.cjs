const assert = require("node:assert/strict");
const path = require("node:path");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { PluginManager } = require("../dist/plugins/PluginManager");
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { Player } = require("../dist/game/entity/impl/player/Player");
const Diaries = require("../plugins/achievements/AchievementDiaries.plugin");
const Thieving = require("../plugins/skills/Thieving.plugin");
const Diary = require("../plugins/achievements/diaries/ArdougneHeroDiary.plugin");
const Data = require("../plugins/achievements/diaries/Data.AchievementDiaries");
const Progress = require("../plugins/achievements/diaries/Progress.AchievementDiaries");

test("Ardougne Elite task counts successful pickpockets of any Hero", async (t) => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  const core = PluginManager.getCoreApi();
  const pending = [];
  const scheduler = { submit(task) { task.setRunning(true); pending.push(task); } };
  const api = {
    ...PluginManager.createApi("ArdougneHeroDiaryTest"),
    core: { ...core, TaskManager: scheduler, ObjectManager: { register() {}, deregister() {} } },
    getTaskManager: () => scheduler,
  };
  core.ObjectDefinition.init();
  Diaries.register(api);
  Thieving.register(api);
  Diary.register(api);

  let index = 1250;
  const npcs = [];
  t.after(() => { for (const npc of npcs) core.World.getNpcs().remove(npc); core.World.getRemoveNPCQueue().splice(0); });
  let randomValue = 0;
  t.mock.method(Math, "random", () => randomValue);
  function player(privateArea = null) {
    const actor = new Player(null, new core.Location(2635, 3306, 0));
    actor.setIndex(index++);
    actor.setUsername("ardougne-hero-test");
    actor.setRegistered(true);
    actor.setNeedsPlacement(false);
    actor.getSession = () => ({ sendClientPacket: () => true, write() {} });
    actor.getSkillManager().setCurrentLevels(core.Skill.THIEVING, 99);
    actor.getPrivateArea = () => privateArea;
    actor.setAttribute(Progress.TASKS_ATTRIBUTE, {});
    return actor;
  }
  function hero(id, owner) {
    const npc = PluginManager.spawnNpc({ id, x: 2635, y: 3306, z: 0, wanderRadius: 0, owner, ownerOnly: !!owner }, "ArdougneHeroDiaryTest");
    assert.ok(npc, `Hero NPC ${id} spawns`);
    npcs.push(npc);
    assert.equal(npc.getDefinition().getName(), "Hero");
    return npc;
  }
  function advance() {
    for (const task of [...pending]) if (task.isRunning()) task.tick();
  }
  const data = Data.BY_KEY.get("ardougne");
  const done = (actor) => Progress.doneTasks(actor, data).has("pickpocket-a-hero");

  for (const id of [3295, 11934, 11935]) {
    const thief = player();
    const target = hero(id);
    assert.equal(PluginManager.emitNpcInteraction({ player: thief, npc: target, npcId: id, clickType: 3, handled: false }), true);
    assert.equal(done(thief), false, "progress waits for the pickpocket result");
    advance();
    assert.equal(done(thief), true, `Hero variant ${id} advances the task`);
    assert.equal(Progress.tierCount(thief, data, "elite"), 1);
    assert.equal(thief.getPacketSender().getVarbit(data.tiers.elite.countVarbit), 1);
    assert.equal(thief.getPacketSender().getVarbit(data.startedVarbit), 1);
  }

  const failedThief = player();
  const failedHero = hero(3295);
  randomValue = 0.999;
  assert.equal(PluginManager.emitNpcInteraction({ player: failedThief, npc: failedHero, npcId: 3295, clickType: 3, handled: false }), true);
  advance();
  assert.equal(done(failedThief), false, "failed pickpockets do not count");

  const privateThief = player({});
  const privateHero = hero(3295);
  randomValue = 0;
  assert.equal(PluginManager.emitNpcInteraction({ player: privateThief, npc: privateHero, npcId: 3295, clickType: 3, handled: false }), true);
  advance();
  assert.equal(done(privateThief), false, "private-area attempts do not count");

  const fullThief = player();
  const fullHero = hero(3295);
  for (let slot = 0; slot < 28; slot++) fullThief.getInventory().add(new core.Item(slot + 1), false);
  assert.equal(fullThief.getInventory().isFull(), true);
  assert.equal(PluginManager.emitNpcInteraction({ player: fullThief, npc: fullHero, npcId: 3295, clickType: 3, handled: false }), true);
  assert.equal(done(fullThief), false, "a full inventory does not count without an attempt");

  const lowLevelThief = player();
  lowLevelThief.getSkillManager().setCurrentLevels(core.Skill.THIEVING, 79);
  const levelHero = hero(3295);
  assert.equal(PluginManager.emitNpcInteraction({ player: lowLevelThief, npc: levelHero, npcId: 3295, clickType: 3, handled: false }), true);
  advance();
  assert.equal(done(lowLevelThief), false, "a level requirement failure does not count");

  const repeat = player();
  const repeatHero = hero(3295);
  assert.equal(PluginManager.emitNpcInteraction({ player: repeat, npc: repeatHero, npcId: 3295, clickType: 3, handled: false }), true);
  advance();
  assert.equal(Progress.tierCount(repeat, data, "elite"), 1);
  PluginManager.emitCustomEvent("thieving:done", { player: repeat, kind: "pickpocket", succeeded: true, npc: repeatHero });
  assert.equal(Progress.tierCount(repeat, data, "elite"), 1, "repeat outcomes do not add progress");
});
