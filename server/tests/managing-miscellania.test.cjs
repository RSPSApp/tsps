// From server/: node --test tests/managing-miscellania.test.cjs (after yarn build).
//
// Daily pay, resource points and gathered quantities against the OSRS Wiki calculator
// (Module:Miscellania_calculator) and its worked examples, plus the kingdom's interface,
// collection and approval rules.
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const plugin = require('../plugins/world/ManagingMiscellania.plugin.js');
const { Common, Interface, Ghrim, Approval } = plugin._test;
const core = PluginManager.getCoreApi();

const MISCELLANIA = { x: 2532, y: 3860 };
const LUMBRIDGE = { x: 3222, y: 3218 };
let events;
let quests;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
});

function install(completed = ['throne_of_miscellania']) {
  events = {};
  quests = new Set(completed);
  const api = new Proxy({
    core,
    persistAttribute: () => {},
    onCustomEvent: (name, fn) => (events[name] ??= []).push(fn),
    emitCustomEvent(name, event) {
      if (name === 'quest:is-complete') { event.complete = quests.has(event.key); return; }
      if (name === 'miscellania:get-approval') { event.value = event.player.favourValue; return; }
      if (name === 'miscellania:set-approval') { event.player.favourValue = event.value; return; }
      if (name === 'treasure-trails:can-receive') { event.allowed = true; return; }
      for (const fn of events[name] ?? []) fn(event);
    },
  }, { get: (target, key) => target[key] ?? (() => {}) });
  plugin.register(api);
}

function player({ at = MISCELLANIA, favour = 127, coins = 0, bankFree = 800 } = {}) {
  const attributes = new Map(), varbits = new Map(), configs = new Map(), strings = new Map(), shown = new Map();
  const bank = new Map(), messages = [], sent = [];
  let inventoryCoins = coins, amountAction = null, interfaceId = -1;
  return {
    favourValue: favour, messages, sent, bank, varbits, configs, strings, shown,
    getAttribute: (k) => attributes.get(k),
    setAttribute: (k, v) => attributes.set(k, v),
    getLocation: () => ({ getX: () => at.x, getY: () => at.y, getZ: () => 0 }),
    sendMessage: (m) => messages.push(m),
    getInterfaceId: () => interfaceId,
    setEnteredAmountAction: (a) => { amountAction = a; },
    enterAmount: (n) => amountAction.execute(n),
    getInventory: () => ({
      getAmount: () => inventoryCoins,
      deleteNumber: (_, n) => { inventoryCoins -= n; },
      addItem: (item) => { inventoryCoins += item.getAmount(); },
      getFreeSlots: () => 28,
    }),
    coins: () => inventoryCoins,
    getCurrentBankTab: () => 0,
    getBank: () => ({
      add: (item) => bank.set(item.getId(), (bank.get(item.getId()) ?? 0) + item.getAmount()),
      getFreeSlots: () => bankFree,
      contains: (id) => bank.has(id),
      getAmount: (id) => bank.get(id) ?? 0,
      getAddableAmount: (item) => bank.has(item.getId()) || bankFree > 0
        ? Math.min(item.getAmount(), 2147483647 - (bank.get(item.getId()) ?? 0)) : 0,
    }),
    getPacketSender: () => ({
      sendVarbit: (id, v) => varbits.set(id, v),
      sendConfig: (id, v) => configs.set(id, v),
      getVarp: (id) => configs.get(id) ?? 0,
      sendString: (text, uid) => strings.set(uid, text),
      sendInterfaceDisplayState: (uid, hidden) => shown.set(uid, !hidden),
      sendInterface: (id) => { interfaceId = id; sent.push(`open ${id}`); },
      sendInterfaceRemoval: () => { interfaceId = -1; sent.push('close'); },
      sendEnterAmountPrompt: () => {},
    }),
  };
}

function kingdom(changes = {}) {
  const fresh = Common.freshKingdom(100);
  return { ...fresh, coffer: 5_000_000, ...changes, workers: { ...fresh.workers, ...changes.workers } };
}

test('one day with full coffers and 100% approval matches the Wiki examples', () => {
  install();
  const base = Common.payDays(kingdom(), 127, 101, false);
  assert.equal(base.kingdom.coffer, 5_000_000 - 50_000);
  assert.equal(base.kingdom.points, 762);
  assert.equal(Common.baseQuantity(10, Common.DATA.inverseCost.maple, base.kingdom.points), 595);

  const rt = Common.payDays(kingdom({ coffer: 7_500_000 }), 127, 101, true);
  assert.equal(rt.kingdom.coffer, 7_500_000 - 75_000);
  assert.equal(rt.kingdom.points, 1143);
  assert.equal(Common.baseQuantity(10, Common.DATA.inverseCost.maple, rt.kingdom.points), 892);
  assert.equal(Common.baseQuantity(10, Common.DATA.inverseCost.coal, rt.kingdom.points), 546);
});

test('approval falls each day towards the floor, faster before Royal Trouble', () => {
  install();
  assert.equal(Common.payDays(kingdom(), 127, 101, false).favour, 127 - Math.ceil((160 - 127) / 15));
  assert.equal(Common.payDays(kingdom(), 127, 101, true).favour, 127 - Math.ceil((131 - 127) / 15));
  assert.equal(Common.payDays(kingdom(), 32, 101, false).favour, 32);
  assert.equal(Common.payDays(kingdom(), 33, 125, false).favour, 32);
});

test('small coffers pay 5 + a tenth, never more than they hold', () => {
  install();
  const day = Common.payDays(kingdom({ coffer: 1000 }), 127, 101, false);
  assert.equal(day.kingdom.coffer, 1000 - 105);
  const empty = Common.payDays(kingdom({ coffer: 0 }), 127, 105, false);
  assert.equal(empty.kingdom.coffer, 0);
  assert.equal(empty.kingdom.points, 0);
});

test('work stops 30 days after the last visit', () => {
  install();
  const away = Common.payDays(kingdom({ lastVisitDay: 100 }), 127, 160, false);
  const thirty = Common.payDays(kingdom({ lastVisitDay: 100 }), 127, 130, false);
  assert.equal(away.kingdom.coffer, thirty.kingdom.coffer);
  assert.equal(away.kingdom.points, thirty.kingdom.points);
  assert.equal(away.kingdom.lastDay, 160);
});

test('resource points stop at the cap', () => {
  install();
  const long = Common.payDays(kingdom({ points: Common.DATA.resourcePointCap - 100 }), 127, 101, false);
  assert.equal(long.kingdom.points, Common.DATA.resourcePointCap);
});

test('catchUp only runs for regents and records visits on the islands only', () => {
  install([]);
  assert.equal(Common.catchUp(player(), 101), null);
  install();
  const away = player({ at: LUMBRIDGE });
  Common.kingdomOf(away, 100);
  assert.equal(Common.catchUp(away, 110).lastVisitDay, 100);
  const here = player();
  Common.kingdomOf(here, 100);
  assert.equal(Common.catchUp(here, 110).lastVisitDay, 110);
  assert.ok(here.favourValue < 127);
});

test('gather pays the base quantities with cooked fish, flax and both hardwoods', () => {
  install();
  const i = Common.items();
  const k = kingdom({ points: 762, cooked: true, flax: true, hardwoodType: Common.HARDWOOD.BOTH,
    workers: { wood: 2, fish: 2, herbs: 2, hardwood: 2, mine: 2 } });
  const out = Common.gather(k, () => 0);
  assert.equal(out.get(i.MAPLE_LOGS), Common.baseQuantity(2, 160, 762));
  assert.equal(out.get(i.COAL), Common.baseQuantity(2, 98, 762));
  const fish = Common.baseQuantity(2, 158, 762);
  assert.equal(out.get(i.TUNA), Math.floor(fish / 2));
  assert.equal(out.get(i.SWORDFISH), Math.floor(fish * 0.15));
  assert.equal(out.has(i.RAW_TUNA), false);
  assert.equal(out.get(i.FLAX), Common.baseQuantity(2, 224, 762));
  const hard = Common.baseQuantity(2, 47, 762);
  assert.equal(out.get(i.MAHOGANY_LOGS), Math.floor(hard / 2));
  assert.equal(out.get(i.TEAK_LOGS), Math.floor(hard / 2));
});

test('rolled tables respect each row maximum', () => {
  install();
  const table = [{ itemId: 1, weight: 1, max: 2 }, { itemId: 2, weight: 1 }];
  const counts = Common.rollTable(table, 50, () => 0);
  assert.equal(counts.get(1), 2);
  assert.equal(counts.has(2), false);
});

test('the interface moves subjects within the limits and hides Etceteria before Royal Trouble', () => {
  install();
  const p = player();
  Common.kingdomOf(p);
  for (let n = 0; n < 12; n++) Interface.move(p, 'wood', true);
  assert.equal(Common.kingdomOf(p).workers.wood, 10);
  Interface.move(p, 'mine', true);
  assert.equal(Common.kingdomOf(p).workers.mine, 0);
  Interface.move(p, 'wood', false);
  Interface.move(p, 'mine', true);
  assert.equal(Common.kingdomOf(p).workers.mine, 1);
  Interface.move(p, 'hardwood', true);
  assert.equal(Common.kingdomOf(p).workers.hardwood, 0);
  assert.equal(p.shown.get(Interface.uid(Interface.COMPONENT.hardwoodPanel)), false);
  assert.equal(p.configs.get(Interface.VARP_IDLE), 0);
});

test('buttons are found by component, and only while the interface is open', () => {
  install();
  const p = player();
  Common.kingdomOf(p);
  assert.equal(Interface.onButton({ player: p, buttonId: Interface.uid(11) }), true);
  assert.equal(Common.kingdomOf(p).workers.mine, 0);
  Interface.open(p);
  assert.equal(Interface.onButton({ player: p, buttonId: Interface.uid(11) }), true);
  assert.equal(Common.kingdomOf(p).workers.mine, 1);
  assert.equal(Interface.onButton({ player: p, buttonId: (390 << 16) | 11 }), false);
});

test("the interface replaces Ghrim's chat: the chatbox closes as it opens", () => {
  install();
  const p = player();
  Common.kingdomOf(p);
  Interface.open(p);
  assert.deepEqual(p.sent, ['close', `open ${Interface.GROUP}`]);
});

test('with nothing to collect, Ghrim describes the effort before the interface opens', () => {
  install();
  const p = player();
  const request = { player: p, npcId: core.NpcIdentifiers.ADVISOR_GHRIM, stepId: Ghrim.ACTION.nothingCollectedManage, handled: false };
  Ghrim.onDialogueAction(request);
  assert.equal(request.handled, true);
  assert.deepEqual(request.steps.map((step) => step.npc ?? step.target), [
    'This is how your subjects are distributing their effort.', 'Managing Miscellania',
  ]);
  assert.equal(p.getInterfaceId(), -1, 'the interface waits for the line');
});

test('deposits stop at the coffer cap and withdrawals return coins', () => {
  install();
  const p = player({ coins: 6_000_000 });
  Common.kingdomOf(p);
  Interface.open(p);
  Interface.deposit(p);
  p.enterAmount(6_000_000);
  assert.equal(Common.kingdomOf(p).coffer, 5_000_000);
  assert.equal(p.coins(), 6_000_000 - (5_000_000 - 10_000));
  Interface.deposit(p);
  p.enterAmount(10);
  assert.ok(p.messages.includes('The coffers cannot hold any more coins.'));
  Interface.withdraw(p);
  p.enterAmount(1_000_000);
  assert.equal(Common.kingdomOf(p).coffer, 4_000_000);
  assert.equal(p.strings.get(Interface.uid(Interface.COMPONENT.coffer)), '4,000,000');
});

test('collection goes to the bank once and waits while the bank is short of space', () => {
  install();
  const today = Common.today();
  const full = player({ bankFree: 0 });
  full.setAttribute(Common.KINGDOM_ATTRIBUTE, kingdom({ points: 762, lastDay: today, lastVisitDay: today, workers: { wood: 5 } }));
  assert.equal(Ghrim.collect(full), false);
  assert.equal(Common.kingdomOf(full).points, 762);

  const p = player();
  p.setAttribute(Common.KINGDOM_ATTRIBUTE, kingdom({ points: 762, lastDay: today, lastVisitDay: today, workers: { wood: 5 } }));
  assert.equal(Ghrim.collect(p), true);
  assert.equal(p.bank.get(Common.items().MAPLE_LOGS), Common.baseQuantity(5, 160, 762));
  assert.equal(Common.kingdomOf(p).points, 0);
  assert.equal(Ghrim.collect(p), false);
});

function bankCollectionPlayer(t, rewards) {
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const p = new Player(null), today = Common.today();
  p.setLocation(new core.Location(MISCELLANIA.x, MISCELLANIA.y));
  p.favourValue = 127;
  t.mock.method(p, 'sendMessage', () => {});
  p.setAttribute(Common.KINGDOM_ATTRIBUTE, kingdom({ points: 762, lastDay: today, lastVisitDay: today }));
  const held = Ghrim.pendingFor(p, Common.kingdomOf(p));
  held.clear();
  for (const [id, count] of rewards) held.set(id, count);
  t.after(() => Ghrim.pending.delete(p));
  return p;
}

test('a capped real bank stack keeps the entire collection and points until it fits', t => {
  install();
  const { Item } = core, { MAPLE_LOGS, COAL } = Common.items();
  const p = bankCollectionPlayer(t, [[COAL, 1], [MAPLE_LOGS, 595]]);
  const bank = p.getBank(0);
  bank.add(new Item(MAPLE_LOGS, 2147483647), false);
  assert.equal(Ghrim.collect(p), false);
  assert.equal(Common.kingdomOf(p).points, 762);
  assert.equal(bank.getAmount(COAL), 0, 'failure must not deliver an earlier resource');
  assert.equal(bank.getAmount(MAPLE_LOGS), 2147483647);
  bank.deleted(MAPLE_LOGS, 595, false);
  assert.equal(Ghrim.collect(p), true);
  assert.equal(bank.getAmount(MAPLE_LOGS), 2147483647);
  assert.equal(bank.getAmount(COAL), 1);
  assert.equal(Common.kingdomOf(p).points, 0);
  assert.equal(Ghrim.collect(p), false);
});

test('collection counts the bank space every real tab shares and ignores free search-result slots', t => {
  install();
  const p = bankCollectionPlayer(t, [[Common.items().MAPLE_LOGS, 595], [Common.items().COAL, 1]]);
  const perTab = core.Bank.MAX_SLOTS / core.Bank.BANK_SEARCH_TAB_INDEX;
  for (let tab = 0; tab < core.Bank.BANK_SEARCH_TAB_INDEX; tab++) {
    p.getBank(tab).setItems(Array.from({ length: perTab }, (_, i) => new core.Item(10000 + tab * perTab + i, 1)));
  }
  assert.ok(Ghrim.spaceShort(p, Ghrim.pendingFor(p, Common.kingdomOf(p))) > 0);
  const spare = p.getBank(1);
  spare.setItem(0, new core.Item(-1, 0));
  assert.equal(Ghrim.collect(p), false, 'two new resources require two slots');
  spare.setItem(1, new core.Item(-1, 0));
  assert.equal(Ghrim.collect(p), true);
  const banked = (id) => [...Array(core.Bank.BANK_SEARCH_TAB_INDEX).keys()].reduce((sum, tab) => sum + p.getBank(tab).getAmount(id), 0);
  assert.equal(banked(Common.items().MAPLE_LOGS), 595);
  assert.equal(banked(Common.items().COAL), 1);
});

test('a changed job or choice rolls the collection again', () => {
  install();
  const today = Common.today();
  const p = player();
  p.setAttribute(Common.KINGDOM_ATTRIBUTE, kingdom({ points: 762, lastDay: today, lastVisitDay: today, workers: { wood: 5 } }));
  const first = Ghrim.pendingFor(p, Common.kingdomOf(p));
  const moved = { ...Common.kingdomOf(p), workers: { ...Common.kingdomOf(p).workers, wood: 0, mine: 5 } };
  const second = Ghrim.pendingFor(p, moved);
  assert.notEqual(first, second);
  assert.equal(second.has(Common.items().COAL), true);
});

test('approval rises from coal, maples and big fish on the islands only', () => {
  install();
  const i = Common.items();
  const today = Common.today();
  const p = player({ favour: 100 });
  p.setAttribute(Common.KINGDOM_ATTRIBUTE, kingdom({ lastDay: today, lastVisitDay: today }));
  Approval.onMined({ player: p, itemId: i.COAL });
  assert.equal(p.favourValue, 101);
  Approval.onChopped({ player: p, logId: i.MAPLE_LOGS }, () => 0.9);
  assert.equal(p.favourValue, 101);
  Approval.onChopped({ player: p, logId: i.MAPLE_LOGS }, () => 0.1);
  assert.equal(p.favourValue, 102);
  Approval.onFished({ player: p, itemId: i.RAW_LOBSTER }, () => 0.1);
  assert.equal(p.favourValue, 103);
  const away = player({ at: LUMBRIDGE, favour: 50 });
  Approval.onMined({ player: away, itemId: i.COAL });
  assert.equal(away.favourValue, 50);
});

test('a regent\'s coal goes to Miner Magnus, who thanks them (rsprox capture 1757)', () => {
  install();
  const i = Common.items();
  const today = Common.today();
  const said = [];
  const magnus = { getDefinition: () => ({ getName: () => 'Miner Magnus' }), forceChat: (text) => said.push(text) };
  const p = Object.assign(player({ favour: 100 }), { getLocalNpcs: () => [magnus] });
  p.setAttribute(Common.KINGDOM_ATTRIBUTE, kingdom({ lastDay: today, lastVisitDay: today }));
  const coal = { player: p, itemId: i.COAL, taker: null };
  Approval.handOverCoal(coal);
  assert.equal(coal.taker, 'Miner Magnus');
  assert.deepEqual(said, ['Thanks!']);
  const logs = { player: p, itemId: i.MAPLE_LOGS, taker: null };
  Approval.handOverCoal(logs);
  assert.equal(logs.taker, null, 'only coal');
  const away = Object.assign(player({ at: LUMBRIDGE }), { getLocalNpcs: () => [] });
  away.setAttribute(Common.KINGDOM_ATTRIBUTE, kingdom({ lastDay: today, lastVisitDay: today }));
  const elsewhere = { player: away, itemId: i.COAL, taker: null };
  Approval.handOverCoal(elsewhere);
  assert.equal(elsewhere.taker, null, 'coal mined off the islands is kept');
});
