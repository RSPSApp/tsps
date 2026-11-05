// Run after `yarn build`: node --test tests/mastering-mixology.test.cjs
const assert = require('node:assert/strict');
const { test, before } = require('node:test');

const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const Shared = require('../plugins/minigames/mixology/Shared.Mixology');
const Orders = require('../plugins/minigames/mixology/Orders.Mixology');
const Stations = require('../plugins/minigames/mixology/Stations.Mixology');
const Mixer = require('../plugins/minigames/mixology/Mixer.Mixology');

before(() => {
  CachePipeline.initialize();
  Shared.bind({ core: PluginManager.getCoreApi(), emitCustomEvent() {} });
});

/** A player with a Herblore level, an inventory of items and the lab varbits. */
function fakePlayer({ level = 81, items = [], vars = {} } = {}) {
  const attributes = { [Shared.STATE_ATTRIBUTE]: { vars: { ...vars } } };
  const slots = items.map((item) => item ?? null);
  return {
    getAttribute: (key) => attributes[key],
    setAttribute: (key, value) => { attributes[key] = value; },
    getSkillManager: () => ({ getCurrentLevel: () => level, getMaxLevel: () => level }),
    getInventory: () => ({ getItems: () => slots }),
    getPacketSender: () => ({ getVarbit: () => 0, sendVarbit() {} }),
  };
}

function finished(index, modifier, digweed = false) {
  const { Item } = PluginManager.getCoreApi();
  const meta = { [Shared.META.MODIFIER]: modifier };
  if (digweed) meta[Shared.META.DIGWEED] = true;
  return new Item(Shared.potion(index).finished, 1, meta);
}

test('potions come from enum 5542 and their levels from enum 5548', () => {
  assert.equal(Shared.potions().size, 10);
  assert.equal(Shared.potion(1).unfinished, 30011); // mm_potion_mmm_unfinished
  assert.equal(Shared.potion(1).finished, 30021);
  assert.equal(Shared.potion(5).unfinished, 30016); // aam: the index runs aam before aal
  assert.equal(Shared.potion(6).unfinished, 30015);
  assert.equal(Shared.potion(9).name, 'Anti-leech lotion'); // lla
  assert.equal(Shared.potion(9).level, 78);
  assert.equal(Shared.potion(10).level, 81);
});

test('three lever pulls always name a potion', () => {
  assert.equal(Shared.potionFor(Mixer.counts([1, 2, 3])).name, 'Mixalot');
  assert.equal(Shared.potionFor(Mixer.counts([2, 2, 2])).name, 'Alco-augmentator'); // capture: vessel_ready 4
  assert.equal(Shared.potionFor(Mixer.counts([3, 2, 1])).index, 10); // capture: lye after aga, mox -> 10
  assert.equal(Shared.potionFor(Mixer.counts([3, 3, 2])).name, 'Anti-leech lotion');
});

test('a station needs 45 - floor(Herblore / 3) progress', () => {
  // rsprox captures: 21 at 72-74, 20 at 75-77, 19 at 78-80, 12 at 99-100, 11 at 102-103, 8 at 111.
  for (const [level, total] of [[72, 21], [75, 20], [78, 19], [81, 18], [99, 12], [102, 11], [111, 8]]) {
    assert.equal(Stations.total(fakePlayer({ level })), total, `level ${level}`);
  }
});

test('ordered potions pay the Wiki resin and XP; unordered a third and 10 of the best resin', () => {
  const mixalot = Shared.potion(10);
  assert.deepEqual(Orders.rewardOf({ entry: mixalot, ordered: true, digweed: false }), { resin: { mox: 20, aga: 20, lye: 20 }, xp: 365 });
  assert.deepEqual(Orders.rewardOf({ entry: mixalot, ordered: true, digweed: true }), { resin: { mox: 40, aga: 40, lye: 40 }, xp: 730 });
  const mmm = Orders.rewardOf({ entry: Shared.potion(1), ordered: false, digweed: false });
  assert.deepEqual(mmm.resin, { mox: 10, aga: 0, lye: 0 }); // capture 4197: 10/0/0
  assert.equal(Math.floor(mmm.xp), 63); // capture 4197: 63 XP
  assert.deepEqual(Orders.rewardOf({ entry: Shared.potion(2), ordered: false, digweed: false }).resin, { mox: 0, aga: 10, lye: 0 });
});

test('each finished potion fills the first open order with its potion and modifier', () => {
  const vars = {
    [Shared.VARBIT.ORDER_TYPE[0]]: 1, [Shared.VARBIT.ORDER_MODIFIER[0]]: Shared.MODIFIER.ALEMBIC,
    [Shared.VARBIT.ORDER_TYPE[1]]: 4, [Shared.VARBIT.ORDER_MODIFIER[1]]: Shared.MODIFIER.RETORT,
    [Shared.VARBIT.ORDER_TYPE[2]]: 1, [Shared.VARBIT.ORDER_MODIFIER[2]]: Shared.MODIFIER.AGITATOR,
  };
  const player = fakePlayer({
    vars,
    items: [finished(1, Shared.MODIFIER.AGITATOR), finished(4, Shared.MODIFIER.ALEMBIC), finished(1, Shared.MODIFIER.ALEMBIC)],
  });
  const chosen = Orders.choose(player);
  assert.deepEqual(chosen.map((deposit) => deposit.slot), [0, 2]);
  assert.ok(chosen.every((deposit) => deposit.ordered));

  const wrong = fakePlayer({ vars, items: [null, finished(7, Shared.MODIFIER.RETORT), finished(4, Shared.MODIFIER.ALEMBIC)] });
  const unordered = Orders.choose(wrong);
  assert.equal(unordered.length, 1);
  assert.equal(unordered[0].slot, 1);
  assert.equal(unordered[0].ordered, false);
});

test('the resin text over the belt matches the capture', () => {
  assert.equal(Orders.chatterText({ mox: 10, aga: 0, lye: 0 }), '<col=389cff>+10 Mox</col>');
  assert.equal(Orders.chatterText({ mox: 0, aga: 672, lye: 224 }), '   <col=11ff00>+672 Aga</col>   <col=ff242f>+224 Lye</col>');
  assert.equal(Orders.chatterText({ mox: 448, aga: 0, lye: 560 }), '<col=389cff>+448 Mox</col>   <col=ff242f>+560 Lye</col>');
});

/** Exercise the shared reward shop with actual cache rows and a native inventory. */
function omnishopHarness(shop = 'forestry_shop') {
  const core = PluginManager.getCoreApi();
  const events = new Map(), buttons = new Map();
  const api = {
    core,
    onCustomEvent(name, fn) { const list = events.get(name) ?? []; list.push(fn); events.set(name, list); },
    emitCustomEvent(name, event) { for (const fn of events.get(name) ?? []) fn(event); },
    onInterfaceActionButton(ids, fn) { for (const id of [ids].flat()) buttons.set(id, fn); },
  };
  require('../plugins/interface/Omnishop.plugin').register(api);
  const messages = [], scripts = [], attributes = new Map(), varps = new Map();
  let interfaceId = -1;
  const sender = new Proxy({}, { get: (_, key) => (...args) => {
    if (key === 'getVarp') return varps.get(args[0]) ?? 0;
    if (key === 'sendConfig') varps.set(args[0], args[1]);
    if (key === 'sendInterfaceScript') scripts.push(args);
    return sender;
  } });
  const player = {
    getUsername: () => 'Omnishop tester', getInterfaceId: () => interfaceId,
    setInterfaceId: (id) => { interfaceId = id; }, getPacketSender: () => sender,
    getAttribute: (key) => attributes.get(key), setAttribute: (key, value) => attributes.set(key, value),
    getEquipment: () => ({ contains: () => false }), getBanks: () => [],
    sendMessage: (text) => messages.push(text),
  };
  const inventory = new core.Inventory(player);
  player.getInventory = () => inventory;
  const shopRow = core.CacheDefinitions.getDbRow(core.CacheDefinitions.getDbRowId(shop));
  const stock = shopRow.column(core.CacheDefinitions.getDbColumn(shopRow.tableId, 'omnishop_shop_stock'));
  const click = (name, fields) => {
    const buttonId = core.CacheDefinitions.getComponentId(name);
    buttons.get(buttonId)({ player, buttonId, handled: false, ...fields });
  };
  api.emitCustomEvent('omnishop:open', { player, shop, handled: false });
  return {
    inventory, player, messages, scripts, api, core,
    buy(row, op = 2) {
      const index = stock.indexOf(core.CacheDefinitions.getDbRowId(row));
      assert.ok(index >= 0, row);
      click('omnishop_main:list', { slot: index * 12, action: op });
    },
    sell(id) { click('omnishop_side:items', { slot: inventory.getSlotForItemId(id), action: 2 }); },
    selectSide(id) { click('omnishop_side:items', { slot: inventory.getSlotForItemId(id), action: 1 }); },
  };
}

test('native Forestry free kits and ten-voucher bundles use cache transaction amounts', () => {
  const h = omnishopHarness();
  h.buy('forestry_shop_stock_0');
  assert.equal(h.inventory.getAmount(28136), 1, 'the kit is free without coins');
  h.inventory.adds(28134, 750);
  h.buy('forestry_shop_stock_20', 3);
  assert.equal(h.inventory.getAmount(28628), 50, 'Buy-5 buys five ten-voucher bundles');
  assert.equal(h.inventory.getAmount(28134), 0);
});

test('native Forestry stock overrides price eggs at 75000 bark and refund 250', () => {
  for (const [row, itemId] of [['forestry_shop_stock_25', 28663], ['forestry_shop_stock_26', 28626]]) {
    const h = omnishopHarness();
    h.inventory.adds(28134, 74999);
    h.buy(row);
    assert.equal(h.inventory.getAmount(itemId), 0, 'short purchases take nothing');
    assert.equal(h.inventory.getAmount(28134), 74999);
    h.inventory.adds(28134, 1);
    h.buy(row);
    assert.equal(h.inventory.getAmount(itemId), 1);
    assert.equal(h.inventory.getAmount(28134), 0);
    h.sell(itemId);
    assert.equal(h.inventory.getAmount(itemId), 0);
    assert.equal(h.inventory.getAmount(28134), 250, 'stock modifier is clamped to 10% by native cost calculation');
  }
});

test('native Forestry sell-only drops cannot be bought and refund the shop 80% rate', () => {
  for (const [row, itemId, refund] of [
    ['forestry_shop_stock_24', 28624, 5],
    ['forestry_shop_stock_28', 28655, 150],
    ['forestry_shop_stock_29', 28674, 25],
  ]) {
    const h = omnishopHarness();
    h.inventory.adds(28134, 1000);
    h.buy(row);
    assert.equal(h.inventory.getAmount(itemId), 0, 'forged buy op on sell-only stock is ignored');
    assert.equal(h.inventory.getAmount(28134), 1000);
    h.inventory.adds(itemId, 1);
    h.sell(itemId);
    assert.equal(h.inventory.getAmount(itemId), 0);
    assert.equal(h.inventory.getAmount(28134), 1000 + refund);
  }
});

test('shared purchases account for paid inventory slots and refuse overflowing reward stacks', () => {
  const h = omnishopHarness();
  h.inventory.adds(28134, 150);
  while (h.inventory.getFreeSlots()) h.inventory.adds(1351, 1);
  h.buy('forestry_shop_stock_20');
  assert.equal(h.inventory.getAmount(28134), 0, 'spending the entire bark stack makes room');
  assert.equal(h.inventory.getAmount(28628), 10);
  h.inventory.delete(1351, 1);
  h.inventory.adds(28134, 150);
  h.inventory.delete(28628, 10);
  h.inventory.adds(28628, 2147483640);
  h.buy('forestry_shop_stock_20');
  assert.equal(h.inventory.getAmount(28134), 150, 'overflow refuses before payment');
  assert.equal(h.inventory.getAmount(28628), 2147483640);
});

test('shared sales refuse before destroying an item if the refund would overflow', () => {
  const h = omnishopHarness();
  h.inventory.adds(28134, 2147483640);
  h.inventory.adds(28674, 1);
  h.sell(28674);
  assert.equal(h.inventory.getAmount(28674), 1);
  assert.equal(h.inventory.getAmount(28134), 2147483640);
});

test('native Mixology refunds retain the default 40% for each owned currency', () => {
  const h = omnishopHarness('mixology_rewards');
  const balances = new Map();
  h.api.onCustomEvent('omnishop:currency', (event) => {
    event.balance = balances.get(event.currency) ?? 0;
    event.set = (value) => balances.set(event.currency, value);
  });
  h.inventory.adds(29978, 1);
  h.sell(29978);
  assert.equal(h.inventory.getAmount(29978), 0);
  for (const [name, expected] of [
    ['omnishop_currency_mixology_mox', 900],
    ['omnishop_currency_mixology_aga', 1120],
    ['omnishop_currency_mixology_lye', 1480],
  ]) assert.equal(balances.get(h.core.CacheDefinitions.getDbRowId(name)), expected, name);
});

test('mixed saved and item currency previews only inventory items actually spent', () => {
  for (const savedOak of [6, 10]) {
    const h = omnishopHarness('forestry_shop_uim');
    const stored = new Map([
      [h.core.CacheDefinitions.getDbRowId('forestry_shop_currency_log_oak'), savedOak],
      [h.core.CacheDefinitions.getDbRowId('forestry_shop_currency_log_willow'), 5],
    ]);
    h.api.onCustomEvent('omnishop:currency', (event) => {
      if (!stored.has(event.currency)) return;
      const saved = stored.get(event.currency);
      event.balance = saved + h.inventory.getAmount(event.itemId);
      event.inventoryCost = (amount) => Math.max(0, amount - saved);
      event.set = (value) => {
        const spent = event.balance - value;
        const fromStorage = Math.min(saved, spent);
        stored.set(event.currency, saved - fromStorage);
        h.inventory.delete(event.itemId, spent - fromStorage);
      };
    });
    h.inventory.adds(28134, 21);
    h.inventory.adds(1522, 4);
    while (h.inventory.getFreeSlots()) h.inventory.adds(1351, 1);
    h.buy('forestry_shop_stock_1');
    const fits = savedOak === 6;
    assert.equal(h.inventory.getAmount(28159), fits ? 1 : 0);
    assert.equal(h.inventory.getAmount(28134), fits ? 1 : 21);
    assert.equal(h.inventory.getAmount(1522), fits ? 0 : 4);
    assert.equal(stored.get(h.core.CacheDefinitions.getDbRowId('forestry_shop_currency_log_oak')), fits ? 0 : 10);
  }
});

test('owner sale checks update the side panel and reject previously offered sales', () => {
  const h = omnishopHarness('forestry_shop_uim');
  let allowed = true;
  h.api.onCustomEvent('omnishop:can-sell', (event) => {
    assert.equal(event.shop, 'forestry_shop_uim');
    assert.equal(event.stock, 'forestry_shop_stock_27');
    assert.equal(event.itemId, 28613);
    event.cancel = !allowed;
  });
  h.inventory.adds(28613, 1);
  h.selectSide(28613);
  assert.equal(h.scripts.findLast(([id]) => id === 7253)[1][4], 1);
  allowed = false;
  h.sell(28613);
  assert.equal(h.inventory.getAmount(28613), 1, 'changing mode invalidates an earlier sale offer');
  assert.equal(h.inventory.getAmount(28134), 0);
  h.selectSide(28613);
  assert.equal(h.scripts.findLast(([id]) => id === 7253)[1][4], -1, 'the side panel hides Sell');
  allowed = true;
  h.sell(28613);
  assert.equal(h.inventory.getAmount(28613), 0);
  assert.equal(h.inventory.getAmount(28134), 2000);
});


/** Real player/items and the station's registered callbacks, with a controlled processing clock.
 * This does not dispatch a client packet or render the NPC headbar. */
function stationWork(t, key = 'alembic') {
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const { PlayerSession } = require('../dist/net/PlayerSession');
  const core = PluginManager.getCoreApi();
  const previousApi = Shared.api();
  const hooks = new Map();
  const itemHooks = [];
  const bars = new Set();
  const sounds = [];
  const xp = [];
  let now = 0;
  let player;
  t.after(() => {
    try {
      if (player) {
        Stations.stop(player);
        core.TaskManager.cancelTasks(player.getIndex());
        player.setRegistered(false);
      }
      assert.equal(bars.size, 0, 'owned progress bars are removed');
    } finally {
      Shared.bind(previousApi);
    }
  });
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true,
    send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  player = new Player(new PlayerSession(channel));
  player.setIndex(1800);
  player.setUsername('mixologystation');
  const station = Stations.STATIONS[key];
  const tile = new core.Location(station.loc.x, station.loc.y - 1, Shared.LAB.z);
  player.setLocation(tile);
  const skills = player.getSkillManager();
  skills.setExperience(core.Skill.HERBLORE, core.SkillManager.getExperienceForLevel(60));
  skills.setMaxLevel(core.Skill.HERBLORE, 60);
  skills.setCurrentLevel(core.Skill.HERBLORE, 60, false);
  assert.equal(Stations.total(player), 25);
  const realAddXp = skills.addExperiences.bind(skills);
  t.mock.method(skills, 'addExperiences', (skill, amount, ...rest) => {
    if (skill === core.Skill.HERBLORE) xp.push(amount);
    return realAddXp(skill, amount, ...rest);
  });
  const sender = player.getPacketSender();
  const realSound = sender.sendSound.bind(sender);
  t.mock.method(sender, 'sendSound', (id, loops, delay, ...rest) => {
    sounds.push({ now, id, loops, delay });
    return realSound(id, loops, delay, ...rest);
  });
  t.mock.method(Shared, 'tick', () => now);
  const api = { ...previousApi, core,
    onObjectInteraction(name, actions) { hooks.set(name, actions); },
    onItemOnObject(handler) { itemHooks.push(handler); },
    spawnNpc() {
      const bar = { showHeadbar() {} };
      bars.add(bar);
      return bar;
    },
    removeNpc(bar) { bars.delete(bar); },
  };
  Shared.bind(api);
  Stations(api);
  Shared.set(player, Shared.VARBIT.MET_SUPERVISOR, 1);
  const potion = Shared.potion(1);
  player.getInventory().add(new core.Item(potion.unfinished, 1), true);
  const event = { player, objectId: station.loc.id,
    location: new core.Location(station.loc.x, station.loc.y, Shared.LAB.z) };
  const action = { alembic: 'Crystalise-potion', retort: 'Concentrate-potion', agitator: 'Homogenise-potion' }[key];
  const interact = () => hooks.get(station.name)[action]({ ...event });
  function start() {
    const itemSlot = player.getInventory().getItems().findIndex(item => item?.getId() === potion.unfinished);
    assert.ok(itemSlot >= 0);
    const use = { ...event, itemId: potion.unfinished, itemSlot, handled: false };
    for (const handler of itemHooks) handler(use);
    assert.equal(use.handled, true, 'real registered item-on-station handler accepted the potion');
    assert.equal(player.getInventory().getAmount(potion.unfinished), 0);
    assert.equal(Shared.get(player, station.potionVarbit), 1);
    assert.equal(Stations.isWorking(player), true);
  }
  function advance(click = false) {
    now++;
    if (click) interact();
    Stations.tick(player, now);
  }
  function leaveAndResume() {
    player.setLocation(new core.Location(tile.getX() + 1, tile.getY(), tile.getZ()));
    advance();
    assert.equal(Stations.isWorking(player), false, 'moving away stops active work');
    assert.equal(Shared.get(player, station.potionVarbit), 1, 'unfinished potion stays in station');
    player.setLocation(tile);
    interact();
    assert.equal(Stations.isWorking(player), true);
  }
  function finish() {
    for (let i = 0; i < 40 && Stations.isWorking(player); i++) advance();
    assert.equal(Stations.isWorking(player), false, 'bounded processing completed');
    assert.equal(Shared.get(player, station.potionVarbit), 0);
    assert.equal(Shared.get(player, station.progressVarbit), 0);
    const carried = player.getInventory().getItems().filter(item => item && item.getId() >= 0 && item.getAmount() > 0);
    assert.equal(carried.length, 1, 'one input becomes exactly one output, without extra items');
    assert.equal(carried[0].getId(), potion.finished);
    assert.equal(carried[0].getAmount(), 1);
    assert.equal(carried[0].getMetaValue(Shared.META.MODIFIER), station.modifier);
    assert.equal(bars.size, 0);
  }
  const cues = () => sounds.filter(sound => sound.id === 2655);
  return { player, station, start, advance, interact, leaveAndResume, finish, xp, cues,
    progress: () => Shared.get(player, station.progressVarbit),
    hit: () => Shared.get(player, station.hitVarbit) };
}

test('alembic: a missed first window rearms after seven active pumps, independently of progress', t => {
  const f = stationWork(t);
  f.start();
  for (let i = 0; i < 4; i++) f.advance();
  assert.deepEqual(f.cues(), [{ now: 4, id: 2655, loops: 1, delay: 30 }]);
  f.advance(); // Leave the existing one-step response window unused.
  f.advance(true); // A late click loses progress and starts the retry count.
  assert.equal(f.progress(), 3, 'late click deducts two from five');
  assert.deepEqual(f.xp, []);
  for (let i = 0; i < 6; i++) f.advance();
  assert.equal(f.cues().length, 1, 'six following pumps cannot open the recovery cue');
  f.advance();
  assert.deepEqual(f.cues().map(sound => [sound.now, sound.delay]), [[4, 30], [13, 30]]);
  assert.deepEqual(f.xp, [], 'the cue itself grants nothing');
  f.advance(true); // The established delayed-cue response phase is unchanged.
  assert.deepEqual(f.xp, [14]);
  assert.equal(f.hit(), 1);
  assert.equal(f.progress(), 20, 'ten progress plus one third of 25 and the ordinary click step');
  f.finish();
  assert.deepEqual(f.xp, [14]);
});

test('alembic: an early click keeps the initial retry target rather than shifting it on every miss', t => {
  const f = stationWork(t);
  f.start();
  f.advance(true); // Failure on active pump one: target pump eight.
  assert.equal(f.progress(), 0);
  f.advance(true); // Another bad click must not postpone the initial target.
  for (let i = 0; i < 5; i++) f.advance();
  assert.deepEqual(f.cues(), []);
  f.advance();
  assert.deepEqual(f.cues().map(sound => sound.now), [8]);
  f.advance(true);
  assert.deepEqual(f.xp, [14]);
  f.finish();
});

test('alembic: leaving and restarting resets pump count without resetting potion progress', t => {
  const f = stationWork(t);
  f.start();
  for (let i = 0; i < 4; i++) f.advance();
  f.advance();
  f.advance(true);
  assert.equal(f.progress(), 3);
  f.leaveAndResume(); // Stop at time seven, retaining three progress.
  assert.equal(f.progress(), 3);
  for (let i = 0; i < 3; i++) f.advance();
  assert.deepEqual(f.cues().map(sound => sound.now), [4]);
  f.advance();
  assert.deepEqual(f.cues().map(sound => sound.now), [4, 11]);
  f.advance(true);
  assert.deepEqual(f.xp, [14]);
  f.finish();
});

test('alembic: a potion keeps its awarded bonus across leaving, restarting and further clicks', t => {
  const f = stationWork(t);
  f.start();
  for (let i = 0; i < 4; i++) f.advance();
  f.advance(true);
  assert.deepEqual(f.xp, [14]);
  assert.equal(f.hit(), 1);
  f.leaveAndResume();
  assert.equal(f.hit(), 1);
  f.advance(true);
  for (let i = 0; i < 8; i++) f.advance();
  assert.equal(f.cues().length, 1, 'a hit potion cannot rearm a cue');
  assert.deepEqual(f.xp, [14], 'no second bonus after resume');
  f.finish();
  assert.deepEqual(f.xp, [14]);
});

test('station controls: retort click XP and potion conservation are unchanged', t => {
  const f = stationWork(t, 'retort');
  f.start();
  f.advance(true);
  assert.equal(f.progress(), 2);
  assert.deepEqual(f.xp, [2]);
  assert.deepEqual(f.cues(), []);
  f.finish();
  assert.deepEqual(f.xp, [2]);
});

test('station controls: agitator retains its two-hit window and literal XP rewards', t => {
  t.mock.method(Math, 'random', () => 0);
  const f = stationWork(t, 'agitator');
  f.start();
  f.advance();
  f.advance();
  assert.deepEqual(f.cues(), [{ now: 2, id: 2655, loops: 1, delay: 0 }]);
  f.advance(true);
  assert.equal(f.progress(), 12);
  f.advance(true);
  assert.equal(f.progress(), 22);
  assert.deepEqual(f.xp, [14, 2]);
  f.finish();
  assert.deepEqual(f.xp, [14, 2]);
});
