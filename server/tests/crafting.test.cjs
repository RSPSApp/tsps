const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const WorldDefinition = require('../dist/game/definition/WorldDefinition');
const { ItemIds } = require('../dist/util/IdEnums');
const { Animation } = require('../dist/game/model/Animation');
const { Location } = require('../dist/game/model/Location');

const THREAD_USES_ATTRIBUTE = 'crafting:thread-uses';
const TASK_ATTRIBUTE = 'crafting:task';
const LEATHER_CRAFTING_ANIMATION = 1249;

let handleNeedleOnLeather;
const handlers = {};
const namedObjects = {};
const tasks = [];

before(async () => {
  await CachePipeline.initialize(process.cwd());
  const api = PluginManager.createApi('LeatherCraftingTest');
  require('../plugins/skills/Crafting.plugin').register({
    ...api,
    onItemOnItem: handler => {
      handlers[handler.name] = handler;
      if (handler.name === 'handleNeedleOnLeather') handleNeedleOnLeather = handler;
    },
    onItemOnObject: handler => { handlers[handler.name] = handler; },
    onInterfaceActionClick: handler => { handlers.button = handler; },
    onObjectInteraction: (name, actions) => { namedObjects[name] = actions; },
    persistAttribute: () => {},
    getTaskManager: () => ({ submit: task => tasks.push(task) }),
  });
});

function membersWorld(t, members) {
  const saved = WorldDefinition.isMembersWorld;
  t.after(() => { WorldDefinition.isMembersWorld = saved; });
  WorldDefinition.isMembersWorld = () => members;
}

function playerWith(entries = [], { level = 99, threadUses } = {}) {
  const amounts = new Map(entries);
  const attributes = new Map(threadUses === undefined ? [] : [[THREAD_USES_ATTRIBUTE, threadUses]]);
  const log = [];
  const location = new Location(3109, 3499, 0);
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
    sendSoundEffect(id) { log.push(['sound', id]); return packetSender; },
    sendObjectAnimation(object, animation) { log.push(['loc-animation', animation.getId()]); return packetSender; },
    sendConfig(id, value) { log.push(['config', id, value]); return packetSender; },
    sendSubInterface(uid, group) { log.push(['open', group]); return packetSender; },
    closeSubInterface() { log.push(['close']); return packetSender; },
  };
  const player = {
    amounts,
    log,
    level,
    interfaceId: -1,
    moving: false,
    getInventory: () => inventory,
    getSkillManager: () => ({
      getCurrentLevel: () => player.level,
      addExperiences: (skill, xp) => log.push(['xp', xp]),
    }),
    getAttribute: key => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getPacketSender: () => packetSender,
    getDialogueManager: () => ({
      startDialogues: chain => log.push(['statement', chain.getDialogues().get(0).text]),
    }),
    sendMessage: text => log.push(['message', text]),
    performAnimation: animation => log.push(['animation', animation.getId()]),
    getInterfaceId: () => player.interfaceId,
    setInterfaceId: id => { player.interfaceId = id; },
    isRegistered: () => true,
    isPlayerBot: () => false,
    getUsername: () => 'CraftingTest',
    getLocation: () => location,
    getHitpoints: () => 99,
    getMovementQueue: () => ({ size: () => player.moving ? 1 : 0 }),
    getForceMovement: () => null,
  };
  return { player, getMenu: () => menu };
}

function useNeedle(player, materialId, needleId = ItemIds.NEEDLE) {
  const event = { player, usedItemId: needleId, usedWithItemId: materialId, handled: false };
  handleNeedleOnLeather(event);
  return event;
}

/** Chooses `itemId` from the menu and returns what each following tick logged. */
function craft(player, menu, itemId, amount, ticks) {
  player.log.length = 0;
  menu.execute(itemId, amount);
  const byTick = [player.log.splice(0)];
  const task = tasks.at(-1);
  for (let i = 1; i <= ticks; i++) {
    if (player.getAttribute(TASK_ATTRIBUTE) === task) task.execute();
    byTick.push(player.log.splice(0));
  }
  return byTick;
}

const messages = rows => rows.filter(row => row[0] === 'message').map(row => row[1]);

test('needle on leather opens the captured skillmulti menu with all seven items, coif included', t => {
  membersWorld(t, true);
  const { player, getMenu } = playerWith([[ItemIds.NEEDLE, 1], [ItemIds.THREAD, 1], [ItemIds.LEATHER, 13]], { level: 1 });
  assert.equal(useNeedle(player, ItemIds.LEATHER).handled, true);
  const menu = getMenu();
  assert.equal(menu.getTitle(), 'How many do you wish to make?');
  assert.deepEqual(menu.getItems(), [
    ItemIds.LEATHER_GLOVES, ItemIds.LEATHER_BOOTS, ItemIds.LEATHER_COWL, ItemIds.LEATHER_VAMBRACES,
    ItemIds.LEATHER_BODY, ItemIds.LEATHER_CHAPS, ItemIds.COIF,
  ]);
  assert.deepEqual(menu.getOptions().labels, [
    'Leather gloves', 'Leather boots', 'Leather cowl', 'Leather vambraces', 'Leather body', 'Leather chaps', 'Coif',
  ]);
  // The menu offers up to the leather carried, not the thread.
  assert.equal(menu.getOptions().maxAmount, 13);
  assert.equal(menu.getOptions().mode, 0);
});

test('free-to-play worlds leave the members coif out of the leather menu', t => {
  membersWorld(t, false);
  const { player, getMenu } = playerWith([[ItemIds.NEEDLE, 1], [ItemIds.THREAD, 1], [ItemIds.LEATHER, 1]]);
  useNeedle(player, ItemIds.LEATHER);
  assert.equal(getMenu().getItems().includes(ItemIds.COIF), false);
  assert.equal(getMenu().getItems().length, 6);
});

test('crafting animates on the choice, makes the first item 2 ticks later and one every 3 ticks', t => {
  membersWorld(t, true);
  const { player, getMenu } = playerWith([[ItemIds.NEEDLE, 1], [ItemIds.THREAD, 1], [ItemIds.LEATHER, 3]]);
  useNeedle(player, ItemIds.LEATHER);
  const byTick = craft(player, getMenu(), ItemIds.LEATHER_CHAPS, 3, 9);

  assert.deepEqual(byTick[0].filter(row => row[0] === 'animation'), [['animation', LEATHER_CRAFTING_ANIMATION]]);
  const madeOn = byTick.flatMap((rows, tick) => messages(rows).includes('You make a pair of leather chaps.') ? [tick] : []);
  assert.deepEqual(madeOn, [2, 5, 8]);
  assert.equal(player.amounts.get(ItemIds.LEATHER_CHAPS), 3);
  assert.equal(player.amounts.get(ItemIds.LEATHER), 0);
  assert.ok(byTick[2].some(row => row[0] === 'xp' && row[1] === 27));
  // Replayed after each item but the last, which resets the animation.
  assert.ok(byTick[2].some(row => row[0] === 'animation' && row[1] === LEATHER_CRAFTING_ANIMATION));
  assert.ok(byTick[8].some(row => row[0] === 'animation' && row[1] === Animation.DEFAULT_RESET_ANIMATION.getId()));
  assert.equal(player.getAttribute(TASK_ATTRIBUTE), null);
});

test('a reel of thread lasts five items, and the count carries over between batches', t => {
  membersWorld(t, true);
  const { player, getMenu } = playerWith([[ItemIds.NEEDLE, 1], [ItemIds.THREAD, 2], [ItemIds.LEATHER, 7]]);
  useNeedle(player, ItemIds.LEATHER);
  const byTick = craft(player, getMenu(), ItemIds.LEATHER_GLOVES, 4, 12);
  assert.equal(player.amounts.get(ItemIds.THREAD), 2);
  assert.equal(player.getAttribute(THREAD_USES_ATTRIBUTE), 4);
  assert.equal(byTick.flatMap(messages).filter(text => text.includes('thread')).length, 0);

  useNeedle(player, ItemIds.LEATHER);
  const next = craft(player, getMenu(), ItemIds.LEATHER_GLOVES, 1, 3);
  assert.deepEqual(messages(next[2]), ['You make a pair of leather gloves.', 'You use up one of your reels of thread.']);
  assert.equal(player.amounts.get(ItemIds.THREAD), 1);
  assert.equal(player.getAttribute(THREAD_USES_ATTRIBUTE), 0);
});

test('a costume needle sews without thread', t => {
  membersWorld(t, true);
  const { player, getMenu } = playerWith([[ItemIds.COSTUME_NEEDLE, 1], [ItemIds.LEATHER, 5]], { threadUses: 4 });
  assert.equal(useNeedle(player, ItemIds.LEATHER, ItemIds.COSTUME_NEEDLE).handled, true);
  craft(player, getMenu(), ItemIds.LEATHER_BOOTS, 5, 15);
  assert.equal(player.amounts.get(ItemIds.LEATHER_BOOTS), 5);
  assert.equal(player.getAttribute(THREAD_USES_ATTRIBUTE), 4);
});

test('choosing an item above the Crafting level shows the captured message box and makes nothing', t => {
  membersWorld(t, true);
  const { player, getMenu } = playerWith([[ItemIds.NEEDLE, 1], [ItemIds.THREAD, 1], [ItemIds.LEATHER, 1]], { level: 37 });
  useNeedle(player, ItemIds.LEATHER);
  const tasksBefore = tasks.length;
  const byTick = craft(player, getMenu(), ItemIds.COIF, 1, 0);
  assert.equal(tasks.length, tasksBefore);
  assert.ok(byTick[0].some(row => row[0] === 'statement' && row[1] === 'You need a Crafting level of 38 to make a coif.'));
  assert.equal(player.amounts.get(ItemIds.LEATHER), 1);
  assert.equal(player.amounts.get(ItemIds.COIF), undefined);
});

test('no thread: needle on leather is handled but opens no menu', t => {
  membersWorld(t, true);
  const { player, getMenu } = playerWith([[ItemIds.NEEDLE, 1], [ItemIds.LEATHER, 1]]);
  assert.equal(useNeedle(player, ItemIds.LEATHER).handled, true);
  assert.equal(getMenu(), undefined);
  assert.ok(messages(player.log).some(text => text.includes('thread')));
});

test('hard leather makes a hardleather body for 35 XP', t => {
  membersWorld(t, true);
  const { player, getMenu } = playerWith([[ItemIds.NEEDLE, 1], [ItemIds.THREAD, 1], [ItemIds.HARD_LEATHER, 9]]);
  useNeedle(player, ItemIds.HARD_LEATHER);
  assert.deepEqual(getMenu().getItems(), [ItemIds.HARDLEATHER_BODY]);
  assert.deepEqual(getMenu().getOptions().labels, ['Hardleather body']);
  assert.equal(getMenu().getOptions().maxAmount, 9);
  const byTick = craft(player, getMenu(), ItemIds.HARDLEATHER_BODY, 1, 3);
  assert.deepEqual(messages(byTick[2]), ['You make a hard leather body.']);
  assert.ok(byTick[2].some(row => row[0] === 'xp' && row[1] === 35));
});

test('dragon leather: body, vambraces, chaps with the captured labels, leather per item and XP', t => {
  membersWorld(t, true);
  const { player, getMenu } = playerWith([[ItemIds.NEEDLE, 1], [ItemIds.THREAD, 1], [ItemIds.BLACK_DRAGON_LEATHER, 26]]);
  useNeedle(player, ItemIds.BLACK_DRAGON_LEATHER);
  assert.deepEqual(getMenu().getItems(), [ItemIds.BLACK_DHIDE_BODY, ItemIds.BLACK_DHIDE_VAMBRACES, ItemIds.BLACK_DHIDE_CHAPS]);
  assert.deepEqual(getMenu().getOptions().labels,
    ['Black dragonhide body', 'Black dragonhide vambraces', 'Black dragonhide chaps']);
  assert.equal(getMenu().getOptions().maxAmount, 26);

  const byTick = craft(player, getMenu(), ItemIds.BLACK_DHIDE_BODY, 1, 3);
  assert.deepEqual(messages(byTick[2]), ['You make a black dragonhide body.']);
  assert.ok(byTick[2].some(row => row[0] === 'xp' && row[1] === 258));
  assert.equal(player.amounts.get(ItemIds.BLACK_DRAGON_LEATHER), 23);

  useNeedle(player, ItemIds.BLACK_DRAGON_LEATHER);
  const chaps = craft(player, getMenu(), ItemIds.BLACK_DHIDE_CHAPS, 1, 3);
  assert.deepEqual(messages(chaps[2]), ['You make a pair of black dragonhide chaps.']);
  assert.equal(player.amounts.get(ItemIds.BLACK_DRAGON_LEATHER), 21);
});

test('a body needs three dragon leather: the batch stops when fewer are left', t => {
  membersWorld(t, true);
  const { player, getMenu } = playerWith([[ItemIds.NEEDLE, 1], [ItemIds.THREAD, 1], [ItemIds.GREEN_DRAGON_LEATHER, 5]]);
  useNeedle(player, ItemIds.GREEN_DRAGON_LEATHER);
  craft(player, getMenu(), ItemIds.GREEN_DHIDE_BODY, 5, 15);
  assert.equal(player.amounts.get(ItemIds.GREEN_DHIDE_BODY), 1);
  assert.equal(player.amounts.get(ItemIds.GREEN_DRAGON_LEATHER), 2);
  assert.equal(player.getAttribute(TASK_ATTRIBUTE), null);
});

test('free-to-play worlds offer no dragonhide recipes', t => {
  membersWorld(t, false);
  const { player, getMenu } = playerWith([[ItemIds.NEEDLE, 1], [ItemIds.THREAD, 1], [ItemIds.GREEN_DRAGON_LEATHER, 3]]);
  useNeedle(player, ItemIds.GREEN_DRAGON_LEATHER);
  assert.deepEqual(getMenu().getItems(), []);
});

test('other items used on a needle are left to other handlers', () => {
  const { player } = playerWith([[ItemIds.NEEDLE, 1], [ItemIds.THREAD, 1]]);
  assert.equal(useNeedle(player, ItemIds.COINS).handled, false);
});

// --- Gems, glass, spinning, weaving, silver, battlestaves, amethyst, studs

function use(player, handler, usedItemId, usedWithItemId) {
  const event = { player, usedItemId, usedWithItemId, handled: false };
  handlers[handler](event);
  return event;
}

/** Chooses `itemId` from the open menu and returns what each following tick logged, with tick 0 the choice. */
function make(player, menu, itemId, amount, ticks) {
  player.log.length = 0;
  menu.execute(itemId, amount);
  const byTick = [player.log.splice(0)];
  const task = tasks.at(-1);
  for (let i = 1; i <= ticks; i++) {
    if (player.getAttribute(TASK_ATTRIBUTE) === task) task.execute();
    byTick.push(player.log.splice(0));
  }
  return byTick;
}

const madeOn = (byTick, text) => byTick.flatMap((rows, tick) => messages(rows).includes(text) ? [tick] : []);
const xpOn = (byTick, tick) => byTick[tick].filter(row => row[0] === 'xp').map(row => row[1]);

function withRandom(t, value) {
  const saved = Math.random;
  t.after(() => { Math.random = saved; });
  Math.random = () => value;
}

test('chisel on an uncut gem opens the captured menu and cuts one gem the tick after, then every 2 ticks', t => {
  membersWorld(t, true);
  withRandom(t, 0);
  const { player, getMenu } = playerWith([[ItemIds.CHISEL, 1], [ItemIds.UNCUT_DIAMOND, 3]]);
  assert.equal(use(player, 'cutGem', ItemIds.CHISEL, ItemIds.UNCUT_DIAMOND).handled, true);
  assert.equal(getMenu().getTitle(), 'How many gems would you like to cut?');
  assert.equal(getMenu().getOptions().mode, 12);
  assert.deepEqual(getMenu().getItems(), [ItemIds.UNCUT_DIAMOND]);
  const byTick = make(player, getMenu(), ItemIds.UNCUT_DIAMOND, 3, 6);
  assert.deepEqual(madeOn(byTick, 'You cut the diamond.'), [1, 3, 5]);
  assert.ok(byTick[1].some(row => row[0] === 'animation' && row[1] === 886));
  assert.ok(byTick[1].some(row => row[0] === 'sound' && row[1] === 2586));
  assert.deepEqual(xpOn(byTick, 1), [107.5]);
  assert.equal(player.amounts.get(ItemIds.DIAMOND), 3);
});

test('a failed cut smashes a semi-precious gem into a crushed gem with the captured message', t => {
  membersWorld(t, true);
  withRandom(t, 0.999);
  const { player, getMenu } = playerWith([[ItemIds.CHISEL, 1], [ItemIds.UNCUT_JADE, 1]], { level: 13 });
  use(player, 'cutGem', ItemIds.UNCUT_JADE, ItemIds.CHISEL);
  const byTick = make(player, getMenu(), ItemIds.UNCUT_JADE, 1, 1);
  assert.deepEqual(messages(byTick[1]), ['You mis-hit the chisel and smash the jade to pieces!']);
  assert.ok(byTick[1].some(row => row[0] === 'sound' && row[1] === 2589));
  assert.deepEqual(xpOn(byTick, 1), [5]);
  assert.equal(player.amounts.get(ItemIds.CRUSHED_GEM), 1);
});

test('the cut chance follows the Wiki curve and a Jeweller\'s chisel guarantees opals from level 62', t => {
  const { cutChance } = require('../plugins/skills/crafting/Gems.Crafting');
  const opal = { low: 128, high: 250 };
  assert.equal(cutChance(1, opal), 129 / 256);
  assert.equal(cutChance(99, opal), 251 / 256);
  assert.ok(cutChance(62, opal) + 0.2 >= 1);
  assert.ok(cutChance(61, opal) + 0.2 < 1);
});

test('glassblowing lists all eight items and makes one every 3 ticks from the second', t => {
  membersWorld(t, true);
  const { player, getMenu } = playerWith([[ItemIds.GLASSBLOWING_PIPE, 1], [ItemIds.MOLTEN_GLASS, 2]]);
  use(player, 'blowGlass', ItemIds.MOLTEN_GLASS, ItemIds.GLASSBLOWING_PIPE);
  assert.equal(getMenu().getItems().length, 8);
  const byTick = make(player, getMenu(), ItemIds.BEER_GLASS, 2, 6);
  assert.ok(byTick[0].some(row => row[0] === 'animation' && row[1] === 884));
  assert.ok(byTick[0].some(row => row[0] === 'sound' && row[1] === 2724));
  assert.deepEqual(madeOn(byTick, 'You make a beer glass.'), [2, 5]);
  assert.equal(player.amounts.get(ItemIds.GLASSBLOWING_PIPE), 1);
});

test('the wheel offers what the carried materials spin into and spins one every 2 ticks from the third', t => {
  membersWorld(t, true);
  const { player, getMenu } = playerWith([[ItemIds.FLAX, 2]], { level: 12 });
  namedObjects['Spinning wheel'].Spin({ player, object: {}, handled: false });
  assert.equal(getMenu().getTitle(), 'What would you like to spin?');
  assert.equal(getMenu().getOptions().mode, 16);
  assert.deepEqual(getMenu().getItems(), [ItemIds.BOW_STRING, ItemIds.LINEN_YARN]);
  const byTick = make(player, getMenu(), ItemIds.LINEN_YARN, 2, 6);
  assert.ok(byTick[1].some(row => row[0] === 'animation' && row[1] === 13139));
  assert.ok(byTick[1].some(row => row[0] === 'loc-animation' && row[1] === 466));
  assert.deepEqual(byTick.flatMap((rows, tick) => rows.some(row => row[0] === 'xp') ? [tick] : []), [3, 5]);
  assert.equal(player.amounts.get(ItemIds.LINEN_YARN), 2);
  assert.equal(player.amounts.get(ItemIds.FLAX), 0);
});

test('free-to-play wheels only spin wool, and wool used on the wheel opens the menu', t => {
  membersWorld(t, false);
  const { player, getMenu } = playerWith([[ItemIds.WOOL, 1], [ItemIds.FLAX, 1]]);
  const event = { player, itemId: ItemIds.WOOL, object: { getDefinition: () => ({ getName: () => 'Spinning wheel' }) }, handled: false };
  handlers.handleMaterialOnStation(event);
  assert.equal(event.handled, true);
  assert.deepEqual(getMenu().getItems(), [ItemIds.BALL_OF_WOOL]);
});

test('the loom weaves drift nets from two jute fibres every 3 ticks from the fourth', t => {
  membersWorld(t, true);
  const { player, getMenu } = playerWith([[ItemIds.JUTE_FIBRE, 4]], { level: 26 });
  namedObjects.Loom.Weave({ player, object: {}, handled: false });
  assert.equal(getMenu().getTitle(), 'How many would you like to weave?');
  assert.equal(getMenu().getOptions().mode, 35);
  assert.deepEqual(getMenu().getItems(), [ItemIds.EMPTY_SACK, ItemIds.DRIFT_NET]);
  const byTick = make(player, getMenu(), ItemIds.DRIFT_NET, 2, 8);
  assert.ok(byTick[1].some(row => row[0] === 'animation' && row[1] === 2270));
  assert.deepEqual(xpOn(byTick, 4), [55]);
  assert.deepEqual(xpOn(byTick, 7), [55]);
  assert.equal(player.amounts.get(ItemIds.DRIFT_NET), 2);
});

test('a silver bar on a furnace opens silver_crafting; a tiara comes 2 ticks after the choice', t => {
  membersWorld(t, false);
  const { player } = playerWith([[ItemIds.SILVER_BAR, 1], [ItemIds.TIARA_MOULD, 1]], { level: 23 });
  const furnace = { getDefinition: () => ({ getName: () => 'Furnace' }) };
  handlers.handleBarOnFurnace({ player, itemId: ItemIds.SILVER_BAR, object: furnace, handled: false });
  assert.ok(player.log.some(row => row[0] === 'open' && row[1] === 6));
  player.log.length = 0;
  handlers.button({ player, buttonId: (6 << 16) | 28, handled: false });
  assert.ok(player.log.some(row => row[0] === 'animation' && row[1] === 899));
  assert.ok(player.log.some(row => row[0] === 'sound' && row[1] === 2725));
  const task = tasks.at(-1);
  task.execute();
  assert.equal(player.amounts.get(ItemIds.TIARA), undefined);
  task.execute();
  assert.equal(player.amounts.get(ItemIds.TIARA), 1);
  assert.equal(player.amounts.get(ItemIds.TIARA_MOULD), 1);
  assert.ok(player.log.some(row => row[0] === 'xp' && row[1] === 52.5));
});

test('silver bolts come ten to a bar, and members silver is refused on free-to-play worlds', t => {
  membersWorld(t, true);
  const { player } = playerWith([[ItemIds.SILVER_BAR, 1], [ItemIds.BOLT_MOULD, 1]]);
  const furnace = { getDefinition: () => ({ getName: () => 'Furnace' }) };
  handlers.handleBarOnFurnace({ player, itemId: ItemIds.SILVER_BAR, object: furnace, handled: false });
  handlers.button({ player, buttonId: (6 << 16) | 27, handled: false });
  tasks.at(-1).execute(); tasks.at(-1).execute();
  assert.equal(player.amounts.get(ItemIds.SILVER_BOLTS_UNF_), 10);

  membersWorld(t, false);
  const f2p = playerWith([[ItemIds.SILVER_BAR, 1], [ItemIds.BOLT_MOULD, 1]]).player;
  handlers.handleBarOnFurnace({ player: f2p, itemId: ItemIds.SILVER_BAR, object: furnace, handled: false });
  const before = tasks.length;
  handlers.button({ player: f2p, buttonId: (6 << 16) | 27, handled: false });
  assert.equal(tasks.length, before);
});

test('an orb on a battlestaff makes the staff 3 ticks after the choice, then every 2', t => {
  membersWorld(t, true);
  const { player, getMenu } = playerWith([[ItemIds.WATER_ORB, 2], [ItemIds.BATTLESTAFF, 2]], { level: 54 });
  use(player, 'attachOrb', ItemIds.BATTLESTAFF, ItemIds.WATER_ORB);
  const byTick = make(player, getMenu(), ItemIds.WATER_BATTLESTAFF, 2, 5);
  assert.deepEqual(xpOn(byTick, 3), [100]);
  assert.deepEqual(xpOn(byTick, 5), [100]);
  assert.equal(player.amounts.get(ItemIds.WATER_BATTLESTAFF), 2);
});

test('one amethyst cuts into 15 bolt tips for 60 XP', t => {
  membersWorld(t, true);
  const { player, getMenu } = playerWith([[ItemIds.CHISEL, 1], [ItemIds.AMETHYST, 1]], { level: 83 });
  use(player, 'handleAmethyst', ItemIds.CHISEL, ItemIds.AMETHYST);
  const byTick = make(player, getMenu(), ItemIds.AMETHYST_BOLT_TIPS, 1, 1);
  assert.deepEqual(xpOn(byTick, 1), [60]);
  assert.equal(player.amounts.get(ItemIds.AMETHYST_BOLT_TIPS), 15);
});

test('steel studs on a leather body make a studded body; a hide shield needs a hammer and 15 nails', t => {
  membersWorld(t, true);
  const { player, getMenu } = playerWith([[ItemIds.STEEL_STUDS, 1], [ItemIds.LEATHER_BODY, 1]], { level: 41 });
  use(player, 'handleCombine', ItemIds.LEATHER_BODY, ItemIds.STEEL_STUDS);
  make(player, getMenu(), ItemIds.STUDDED_BODY, 1, 2);
  assert.equal(player.amounts.get(ItemIds.STUDDED_BODY), 1);

  const shield = playerWith([[ItemIds.HARD_LEATHER, 2], [ItemIds.OAK_SHIELD, 1], [ItemIds.BRONZE_NAILS, 15]], { level: 41 });
  assert.equal(use(shield.player, 'handleCombine', ItemIds.HARD_LEATHER, ItemIds.OAK_SHIELD).handled, true);
  assert.equal(shield.getMenu(), undefined);
  shield.player.amounts.set(ItemIds.HAMMER, 1);
  use(shield.player, 'handleCombine', ItemIds.HARD_LEATHER, ItemIds.OAK_SHIELD);
  make(shield.player, shield.getMenu(), ItemIds.HARD_LEATHER_SHIELD, 1, 4);
  assert.equal(shield.player.amounts.get(ItemIds.HARD_LEATHER_SHIELD), 1);
  assert.equal(shield.player.amounts.get(ItemIds.BRONZE_NAILS), 0);
  assert.equal(shield.player.amounts.get(ItemIds.HAMMER), 1);
});

test('Smelt on a furnace opens the gold or silver menu when a bar and its mould are carried, else falls through', t => {
  membersWorld(t, true);
  const gold = playerWith([[ItemIds.GOLD_BAR, 1], [ItemIds.RING_MOULD, 1], [ItemIds.SILVER_BAR, 1], [ItemIds.TIARA_MOULD, 1]]);
  assert.notEqual(namedObjects.Furnace.Smelt({ player: gold.player, handled: false }), false);
  assert.ok(gold.player.log.some(row => row[0] === 'open' && row[1] === 446));

  const silver = playerWith([[ItemIds.SILVER_BAR, 1], [ItemIds.TIARA_MOULD, 1]]);
  namedObjects.Furnace.Smelt({ player: silver.player, handled: false });
  assert.ok(silver.player.log.some(row => row[0] === 'open' && row[1] === 6));

  // A bar without a mould, or ores, are Smithing's: the hook returns false to fall through.
  const ores = playerWith([[ItemIds.GOLD_BAR, 1], [ItemIds.GOLD_ORE, 1]]);
  assert.equal(namedObjects.Furnace.Smelt({ player: ores.player, handled: false }), false);
  assert.equal(ores.player.log.some(row => row[0] === 'open'), false);
});

test('a hide shield short on hides says how many it needs', t => {
  membersWorld(t, true);
  const { player, getMenu } = playerWith([[ItemIds.HARD_LEATHER, 1], [ItemIds.OAK_SHIELD, 1], [ItemIds.BRONZE_NAILS, 15], [ItemIds.HAMMER, 1]], { level: 41 });
  use(player, 'handleCombine', ItemIds.HARD_LEATHER, ItemIds.OAK_SHIELD);
  assert.equal(getMenu(), undefined);
  assert.deepEqual(messages(player.log), ['You need 2 hard leather to make this.']);
});

test('a furnace product above the Crafting level is refused before the menu closes or anything animates', t => {
  membersWorld(t, true);
  const { player } = playerWith([[ItemIds.SILVER_BAR, 1], [ItemIds.TIARA_MOULD, 1]], { level: 22 });
  const furnace = { getDefinition: () => ({ getName: () => 'Furnace' }) };
  handlers.handleBarOnFurnace({ player, itemId: ItemIds.SILVER_BAR, object: furnace, handled: false });
  player.log.length = 0;
  const before = tasks.length;
  handlers.button({ player, buttonId: (6 << 16) | 28, handled: false });
  assert.equal(tasks.length, before);
  assert.deepEqual(player.log, [['message', 'You need a Crafting level of at least 23 to craft this.']]);
  assert.equal(player.getInterfaceId(), 6);
});
