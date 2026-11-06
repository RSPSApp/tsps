// Run after `yarn build`: node --test tests/ardougne-altar-diary-action.test.cjs
const assert = require("node:assert/strict");
const path = require("node:path");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { PluginManager } = require("../dist/plugins/PluginManager");
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { ObjectActionPacketListener } = require("../dist/net/packet/impl/ObjectActionPacketListener");
const Diaries = require("../plugins/achievements/AchievementDiaries.plugin");
const Altars = require("../plugins/objects/Altars.plugin");
const Data = require("../plugins/achievements/diaries/Data.AchievementDiaries");
const Progress = require("../plugins/achievements/diaries/Progress.AchievementDiaries");

test("East Ardougne church altar diary task requires a successful prayer restoration", async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  const core = PluginManager.getCoreApi();
  core.ObjectDefinition.init();
  core.RegionManager.init();
  const api = PluginManager.createApi("ArdougneAltarDiaryActionTest");
  Diaries.register(api);
  Altars.register(api);

  const altarId = core.ObjectIdentifiers.ALTAR;
  const altarLocation = [2617, 3309, 0];
  const altarDefinition = core.ObjectDefinition.forId(altarId);
  assert.equal(altarDefinition.getName(), "Altar");
  assert.ok(altarDefinition.getInteractions().includes("Pray-at"));

  let index = 1000;
  function actor(privateArea = null) {
    const player = new Player(null, new core.Location(2616, 3309, 0));
    player.setIndex(index++);
    player.setUsername("ardougne-altar-test");
    player.setRegistered(true);
    player.setNeedsPlacement(false);
    player.getSession = () => ({ sendClientPacket: () => true, write() {} });
    player.getPrivateArea = () => privateArea;
    player.getSkillManager().setMaxLevel(core.Skill.PRAYER, 10);
    return player;
  }
  function pray(player, id = altarId, [x, y, z] = altarLocation) {
    const object = new core.GameObject(id, new core.Location(x, y, z), 10, 0, null);
    const event = { player, object, objectId: id, clickType: 1, handled: false };
    assert.equal(PluginManager.emitObjectInteraction(event), true);
    assert.equal(event.handled, true);
    return object;
  }
  function queuePrayer(player) {
    const movement = player.getMovementQueue();
    let execute;
    movement.walkToObject = (_object, options) => { execute = options.execute; return true; };
    new ObjectActionPacketListener().executeAction(player, altarId, ...altarLocation.slice(0, 2), 1);
    assert.equal(typeof execute, "function", "the object listener queued the altar action");
    return execute;
  }
  const diary = Data.BY_KEY.get("ardougne");
  const taskKey = "use-the-altar-in-east-ardougne-s-church";
  const completed = (player) => Progress.doneTasks(player, diary).has(taskKey);

  const restoredPlayer = actor();
  const skills = restoredPlayer.getSkillManager();
  const maxPrayer = skills.getMaxLevel(core.Skill.PRAYER);
  skills.setCurrentLevels(core.Skill.PRAYER, 1);
  const restoredAltar = pray(restoredPlayer);
  assert.deepEqual(
    [restoredAltar.getId(), restoredAltar.getLocation().getX(), restoredAltar.getLocation().getY(), restoredAltar.getLocation().getZ()],
    [altarId, ...altarLocation],
  );
  assert.equal(skills.getCurrentLevel(core.Skill.PRAYER), maxPrayer, "the real altar handler restored Prayer");
  assert.equal(completed(restoredPlayer), true);

  const queuedDeathPlayer = actor();
  const queuedDeathSkills = queuedDeathPlayer.getSkillManager();
  queuedDeathSkills.setCurrentLevels(core.Skill.PRAYER, 1);
  const executeAfterDeath = queuePrayer(queuedDeathPlayer);
  queuedDeathPlayer.setHitpoints(0);
  assert.equal(queuedDeathPlayer.getHitpoints(), 0);
  assert.equal(queuedDeathPlayer.isDyingReturn(), true);
  executeAfterDeath();
  assert.equal(queuedDeathSkills.getCurrentLevel(core.Skill.PRAYER), 1, "a queued action does not restore Prayer after death");
  assert.equal(completed(queuedDeathPlayer), false, "a queued action does not credit the diary after death");

  const dyingPlayer = actor();
  dyingPlayer.getSkillManager().setCurrentLevels(core.Skill.PRAYER, 1);
  dyingPlayer.isDyingReturn = () => true;
  queuePrayer(dyingPlayer)();
  assert.equal(dyingPlayer.getSkillManager().getCurrentLevel(core.Skill.PRAYER), 1, "the dying state blocks the action while hitpoints remain");
  assert.equal(completed(dyingPlayer), false, "the dying state does not earn the task");

  const queuedValidPlayer = actor();
  queuedValidPlayer.getSkillManager().setCurrentLevels(core.Skill.PRAYER, 1);
  queuePrayer(queuedValidPlayer)();
  assert.equal(queuedValidPlayer.getSkillManager().getCurrentLevel(core.Skill.PRAYER), 10, "a living player can use the queued action");
  assert.equal(completed(queuedValidPlayer), true, "a living player earns the task after restoration");

  const fullPrayerPlayer = actor();
  fullPrayerPlayer.getSkillManager().setCurrentLevels(core.Skill.PRAYER, 10);
  pray(fullPrayerPlayer);
  assert.equal(completed(fullPrayerPlayer), false, "full Prayer does not earn the task");

  for (const [label, id, location, privateArea] of [
    ["another altar", core.ObjectIdentifiers.ALTAR_2, altarLocation, null],
    ["another location", altarId, [2618, 3309, 0], null],
    ["another plane", altarId, [2617, 3309, 1], null],
    ["a private instance", altarId, altarLocation, {}],
  ]) {
    const player = actor(privateArea);
    player.getSkillManager().setCurrentLevels(core.Skill.PRAYER, 1);
    pray(player, id, location);
    assert.equal(completed(player), false, `${label} does not earn the task`);
  }
});
