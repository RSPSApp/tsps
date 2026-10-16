const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');

let core;
let handleNeedleOnLeather;
const tasks = [];

before(async () => {
  await CachePipeline.initialize(process.cwd());
  core = PluginManager.getCoreApi();
  const api = PluginManager.createApi('HardLeatherCraftingTest');
  require('../plugins/skills/Crafting.plugin').register({
    ...api,
    onItemOnItem: handler => {
      if (handler.name === 'handleNeedleOnLeather') handleNeedleOnLeather = handler;
    },
    onItemOnObject: () => {},
    onInterfaceActionClick: () => {},
    getTaskManager: () => ({ submit: task => tasks.push(task) }),
  });
});

function playerWith(entries = []) {
  const amounts = new Map(entries);
  const attributes = new Map();
  const log = [];
  let menu;
  const inventory = {
    contains: id => (amounts.get(id) ?? 0) > 0,
    getAmount: id => amounts.get(id) ?? 0,
    deleteNumber: (id, amount) => amounts.set(id, Math.max(0, (amounts.get(id) ?? 0) - amount)),
    addItem: item => amounts.set(item.id, (amounts.get(item.id) ?? 0) + item.getAmount()),
  };
  const packetSender = {
    sendCreationMenu(value) {
      menu = value;
      return packetSender;
    },
    closeInterface() {
      log.push(['close']);
      return packetSender;
    },
  };
  const player = {
    amounts,
    log,
    level: 99,
    interfaceId: -1,
    moving: false,
    getInventory: () => inventory,
    getSkillManager: () => ({
      getCurrentLevel: () => player.level,
      addExperiences: (skill, xp) => log.push(['xp', skill, xp]),
    }),
    getAttribute: key => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getPacketSender: () => packetSender,
    sendMessage: text => log.push(['message', text]),
    performAnimation: animation => log.push(['animation', animation.getId()]),
    getInterfaceId: () => player.interfaceId,
    setInterfaceId: id => { player.interfaceId = id; },
    isRegistered: () => true,
    getHitpoints: () => 99,
    getMovementQueue: () => ({ size: () => player.moving ? 1 : 0 }),
    getForceMovement: () => null,
  };
  return { player, getMenu: () => menu };
}

function useNeedle(player, materialId = 1743) {
  const event = { player, usedItemId: 1733, usedWithItemId: materialId, handled: false };
  handleNeedleOnLeather(event);
  return event;
}

function tick(task, count) {
  for (let i = 0; i < count; i++) task.execute();
}

test('needle on normal leather opens a menu for all six leather items only', () => {
  const { player, getMenu } = playerWith([[1733, 1], [1734, 4], [1741, 3], [1743, 2]]);
  const event = useNeedle(player, 1741);
  const menu = getMenu();

  assert.equal(event.handled, true);
  assert.deepEqual(menu.getItems(), [1059, 1061, 1167, 1063, 1129, 1095]);
  assert.equal(menu.getOptions().maxAmount, 3);
  assert.equal(menu.getOptions().lastAmount, 1);
  for (const [itemId, name] of [
    [1059, 'leather gloves'],
    [1061, 'leather boots'],
    [1167, 'leather cowl'],
    [1063, 'leather vambraces'],
    [1129, 'leather body'],
    [1095, 'leather chaps'],
  ]) {
    const item = core.CacheDefinitions.getItem(itemId);
    assert.equal(item.name.toLowerCase(), name);
    assert.equal(item.noteTemplate, -1);
    assert.equal(item.placeholderTemplate, -1);
  }
});

test('all six normal leather recipes consume leather and thread, preserve the needle, and award correct XP', () => {
  const recipes = [
    [1059, 1, 13.8],
    [1061, 7, 16.25],
    [1167, 9, 18.5],
    [1063, 11, 22],
    [1129, 14, 25],
    [1095, 18, 27],
  ];
  for (const [itemId, level, xp] of recipes) {
    const { player, getMenu } = playerWith([[1733, 1], [1734, 1], [1741, 1]]);
    player.level = level;
    useNeedle(player, 1741);
    getMenu().execute(itemId, 1);
    const task = tasks.at(-1);
    tick(task, 3);

    assert.equal(player.amounts.get(itemId), 1, `crafted item ${itemId}`);
    assert.equal(player.amounts.get(1741), 0);
    assert.equal(player.amounts.get(1734), 0);
    assert.equal(player.amounts.get(1733), 1);
    assert.ok(player.log.some(row => row[0] === 'xp' && row[2] === xp), `XP ${xp} for item ${itemId}`);
    assert.equal(player.getAttribute('crafting:leather-task'), null);
  }
});

test('normal leather crafting enforces recipe levels and thread requirements', () => {
  const lowLevel = playerWith([[1733, 1], [1734, 1], [1741, 1]]);
  lowLevel.player.level = 17;
  useNeedle(lowLevel.player, 1741);
  lowLevel.getMenu().execute(1095, 1);
  tick(tasks.at(-1), 3);
  assert.equal(lowLevel.player.amounts.get(1741), 1);
  assert.equal(lowLevel.player.amounts.get(1734), 1);
  assert.equal(lowLevel.player.amounts.get(1095), undefined);
  assert.ok(lowLevel.player.log.some(row => row[0] === 'message' && row[1].includes('18')));

  const noThread = playerWith([[1733, 1], [1741, 1]]);
  const event = useNeedle(noThread.player, 1741);
  assert.equal(event.handled, true);
  assert.equal(noThread.getMenu(), undefined);
  assert.ok(noThread.player.log.some(row => row[0] === 'message' && row[1].includes('thread')));
});

test('needle on hard leather opens a menu for hardleather bodies only', () => {
  const { player, getMenu } = playerWith([[1733, 1], [1734, 3], [1743, 2]]);
  const event = useNeedle(player);
  const menu = getMenu();

  assert.equal(event.handled, true);
  assert.deepEqual(menu.getItems(), [1131]);
  assert.equal(menu.getOptions().maxAmount, 2);
  assert.equal(menu.getOptions().lastAmount, 1);
  const item = core.CacheDefinitions.getItem(1131);
  assert.equal(item.name.toLowerCase(), 'hardleather body');
  assert.equal(item.noteTemplate, -1);
  assert.equal(item.placeholderTemplate, -1);
});

test('hardleather bodies consume hard leather and thread, preserve the needle, and award 35 XP', () => {
  const { player, getMenu } = playerWith([[1733, 1], [1734, 2], [1743, 2]]);
  useNeedle(player);
  getMenu().execute(1131, 2);

  const task = tasks.at(-1);
  tick(task, 2);
  assert.equal(player.amounts.get(1131), undefined);
  tick(task, 1);
  assert.equal(player.amounts.get(1131), 1);
  assert.equal(player.amounts.get(1743), 1);
  assert.equal(player.amounts.get(1734), 1);
  assert.equal(player.amounts.get(1733), 1);
  assert.ok(player.log.some(row => row[0] === 'xp' && row[2] === 35));

  tick(task, 3);
  assert.equal(player.amounts.get(1131), 2);
  assert.equal(player.amounts.get(1743), 0);
  assert.equal(player.amounts.get(1734), 0);
  assert.equal(player.amounts.get(1733), 1);
  assert.equal(player.getAttribute('crafting:leather-task'), null);
});

test('hard-leather crafting enforces level and required materials', () => {
  const lowLevel = playerWith([[1733, 1], [1734, 1], [1743, 1]]);
  lowLevel.player.level = 27;
  useNeedle(lowLevel.player);
  lowLevel.getMenu().execute(1131, 1);
  tick(tasks.at(-1), 3);
  assert.equal(lowLevel.player.amounts.get(1743), 1);
  assert.equal(lowLevel.player.amounts.get(1734), 1);
  assert.equal(lowLevel.player.amounts.get(1131), undefined);
  assert.ok(lowLevel.player.log.some(row => row[0] === 'message' && row[1].includes('28')));

  const noThread = playerWith([[1733, 1], [1743, 1]]);
  const event = useNeedle(noThread.player);
  assert.equal(event.handled, true);
  assert.equal(noThread.getMenu(), undefined);
  assert.ok(noThread.player.log.some(row => row[0] === 'message' && row[1].includes('thread')));

  const noHardLeather = playerWith([[1733, 1], [1734, 1]]);
  assert.equal(useNeedle(noHardLeather.player, 995).handled, false);
  assert.equal(noHardLeather.getMenu(), undefined);
});
