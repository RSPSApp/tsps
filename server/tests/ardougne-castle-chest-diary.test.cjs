const assert = require("node:assert/strict");
const { after, before, test } = require("node:test");
const path = require("node:path");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { MapObjects } = require("../dist/game/entity/impl/object/MapObjects");
const { PluginManager } = require("../dist/plugins/PluginManager");
const DiaryPlugin = require("../plugins/achievements/diaries/ArdougneCastleChestDiary.plugin");
const DiaryData = require("../plugins/achievements/diaries/Data.AchievementDiaries");
const Progress = require("../plugins/achievements/diaries/Progress.AchievementDiaries");

const core = PluginManager.getCoreApi();
const diary = DiaryData.BY_KEY.get("ardougne");
const hookState = {
  beforeObjectInteractionHooks: PluginManager.beforeObjectInteractionHooks,
  customEventHooks: PluginManager.customEventHooks,
  objectHooksByName: PluginManager.objectHooksByName,
  objectHooksById: PluginManager.objectHooksById,
  objectInteractionHooks: PluginManager.objectInteractionHooks,
};
let playerIndex = 28200;
let api;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core.ObjectDefinition.init();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(2588, 3291);
  core.RegionManager.loadMapFiles(2696, 3283);
  PluginManager.beforeObjectInteractionHooks = [];
  PluginManager.customEventHooks = new Map();
  PluginManager.objectHooksByName = new Map();
  PluginManager.objectHooksById = new Map();
  PluginManager.objectInteractionHooks = [];

  for (const [x, y] of [[2588, 3291], [2588, 3302]]) {
    assert.ok(MapObjects.get(11739, new core.Location(x, y, 1), null), `cache map has chest at ${x},${y},1`);
  }
  const chest = core.ObjectDefinition.forId(11739);
  assert.equal(chest.getName(), "Chest");
  assert.deepEqual(chest.getInteractions().slice(0, 2), ["Open", "Search for traps"]);

  api = PluginManager.createApi("ArdougneCastleChestDiaryTest");
  Progress(api);
  api.onCustomEvent("diary:task", require("../plugins/achievements/AchievementDiaries.plugin")._test.onTask);
  require("../plugins/objects/Chests.plugin").register(api);
  DiaryPlugin.register(api);
  require("../plugins/treasuretrails/TreasureTrails.plugin").register(api);
});

after(() => {
  PluginManager.beforeObjectInteractionHooks = hookState.beforeObjectInteractionHooks;
  PluginManager.customEventHooks = hookState.customEventHooks;
  PluginManager.objectHooksByName = hookState.objectHooksByName;
  PluginManager.objectHooksById = hookState.objectHooksById;
  PluginManager.objectInteractionHooks = hookState.objectInteractionHooks;
});

function playerFixture(t, { level = 72, filledSlots = 0, registered = true, hitpoints = 10, dying = false } = {}) {
  const { Player } = require("../dist/game/entity/impl/player/Player");
  const player = new Player(null, new core.Location(2588, 3290, 1));
  player.setIndex(playerIndex++);
  player.setUsername(`ardougne-castle-chest-${playerIndex}`);
  player.setRegistered(registered);
  player.setNeedsPlacement(false);
  player.getSkillManager().setCurrentLevel(core.Skill.THIEVING, level, false);
  player.getHitpoints = () => hitpoints;
  player.isDyingReturn = () => dying;
  player.getPrivateArea = () => null;
  const messages = [];
  player.sendMessage = (message) => { messages.push(message); };
  const sender = new Proxy({}, { get: (_target, key) => key === "sendVarbit"
    ? () => sender
    : () => sender });
  player.getPacketSender = () => sender;
  for (let slot = 0; slot < filledSlots; slot++) {
    player.getInventory().add(new core.Item(core.ItemIdentifiers.WHIP, 1), false);
  }
  const teleports = [];
  player.moveTo = (location) => { teleports.push(location); player.setLocation(location); };
  t.after(() => {
    core.TaskManager.cancelTasks(player.getIndex());
    player.setRegistered(false);
  });
  return { player, messages, teleports };
}

function interact(player, { x = 2588, y = 3291, option = "search for traps", objectId = 11739 } = {}) {
  const object = new core.GameObject(objectId, new core.Location(x, y, 1), 10, 3);
  const event = {
    player,
    object,
    objectId,
    definition: core.ObjectDefinition.forPlayer(objectId, player),
    location: { x, y, z: 1 },
    clickType: option === "open" ? 1 : 2,
    option,
    handled: false,
  };
  return { handled: PluginManager.emitObjectInteraction(event), event };
}

test("lowercase Search for traps dispatches through PluginManager and credits Ardougne Hard", (t) => {
  DiaryPlugin._test.reset();
  const { player, teleports } = playerFixture(t);
  const beforeXp = player.getSkillManager().getExperience(core.Skill.THIEVING);
  const { handled } = interact(player);
  assert.equal(handled, true);
  assert.deepEqual([
    core.ItemIdentifiers.COINS,
    core.ItemIdentifiers.RAW_SHARK,
    core.ItemIdentifiers.ADAMANTITE_ORE,
    core.ItemIdentifiers.UNCUT_SAPPHIRE,
  ].map((id) => player.getInventory().getAmount(id)), [1000, 1, 1, 1]);
  assert.equal(player.getSkillManager().getExperience(core.Skill.THIEVING) - beforeXp, 500);
  assert.ok(Progress.doneTasks(player, diary).has(DiaryPlugin._test.TASK));
  assert.equal(Progress.tierCount(player, diary, "hard"), 1);
  assert.deepEqual(teleports.map((tile) => [tile.getX(), tile.getY(), tile.getZ()]), [[2697, 3283, 0]]);
  // The dungeon entrance loc itself is clipped; the landing must be walkable.
  assert.notEqual(core.RegionManager.getClipping(2696, 3283, 0, null), 0);
  assert.equal(core.RegionManager.getClipping(2697, 3283, 0, null), 0);
});

test("Open cannot reach generic chest handlers and reports that its damage is unsupported", (t) => {
  DiaryPlugin._test.reset();
  const { player, messages } = playerFixture(t);
  const { handled } = interact(player, { option: "open" });
  assert.equal(handled, true);
  assert.match(messages.at(-1), /damage is not implemented/i);
  assert.equal(player.getInventory().getAmount(core.ItemIdentifiers.COINS), 0);
  assert.equal(Progress.tierCount(player, diary, "hard"), 0);
});

test("actual inventory capacity rejects incomplete loot without XP, task credit, teleport, or cooldown", (t) => {
  DiaryPlugin._test.reset();
  const cramped = playerFixture(t, { filledSlots: 25 });
  assert.equal(cramped.player.getInventory().getFreeSlots(), 3);
  assert.equal(interact(cramped.player).handled, true);
  assert.equal(cramped.player.getInventory().getFreeSlots(), 3);
  assert.equal(cramped.player.getInventory().getAmount(core.ItemIdentifiers.COINS), 0);
  assert.equal(cramped.player.getSkillManager().getExperience(core.Skill.THIEVING), 0);
  assert.equal(Progress.tierCount(cramped.player, diary, "hard"), 0);
  assert.deepEqual(cramped.teleports, []);

  const roomy = playerFixture(t, { filledSlots: 24 });
  assert.equal(roomy.player.getInventory().getFreeSlots(), 4);
  assert.equal(interact(roomy.player).handled, true);
  assert.equal(roomy.player.getInventory().getAmount(core.ItemIdentifiers.COINS), 1000);
});

test("a second player cannot loot the same chest during its shared cooldown", (t) => {
  DiaryPlugin._test.reset();
  const first = playerFixture(t);
  const second = playerFixture(t);
  assert.equal(interact(first.player).handled, true);
  assert.equal(interact(second.player).handled, true);
  assert.equal(second.player.getInventory().getAmount(core.ItemIdentifiers.COINS), 0);
  assert.equal(second.player.getSkillManager().getExperience(core.Skill.THIEVING), 0);
  assert.equal(Progress.tierCount(second.player, diary, "hard"), 0);
  assert.deepEqual(second.teleports, []);
});

test("a re-entrant click while loot is being added cannot duplicate a transaction", (t) => {
  DiaryPlugin._test.reset();
  const { player } = playerFixture(t);
  const inventory = player.getInventory();
  const add = inventory.add.bind(inventory);
  let nested;
  let clicked = false;
  inventory.add = (item, refresh) => {
    const result = add(item, refresh);
    if (!clicked) {
      clicked = true;
      nested = interact(player).handled;
    }
    return result;
  };

  assert.equal(interact(player).handled, true);
  assert.equal(nested, true);
  assert.equal(inventory.getAmount(core.ItemIdentifiers.COINS), 1000);
  assert.equal(inventory.getAmount(core.ItemIdentifiers.RAW_SHARK), 1);
  assert.equal(player.getSkillManager().getExperience(core.Skill.THIEVING), 500);
  assert.equal(Progress.tierCount(player, diary, "hard"), 1);
});

test("the other chest has its own cooldown, while invalid players and placements do not steal", (t) => {
  DiaryPlugin._test.reset();
  const player = playerFixture(t);
  assert.equal(interact(player.player).handled, true);
  assert.equal(interact(player.player, { x: 2588, y: 3302 }).handled, true);
  assert.equal(player.player.getInventory().getAmount(core.ItemIdentifiers.COINS), 2000);

  DiaryPlugin._test.reset();
  for (const options of [
    { x: 2587 }, { objectId: 11738 },
  ]) {
    const invalid = playerFixture(t);
    assert.equal(interact(invalid.player, options).handled, false);
    assert.equal(invalid.player.getInventory().getAmount(core.ItemIdentifiers.COINS), 0);
  }
  for (const options of [{ level: 71 }, { filledSlots: 25 }, { registered: false }, { hitpoints: 0 }, { dying: true }]) {
    const invalid = playerFixture(t, options);
    assert.equal(interact(invalid.player).handled, true);
    assert.equal(invalid.player.getInventory().getAmount(core.ItemIdentifiers.COINS), 0);
    assert.equal(Progress.tierCount(invalid.player, diary, "hard"), 0);
  }
});

test("looting a chest with an elite Sherlock scroll for this task completes the challenge", (t) => {
  DiaryPlugin._test.reset();
  const Runtime = require("../plugins/treasuretrails/trails/Runtime.TreasureTrails");
  const elite = require("../plugins/treasuretrails/trails/Tiers.TreasureTrails").byName.get("elite");
  const data = Runtime.data(elite);
  const sherlock = data.steps.find((step) => step.skill);
  const task = [...data.tasks.values()].find((entry) => entry.text === "Steal from a chest in Ardougne Castle.");
  assert.ok(data.supportedTasks.includes(task), "Sherlock can set the Ardougne Castle chest task");
  const { player, messages } = playerFixture(t);
  const key = Runtime.metaKey(elite);
  const state = { version: 1, token: "ardougne-chest", revision: 0, completed: 1, length: 5, row: sherlock.row };
  const inventory = player.getInventory();
  inventory.setItem(0, new core.Item(sherlock.itemId, 1).setMetaValue(key, state));
  inventory.setItem(1, new core.Item(sherlock.skill.itemId, 1).setMetaValue(key, { ...state, task: task.row, taskDone: false }));
  assert.equal(interact(player).handled, true);
  assert.equal(inventory.getItems()[1].getMetaValue(key).taskDone, true);
  assert.ok(messages.includes("You have completed your elite/master level challenge!"));
});
