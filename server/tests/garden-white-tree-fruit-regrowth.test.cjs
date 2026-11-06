const assert = require("node:assert/strict");
const { before, test } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PluginManager } = require("../dist/plugins/PluginManager");
const core = PluginManager.getCoreApi();
const registerGarden = require("../plugins/quests/quests/GardenOfTranquillity.Quest");

before(async () => {
  await CachePipeline.initialize(process.cwd());
  core.ObjectDefinition.init();
  core.RegionManager.init();
});

function api() {
  const noop = () => {};
  return {
    core,
    persistAttribute: noop,
    onInterfaceActionButton: noop,
    onCustomEvent: noop,
    onPlayerLogin: noop,
    onPlayerLogout: noop,
    onPlayerDisconnect: noop,
    onNpcDialogueVariant: noop,
    onNpcDialogueCondition: noop,
    onItemOnObject: noop,
    onItemOnItem: noop,
    onItemOnNpc: noop,
    onObjectInteraction: noop,
    onNpcInteraction: noop,
    emitCustomEvent: noop,
  };
}

function player(t) {
  const p = new Player(null);
  p.setRegistered(true);
  t.mock.method(p, "getSession", () => ({ sendClientPacket: () => true, write() {} }));
  p.setAttribute("quest.garden_of_tranquillity.stage", 60);
  return p;
}

test("white tree grows one fruit per five online minutes and stops at four", (t) => {
  registerGarden(api());
  const garden = registerGarden._test;
  const p = player(t);
  const location = new core.Location(3229, 3474, 0);
  const realNow = Date.now;
  let now = 1_700_000_000_000;
  Date.now = () => now;
  t.after(() => {
    Date.now = realNow;
    garden.handleLogout({ player: p });
    core.TaskManager.cancelTasks(p);
  });

  garden.vset(p, garden.VARBIT_WHITE_TREE, 8);
  garden.setTimer(p, garden.WHITE_TREE_FRUIT_TIMER, 0);
  garden.refreshWhiteTreeFruit(p);
  assert.equal(garden.whiteTreeFruitCount(p), garden.WHITE_TREE_MAX_FRUIT, "post-quest tree seeds four fruits");
  assert.equal(core.TaskManager.hasActiveTask(p, "WhiteTreeFruitTask"), false);

  assert.equal(garden.pickWhiteTreeFruit(p, location), undefined);
  assert.equal(p.getInventory().getAmount(core.ItemIdentifiers.WHITE_TREE_FRUIT), 1);
  assert.equal(garden.whiteTreeFruitCount(p), 3);
  assert.equal(garden.timerOf(p, garden.WHITE_TREE_FRUIT_TIMER), now);
  const task = garden.whiteTreeFruitTasks.get(p);
  assert.ok(task?.isRunning(), "picking schedules the online refill task");
  assert.equal(task.getDelay(), garden.WHITE_TREE_FRUIT_GROWTH_TICKS);

  now += garden.WHITE_TREE_FRUIT_GROWTH_MS / 2;
  task.execute();
  assert.equal(garden.whiteTreeFruitCount(p), 3, "half an interval does not grow a fruit");
  assert.equal(task.isRunning(), true);
  assert.equal(task.getDelay(), Math.ceil(garden.WHITE_TREE_FRUIT_GROWTH_TICKS / 2));

  now += garden.WHITE_TREE_FRUIT_GROWTH_MS / 2;
  task.execute();
  assert.equal(garden.whiteTreeFruitCount(p), garden.WHITE_TREE_MAX_FRUIT, "five minutes grows one fruit");
  assert.equal(task.isRunning(), false, "the task stops once the tree is full");
  assert.equal(core.TaskManager.hasActiveTask(p, "WhiteTreeFruitTask"), false);
});

test("logout stops the refill task and the saved timer resumes it after relog", (t) => {
  registerGarden(api());
  const garden = registerGarden._test;
  const p = player(t);
  const location = new core.Location(3229, 3474, 0);
  const realNow = Date.now;
  let now = 1_700_000_000_000;
  Date.now = () => now;
  t.after(() => {
    Date.now = realNow;
    garden.handleLogout({ player: p });
    core.TaskManager.cancelTasks(p);
  });

  garden.vset(p, garden.VARBIT_WHITE_TREE, 8);
  garden.setTimer(p, garden.WHITE_TREE_FRUIT_TIMER, 0);
  garden.refreshWhiteTreeFruit(p);
  garden.pickWhiteTreeFruit(p, location);
  const running = garden.whiteTreeFruitTasks.get(p);
  assert.ok(running?.isRunning());

  garden.handleLogout({ player: p });
  assert.equal(running.isRunning(), false, "logout stops the online task");
  assert.equal(core.TaskManager.hasActiveTask(p, "WhiteTreeFruitTask"), false);

  now += garden.WHITE_TREE_FRUIT_GROWTH_MS;
  garden.refreshGrowth(p);
  assert.equal(garden.whiteTreeFruitCount(p), garden.WHITE_TREE_MAX_FRUIT, "the saved timer is applied on return");
  assert.equal(core.TaskManager.hasActiveTask(p, "WhiteTreeFruitTask"), false, "a full tree needs no task");
});
