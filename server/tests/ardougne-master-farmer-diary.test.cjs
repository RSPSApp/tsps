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
const Diary = require("../plugins/achievements/diaries/ArdougneMasterFarmerDiary.plugin");
const Data = require("../plugins/achievements/diaries/Data.AchievementDiaries");
const Progress = require("../plugins/achievements/diaries/Progress.AchievementDiaries");

test("Ardougne Medium farmer task follows successful pickpockets of its northern spawn", async (t) => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  const core = PluginManager.getCoreApi();
  const pending = [];
  const scheduler = { submit(task) { task.setRunning(true); pending.push(task); } };
  const api = {
    ...PluginManager.createApi("ArdougneMasterFarmerDiaryTest"),
    core: { ...core, TaskManager: scheduler, ObjectManager: { register() {}, deregister() {} } },
    getTaskManager: () => scheduler,
  };
  core.ObjectDefinition.init();
  Diaries.register(api);
  Thieving.register(api);
  Diary.register(api);

  let index = 1200;
  const npcs = [];
  t.after(() => { for (const npc of npcs) core.World.getNpcs().remove(npc); core.World.getRemoveNPCQueue().splice(0); });
  let randomValue = 0;
  t.mock.method(Math, "random", () => randomValue);
  function player(x = 2635, y = 3364, z = 0, privateArea = null) {
    const actor = new Player(null, new core.Location(x, y, z));
    actor.setIndex(index++);
    actor.setUsername("ardougne-farmer-test");
    actor.setRegistered(true);
    actor.setNeedsPlacement(false);
    actor.getSession = () => ({ sendClientPacket: () => true, write() {} });
    actor.getSkillManager().setCurrentLevels(core.Skill.THIEVING, 99);
    actor.getPrivateArea = () => privateArea;
    actor.setAttribute(Progress.TASKS_ATTRIBUTE, {});
    return actor;
  }
  function farmer(x = 2636, y = 3364, z = 0, owner) {
    const npc = PluginManager.spawnNpc({ id: 5730, x, y, z, wanderRadius: 0, owner, ownerOnly: !!owner }, "ArdougneMasterFarmerDiaryTest");
    assert.ok(npc);
    npcs.push(npc);
    return npc;
  }
  function advance() {
    for (const task of [...pending]) if (task.isRunning()) task.tick();
  }
  const data = Data.BY_KEY.get("ardougne");
  const task = "pickpocket-the-master-farmer-north-of-ardougne";
  const done = (actor) => Progress.doneTasks(actor, data).has(task);

  const thief = player();
  const target = farmer();
  assert.equal(target.getId(), 5730);
  assert.equal(target.getCurrentDefinition(thief).getName(), "Master Farmer");
  assert.equal(PluginManager.emitNpcInteraction({ player: thief, npc: target, npcId: 5730, clickType: 3, handled: false }), true);
  assert.equal(done(thief), false, "the diary waits for the action outcome");
  advance();
  assert.equal(done(thief), true);
  assert.equal(Progress.tierCount(thief, data, "medium"), 1);
  assert.equal(thief.getPacketSender().getVarbit(data.tiers.medium.countVarbit), 1);
  assert.equal(thief.getPacketSender().getVarbit(data.startedVarbit), 1);
  const completedMessageCount = thief.getPacketSender().getMessages?.().length;
  PluginManager.emitCustomEvent("thieving:done", { player: thief, kind: "pickpocket", succeeded: true, npc: target });
  assert.equal(Progress.tierCount(thief, data, "medium"), 1, "repeated outcome does not add progress");
  assert.equal(thief.getPacketSender().getMessages?.().length, completedMessageCount);

  const blocked = [
    { player: player(2635, 3364, 0, {}), npc: farmer() },
    { player: player(), npc: farmer(2636, 3364, 1) },
    { player: player(), npc: farmer(2640, 3364) },
    { player: player(), npc: farmer(2619, 3274) },
    { player: player(), npc: farmer(2800, 3200) },
  ];
  const wrongIdNpc = farmer();
  wrongIdNpc.getId = () => 5731;
  blocked.push({ player: player(), npc: wrongIdNpc });
  const privateNpc = farmer();
  privateNpc.getPrivateArea = () => ({ getObjects() { return []; } });
  blocked.push({ player: player(), npc: privateNpc });
  const deadNpc = farmer();
  deadNpc.setHitpoints(0);
  blocked.push({ player: player(), npc: deadNpc });
  for (const [index, event] of blocked.entries()) {
    assert.equal(Diary._test.pickpocketed({ ...event, kind: "pickpocket", succeeded: true }), undefined);
    assert.equal(done(event.player), false, `blocked target ${index} does not count`);
  }

  const failed = player();
  const failedNpc = farmer();
  randomValue = 0.999;
  assert.equal(PluginManager.emitNpcInteraction({ player: failed, npc: failedNpc, npcId: 5730, clickType: 3, handled: false }), true);
  advance();
  assert.equal(done(failed), false, "a real failed pickpocket does not count");
  randomValue = 0;
  assert.equal(Diary._test.pickpocketed({ player: failed, npc: failedNpc, kind: "stall", succeeded: true }), undefined);
  failed.setRegistered(false);
  assert.equal(Diary._test.pickpocketed({ player: failed, npc: failedNpc, kind: "pickpocket", succeeded: true }), undefined);
  assert.equal(done(failed), false);
});
