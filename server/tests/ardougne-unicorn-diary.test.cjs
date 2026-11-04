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
const FairyRings = require("../plugins/world/FairyRings.plugin");
const UnicornPenDiary = require("../plugins/achievements/diaries/ArdougneUnicornPenFairyRingDiary.plugin");
const AchievementDiaries = require("../plugins/achievements/AchievementDiaries.plugin");
const DiaryData = require("../plugins/achievements/diaries/Data.AchievementDiaries");
const DiaryProgress = require("../plugins/achievements/diaries/Progress.AchievementDiaries");

let game;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  TeleportHandler.checkReqs = () => true;
  game = PluginManager.getCoreApi();
  const diaryApi = PluginManager.createApi("UnicornDiaryProgressTest");
  AchievementDiaries.register(diaryApi);
  const unicornApi = PluginManager.createApi("UnicornDiaryArrivalTest");
  UnicornPenDiary.register(unicornApi);
  FairyRings.register({
    core: game,
    persistAttribute() {},
    onObjectInteraction() {},
    onInterfaceActionClick() {},
    onCustomEvent() {},
    emitCustomEvent(name, event) {
      if (name === "fairy-rings:access") event.allowed = true;
    },
    onPlayerLogin() {},
    log() {},
  });
});

function makePlayer(at = new Location(2600, 3200, 0)) {
  let location = at;
  const attributes = new Map();
  const varbits = new Map();
  const log = [];
  const sender = {
    getVarbit: (id) => varbits.get(id) ?? 0,
    sendVarbit: (id, value) => (varbits.set(id, value), sender),
    sendConfig: () => sender,
    closeSubInterface: () => sender,
    sendInterfaceRemoval: () => sender,
    sendSoundEffect: () => sender,
  };
  return {
    getEquipment: () => ({ get: () => ({ getId: () => 772 }) }),
    getInventory: () => ({ getItems: () => [] }),
    getPacketSender: () => sender,
    varbits,
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    log,
    sendMessage: (message) => log.push(message),
    performGraphic() {},
    performAnimation() {},
    getLocation: () => location,
    getPrivateArea: () => null,
    getHitpoints: () => 10,
    isDyingReturn: () => false,
    isRegistered: () => true,
    getMovementQueue: () => ({ reset() {}, handleRegionChange() {} }),
    setLocation: (to) => { location = to; },
    setWalkingDirection() {},
    moveTo: (to) => { location = to; },
  };
}

function runTicks(player, count) {
  for (let tick = 0; tick < count; tick++) TaskManager.process();
}

test("BIS arrival credits the Ardougne unicorn diary after the player reaches the pen", () => {
  const target = FairyRings._test.rings().get("BIS").destination;
  assert.ok(UnicornPenDiary._test.isPenLocation(target));
  const player = makePlayer();
  FairyRings._test.setDials(player, "BIS");
  FairyRings._test.confirmDial(player);
  runTicks(player, 6);

  const task = "enter-the-unicorn-pen-in-ardougne-zoo-using-fair";
  const diary = DiaryData.BY_KEY.get("ardougne");
  assert.ok(DiaryProgress.doneTasks(player, diary).has(task));
  assert.equal(DiaryProgress.tierCount(player, diary, "medium"), 1);
  assert.equal(player.getPacketSender().getVarbit(6292), 1, "the medium count varbit updates");
  assert.equal(player.getPacketSender().getVarbit(4448), 1, "the diary started varbit updates");
  assert.equal(player.log.filter((message) => message.includes("completed a medium task")).length, 1);

  game.PluginManager.emitCustomEvent("teleport:landed", {
    player,
    from: new Location(2600, 3200, 0),
    fromInstance: false,
    to: player.getLocation(),
    source: "fairy-ring",
    code: "BIS",
  });
  assert.equal(DiaryProgress.doneTasks(player, diary).size, 1, "repeating the arrival does not duplicate the task");
  assert.equal(DiaryProgress.tierCount(player, diary, "medium"), 1);
  assert.equal(player.getPacketSender().getVarbit(6292), 1);
  assert.equal(player.log.filter((message) => message.includes("completed a medium task")).length, 1);
  assert.deepEqual(
    [player.getLocation().getX(), player.getLocation().getY(), player.getLocation().getZ()],
    [target.getX(), target.getY(), target.getZ()],
  );
});

test("failed, wrong, private, and non-BIS arrivals do not credit the diary", () => {
  const target = FairyRings._test.rings().get("BIS").destination;
  const player = makePlayer(target);
  const valid = {
    player,
    from: new Location(2600, 3200, 0),
    fromInstance: false,
    to: target,
    source: "fairy-ring",
    code: "BIS",
  };
  const diary = DiaryData.BY_KEY.get("ardougne");
  const invalidEvents = [
    { ...valid, code: "BJR" },
    { ...valid, source: "spirit-tree" },
    { ...valid, to: new Location(2780, 3613, 0) },
    { ...valid, from: target },
    { ...valid, fromInstance: true },
    { ...valid, player: { ...player, getPrivateArea: () => ({}) } },
    { ...valid, player: { ...player, isRegistered: () => false } },
  ];
  for (const event of invalidEvents) game.PluginManager.emitCustomEvent("teleport:landed", event);
  assert.equal(DiaryProgress.doneTasks(player, diary).size, 0);
  assert.equal(player.getPacketSender().getVarbit(6292), 0);

  const failed = makePlayer();
  failed.moveTo = () => {};
  FairyRings._test.setDials(failed, "BIS");
  FairyRings._test.confirmDial(failed);
  runTicks(failed, 6);
  assert.equal(DiaryProgress.doneTasks(failed, diary).size, 0);
  assert.equal(failed.getPacketSender().getVarbit(6292), 0);
  assert.equal(failed.getAttribute(FairyRings._test.USED_CODES_ATTRIBUTE), undefined);
});
