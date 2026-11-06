// Run after `yarn build`: node --test tests/ardougne-cake-diary-action.test.cjs
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
const Data = require("../plugins/achievements/diaries/Data.AchievementDiaries");
const Progress = require("../plugins/achievements/diaries/Progress.AchievementDiaries");

test("Ardougne Easy cake stall task follows successful cake thefts only", async (t) => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  const core = PluginManager.getCoreApi();
  core.ObjectDefinition.init();
  const pending = [];
  const scheduler = { submit(task) { task.setRunning(true); pending.push(task); } };
  const api = {
    ...PluginManager.createApi("ArdougneCakeDiaryActionTest"),
    core: {
      ...core,
      TaskManager: scheduler,
      ObjectManager: { register() {}, deregister() {} },
    },
    getTaskManager: () => scheduler,
  };
  Diaries.register(api);
  Thieving.register(api);
  const successes = [];
  api.onCustomEvent("thieving:success", (event) => successes.push(event));

  let index = 1000;
  function actor(x, y, z = 0, privateArea = null) {
    const player = new Player(null, new core.Location(x, y, z));
    player.setIndex(index++);
    player.setUsername("ardougne-cake-test");
    player.setRegistered(true);
    player.setNeedsPlacement(false);
    player.getSession = () => ({ sendClientPacket: () => true, write() {} });
    player.getSkillManager().setCurrentLevels(core.Skill.THIEVING, 99);
    player.getPrivateArea = () => privateArea;
    return player;
  }
  function steal(player, x, y, z = 0) {
    const object = new core.GameObject(core.ObjectIdentifiers.BAKERS_STALL, new core.Location(x, y, z), 10, 1, null);
    assert.equal(object.getDefinition().getName(), "Baker's stall");
    const event = { player, object, definition: object.getDefinition(), handled: false };
    Thieving._test.handleStealFromStall(event);
    assert.equal(event.handled, true);
    for (const task of [...pending]) if (task.isRunning()) task.tick();
    return object;
  }
  const diary = Data.BY_KEY.get("ardougne");
  const taskKey = "steal-a-cake-from-the-ardougne-market-stalls";
  const completed = (player) => Progress.doneTasks(player, diary).has(taskKey);
  let roll = 0.1;
  t.mock.method(Math, "random", () => roll);

  const cakeThief = actor(2654, 3311);
  steal(cakeThief, 2655, 3311);
  assert.equal(cakeThief.getInventory().contains(core.ItemIdentifiers.CAKE), true);
  assert.equal(completed(cakeThief), true);
  assert.deepEqual([successes.at(-1).stall, successes.at(-1).itemId,
    successes.at(-1).location.getX(), successes.at(-1).location.getY(), successes.at(-1).location.getZ()],
  ["Baker's stall", core.ItemIdentifiers.CAKE, 2655, 3311, 0]);
  const taskCount = Progress.doneTasks(cakeThief, diary).size;
  PluginManager.emitCustomEvent("thieving:success", {
    player: cakeThief, method: "stall", stall: "Baker's stall", itemId: core.ItemIdentifiers.CAKE,
    location: new core.Location(2655, 3311, 0),
  });
  assert.equal(Progress.doneTasks(cakeThief, diary).size, taskCount, "repeat success events do not add duplicate progress");

  const secondCakeThief = actor(2666, 3310);
  roll = 0.1;
  steal(secondCakeThief, 2667, 3310);
  assert.equal(secondCakeThief.getInventory().contains(core.ItemIdentifiers.CAKE), true);
  assert.equal(completed(secondCakeThief), true, "the second Ardougne Baker's stall counts too");

  const breadThief = actor(2654, 3311);
  roll = 0.7;
  steal(breadThief, 2655, 3311);
  assert.equal(breadThief.getInventory().contains(core.ItemIdentifiers.BREAD), true);
  assert.equal(completed(breadThief), false, "bread from the bakery stall does not count");

  const blockedThief = actor(2654, 3311);
  for (let slot = 0; slot < 28; slot++) blockedThief.getInventory().setItem(slot, new core.Item(core.ItemIdentifiers.CABBAGE));
  steal(blockedThief, 2655, 3311);
  assert.equal(completed(blockedThief), false, "a full inventory prevents a successful theft");

  for (const [x, y, z, area] of [
    [2590, 3290, 0, null],
    [2655, 3311, 1, null],
    [2655, 3311, 0, {}],
  ]) {
    roll = 0.1;
    const player = actor(x - 1, y, z, area);
    steal(player, x, y, z);
    assert.equal(completed(player), false, `no credit at ${x},${y},${z} in ${area ? "a private area" : "the public area"}`);
  }
});
