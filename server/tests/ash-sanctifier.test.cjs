const assert = require('node:assert/strict');
const { before, test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { Skill } = require('../dist/game/model/Skill');
const { Item } = require('../dist/game/model/Item');
const { Bank } = require('../dist/game/model/container/impl/Bank');
const { ItemOnGroundManager } = require('../dist/game/entity/impl/grounditem/ItemOnGroundManager');
const { ItemIdentifiers: I } = require('../dist/util/ItemIdentifiers');

const events = new Map();
const actions = {};
let charge, condition;
const diaries = new Set();
const api = new Proxy({
  core: PluginManager.getCoreApi(),
  persistAttribute() {},
  onItemAction(name, handlers) { Object.assign(actions, handlers); },
  onItemOnItem(a, b, handler) { charge = handler; },
  onNpcDialogueCondition(handler) { condition = handler; },
  onCustomEvent(name, handler) { events.set(name, [...(events.get(name) ?? []), handler]); },
  emitCustomEvent(name, event) { for (const handler of events.get(name) ?? []) handler(event); },
}, { get: (target, key) => target[key] ?? (() => {}) });
let S;

before(async () => {
  await CachePipeline.initialize(process.cwd());
  require('../plugins/skills/Prayer.plugin').register(api);
  S = require('../plugins/items/AshSanctifier.plugin');
  S.register(api);
  api.onCustomEvent('diary:is-complete', (request) => {
    request.complete = diaries.has(`${request.diary}:${request.tier}`);
  });
});

function player(t, stored = 0, completed = []) {
  diaries.clear();
  for (const diary of completed) diaries.add(diary);
  const p = new Player(null);
  const sender = new Proxy({}, { get: () => () => sender });
  t.mock.method(p, 'getPacketSender', () => sender);
  p.messages = [];
  t.mock.method(p, 'sendMessage', (text) => p.messages.push(text));
  p.setAttribute(S._test.CHARGES_ATTRIBUTE, stored);
  return p;
}
const charges = (p) => p.getAttribute(S._test.CHARGES_ATTRIBUTE);
const TYSS = 7050;
const npc = (name, demon = true) => ({ getCurrentDefinition: () => ({ getName: () => name, hasAttribute: (a) => demon && a === 'demon' }) });
const xp = (p) => p.getSkillManager().getSkills().getExperiences()[Skill.PRAYER.getIndex()];

/** Plays Tyss's claim branch: the first sibling condition answered true wins, as the dialogue runtime does. */
function claim(p) {
  const { NOT_HARD_STEP, FULL_INVENTORY_STEP, NO_SANCTIFIER_STEP, HAS_SANCTIFIER_STEP, HAND_OVER_LINE } = S._test;
  const step = [NOT_HARD_STEP, FULL_INVENTORY_STEP, NO_SANCTIFIER_STEP, HAS_SANCTIFIER_STEP]
    .find((stepId) => condition({ player: p, npcId: TYSS, stepId, text: '' }) === true);
  if (step === NO_SANCTIFIER_STEP) {
    const line = { player: p, npcId: TYSS, text: HAND_OVER_LINE };
    api.emitCustomEvent('npc-dialogue:line', line);
    line.before();
  }
  return step;
}

test('Tyss refuses the sanctifier without the hard Kourend & Kebos diary', t => {
  const p = player(t);
  assert.equal(claim(p), S._test.NOT_HARD_STEP);
  assert.equal(p.getInventory().getAmount(I.ASH_SANCTIFIER), 0);
});

test('Tyss hands it over after the hard diary, once', t => {
  const p = player(t, 0, ['kourend:hard']);
  assert.equal(claim(p), S._test.NO_SANCTIFIER_STEP);
  assert.equal(p.getInventory().getAmount(I.ASH_SANCTIFIER), 1);
  assert.equal(claim(p), S._test.HAS_SANCTIFIER_STEP);
  assert.equal(p.getInventory().getAmount(I.ASH_SANCTIFIER), 1);
});

test('Tyss counts a banked sanctifier and asks for space when the inventory is full', t => {
  const p = player(t, 0, ['kourend:hard']);
  p.getInventory().add(new Item(I.COINS, 1));
  for (let i = 0; p.getInventory().getFreeSlots() > 0; i++) p.getInventory().add(new Item(I.BRONZE_DAGGER, 1));
  assert.equal(claim(p), S._test.FULL_INVENTORY_STEP);
  p.getBank(0).add(new Item(I.ASH_SANCTIFIER, 1), false);
  assert.equal(claim(p), S._test.HAS_SANCTIFIER_STEP);
});

test('7 death runes give 70 charges, and Uncharge returns them', t => {
  const p = player(t);
  p.getInventory().add(new Item(I.ASH_SANCTIFIER, 1));
  p.getInventory().add(new Item(I.DEATH_RUNE, 9));
  charge({ player: p });
  p.getEnteredAmountAction().execute(7);
  assert.equal(charges(p), 70);
  assert.equal(p.getInventory().getAmount(I.DEATH_RUNE), 2);
  assert.match(p.messages.at(-1), /has 70 charges/);
  actions.Uncharge({ player: p });
  assert.equal(charges(p), 0);
  assert.equal(p.getInventory().getAmount(I.DEATH_RUNE), 9);
});

test('destroying it drops the death runes', t => {
  const p = player(t, 35), drops = [];
  t.mock.method(ItemOnGroundManager, 'registers', (owner, item) => drops.push(item));
  api.emitCustomEvent('destroy-item:destroyed', { player: p, itemId: I.ASH_SANCTIFIER, amount: 1 });
  assert.equal(charges(p), 0);
  assert.deepEqual(drops.map(item => [item.getId(), item.getAmount()]), [[I.DEATH_RUNE, 3]]);
});

function kill(p, monster, items) {
  const drops = items.map(([itemId, amount]) => ({ itemId, amount }));
  api.emitCustomEvent('npc-drops:generated', { player: p, npc: monster, npcId: 1, drops });
  return drops;
}

test('a vile-ash drop gives half XP and uses one charge, full XP with the elite diary', t => {
  const p = player(t, 5);
  p.getInventory().add(new Item(I.ASH_SANCTIFIER, 1));
  let before = xp(p);
  const left = kill(p, npc('Lesser demon'), [[I.VILE_ASHES, 1], [I.COINS, 10]]);
  assert.equal(xp(p) - before, 12.5);
  assert.equal(charges(p), 4);
  assert.deepEqual(left.map(d => d.itemId), [I.COINS], 'only the ashes are taken');
  const q = player(t, 5, ['kourend:elite']);
  q.getInventory().add(new Item(I.ASH_SANCTIFIER, 1));
  before = xp(q);
  kill(q, npc('Lesser demon'), [[I.VILE_ASHES, 1]]);
  assert.equal(xp(q) - before, 25);
});

test("Skotizo's ashes, a non-demon's drops, bones and Activity off are left alone", t => {
  const p = player(t, 5);
  p.getInventory().add(new Item(I.ASH_SANCTIFIER, 1));
  assert.equal(kill(p, npc('Skotizo'), [[I.INFERNAL_ASHES, 1]]).length, 1);
  assert.equal(kill(p, npc('Goblin', false), [[I.VILE_ASHES, 1]]).length, 1);
  assert.equal(kill(p, npc('Lesser demon'), [[I.BONES, 1]]).length, 1);
  actions.Activity({ player: p });
  assert.equal(kill(p, npc('Lesser demon'), [[I.VILE_ASHES, 1]]).length, 1);
  assert.equal(charges(p), 5);
  actions.Activity({ player: p });
  assert.equal(kill(p, npc('Lesser demon'), [[I.VILE_ASHES, 1]]).length, 0);
});

test('Configure-Charges sets the charges from the banked death runes and refunds them', t => {
  const p = player(t, 0);
  t.mock.method(Bank, 'isOpen', () => true);
  p.getBank(0).add(new Item(I.ASH_SANCTIFIER, 1), false);
  p.getBank(0).add(new Item(I.DEATH_RUNE, 20), false);
  const item = p.getBank(0).getItems().find(i => i.getId() === I.ASH_SANCTIFIER);
  const event = { player: p, item, tab: 0, slot: 0, op: 9, handled: false };
  api.emitCustomEvent(Bank.ITEM_OP_EVENT, event);
  assert.equal(event.handled, true);
  p.getEnteredAmountAction().execute(150);
  assert.equal(charges(p), 150);
  assert.equal(p.getBank(0).getAmount(I.DEATH_RUNE), 5);
  api.emitCustomEvent(Bank.ITEM_OP_EVENT, { ...event });
  p.getEnteredAmountAction().execute(0);
  assert.equal(charges(p), 0);
  assert.equal(p.getBank(0).getAmount(I.DEATH_RUNE), 20);
  p.messages.length = 0;
  api.emitCustomEvent(Bank.ITEM_OP_EVENT, { ...event });
  p.getEnteredAmountAction().execute(500);
  assert.equal(charges(p), 200, 'bounded by the banked runes');
  assert.match(p.messages.at(-1), /has 200 charges/);
});
