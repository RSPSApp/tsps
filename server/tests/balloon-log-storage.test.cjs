// From server/: node --test tests/balloon-log-storage.test.cjs (after yarn build).
//
// The balloons' log storage against the OSRS Wiki (Log_storage) and its transcript: Store with
// its menu and amount, noted logs, the 100 cap, Check and Preferences, and a trip paid from the
// stock (the preference, the choice, the count told after, a route opened, a refund).
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, beforeEach, test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const core = PluginManager.getCoreApi();

let Common, Travel, Storage, Controls, tasks, prompts;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  require('../dist/game/definition/ObjectDefinition').ObjectDefinition.init();
  Common = require('../plugins/world/balloontransport/Common.BalloonTransport');
  Travel = require('../plugins/world/balloontransport/Travel.BalloonTransport');
  Storage = require('../plugins/world/balloontransport/Storage.BalloonTransport');
  Controls = require('../plugins/world/balloontransport/Controls.BalloonTransport');
  let entranaCheck;
  const api = new Proxy({
    core: {
      ...core,
      TaskManager: { submit: (task) => { task.setRunning(true); tasks.push(task); } },
      WorldDefinition: { isMembersWorld: () => true },
    },
    onCustomEvent(name, handler) { if (name === 'entrana:check-items') entranaCheck = handler; },
    emitCustomEvent(name, event) {
      if (name === 'quest:is-complete') event.complete = true;
      if (name === 'entrana:check-items') entranaCheck(event);
    },
    sendMultiChatboxPrompt(player, title, ...pairs) {
      const options = [];
      for (let i = 0; i < pairs.length; i += 2) options.push({ text: pairs[i], pick: pairs[i + 1] });
      prompts.push({ player, title, options });
    },
  }, { get: (target, key) => target[key] ?? (() => {}) });
  require('../plugins/npcs/Entrana.plugin').register(api);
  assert.equal(typeof entranaCheck, 'function');
  Common.init(api);
});

beforeEach(() => {
  tasks = [];
  prompts = [];
});

const loc = (x, y) => new core.Location(x, y, 0);
const id = (key) => Common.ids.objs[key];
const noted = (key) => core.ItemDefinition.forId(id(key)).getNoteId();
const station = (key) => Common.data.stations.find((entry) => entry.key === key);

function fakePlayer({ at = [2938, 3421], items = {} } = {}) {
  let tile = loc(...at);
  const inventory = new Map(Object.entries(items).map(([k, v]) => [Number(k), v]));
  const equipment = Array.from({ length: 14 }, () => new core.Item(-1, 0));
  const player = {
    attributes: {}, varbits: {}, messages: [], boxes: [], amountPrompt: null, amount: null,
    getLocation: () => tile,
    moveTo: (to) => { tile = to; },
    isRegistered: () => true,
    getHitpoints: () => 99,
    getAttribute: (k) => player.attributes[k],
    setAttribute: (k, v) => { player.attributes[k] = v; },
    sendMessage: (m) => player.messages.push(m),
    setEnteredAmountAction: (action) => { player.amount = action; },
    getSkillManager: () => ({ getMaxLevel: () => 99, getCurrentLevel: () => 99, addExperience() {} }),
    getInventory: () => ({
      getAmount: (item) => inventory.get(item) ?? 0,
      delete: (item, n) => inventory.set(item, (inventory.get(item) ?? 0) - n),
      adds: (item, n) => inventory.set(item, (inventory.get(item) ?? 0) + n),
      getItems: () => [...inventory].filter(([, n]) => n > 0).map(([item, n]) => new core.Item(item, n)),
      getValidItems: () => [...inventory].filter(([, n]) => n > 0).map(([item, n]) => new core.Item(item, n)),
      refreshItems() {},
    }),
    inventory,
    getEquipment: () => ({ get: (slot) => equipment[slot], getItems: () => equipment, getValidItems: () => equipment.filter(item => item.getId() > 0 && item.getAmount() > 0) }),
    getMovementQueue: () => ({ setBlockMovement() { return this; }, reset() { return this; } }),
    getDialogueManager: () => ({
      startDialogues: (chain) => {
        player.lastChain = chain;
        player.boxes.push(chain.getDialogues().get(0)?.getText?.());
      },
      reset() {},
    }),
    getPacketSender: () => ({
      sendEnterAmountPrompt: (title) => { player.amountPrompt = title; },
      getVarbit: (varbit) => player.varbits[varbit] ?? 0,
      getVarp: () => 0,
      sendInterfaceRemoval() {}, sendInterface() {}, sendVarbit() {}, sendSubInterface() {}, closeSubInterface() {},
      sendJingle: (id) => { (player.jingles ??= []).push(id); },
      sendSong: (id) => { (player.songs ??= []).push(id); },
      sendTypedMessage: (type, line) => player.messages.push(line),
      sendInterfaceRawModel() {}, sendInterfaceAnimation: (uid, seq) => { player.journey = seq; },
      sendInterfaceDisplayState() {}, sendInterfacePosition() {}, sendInterfaceAngle() {}, sendSound() {}, sendTabInterface() {},
    }),
    getSpellbook: () => ({ getInterfaceId: () => 218 }),
  };
  return player;
}

function tick(n = 1) {
  for (let i = 0; i < n; i++) {
    const due = tasks;
    tasks = [];
    for (const task of due) if (task.tick()) tasks.push(task);
  }
}

const lastPrompt = () => prompts.at(-1);
const choose = (text) => lastPrompt().options.find((option) => option.text === text).pick();

test('Store: the carried types, the amount asked for more than one, noted logs too', () => {
  const player = fakePlayer({ items: { [id('logs')]: 1, [noted('oak')]: 30, [id('oak')]: 2 } });
  Storage.store({ player });
  assert.equal(lastPrompt().title, 'Which of your logs would you like to store?');
  assert.deepEqual(lastPrompt().options.map((option) => option.text), ['Logs', 'Oak logs']);
  choose('Logs');
  assert.equal(player.amountPrompt, null, 'one log: no amount asked');
  assert.equal(player.boxes.at(-1), 'You put the Logs in the crate. You now have 1 stored.');
  Storage.store({ player });
  choose('Oak logs');
  assert.equal(player.amountPrompt, 'How many logs would you like to store?');
  player.amount.execute(25);
  assert.equal(player.boxes.at(-1), 'You put the Oak logs in the crate. You now have 25 stored.');
  assert.equal(player.inventory.get(id('oak')), 0, 'unnoted first');
  assert.equal(player.inventory.get(noted('oak')), 7);
  assert.equal(Storage.stored(player, 'oak'), 25);
});

test('Store with no logs, and a full type, as the transcript says; 100 of each at most', () => {
  const empty = fakePlayer();
  Storage.store({ player: empty });
  assert.equal(empty.messages.at(-1), 'You have no logs that you are able to store right now.');
  const player = fakePlayer({ items: { [noted('willow')]: 150 } });
  Storage.storeType(player, 'willow');
  player.amount.execute(150);
  assert.equal(Storage.stored(player, 'willow'), 100);
  assert.equal(player.inventory.get(noted('willow')), 50);
  Storage.storeType(player, 'willow');
  assert.equal(player.messages.at(-1), 'You have no room for any more logs of that type.');
});

test('logs used on the crate store that type; other items, a bush and other objects are left alone', () => {
  // Taverley's crate is the multiloc 31574: a bush until zep_multi_piccard is set.
  const TAVERLEY_CRATE = 31574;
  const piccard = core.CacheDefinitions.getVarbitId('zep_multi_piccard');
  const player = fakePlayer({ items: { [noted('yew')]: 3 } });
  assert.equal(Storage.useOnStorage({ player, objectId: TAVERLEY_CRATE, itemId: noted('yew') }), false, 'still a bush');
  player.varbits[piccard] = 1;
  const event = { player, objectId: TAVERLEY_CRATE, itemId: noted('yew'), handled: false };
  assert.equal(Storage.useOnStorage(event), true);
  player.amount.execute(3);
  assert.equal(Storage.stored(player, 'yew'), 3);
  assert.equal(Storage.useOnStorage({ player, objectId: TAVERLEY_CRATE, itemId: 995 }), false);
  assert.equal(Storage.useOnStorage({ player, objectId: 9025, itemId: id('yew') }), false);
});

test('an amount answered away from the stations stores nothing', () => {
  const player = fakePlayer({ items: { [id('oak')]: 5 } });
  Storage.storeType(player, 'oak');
  player.moveTo(loc(3200, 3200));
  player.amount.execute(5);
  assert.equal(Storage.stored(player, 'oak'), 0);
  assert.equal(player.inventory.get(id('oak')), 5);
});

test('noted logs fill the crate but do not pay a trip', () => {
  const player = fakePlayer({ items: { [noted('logs')]: 5 } });
  assert.equal(Storage.canPay(player, station('entrana'), 1), false);
});

test('the choice of logs checks the trip again: walked off, nothing flies', () => {
  const player = fakePlayer({ items: { [id('logs')]: 2 } });
  player.attributes[Storage.STORED_ATTRIBUTE] = { logs: 2 };
  Travel.travel(player, station('taverley'), station('entrana'));
  player.lastChain.getDialogues().get(1).action.execute();
  assert.equal(lastPrompt().title, 'Which logs would you like to use?');
  player.moveTo(loc(3200, 3200));
  choose('Use the logs in storage.');
  tick(4);
  assert.equal(Storage.stored(player, 'logs'), 2, 'not paid');
  assert.notDeepEqual([player.getLocation().getX(), player.getLocation().getY()], station('entrana').land);
});

test('Check gives the five counts; Preferences sets which logs a trip takes', () => {
  const player = fakePlayer();
  player.attributes[Storage.STORED_ATTRIBUTE] = { logs: 4, magic: 2 };
  Storage.check({ player });
  assert.equal(player.boxes.at(-1), 'This crate currently contains 4 logs, 0 oak logs, 0 willow logs, 0 yew logs and 2 magic logs.');
  Storage.preferences({ player });
  assert.match(player.boxes.at(-1), /^When you travel with logs in storage as well as your inventory/);
  player.lastChain.getDialogues().get(1).action.execute();
  assert.equal(lastPrompt().title, 'Which logs would you like to use up first?');
  choose('Take logs from storage first.');
  assert.equal(player.attributes[Storage.PREFERENCE_ATTRIBUTE], 'storage');
});

test('a trip paid from storage: no log carried, the count told on landing', () => {
  const player = fakePlayer();
  player.attributes[Storage.STORED_ATTRIBUTE] = { logs: 5 };
  assert.equal(Travel.travel(player, station('taverley'), station('entrana')), true);
  player.lastChain.getDialogues().get(1).action.execute();
  tick(4);
  assert.deepEqual([player.getLocation().getX(), player.getLocation().getY()], station('entrana').land);
  assert.equal(Storage.stored(player, 'logs'), 4);
  assert.ok(player.messages.includes('You have 4 sets of Logs left in storage.'), 'recorded');
});

test('"ask" with logs in both offers the choice; preferring storage does not ask', () => {
  const asks = fakePlayer({ items: { [id('logs')]: 2 } });
  asks.attributes[Storage.STORED_ATTRIBUTE] = { logs: 2 };
  let flown = null;
  Storage.chooseSource(asks, station('taverley'), 1, (source) => { flown = source; });
  assert.equal(lastPrompt().title, 'Which logs would you like to use?');
  choose('Use the logs in my inventory.');
  assert.equal(flown, Storage.INVENTORY);
  const prefers = fakePlayer({ items: { [id('logs')]: 2 } });
  prefers.attributes[Storage.STORED_ATTRIBUTE] = { logs: 2 };
  prefers.attributes[Storage.PREFERENCE_ATTRIBUTE] = 'storage';
  const before = prompts.length;
  Storage.chooseSource(prefers, station('taverley'), 1, (source) => { flown = source; });
  assert.equal(prompts.length, before);
  assert.equal(flown, Storage.STORAGE);
});

test('a route opened from Entrana is paid from stored logs at take-off; a trip that does not happen refunds the stock', () => {
  const player = fakePlayer({ at: [2808, 3354] });
  player.attributes[Storage.STORED_ATTRIBUTE] = { willow: 12 };
  Travel.travel(player, station('entrana'), station('varrock'));
  assert.equal(player.boxes.at(-1), 'You board the balloon.');
  player.lastChain.getDialogues().get(1).action.execute();
  assert.equal(Storage.stored(player, 'willow'), 2, 'paid from the crate at take-off');
  assert.equal(Controls.inFlight(player), true, 'the controls fly the route open');

  const moved = fakePlayer();
  moved.attributes[Storage.STORED_ATTRIBUTE] = { oak: 3 };
  moved.attributes[Common.ROUTES_ATTRIBUTE] = station('craft').bit;
  Travel.fly(moved, station('craft'), 1, null, Storage.STORAGE);
  assert.equal(Storage.stored(moved, 'oak'), 2);
  moved.moveTo(loc(3200, 3200));
  tick(4);
  assert.equal(Storage.stored(moved, 'oak'), 3, 'back in the crate');
});
