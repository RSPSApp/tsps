// Run from server after yarn build: node --test tests/alfred-grimhands-barcrawl.test.cjs
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const path = require('node:path');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { getRegisteredQuests } = require('../plugins/quests/QuestRuntime');
const core = PluginManager.getCoreApi();
const register = require('../plugins/quests/quests/AlfredGrimhandsBarcrawl.Quest');

before(async () => {
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize(path.resolve(__dirname, '..'));
});

function player(items = []) {
  const attributes = new Map(), inventoryItems = new Map(items), bank = new Map(), messages = [], varps = new Map(), varbits = new Map();
  const inventory = {
    getAmount: (id) => inventoryItems.get(id) || 0,
    adds: (id, amount) => inventoryItems.set(id, (inventoryItems.get(id) || 0) + amount),
    deleteNumber: (id, amount) => inventoryItems.set(id, Math.max(0, (inventoryItems.get(id) || 0) - amount)),
    isFull: () => inventoryItems.size >= 28,
    getFreeSlots: () => Math.max(0, 28 - inventoryItems.size),
    getItems: () => [], setItem() {}, refreshItems() {},
  };
  const packet = {
    sendConfig: (id, value) => { varps.set(id, value); return packet; },
    sendVarbit: (id, value) => { varbits.set(id, value); return packet; },
    getVarbit: (id) => varbits.get(id) ?? 0,
    sendJingle() { return packet; }, sendInterface() { return packet; }, sendInterfaceRemoval() { return packet; },
    sendString() { return packet; }, sendSubInterface() { return packet; }, sendInterfaceFlagsRange() { return packet; },
    sendInterfaceScript() { return packet; }, sendItemOnInterfaces() { return packet; }, sendChatboxInterface() { return packet; },
    sendClientScript() { return packet; }, closeSubInterface() { return packet; }, sendInterfaceRemoval() { return packet; },
  };
  let p;
  p = {
    attributes, inventoryItems, bank, messages, varps, varbits,
    getAttribute: (key) => attributes.get(key), setAttribute: (key, value) => attributes.set(key, value),
    getInventory: () => inventory, getBanks: () => [{ getAmount: (id) => bank.get(id) || 0 }],
    getPacketSender: () => packet, sendMessage: (message) => messages.push(message),
    getLocation: () => new core.Location(2544, 3570, 0),
    getDialogueManager: () => ({ reset() {}, startDialogues() {}, isActive: () => false }),
    getSkillManager: () => ({ getMaxLevel: () => 1, getCurrentLevel: () => 1 }),
    isRegistered: () => true, getUsername: () => 'BarcrawlTester', getDisplayName: () => 'BarcrawlTester',
  };
  return p;
}

function setup() {
  const custom = new Map(), hooks = new Map();
  const api = new Proxy({
    core,
    persistAttribute() {},
    onCustomEvent: (event, fn) => { if (!custom.has(event)) custom.set(event, []); custom.get(event).push(fn); },
    emitCustomEvent: (event, payload) => { for (const fn of custom.get(event) || []) fn(payload); },
    onNpcInteraction: (name, actions) => { if (typeof name === 'function') hooks.set('*', name); else for (const [action, fn] of Object.entries(actions)) hooks.set(`${name}:${action}`, fn); },
  }, {
    get(target, prop) {
      if (prop in target) return target[prop];
      return (...args) => {
        const fn = args.findLast((arg) => typeof arg === 'function')
          || Object.values(args.at(-1) || {}).find((value) => typeof value === 'function');
        if (fn) { if (!custom.has(prop)) custom.set(prop, []); custom.get(prop).push(fn); }
      };
    },
  });
  const internals = register(api);
  const quest = getRegisteredQuests().findLast((entry) => entry.key === 'alfred-grimhands-barcrawl');
  const emit = (event, payload) => { for (const fn of custom.get(event) || []) fn(payload); };
  return { api, quest, internals, hooks, emit };
}

test('guard start needs a free slot and grants the card with native progress vars', () => {
  const { quest, internals } = setup();
  const full = player(Array.from({ length: 28 }, (_, index) => [1000 + index, 1]));
  assert.equal(internals.startCrawl(full), false);
  assert.equal(full.inventoryItems.get(core.ItemIdentifiers.BARCRAWL_CARD), undefined);
  assert.equal(quest.getStage(full), 0);

  const p = player();
  assert.equal(internals.startCrawl(p), true);
  assert.equal(p.inventoryItems.get(core.ItemIdentifiers.BARCRAWL_CARD), 1);
  assert.equal(quest.getStage(p), 1);
  assert.equal(p.varps.get(77), 1);
  assert.equal(p.varbits.get(13714), 1);
});

test('all ten bars charge their canonical price, sign once, and completion hands the card in', () => {
  const { quest, internals } = setup();
  const p = player([[core.ItemIdentifiers.COINS, 208]]);
  internals.startCrawl(p);

  for (const bar of internals.BARS) {
    const event = { player: p, action: 'barcrawl:drink', stepId: `barcrawl:drink:${bar.key}`, handled: false };
    internals.handleAction(event);
    assert.equal(event.handled, true, bar.key);
    assert.equal(internals.isSigned(p, bar), true, bar.key);
  }
  assert.equal(internals.signedCount(p), 10);
  assert.equal(p.inventoryItems.get(core.ItemIdentifiers.COINS), 0);

  p.inventoryItems.set(core.ItemIdentifiers.COINS, 50);
  internals.handleAction({ player: p, action: 'barcrawl:drink', stepId: 'barcrawl:drink:blue-moon', handled: false });
  assert.equal(p.inventoryItems.get(core.ItemIdentifiers.COINS), 50, 'a signed bar cannot be drunk again');
  p.inventoryItems.delete(core.ItemIdentifiers.COINS);

  const complete = { player: p, action: 'barcrawl:complete', stepId: 'barcrawl:complete', handled: false };
  internals.handleAction(complete);
  assert.equal(complete.handled, true);
  assert.equal(quest.getStage(p), 2);
  assert.equal(p.inventoryItems.get(core.ItemIdentifiers.BARCRAWL_CARD), 0);
  assert.equal(p.varps.get(77), 2);
  assert.equal(p.varbits.get(13714), 2);
});

test('losing the card restarts bar progress only when the guard can hand one back', () => {
  const { internals } = setup();
  const p = player([[core.ItemIdentifiers.COINS, 50]]);
  internals.startCrawl(p);
  const blueMoon = internals.BARS.find((bar) => bar.key === 'blue-moon');
  internals.drinkAt(p, blueMoon);
  assert.equal(internals.isSigned(p, blueMoon), true);
  p.inventoryItems.delete(core.ItemIdentifiers.BARCRAWL_CARD);

  for (let index = 0; index < 28; index++) p.inventoryItems.set(1000 + index, 1);
  assert.equal(internals.restartCrawl(p), false);
  assert.equal(internals.isSigned(p, blueMoon), true, 'a full inventory does not reset progress');
  for (let index = 0; index < 28; index++) p.inventoryItems.delete(1000 + index);

  assert.equal(internals.restartCrawl(p), true);
  assert.equal(internals.signedCount(p), 0);
  assert.equal(p.inventoryItems.get(core.ItemIdentifiers.BARCRAWL_CARD), 1);
});

test('the outpost gate refuses an outsider until the card is handed in', () => {
  const { quest, internals } = setup();
  const p = player([[core.ItemIdentifiers.COINS, 208]]);
  internals.startCrawl(p);
  const request = { player: p, objectId: 2115, location: new core.Location(2545, 3570, 0), handled: false };
  internals.handleGateToggle(request);
  assert.equal(request.handled, true);
  assert.equal(p.messages.at(-1), "You need to complete Alfred Grimhand's Barcrawl to enter.");

  p.getLocation = () => new core.Location(2545, 3570, 0);
  const onTile = { player: p, objectId: 2115, location: new core.Location(2545, 3570, 0), handled: false };
  internals.handleGateToggle(onTile);
  assert.equal(onTile.handled, true, 'the tile the gate click walks onto is still outside');

  const inside = player();
  internals.startCrawl(inside);
  inside.getLocation = () => new core.Location(2546, 3570, 0);
  const leaving = { player: inside, objectId: 2115, location: new core.Location(2545, 3570, 0), handled: false };
  internals.handleGateToggle(leaving);
  assert.equal(leaving.handled, false);

  for (const bar of internals.BARS) internals.drinkAt(p, bar);
  internals.completeCrawl(p);
  assert.equal(quest.getStage(p), 2);
  const after = { player: p, objectId: 2115, location: new core.Location(2545, 3570, 0), handled: false };
  internals.handleGateToggle(after);
  assert.equal(after.handled, false);
});
