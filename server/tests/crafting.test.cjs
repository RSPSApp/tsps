const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const WorldDefinition = require('../dist/game/definition/WorldDefinition');
const productionMembersWorld = WorldDefinition.isMembersWorld;
const { ItemIds } = require('../dist/util/IdEnums');
const { Animation } = require('../dist/game/model/Animation');
const { Location } = require('../dist/game/model/Location');

const THREAD_USES_ATTRIBUTE = 'crafting:thread-uses';
const TASK_ATTRIBUTE = 'crafting:task';
const LEATHER_CRAFTING_ANIMATION = 1249;

let handleNeedleOnLeather;
const handlers = {};
const namedObjects = {};
const provenanceEvents = [];
const tasks = [];

before(async () => {
  await CachePipeline.initialize(process.cwd());
  PluginManager.getCoreApi().ObjectDefinition.init();
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
    sendMultiChatboxPrompt: player => player.log.push(["legacy-choice-menu"]),
    emitCustomEvent: (name, event) => {
      if (name === "quest:get-stage") event.stage = event.player.questStage ?? 0;
      else {
        if (name === "crafting:spun") provenanceEvents.push(event);
        api.emitCustomEvent(name, event);
      }
    },
    getTaskManager: () => ({ submit: task => tasks.push(task) }),
  });
  require('../plugins/quests/quests/OneSmallFavour.Quest')(new Proxy({
    core: api.core,
    onItemOnObject: handler => { handlers.questItemOnObject = handler; },
  }, { get: (object, key) => object[key] ?? (() => {}) }));
});

function membersWorld(t, members) {
  const saved = productionMembersWorld;
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
    adds: (id, amount = 1) => amounts.set(id, (amounts.get(id) ?? 0) + amount),
    getItems: () => {
      const { Item, ItemDefinition } = PluginManager.getCoreApi();
      return [...amounts].filter(([, amount]) => amount > 0).flatMap(([id, amount]) =>
        ItemDefinition.forId(id).isStackable() ? [new Item(id, amount)] :
          Array.from({ length: amount }, () => new Item(id, 1)));
    },
    getCopiedItems: () => {
      const { Item } = PluginManager.getCoreApi();
      const items = inventory.getItems();
      assert.ok(items.length <= 28, "fixture inventory exceeds capacity");
      return [...items.map(item => item.clone()), ...Array.from({ length: 28 - items.length }, () => new Item(-1, 0))];
    },
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
    sendTypedMessage(type, text) { log.push(['message', text, type]); return packetSender; },
    sendObjectAnimation(object, animation) { log.push(['loc-animation', animation.getId()]); return packetSender; },
    sendConfig(id, value) { log.push(['config', id, value]); return packetSender; },
    sendVarbit(id, value) { log.push(['varbit', id, value]); return packetSender; },
    getVarbit(id) { return player.varbits?.get(id) ?? 0; },
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
    getIndex: () => 7,
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

test('wool strings holy and unholy symbols in either order for four Crafting XP', () => {
  for (const [input, output] of [[ItemIds.UNSTRUNG_SYMBOL, ItemIds.UNBLESSED_SYMBOL], [ItemIds.UNSTRUNG_EMBLEM, ItemIds.UNPOWERED_SYMBOL]]) {
    for (const reverse of [false, true]) {
      const { player } = playerWith([[input, 1], [ItemIds.BALL_OF_WOOL, 1]], { level: 1 });
      const event = { player, usedItemId: reverse ? input : ItemIds.BALL_OF_WOOL,
        usedWithItemId: reverse ? ItemIds.BALL_OF_WOOL : input, handled: false };
      handlers.stringAmulet(event);
      assert.equal(event.handled, true);
      assert.equal(player.getInventory().getAmount(output), 0, 'the action retains its existing one-tick delay');
      tasks.at(-1).execute();
      assert.equal(player.getInventory().getAmount(input), 0);
      assert.equal(player.getInventory().getAmount(ItemIds.BALL_OF_WOOL), 0);
      assert.equal(player.getInventory().getAmount(output), 1);
      assert.deepEqual(player.log.filter(row => row[0] === 'xp'), [['xp', 4]]);
      assert.ok(player.log.some(row => row[1] === 'You put some string on your symbol.'));
    }
  }
});

test('stringing keeps ordinary amulets and rechecks materials before consuming them', () => {
  for (const cancel of [false, true]) {
    const { player } = playerWith([[ItemIds.GOLD_AMULET_U_, 1], [ItemIds.BALL_OF_WOOL, 1]]);
    handlers.stringAmulet({ player, usedItemId: ItemIds.BALL_OF_WOOL, usedWithItemId: ItemIds.GOLD_AMULET_U_ });
    if (cancel) player.getInventory().deleteNumber(ItemIds.BALL_OF_WOOL, 1);
    tasks.at(-1).execute();
    assert.equal(player.getInventory().getAmount(ItemIds.GOLD_AMULET), cancel ? 0 : 1);
    assert.equal(player.getInventory().getAmount(ItemIds.GOLD_AMULET_U_), cancel ? 1 : 0);
    assert.equal(player.log.filter(row => row[0] === 'xp').length, cancel ? 0 : 1);
    if (!cancel) assert.ok(player.log.some(row => row[1] === 'You put some string on your amulet.'));
  }
});

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
  assert.ok(byTick[1].some(row => row[0] === 'message' && row[2] === PluginManager.getCoreApi().ChatType.SPAM), 'a spam line');
  assert.equal(player.amounts.get(ItemIds.DIAMOND), 3);
});

test('below the level, the tick after the click brings an item box naming the gem (rsprox 1102, 1723)', t => {
  membersWorld(t, true);
  const { player, getMenu } = playerWith([[ItemIds.CHISEL, 1], [ItemIds.UNCUT_SAPPHIRE, 2]], { level: 19 });
  assert.equal(use(player, 'cutGem', ItemIds.CHISEL, ItemIds.UNCUT_SAPPHIRE).handled, true);
  assert.equal(getMenu(), undefined, 'no menu');
  assert.equal(player.log.length, 0, 'nothing on the click tick');
  tasks.at(-1).execute();
  assert.deepEqual(player.log, [['statement', 'You need a Crafting level of 20 to cut sapphires.']]);
});

test('another action cancels the delayed refusal: it is keyed by the player index, as combat cancels', t => {
  membersWorld(t, true);
  const { TaskManager } = PluginManager.getCoreApi();
  const { player } = playerWith([[ItemIds.CHISEL, 1], [ItemIds.UNCUT_SAPPHIRE, 1]], { level: 1 });
  use(player, 'cutGem', ItemIds.CHISEL, ItemIds.UNCUT_SAPPHIRE);
  const task = tasks.at(-1);
  assert.equal(task.key, player.getIndex());
  TaskManager.submit(task);
  TaskManager.cancelTasks(player.getIndex());
  TaskManager.process();
  assert.equal(task.isRunning(), false);
  assert.deepEqual(player.log, []);
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

test('the wheel offers what the carried materials spin into, starts on the choice and spins one every 2 ticks from the second', t => {
  membersWorld(t, true);
  provenanceEvents.length = 0;
  const { player, getMenu } = playerWith([[ItemIds.FLAX, 2]], { level: 12 });
  namedObjects['Spinning wheel'].Spin({ player, object: {}, handled: false });
  assert.equal(getMenu().getTitle(), 'What would you like to spin?');
  assert.equal(getMenu().getOptions().mode, 16);
  assert.deepEqual(getMenu().getItems(), [ItemIds.LINEN_YARN, ItemIds.BOW_STRING]);
  const byTick = make(player, getMenu(), ItemIds.LINEN_YARN, 2, 6);
  assert.ok(byTick[0].some(row => row[0] === 'animation' && row[1] === 13139));
  assert.ok(byTick[0].some(row => row[0] === 'loc-animation' && row[1] === 466));
  assert.equal(byTick[1].some(row => row[0] === 'animation'), false);
  assert.ok(byTick[2].some(row => row[0] === 'animation' && row[1] === 13139));
  assert.deepEqual(byTick.flatMap((rows, tick) => rows.some(row => row[0] === 'xp') ? [tick] : []), [2, 4]);
  assert.deepEqual(xpOn(byTick, 2), [16]);
  assert.equal(player.amounts.get(ItemIds.LINEN_YARN), 2);
  assert.equal(player.amounts.get(ItemIds.FLAX), 0);
  assert.equal(provenanceEvents.length, 2);
  assert.equal(Object.hasOwn(provenanceEvents[0], 'stationObjectId'), false);
  assert.equal(Object.hasOwn(provenanceEvents[0], 'location'), false);
});

test('free-to-play wheels only spin wool, and wool used on the wheel opens the menu', t => {
  membersWorld(t, false);
  const { player, getMenu } = playerWith([[ItemIds.WOOL, 1], [ItemIds.FLAX, 1]]);
  const event = { player, itemId: ItemIds.WOOL, object: { getDefinition: () => ({ getName: () => 'Spinning wheel' }) }, handled: false };
  handlers.handleMaterialOnStation(event);
  assert.equal(event.handled, true);
  assert.deepEqual(getMenu().getItems(), [ItemIds.BALL_OF_WOOL]);
  assert.equal(getMenu().getTitle(), 'How many would you like to spin?');
});

test('the loom starts on the choice and weaves drift nets from two jute fibres every 3 ticks from the third', t => {
  membersWorld(t, true);
  const { player, getMenu } = playerWith([[ItemIds.JUTE_FIBRE, 4]], { level: 26 });
  namedObjects.Loom.Weave({ player, object: {}, handled: false });
  assert.equal(getMenu().getTitle(), 'How many would you like to weave?');
  assert.equal(getMenu().getOptions().mode, 35);
  assert.deepEqual(getMenu().getItems(), [ItemIds.EMPTY_SACK, ItemIds.DRIFT_NET]);
  const byTick = make(player, getMenu(), ItemIds.DRIFT_NET, 2, 8);
  assert.ok(byTick[0].some(row => row[0] === 'animation' && row[1] === 2270));
  assert.deepEqual(xpOn(byTick, 3), [55]);
  assert.deepEqual(xpOn(byTick, 6), [55]);
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

// Pottery: captures 3121 (normal world), 1757/1858/1098 (Leagues); Wiki creation rates.
const potteryStation = name => ({
  getDefinition: () => ({ getName: () => name }),
  getLocation: () => new Location(3109, 3499, 0),
});
function openPottery(player, firing = false) {
  const name = firing ? 'Pottery Oven' : "Potter's Wheel";
  const event = { player, object: potteryStation(name), handled: false };
  namedObjects[name][firing ? 'Fire' : 'Use'](event);
  assert.equal(event.handled, true);
}

test('pottery offers the captured ordered quantity menu even at level 1', t => {
  membersWorld(t, true);
  const { player, getMenu } = playerWith([[ItemIds.SOFT_CLAY, 3]], { level: 1 });
  player.questStage = 34;
  openPottery(player);
  assert.equal(getMenu().getTitle(), 'How many do you wish to make?');
  assert.equal(getMenu().getOptions().mode, 0);
  assert.equal(getMenu().getOptions().maxAmount, 3);
  assert.deepEqual(getMenu().getItems(), [ItemIds.UNFIRED_POT, ItemIds.UNFIRED_PIE_DISH,
    ItemIds.UNFIRED_BOWL, ItemIds.UNFIRED_PLANT_POT, ItemIds.UNFIRED_CUP, ItemIds.UNFIRED_POT_LID]);
  assert.deepEqual(getMenu().getOptions().labels, ['Pot', 'Pie dish', 'Bowl', 'Plant pot', 'Set of cups', 'Pot lid']);
  assert.equal(player.amounts.get(ItemIds.SOFT_CLAY), 3);
});

test('shaping repeats at three ticks, with first result two ticks after starting', t => {
  membersWorld(t, true);
  const { player, getMenu } = playerWith([[ItemIds.SOFT_CLAY, 3]]);
  openPottery(player);
  const rows = craft(player, getMenu(), ItemIds.UNFIRED_BOWL, 2, 9);
  assert.deepEqual(madeOn(rows, 'You make the clay into a bowl.'), [2, 5]);
  assert.ok(rows[2].some(row => row[0] === 'message' && row[2] === PluginManager.getCoreApi().ChatType.SPAM));
  assert.ok(rows[0].some(row => row[0] === 'animation' && row[1] === 883));
  assert.ok(rows[0].some(row => row[0] === 'sound' && row[1] === 2588));
  assert.deepEqual(xpOn(rows, 2), [18]);
  assert.ok(rows[2].some(row => row[0] === 'animation' && row[1] === 883));
  assert.equal(rows[3].some(row => row[0] === 'animation'), false);
  assert.equal(player.amounts.get(ItemIds.UNFIRED_BOWL), 2);
  assert.equal(player.amounts.get(ItemIds.SOFT_CLAY), 1);
});

test('oven always opens its quantity menu and fires at six ticks then every seven', t => {
  membersWorld(t, true);
  const { player, getMenu } = playerWith([[ItemIds.UNFIRED_BOWL, 3]], { level: 13 });
  openPottery(player, true);
  assert.equal(getMenu().getTitle(), 'What would you like to fire in the oven?');
  assert.equal(getMenu().getOptions().mode, 9);
  assert.equal(getMenu().getOptions().maxAmount, 3);
  const rows = craft(player, getMenu(), ItemIds.UNFIRED_BOWL, 2, 16);
  assert.deepEqual(madeOn(rows, 'You put a bowl in the oven.'), [0, 7]);
  assert.deepEqual(madeOn(rows, 'You remove the bowl from the oven.'), [6, 13]);
  const SPAM = PluginManager.getCoreApi().ChatType.SPAM;
  assert.ok([rows[0], rows[6]].every(tick => tick.some(row => row[0] === 'message' && row[2] === SPAM)));
  assert.ok(rows[0].some(row => row[0] === 'animation' && row[1] === 1317));
  assert.ok(rows[0].some(row => row[0] === 'sound' && row[1] === 2725));
  assert.deepEqual(xpOn(rows, 6), [15]);
  assert.equal(player.amounts.get(ItemIds.BOWL), 2);
  assert.equal(player.amounts.get(ItemIds.UNFIRED_BOWL), 1);
});

test('unfired pottery used on an oven opens the same menu without consuming the item', t => {
  membersWorld(t, true);
  const { player, getMenu } = playerWith([[ItemIds.UNFIRED_BOWL, 2]]);
  const event = { player, itemId: ItemIds.UNFIRED_BOWL, object: potteryStation('Pottery Oven') };
  handlers.handlePotteryItemOnObject(event);
  assert.equal(event.handled, true);
  assert.equal(player.amounts.get(ItemIds.UNFIRED_BOWL), 2);
  assert.equal(getMenu().getOptions().mode, 9);
});

test('pottery interruption before completion preserves materials and XP', t => {
  membersWorld(t, true);
  for (const firing of [false, true]) {
    const input = firing ? ItemIds.UNFIRED_BOWL : ItemIds.SOFT_CLAY;
    const { player, getMenu } = playerWith([[input, 2]]);
    openPottery(player, firing);
    getMenu().execute(firing ? input : ItemIds.UNFIRED_BOWL, 2);
    const task = tasks.at(-1);
    player.moving = true;
    task.execute();
    assert.equal(player.amounts.get(input), 2);
    assert.equal(player.log.some(row => row[0] === 'xp'), false);
    assert.equal(player.getAttribute(TASK_ATTRIBUTE), null);
  }
});

test('cups produce four for one clay for the shaping XP of one action', t => {
  membersWorld(t, true);
  const { player, getMenu } = playerWith([[ItemIds.SOFT_CLAY, 1]]);
  openPottery(player);
  const rows = craft(player, getMenu(), ItemIds.UNFIRED_CUP, 1, 3);
  assert.equal(player.amounts.get(ItemIds.UNFIRED_CUP), 4);
  assert.deepEqual(xpOn(rows, 2), [8.5]);
  assert.deepEqual(messages(rows[2]), ['You make the clay into a set of cups.']);
  openPottery(player, true);
  const fired = craft(player, getMenu(), ItemIds.UNFIRED_CUP, 2, 14);
  assert.deepEqual(madeOn(fired, 'You put an item in the oven.'), [0, 7]);
  assert.deepEqual(madeOn(fired, 'You remove the item from the oven.'), [6, 13]);
  assert.deepEqual(xpOn(fired, 6), [8.5]);
  assert.equal(player.amounts.get(ItemIds.EMPTY_CUP), 2);
});

test('pottery shaping enforces levels and the quest pot-lid unlock; firing needs neither', t => {
  membersWorld(t, true);
  const { player, getMenu } = playerWith([[ItemIds.SOFT_CLAY, 3], [ItemIds.UNFIRED_PLANT_POT, 1]], { level: 1 });
  openPottery(player);
  craft(player, getMenu(), ItemIds.UNFIRED_BOWL, 1, 3);
  assert.equal(player.amounts.get(ItemIds.SOFT_CLAY), 3);
  player.level = 99;
  openPottery(player);
  craft(player, getMenu(), ItemIds.UNFIRED_POT_LID, 1, 3);
  assert.equal(player.amounts.get(ItemIds.SOFT_CLAY), 3);
  player.questStage = 34;
  openPottery(player);
  const lid = craft(player, getMenu(), ItemIds.UNFIRED_POT_LID, 1, 3);
  assert.deepEqual(xpOn(lid, 2), [20]);
  assert.equal(player.amounts.get(ItemIds.UNFIRED_POT_LID), 1);
  player.level = 1;
  withRandom(t, 0);
  openPottery(player, true);
  const rows = craft(player, getMenu(), ItemIds.UNFIRED_PLANT_POT, 1, 7);
  assert.equal(player.amounts.get(ItemIds.EMPTY_PLANT_POT), 1);
  assert.deepEqual(xpOn(rows, 6), [17.5]);
  openPottery(player, true);
  const lidFired = craft(player, getMenu(), ItemIds.UNFIRED_POT_LID, 1, 7);
  assert.deepEqual(xpOn(lidFired, 6), [20]);
  assert.equal(player.amounts.get(ItemIds.POT_LID), 1);
});

test('low-level pottery can crack without output or XP; level 13 always succeeds', t => {
  membersWorld(t, true);
  withRandom(t, 0.999);
  for (const level of [1, 12, 13]) {
    const { player, getMenu } = playerWith([[ItemIds.UNFIRED_POT, 1]], { level });
    openPottery(player, true);
    const rows = craft(player, getMenu(), ItemIds.UNFIRED_POT, 1, 7);
    assert.equal(player.amounts.get(ItemIds.UNFIRED_POT), 0);
    assert.equal(player.amounts.get(ItemIds.POT) ?? 0, level < 13 ? 0 : 1);
    assert.deepEqual(xpOn(rows, 6), level < 13 ? [] : [6.3]);
  }
});

test('free-to-play pottery menu excludes cups, plant pots and pot lids', t => {
  membersWorld(t, false);
  const { player, getMenu } = playerWith([[ItemIds.SOFT_CLAY, 2]]);
  openPottery(player);
  assert.deepEqual(getMenu().getItems(), [ItemIds.UNFIRED_POT, ItemIds.UNFIRED_PIE_DISH, ItemIds.UNFIRED_BOWL]);
});

test('empty wheel shows the captured message box and schedules no work', () => {
  const { player, getMenu } = playerWith();
  openPottery(player);
  assert.equal(getMenu(), undefined);
  assert.ok(player.log.some(row => row[0] === 'statement' && row[1] === "You don't have anything suitable to craft with."));
});

test('One Small Favour leaves pot lid firing to the timed Crafting path', () => {
  const { player } = playerWith([[ItemIds.UNFIRED_POT_LID, 1]]);
  const event = { player, itemId: ItemIds.UNFIRED_POT_LID,
    object: potteryStation('Pottery Oven'),
    objectId: PluginManager.getCoreApi().CacheDefinitions.getLocId('fai_barbarian_pottery_oven'), handled: false };
  handlers.questItemOnObject(event);
  assert.equal(event.handled, false);
  assert.equal(player.amounts.get(ItemIds.UNFIRED_POT_LID), 1);
  assert.equal(player.amounts.get(ItemIds.POT_LID), undefined);
});

test('a completed one-step move cancels pottery even after the movement queue empties', t => {
  membersWorld(t, true);
  const { player, getMenu } = playerWith([[ItemIds.UNFIRED_BOWL, 2]]);
  openPottery(player, true);
  getMenu().execute(ItemIds.UNFIRED_BOWL, 2);
  player.getLocation().addX(1);
  const task = tasks.at(-1);
  task.execute();
  assert.equal(player.getAttribute(TASK_ATTRIBUTE), null);
  assert.equal(player.amounts.get(ItemIds.UNFIRED_BOWL), 2);
});

test('water on clay makes soft clay with the captured spam line', () => {
  const { player } = playerWith([[ItemIds.CLAY, 1], [ItemIds.JUG_OF_WATER, 1]]);
  const event = use(player, 'makeSoftClay', ItemIds.JUG_OF_WATER, ItemIds.CLAY);
  assert.equal(event.handled, true);
  assert.equal(player.amounts.get(ItemIds.SOFT_CLAY), 1);
  assert.equal(player.amounts.get(ItemIds.JUG), 1);
  assert.deepEqual(player.log.filter(row => row[0] === 'message'),
    [['message', 'You mix the clay and water.<br>You now have some soft workable clay.', PluginManager.getCoreApi().ChatType.SPAM]]);
});

test('an oven choice the player does not carry names it in a message box', t => {
  membersWorld(t, true);
  const { player, getMenu } = playerWith([[ItemIds.UNFIRED_POT, 1]]);
  openPottery(player, true);
  player.log.length = 0;
  getMenu().execute(ItemIds.UNFIRED_BOWL, 1);
  assert.deepEqual(player.log, [['statement', "You don't have any bowls which need firing."]]);
  assert.equal(player.getAttribute(TASK_ATTRIBUTE) ?? null, null);
});

test('the oven leaves pot lids out until One Small Favour teaches them, as the wheel does', t => {
  membersWorld(t, true);
  const { player, getMenu } = playerWith([[ItemIds.UNFIRED_POT, 1]]);
  openPottery(player, true);
  assert.deepEqual(getMenu().getOptions().labels, ['Pot', 'Pie dish', 'Bowl', 'Plant pot', 'Cup']);
  player.questStage = 34;
  openPottery(player, true);
  assert.equal(getMenu().getItems().at(-1), ItemIds.UNFIRED_POT_LID);
});

/** Opens the gold menu and clicks one of its buttons; the made item comes on the task's second run. */
function goldButton(entries, component, { varbits } = {}) {
  const { player } = playerWith([[ItemIds.GOLD_BAR, 1], ...entries]);
  player.varbits = varbits;
  const furnace = { getDefinition: () => ({ getName: () => 'Furnace' }) };
  handlers.handleBarOnFurnace({ player, itemId: ItemIds.GOLD_BAR, object: furnace, handled: false });
  const before = tasks.length;
  handlers.button({ player, buttonId: (446 << 16) | component, handled: false });
  if (tasks.length > before) { tasks.at(-1).execute(); tasks.at(-1).execute(); }
  return player;
}

test('each rev 241 bracelet button makes its own bracelet (446:50, 52-58; 51 is the mould layer)', t => {
  membersWorld(t, true);
  const rows = [
    [50, null, ItemIds.GOLD_BRACELET_2], [52, ItemIds.SAPPHIRE, ItemIds.SAPPHIRE_BRACELET_2],
    [53, ItemIds.EMERALD, ItemIds.EMERALD_BRACELET], [54, ItemIds.RUBY, ItemIds.RUBY_BRACELET],
    [55, ItemIds.DIAMOND, ItemIds.DIAMOND_BRACELET], [56, ItemIds.DRAGONSTONE, ItemIds.DRAGONSTONE_BRACELET],
    [57, ItemIds.ONYX, ItemIds.ONYX_BRACELET], [58, ItemIds.ZENYTE, ItemIds.ZENYTE_BRACELET_2],
  ];
  for (const [component, gem, bracelet] of rows) {
    const player = goldButton([[ItemIds.BRACELET_MOULD, 1], ...(gem ? [[gem, 1]] : [])], component);
    assert.equal(player.amounts.get(bracelet), 1, `446:${component}`);
    assert.equal(player.amounts.get(ItemIds.GOLD_BAR), 0);
  }
  const layer = goldButton([[ItemIds.BRACELET_MOULD, 1]], 51);
  assert.equal(layer.amounts.get(ItemIds.GOLD_BRACELET_2), undefined, 'the mould layer makes nothing');
});

test('the slayer ring button (446:16) needs Ring bling, and makes the eternal ring from an eternal gem', t => {
  membersWorld(t, true);
  const unlocked = new Map([[PluginManager.getCoreApi().CacheDefinitions.getVarbitId('slayer_ring_unlocked'), 1]]);
  const locked = goldButton([[ItemIds.RING_MOULD, 1], [ItemIds.ENCHANTED_GEM, 1]], 16);
  assert.equal(locked.amounts.get(ItemIds.SLAYER_RING_8_), undefined);
  assert.ok(locked.log.some(row => row[0] === 'message' && /slayer rings/.test(row[1])));
  const ring = goldButton([[ItemIds.RING_MOULD, 1], [ItemIds.ENCHANTED_GEM, 1]], 16, { varbits: unlocked });
  assert.equal(ring.amounts.get(ItemIds.SLAYER_RING_8_), 1);
  assert.equal(ring.amounts.get(ItemIds.ENCHANTED_GEM), 0);
  assert.ok(ring.log.some(row => row[0] === 'xp' && row[1] === 15));
  const eternal = goldButton([[ItemIds.RING_MOULD, 1], [ItemIds.ENCHANTED_GEM, 1], [ItemIds.ETERNAL_GEM, 1]], 16, { varbits: unlocked });
  assert.equal(eternal.amounts.get(ItemIds.SLAYER_RING_ETERNAL_), 1);
  assert.equal(eternal.amounts.get(ItemIds.ENCHANTED_GEM), 1, 'the eternal gem is used, as the client shows');
});

// Native conservation oracle for one silver bar -> ten unfinished silver bolts.
test("native furnace silver-bolt batches conserve inputs at output stack limits", async t => {
  process.env.DISABLE_PLAYER_BOTS = "1";
  const path = require("node:path");
  const { Player } = require("../dist/game/entity/impl/player/Player");
  const { PlayerSession } = require("../dist/net/PlayerSession");
  const { ClientConnection } = require("../dist/net/NetworkBuilder");
  const { MAX_STACK_AMOUNT } = require("../dist/game/model/container/StackType");
  const Smithing = require("../plugins/skills/Smithing.plugin");
  const Shared = require("../plugins/skills/crafting/Shared.Crafting");
  PluginManager.loadFromDirectory(path.resolve(__dirname,"../plugins"));
  const core=PluginManager.getCoreApi(),ids=core.ItemIdentifiers;
  core.RegionManager.init();core.RegionManager.loadMapFiles(3222,3218);PluginManager.emitServerStartup({});
  t.after(()=>PluginManager.emitServerShutdown({}));
  assert.equal(core.WorldDefinition.isMembersWorld,productionMembersWorld,"restore the real configured-world provider before native work");
  assert.equal(core.WorldDefinition.isMembersWorld(),true,"native silver bolts require an actual members world");
  const recipe=Shared.DATA.silver.products.find(r=>r.item==="SILVER_BOLTS_UNF_");
  assert.ok(recipe);assert.equal(recipe.amount,10);assert.equal(recipe.xp,50);assert.equal(recipe.mould,"BOLT_MOULD");
  const outputId=ids.SILVER_BOLTS_UNF_;
  assert.equal(core.ItemDefinition.forId(outputId).isStackable(),true);
  let index=1830;
  for(const [label,seed,capacity] of [["room",0,10],["exact",MAX_STACK_AMOUNT-10,10],["near",MAX_STACK_AMOUNT-5,5],["full",MAX_STACK_AMOUNT,0]]) await t.test(label,async t=>{
    const channel={kind:"test",remoteAddress:"127.0.0.1",isOpen:()=>true,send:()=>true,close(){},onData(){},onError(){},onClose(){}};
    const p=new Player(new PlayerSession(channel));p.setIndex(index++);p.setUsername("boltcapacity"+index);p.setRegistered(true);p.setLocation(new core.Location(3226,3218,0));p.needsPlacement=false;
    p.getSkillManager().setCurrentLevel(core.Skill.CRAFTING,99,false);
    const c=new ClientConnection(channel);c.player=p;
    t.after(()=>{Shared.stopCrafting(p);PluginManager.emitPlayerDisconnect({player:p,username:p.getUsername()});PluginManager.emitPlayerLogout({player:p,username:p.getUsername()});p.setRegistered(false);core.TaskManager.cancelTasks(p.getIndex());core.TaskManager.cancelTasks(p);});
    const inv=p.getInventory();for(const id of [ids.SILVER_BAR,ids.BOLT_MOULD])inv.add(new core.Item(id,1),false);if(seed)inv.add(new core.Item(outputId,seed),false);
    assert.equal(inv.getAmount(outputId),seed);assert.equal(inv.getAddableAmount(new core.Item(outputId,10)),capacity);
    assert.equal(p.getEquipment().getItems().some(i=>i&&i.getId()>0),false);
    const furnaceId=[...Smithing.FURNACE_OBJECT_IDS].find(id=>{const d=core.ObjectDefinition.forPlayer(id,p);return d?.getName()==="Furnace"&&d.getActions()?.includes("Smelt");});assert.ok(Number.isInteger(furnaceId));
    const furnace=new core.GameObject(furnaceId,new core.Location(3223,3218,0),10,0,null);core.ObjectManager.register(furnace,true);t.after(()=>core.ObjectManager.deregister(furnace,true));
    const pos=()=>[p.getLocation().getX(),p.getLocation().getY(),p.getLocation().getZ()];
    const total=id=>inv.getAmount(id)+p.getEquipment().getAmount(id)+core.World.getItems().filter(g=>!g.isPendingRemoval()&&g.getOwner()===p.getUsername()&&g.getPrivateArea()===p.getPrivateArea()&&g.getItem().getId()===id).reduce((n,g)=>n+g.getItem().getAmount(),0);
    const gains=[],produced=[];const skills=p.getSkillManager(),add=skills.addExperiences.bind(skills);
    t.mock.method(skills,"addExperiences",(skill,xp)=>{if(skill===core.Skill.CRAFTING)gains.push(xp);return add(skill,xp);});
    PluginManager.createApi("BoltCapacityObserve"+p.getIndex()).onCustomEvent("skills:produced",e=>{if(e.player===p&&e.itemId===outputId)produced.push({itemId:e.itemId,amount:e.amount,xp:e.xp,kind:e.kind});});
    let turns=0;const rows=[];
    const snapshot=phase=>{const q=p.getMovementQueue(),row={phase,label,turns,pos:pos(),queue:q.size(),taskActive:p.getAttribute(Shared.CRAFTING_TASK_ATTRIBUTE)?.isRunning?.()??false,bar:total(ids.SILVER_BAR),mould:total(ids.BOLT_MOULD),bolts:total(outputId),gains:[...gains],produced:[...produced]};rows.push(row);console.log("SILVER_BOLT_CAPACITY_PRECONDITION "+JSON.stringify(row));return row;};
    const turn=()=>{assert.ok(++turns<=16);p.resetUpdating();core.World.processCycle=(core.World.processCycle+1)&0x7fffffff;core.TaskManager.process();c.processTurnPackets();const q=p.getMovementQueue();q.beginCycle();q.processEntityPursuit();if(q.hasPendingWork())q.process();core.TaskManager.processWalkTo(p.getIndex());};
    await c.dispatch([{type:"item_on_object",objectId:furnaceId,x:3223,y:3218,itemId:ids.SILVER_BAR,slot:inv.getSlotForItemId(ids.SILVER_BAR),widgetId:149<<16}]);
    for(let i=0;i<8&&p.getInterfaceId()!==6;i++)turn();snapshot("menu");
    assert.equal(p.getInterfaceId(),6,"actual silverbar-on-furnace opens native silver menu");assert.deepEqual(pos(),[3226,3218,0]);assert.equal(p.getMovementQueue().size(),0);assert.equal(total(ids.SILVER_BAR),1);assert.equal(total(outputId),seed);assert.deepEqual(gains,[]);
    await c.dispatch([{type:"widget_action",widgetId:(6<<16)|recipe.component,groupId:6,childId:recipe.component,buttonNum:1,opId:1,slot:-1,itemId:-1}]);
    turn();snapshot("selected-before-commit");assert.equal(total(ids.SILVER_BAR),1);assert.equal(total(outputId),seed);assert.deepEqual(gains,[]);
    if(label==="room"||label==="exact")assert.equal(p.getAttribute(Shared.CRAFTING_TASK_ATTRIBUTE)?.isRunning(),true,"working positive must admit its real pending task");
    for(let i=0;i<5;i++)turn();const end=snapshot("completion");console.log("SILVER_BOLT_CAPACITY_OBSERVATION "+JSON.stringify(rows));
    const consumed=1-total(ids.SILVER_BAR),credited=total(outputId)-seed;
    assert.ok(consumed===0||consumed===1);
    assert.equal(credited,consumed*10,"one silver bar must yield all ten bolts or remain unspent: "+JSON.stringify(end));
    if(label==="room"||label==="exact")assert.equal(consumed,1,"positive control completes one batch");
    assert.equal(total(ids.BOLT_MOULD),1);assert.deepEqual(gains,consumed?[50]:[]);
    assert.deepEqual(produced,consumed?[{itemId:outputId,amount:10,xp:50,kind:"jewellery"}]:[]);
    assert.equal(p.getAttribute(Shared.CRAFTING_TASK_ATTRIBUTE),null);
  });
  await t.test("full inventory gold ring uses the bar's freed slot", async t => {
    const channel={kind:"test",remoteAddress:"127.0.0.1",isOpen:()=>true,send:()=>true,close(){},onData(){},onError(){},onClose(){}};
    const p=new Player(new PlayerSession(channel));p.setIndex(index++);p.setUsername("goldcapacity"+index);p.setRegistered(true);p.setLocation(new core.Location(3226,3218,0));p.needsPlacement=false;
    p.getSkillManager().setCurrentLevel(core.Skill.CRAFTING,99,false);
    const c=new ClientConnection(channel);c.player=p;
    t.after(()=>{Shared.stopCrafting(p);PluginManager.emitPlayerDisconnect({player:p,username:p.getUsername()});PluginManager.emitPlayerLogout({player:p,username:p.getUsername()});p.setRegistered(false);core.TaskManager.cancelTasks(p.getIndex());core.TaskManager.cancelTasks(p);});
    const inv=p.getInventory();
    for(const id of [ids.GOLD_BAR,ids.RING_MOULD]) inv.add(new core.Item(id,1),false);
    assert.equal(core.ItemDefinition.forId(ids.BRONZE_DAGGER).isStackable(),false);
    for(let i=0;i<26;i++) inv.add(new core.Item(ids.BRONZE_DAGGER,1),false);
    assert.equal(inv.getFreeSlots(),0);assert.equal(inv.getAmount(ids.GOLD_BAR),1);
    assert.equal(core.ItemDefinition.forId(ids.GOLD_RING).isStackable(),false);
    assert.equal(inv.getAddableAmount(new core.Item(ids.GOLD_RING,1)),0);
    const furnaceId=[...Smithing.FURNACE_OBJECT_IDS].find(id=>{const d=core.ObjectDefinition.forPlayer(id,p);return d?.getName()==="Furnace"&&d.getActions()?.includes("Smelt");});assert.ok(Number.isInteger(furnaceId));
    const furnace=new core.GameObject(furnaceId,new core.Location(3223,3218,0),10,0,null);core.ObjectManager.register(furnace,true);t.after(()=>core.ObjectManager.deregister(furnace,true));
    let turns=0;const turn=()=>{assert.ok(++turns<=16);p.resetUpdating();core.World.processCycle=(core.World.processCycle+1)&0x7fffffff;core.TaskManager.process();c.processTurnPackets();const q=p.getMovementQueue();q.beginCycle();q.processEntityPursuit();if(q.hasPendingWork())q.process();core.TaskManager.processWalkTo(p.getIndex());};
    await c.dispatch([{type:"item_on_object",objectId:furnaceId,x:3223,y:3218,itemId:ids.GOLD_BAR,slot:inv.getSlotForItemId(ids.GOLD_BAR),widgetId:149<<16}]);
    for(let i=0;i<8&&p.getInterfaceId()!==446;i++)turn();
    assert.equal(p.getInterfaceId(),446);assert.equal(p.getMovementQueue().size(),0);assert.equal(inv.getAmount(ids.GOLD_BAR),1);
    await c.dispatch([{type:"widget_action",widgetId:(446<<16)|8,groupId:446,childId:8,buttonNum:1,opId:1,slot:-1,itemId:-1}]);
    turn();assert.equal(inv.getAmount(ids.GOLD_BAR),1);assert.equal(p.getAttribute(Shared.CRAFTING_TASK_ATTRIBUTE)?.isRunning(),true);
    for(let i=0;i<5;i++)turn();
    assert.equal(inv.getAmount(ids.GOLD_BAR),0);assert.equal(inv.getAmount(ids.GOLD_RING),1);assert.equal(inv.getAmount(ids.RING_MOULD),1);
    assert.equal(p.getAttribute(Shared.CRAFTING_TASK_ATTRIBUTE),null);
  });
  await t.test("a selected costume needle works even when an ordinary needle is also carried", async t => {
    const { CREATION_MENU_GROUP_ID, CREATION_MENU_FIRST_ITEM_COMPONENT } = require("../dist/net/packet/PacketSender");
    assert.equal(CREATION_MENU_GROUP_ID,270);
    assert.equal(ids.NEEDLE,1733); assert.equal(ids.COSTUME_NEEDLE,29920);
    assert.equal(ids.LEATHER,1741); assert.equal(ids.LEATHER_BOOTS,1061);
    const recipe=Shared.DATA.leather.LEATHER.find(r=>r.item==="LEATHER_BOOTS");
    assert.ok(recipe); assert.equal(recipe.level,7); assert.equal(recipe.leather,1); assert.equal(recipe.xp,16.25);
    for (const [mode,entries,chosen,expected] of [
      ["costume only",[[ids.COSTUME_NEEDLE,1],[ids.LEATHER,1]],ids.COSTUME_NEEDLE,true],
      ["ordinary needle and thread",[[ids.NEEDLE,1],[ids.THREAD,1],[ids.LEATHER,1]],ids.NEEDLE,true],
      ["ordinary needle without thread",[[ids.NEEDLE,1],[ids.LEATHER,1]],ids.NEEDLE,false],
      ["selected costume with both needles",[[ids.NEEDLE,1],[ids.COSTUME_NEEDLE,1],[ids.LEATHER,1]],ids.COSTUME_NEEDLE,true],
    ]) await t.test(mode,async t=>{
      const channel={kind:"test",remoteAddress:"127.0.0.1",isOpen:()=>true,send:()=>true,close(){},onData(){},onError(){},onClose(){}};
      const p=new Player(new PlayerSession(channel));p.setIndex(index++);p.setUsername("leathertool"+index);p.setRegistered(true);p.setLocation(new core.Location(3226,3218,0));p.needsPlacement=false;
      const c=new ClientConnection(channel),inv=p.getInventory(),skill=p.getSkillManager(),craft=core.Skill.CRAFTING;c.player=p;
      t.after(()=>{Shared.stopCrafting(p);PluginManager.emitPlayerDisconnect({player:p,username:p.getUsername()});PluginManager.emitPlayerLogout({player:p,username:p.getUsername()});p.setRegistered(false);core.TaskManager.cancelTasks(p.getIndex());core.TaskManager.cancelTasks(p);});
      skill.setCurrentLevel(craft,99,false).setMaxLevels(craft,99,false).setExperience(craft,core.SkillManager.getExperienceForLevel(99));
      assert.equal(skill.getCurrentLevel(craft),99);assert.equal(skill.getMaxLevel(craft),99);
      for(const [id,n] of entries)inv.add(new core.Item(id,n),false);
      for(const [id,n] of entries){assert.equal(inv.getAmount(id),n);const def=core.ItemDefinition.forId(id);assert.ok(def.getName());assert.equal(def.isNoted(),false);}
      assert.equal(p.getEquipment().getItems().some(i=>i&&i.getId()>0),false);
      assert.equal(inv.getAmount(ids.THREAD),mode==="ordinary needle and thread"?1:0,"thread state before using the needle");
      assert.notEqual(PluginManager.emitCanUseItem(p,chosen,"use"),false);assert.notEqual(PluginManager.emitCanUseItem(p,ids.LEATHER,"use"),false);
      const initialXp=skill.getExperience(craft),initialUses=p.getAttribute("crafting:thread-uses")??0;assert.equal(initialUses,0);
      const slot=inv.getSlotForItemId(chosen),target=inv.getSlotForItemId(ids.LEATHER);assert.ok(slot>=0&&target>=0&&slot!==target);
      assert.equal(inv.getItems()[slot].getId(),chosen);assert.equal(inv.getItems()[target].getId(),ids.LEATHER);
      assert.equal(inv.getItems()[slot].getMeta(),null);assert.match(core.ItemDefinition.forId(chosen).getName(),chosen===ids.COSTUME_NEEDLE?/^costume needle$/i:/^needle$/i);
      let turns=0;const turn=()=>{assert.ok(++turns<=16);p.resetUpdating();core.World.processCycle=(core.World.processCycle+1)&0x7fffffff;core.TaskManager.process();c.processTurnPackets();const q=p.getMovementQueue();q.beginCycle();q.processEntityPursuit();if(q.hasPendingWork())q.process();core.TaskManager.processWalkTo(p.getIndex());};
      await c.dispatch([{type:"inventory_use_on",slot,itemId:chosen,target:{kind:"inventory",slot:target,itemId:ids.LEATHER}}]);turn();
      const menu=p.getCreationMenu();
      if(!expected){assert.ok(!menu,"ordinary needle requires thread");assert.equal(inv.getAmount(ids.LEATHER),1);assert.equal(inv.getAmount(ids.LEATHER_BOOTS),0);assert.equal(skill.getExperience(craft),initialXp);return;}
      assert.ok(menu,"native item-on-item opens the leather make menu");const child=menu.getItems().indexOf(ids.LEATHER_BOOTS);assert.ok(child>=0);
      assert.equal(inv.getAmount(ids.LEATHER),1);assert.equal(inv.getAmount(ids.LEATHER_BOOTS),0);
      await c.dispatch([{type:"dialogue_continue",widgetId:(CREATION_MENU_GROUP_ID<<16)|(CREATION_MENU_FIRST_ITEM_COMPONENT+child),childIndex:1}]);turn();
      for(let i=0;i<5;i++)turn();
      assert.equal(inv.getAmount(ids.LEATHER_BOOTS),1,"selected needle must produce the requested leather boots");
      assert.equal(inv.getAmount(ids.LEATHER),0);assert.equal(inv.getAmount(chosen),1);
      if(mode==="selected costume with both needles")assert.equal(inv.getAmount(ids.NEEDLE),1);
      assert.equal(inv.getAmount(ids.THREAD),mode==="ordinary needle and thread"?1:0);
      assert.equal(p.getAttribute("crafting:thread-uses")??0,mode==="ordinary needle and thread"?1:0);
      assert.ok(skill.getExperience(craft)>initialXp);assert.equal(skill.getCurrentLevel(craft),99);assert.equal(skill.getMaxLevel(craft),99);
    });
  });
  await t.test("a carried Imcando hammer works for a hard leather shield", async t => {
    const { CREATION_MENU_GROUP_ID, CREATION_MENU_FIRST_ITEM_COMPONENT } = require("../dist/net/packet/PacketSender");
    assert.equal(CREATION_MENU_GROUP_ID,270);assert.equal(ids.IMCANDO_HAMMER,25644);assert.equal(ids.IMCANDO_HAMMER_OFF_HAND_,29775);
    const recipe=Shared.DATA.combine.recipes.find(r=>r.item==="HARD_LEATHER_SHIELD");
    assert.ok(recipe);assert.deepEqual(recipe.pair,["HARD_LEATHER","OAK_SHIELD"]);assert.deepEqual(recipe.pairAmounts,[2,1]);
    assert.deepEqual(recipe.materials,[["BRONZE_NAILS",15]]);assert.deepEqual(recipe.tools,["HAMMER"]);assert.equal(recipe.level,41);assert.equal(recipe.xp,70);
    for(const [mode,tool,expectMenu,remove] of [["ordinary hammer",ids.HAMMER,true,false],["no hammer",null,false,false],["ordinary hammer removed before make",ids.HAMMER,true,true],["carried Imcando hammer",ids.IMCANDO_HAMMER,true,false],["carried off-hand Imcando hammer",ids.IMCANDO_HAMMER_OFF_HAND_,true,false]]) await t.test(mode,async t=>{
      const channel={kind:"test",remoteAddress:"127.0.0.1",isOpen:()=>true,send:()=>true,close(){},onData(){},onError(){},onClose(){}};
      const p=new Player(new PlayerSession(channel));p.setIndex(index++);p.setUsername("shieldtool"+index);p.setRegistered(true);p.setLocation(new core.Location(3226,3218,0));p.needsPlacement=false;
      const c=new ClientConnection(channel),inv=p.getInventory(),skill=p.getSkillManager(),craft=core.Skill.CRAFTING;c.player=p;
      t.after(()=>{Shared.stopCrafting(p);PluginManager.emitPlayerDisconnect({player:p,username:p.getUsername()});PluginManager.emitPlayerLogout({player:p,username:p.getUsername()});p.setRegistered(false);core.TaskManager.cancelTasks(p.getIndex());core.TaskManager.cancelTasks(p);});
      skill.setCurrentLevel(craft,99,false).setMaxLevels(craft,99,false).setExperience(craft,core.SkillManager.getExperienceForLevel(99));
      assert.equal(skill.getCurrentLevel(craft),99);assert.equal(skill.getMaxLevel(craft),99);
      const entries=[[ids.HARD_LEATHER,2],[ids.OAK_SHIELD,1],[ids.BRONZE_NAILS,15],...(tool==null?[]:[[tool,1]])];
      for(const [id,n] of entries)inv.add(new core.Item(id,n),false);
      for(const [id,n] of entries){assert.equal(inv.getAmount(id),n);const def=core.ItemDefinition.forId(id);assert.ok(def.getName());assert.equal(def.isNoted(),false);}
      assert.equal(p.getEquipment().getItems().some(i=>i&&i.getId()>0),false);
      assert.equal(inv.getAmount(ids.HAMMER),tool===ids.HAMMER?1:0);assert.equal(inv.getAmount(ids.IMCANDO_HAMMER),tool===ids.IMCANDO_HAMMER?1:0);
      if(tool!=null){const toolSlot=inv.getSlotForItemId(tool);assert.ok(toolSlot>=0);assert.equal(inv.getItems()[toolSlot].getId(),tool);assert.equal(inv.getItems()[toolSlot].getMeta(),null);assert.match(core.ItemDefinition.forId(tool).getName(),tool===ids.IMCANDO_HAMMER?/^imcando hammer$/i:tool===ids.IMCANDO_HAMMER_OFF_HAND_?/^imcando hammer \(off-hand\)$/i:/^hammer$/i);assert.notEqual(PluginManager.emitCanUseItem(p,tool,"use"),false);}
      assert.notEqual(PluginManager.emitCanUseItem(p,ids.HARD_LEATHER,"use"),false);assert.notEqual(PluginManager.emitCanUseItem(p,ids.OAK_SHIELD,"use"),false);
      const initialXp=skill.getExperience(craft),slot=inv.getSlotForItemId(ids.HARD_LEATHER),target=inv.getSlotForItemId(ids.OAK_SHIELD);
      assert.ok(slot>=0&&target>=0&&slot!==target);assert.equal(inv.getItems()[slot].getId(),ids.HARD_LEATHER);assert.equal(inv.getItems()[target].getId(),ids.OAK_SHIELD);
      let turns=0;const turn=()=>{assert.ok(++turns<=16);p.resetUpdating();core.World.processCycle=(core.World.processCycle+1)&0x7fffffff;core.TaskManager.process();c.processTurnPackets();const q=p.getMovementQueue();q.beginCycle();q.processEntityPursuit();if(q.hasPendingWork())q.process();core.TaskManager.processWalkTo(p.getIndex());};
      const untouched=()=>{assert.equal(inv.getAmount(ids.HARD_LEATHER),2);assert.equal(inv.getAmount(ids.OAK_SHIELD),1);assert.equal(inv.getAmount(ids.BRONZE_NAILS),15);assert.equal(inv.getAmount(ids.HARD_LEATHER_SHIELD),0);assert.equal(skill.getExperience(craft),initialXp);};
      await c.dispatch([{type:"inventory_use_on",slot,itemId:ids.HARD_LEATHER,target:{kind:"inventory",slot:target,itemId:ids.OAK_SHIELD}}]);turn();
      const menu=p.getCreationMenu();
      if(!expectMenu){assert.ok(!menu,"no hammer refuses the recipe");untouched();return;}
      assert.ok(menu,"the carried hammer must admit the hard leather shield menu");const child=menu.getItems().indexOf(ids.HARD_LEATHER_SHIELD);assert.ok(child>=0);untouched();
      if(remove){inv.deleteNumber(ids.HAMMER,1);assert.equal(inv.getAmount(ids.HAMMER),0,"tool must actually be removed before selection");}
      await c.dispatch([{type:"dialogue_continue",widgetId:(CREATION_MENU_GROUP_ID<<16)|(CREATION_MENU_FIRST_ITEM_COMPONENT+child),childIndex:1}]);turn();
      for(let i=0;i<8;i++)turn();
      if(remove){untouched();return;}
      assert.equal(inv.getAmount(ids.HARD_LEATHER_SHIELD),1);assert.equal(inv.getAmount(ids.HARD_LEATHER),0);assert.equal(inv.getAmount(ids.OAK_SHIELD),0);assert.equal(inv.getAmount(ids.BRONZE_NAILS),0);assert.equal(inv.getAmount(tool),1);
      assert.ok(skill.getExperience(craft)>initialXp);assert.equal(skill.getCurrentLevel(craft),99);assert.equal(skill.getMaxLevel(craft),99);
    });
  });
  await t.test("leather crafting keeps the selected needle and accepts wielded Imcando hammers", async t => {
    const { CREATION_MENU_GROUP_ID, CREATION_MENU_FIRST_ITEM_COMPONENT } = require("../dist/net/packet/PacketSender");
    for(const [mode,chosen,removed] of [["costume selected with both needles and thread",ids.COSTUME_NEEDLE,false],["ordinary selected with both needles and thread",ids.NEEDLE,false],["selected costume removed before make",ids.COSTUME_NEEDLE,true]]) await t.test(mode,async t=>{
      const channel={kind:"test",remoteAddress:"127.0.0.1",isOpen:()=>true,send:()=>true,close(){},onData(){},onError(){},onClose(){}};
      const p=new Player(new PlayerSession(channel));p.setIndex(index++);p.setUsername("needlectrl"+index);p.setRegistered(true);p.setLocation(new core.Location(3226,3218,0));p.needsPlacement=false;
      const c=new ClientConnection(channel),inv=p.getInventory(),skill=p.getSkillManager(),craft=core.Skill.CRAFTING;c.player=p;
      t.after(()=>{Shared.stopCrafting(p);PluginManager.emitPlayerDisconnect({player:p,username:p.getUsername()});PluginManager.emitPlayerLogout({player:p,username:p.getUsername()});p.setRegistered(false);core.TaskManager.cancelTasks(p.getIndex());core.TaskManager.cancelTasks(p);});
      skill.setCurrentLevel(craft,99,false).setMaxLevels(craft,99,false).setExperience(craft,core.SkillManager.getExperienceForLevel(99));
      for(const [id,n] of [[ids.NEEDLE,1],[ids.COSTUME_NEEDLE,1],[ids.THREAD,1],[ids.LEATHER,5]])inv.add(new core.Item(id,n),false);
      assert.equal(inv.getAmount(ids.NEEDLE),1);assert.equal(inv.getAmount(ids.COSTUME_NEEDLE),1);assert.equal(inv.getAmount(ids.THREAD),1);assert.equal(inv.getAmount(ids.LEATHER),5);assert.equal(p.getAttribute("crafting:thread-uses")??0,0);
      const initialXp=skill.getExperience(craft),slot=inv.getSlotForItemId(chosen),target=inv.getSlotForItemId(ids.LEATHER);assert.ok(slot>=0&&target>=0&&slot!==target);assert.equal(inv.getItems()[slot].getId(),chosen);assert.notEqual(PluginManager.emitCanUseItem(p,chosen,"use"),false);
      let turns=0;const turn=()=>{assert.ok(++turns<=32);p.resetUpdating();core.World.processCycle=(core.World.processCycle+1)&0x7fffffff;core.TaskManager.process();c.processTurnPackets();const q=p.getMovementQueue();q.beginCycle();q.processEntityPursuit();if(q.hasPendingWork())q.process();core.TaskManager.processWalkTo(p.getIndex());};
      await c.dispatch([{type:"inventory_use_on",slot,itemId:chosen,target:{kind:"inventory",slot:target,itemId:ids.LEATHER}}]);turn();const menu=p.getCreationMenu();assert.ok(menu);const child=menu.getItems().indexOf(ids.LEATHER_BOOTS);assert.ok(child>=0);
      if(removed){inv.deleteNumber(chosen,1);assert.equal(inv.getAmount(chosen),0);}
      await c.dispatch([{type:"dialogue_continue",widgetId:(CREATION_MENU_GROUP_ID<<16)|(CREATION_MENU_FIRST_ITEM_COMPONENT+child),childIndex:5}]);turn();for(let i=0;i<17;i++)turn();
      assert.equal(inv.getAmount(ids.LEATHER_BOOTS),removed?0:5);assert.equal(inv.getAmount(ids.LEATHER),removed?5:0);assert.equal(inv.getAmount(ids.NEEDLE),1);assert.equal(inv.getAmount(ids.COSTUME_NEEDLE),removed?0:1);
      assert.equal(inv.getAmount(ids.THREAD),mode==="ordinary selected with both needles and thread"?0:1);assert.equal(p.getAttribute("crafting:thread-uses")??0,0);
      if(removed)assert.equal(skill.getExperience(craft),initialXp);else assert.ok(skill.getExperience(craft)>initialXp);
      assert.equal(skill.getCurrentLevel(craft),99);assert.equal(skill.getMaxLevel(craft),99);
    });
    for(const [label,tool,wearSlot] of [["wielded Imcando hammer",ids.IMCANDO_HAMMER,core.Equipment.WEAPON_SLOT],["wielded off-hand Imcando hammer",ids.IMCANDO_HAMMER_OFF_HAND_,core.Equipment.SHIELD_SLOT]]) await t.test(label,async t=>{
      const channel={kind:"test",remoteAddress:"127.0.0.1",isOpen:()=>true,send:()=>true,close(){},onData(){},onError(){},onClose(){}};
      const p=new Player(new PlayerSession(channel));p.setIndex(index++);p.setUsername("hammerctrl"+index);p.setRegistered(true);p.setLocation(new core.Location(3226,3218,0));p.needsPlacement=false;
      const c=new ClientConnection(channel),inv=p.getInventory(),skill=p.getSkillManager(),craft=core.Skill.CRAFTING;c.player=p;
      t.after(()=>{Shared.stopCrafting(p);PluginManager.emitPlayerDisconnect({player:p,username:p.getUsername()});PluginManager.emitPlayerLogout({player:p,username:p.getUsername()});p.setRegistered(false);core.TaskManager.cancelTasks(p.getIndex());core.TaskManager.cancelTasks(p);});
      skill.setCurrentLevel(craft,99,false).setMaxLevels(craft,99,false).setExperience(craft,core.SkillManager.getExperienceForLevel(99));
      for(const [id,n] of [[ids.HARD_LEATHER,2],[ids.OAK_SHIELD,1],[ids.BRONZE_NAILS,15],[tool,1]])inv.add(new core.Item(id,n),false);
      assert.equal(inv.getAmount(ids.HAMMER),0);assert.equal(inv.getAmount(tool),1);const toolSlot=inv.getSlotForItemId(tool);assert.ok(toolSlot>=0);assert.equal(inv.getItems()[toolSlot].getMeta(),null);
      let turns=0;const turn=()=>{assert.ok(++turns<=20);p.resetUpdating();core.World.processCycle=(core.World.processCycle+1)&0x7fffffff;core.TaskManager.process();c.processTurnPackets();const q=p.getMovementQueue();q.beginCycle();q.processEntityPursuit();if(q.hasPendingWork())q.process();core.TaskManager.processWalkTo(p.getIndex());};
      await c.dispatch([{type:"inventory_action",widgetId:3214,slot:toolSlot,itemId:tool,option:"Wield"}]);turn();
      assert.equal(p.getEquipment().get(wearSlot)?.getId(),tool,"native Wield must equip the repaired hammer in its real slot");assert.equal(inv.getAmount(tool),0);
      const xp=skill.getExperience(craft),slot=inv.getSlotForItemId(ids.HARD_LEATHER),target=inv.getSlotForItemId(ids.OAK_SHIELD);assert.ok(slot>=0&&target>=0);
      await c.dispatch([{type:"inventory_use_on",slot,itemId:ids.HARD_LEATHER,target:{kind:"inventory",slot:target,itemId:ids.OAK_SHIELD}}]);turn();const menu=p.getCreationMenu();assert.ok(menu);const child=menu.getItems().indexOf(ids.HARD_LEATHER_SHIELD);assert.ok(child>=0);
      await c.dispatch([{type:"dialogue_continue",widgetId:(CREATION_MENU_GROUP_ID<<16)|(CREATION_MENU_FIRST_ITEM_COMPONENT+child),childIndex:1}]);turn();for(let i=0;i<8;i++)turn();
      assert.equal(inv.getAmount(ids.HARD_LEATHER_SHIELD),1);assert.equal(inv.getAmount(ids.HARD_LEATHER),0);assert.equal(inv.getAmount(ids.OAK_SHIELD),0);assert.equal(inv.getAmount(ids.BRONZE_NAILS),0);assert.equal(p.getEquipment().get(wearSlot)?.getId(),tool);assert.ok(skill.getExperience(craft)>xp);
    });
  });
});
