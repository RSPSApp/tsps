const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Location } = require("../dist/game/model/Location");
const { TaskManager } = require("../dist/game/task/TaskManager");
const { TeleportHandler } = require("../dist/game/model/teleportation/TeleportHandler");
const QuestRuntime = require("../plugins/quests/QuestRuntime");
const FairyRings = require("../plugins/world/FairyRings.plugin");
const IslandDiary = require("../plugins/achievements/diaries/ArdougneNecromancerIslandDiary.plugin");
const AchievementDiaries = require("../plugins/achievements/AchievementDiaries.plugin");
const DiaryData = require("../plugins/achievements/diaries/Data.AchievementDiaries");
const Progress = require("../plugins/achievements/diaries/Progress.AchievementDiaries");

let core;
let stage = 39;

before(async (t) => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  TeleportHandler.checkReqs = () => true;
  const originalQuests = QuestRuntime.getRegisteredQuests;
  QuestRuntime.getRegisteredQuests = () => [{
    name: "Fairytale II - Cure a Queen",
    getStage: () => stage,
  }];
  t.after(() => { QuestRuntime.getRegisteredQuests = originalQuests; });
  const diaryApi = PluginManager.createApi("NecromancerIslandDiaryProgressTest");
  AchievementDiaries.register(diaryApi);
  IslandDiary.register(PluginManager.createApi("NecromancerIslandDiaryTest"));
  FairyRings.register({
    core,
    persistAttribute() {},
    onCanAttack() {},
    onObjectInteraction() {},
    onInterfaceActionClick() {},
    onCustomEvent() {},
    emitCustomEvent(name, event) {
      if (name === "fairy-rings:access") event.allowed = stage >= 40;
    },
    onPlayerLogin() {},
    log() {},
  });
});

function makePlayer(at = new Location(2600, 3200, 0)) {
  let location = at;
  let interfaceId = -1;
  const attributes = new Map();
  const varbits = new Map();
  const sender = {
    getVarbit: (id) => varbits.get(id) ?? 0,
    sendVarbit: (id, value) => (varbits.set(id, value), sender),
    sendConfig: () => sender,
    sendString: () => sender,
    sendClientScript: () => sender,
    sendInterface: (id) => ((interfaceId = id), sender),
    sendSubInterface: () => sender,
    closeSubInterface: () => sender,
    sendInterfaceRemoval: () => ((interfaceId = -1), sender),
    sendSoundEffect: () => sender,
  };
  return {
    getEquipment: () => ({ get: () => ({ getId: () => 772 }) }),
    getInventory: () => ({ getItems: () => [] }),
    getPacketSender: () => sender,
    varbits,
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    sendMessage() {},
    performGraphic() {},
    performAnimation() {},
    getLocation: () => location,
    getInterfaceId: () => interfaceId,
    getPrivateArea: () => null,
    getHitpoints: () => 10,
    isDyingReturn: () => false,
    isRegistered: () => true,
    getMovementQueue: () => ({ reset() {}, handleRegionChange() {} }),
    setLocation: (to) => { location = to; },
    moveTo: (to) => { location = to; },
  };
}

function runTicks(player, count) {
  for (let tick = 0; tick < count; tick++) TaskManager.process();
}

const diary = DiaryData.BY_KEY.get("ardougne");
const emit = (name, event) => core.PluginManager.emitCustomEvent(name, event);

test("AIR's real island landing advances Ardougne Medium #12 after FT2 stage 40", () => {
  const target = FairyRings._test.rings().get("AIR").destination;
  assert.deepEqual([target.getX(), target.getY(), target.getZ()], [2700, 3247, 0]);
  const player = makePlayer();

  stage = 39;
  assert.equal(FairyRings._test.canUse(player), false, "stage 39 does not grant fairy-ring access");
  assert.equal(Progress.tierCount(player, diary, "medium"), 0);

  stage = 40;
  assert.equal(FairyRings._test.canUse(player), true, "FT2 stage 40 grants fairy-ring access");
  FairyRings._test.openDial({ player, location: { x: 2600, y: 3200, z: 0 } });
  FairyRings._test.setDials(player, "AIR");
  FairyRings._test.confirmDial(player);
  runTicks(player, 6);

  assert.deepEqual([player.getLocation().getX(), player.getLocation().getY(), player.getLocation().getZ()], [2700, 3247, 0]);
  assert.ok(Progress.doneTasks(player, diary).has(IslandDiary._test.TASK));
  assert.equal(Progress.tierCount(player, diary, "medium"), 1);
  assert.equal(player.getPacketSender().getVarbit(diary.tiers.medium.countVarbit), 1);
  assert.equal(player.getPacketSender().getVarbit(diary.startedVarbit), 1);
});

test("login, admin, failed, wrong-code, and instance arrivals do not credit the island task", () => {
  const target = FairyRings._test.rings().get("AIR").destination;
  const player = makePlayer();
  emit("player:login", { player });
  const validShape = {
    player,
    from: new Location(2600, 3200, 0),
    fromInstance: false,
    to: target,
    source: "fairy-ring",
    code: "AIR",
  };
  emit("teleport:landed", { ...validShape, source: "admin" });
  emit("teleport:landed", { ...validShape, code: "BIS" });
  emit("teleport:landed", { ...validShape, fromInstance: true });
  emit("teleport:landed", validShape);
  assert.equal(Progress.tierCount(player, diary, "medium"), 0, "the event target alone is not proof of arrival");

  const failed = makePlayer();
  failed.moveTo = () => {};
  stage = 40;
  FairyRings._test.openDial({ player: failed, location: { x: 2600, y: 3200, z: 0 } });
  FairyRings._test.setDials(failed, "AIR");
  FairyRings._test.confirmDial(failed);
  runTicks(failed, 6);
  assert.equal(Progress.tierCount(failed, diary, "medium"), 0, "a failed move emits no successful landing");
  assert.equal(failed.getPacketSender().getVarbit(diary.tiers.medium.countVarbit), 0);
});
