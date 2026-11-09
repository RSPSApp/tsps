// node --test tests/pennant.test.cjs
// Pennant (plugins/npcs/Pennant.plugin.js): the crystal seed -> acorn exchange the Wiki
// transcript leaves as a `missing` step. The plugin answers the transcript's own prose
// conditions from the seeds the player carries, fills the true branches' missing step with
// the trade, and takes the seed for an acorn, which it credits as the league task's own
// "pennant:crystal-acorn" event (not a crystal impling's or the Elven Crystal Chest's acorn).
const assert = require('node:assert/strict');
const { test } = require('node:test');
const Pennant = require('../plugins/npcs/Pennant.plugin');
const dialogues = require('../data/definitions/npc-dialogues.json');

const WEAPON_SEED = 4207, ARMOUR_SEED = 23956, TOOL_SEED = 23953, ACORN = 23661;
const NAMES = new Map([[WEAPON_SEED, 'Crystal weapon seed'], [ARMOUR_SEED, 'Crystal armour seed'], [TOOL_SEED, 'Crystal tool seed'], [ACORN, 'Crystal acorn']]);

const conditions = [];
const actions = [];
const emitted = [];
Pennant.register({
  core: {
    ItemIdentifiers: { CRYSTAL_WEAPON_SEED: WEAPON_SEED, CRYSTAL_ARMOUR_SEED: ARMOUR_SEED, CRYSTAL_TOOL_SEED: TOOL_SEED, CRYSTAL_ACORN: ACORN },
    CacheDefinitions: { getItem: (id) => ({ name: NAMES.get(id) ?? `item ${id}` }) },
    Item: class { constructor(id, amount = 1) { this.id = id; this.amount = amount; } getAmount() { return this.amount; } },
  },
  onNpcDialogueCondition: (handler) => conditions.push(handler),
  onCustomEvent: (_name, handler) => actions.push(handler),
  emitCustomEvent: (name, payload) => emitted.push({ name, payload }),
});

function player(...held) {
  const items = new Map(held.map(([id, n]) => [id, n]));
  return {
    messages: [],
    items,
    sendMessage(m) { this.messages.push(m); },
    getInventory: () => ({
      getAmount: (id) => items.get(id) ?? 0,
      getAddableAmount: (item) => items.has(0) ? 0 : 1,
      deleteNumber: (id, n) => items.set(id, (items.get(id) ?? 0) - n),
      adds: (id, n) => items.set(id, (items.get(id) ?? 0) + n),
    }),
  };
}

test('the plugin answers the transcript\'s own condition ids and fills its missing steps', () => {
  const text = JSON.stringify(dialogues['Pennant']);
  for (const t of ['ALgg5h', 'seWDU3', '-X_0_Y', 'Yg10Dx', '-N8YQe', 'jmiq6v']) assert.ok(text.includes(t), t);
  assert.equal(conditions.length, 1, 'one condition handler');
  assert.equal(actions.length, 2, 'the action handler and the trade handler');
});

test('conditions answer by the seed carried', () => {
  const ask = (stepId, p) => conditions[0]({ player: p, stepId });
  const none = player();
  const weapon = player([WEAPON_SEED, 1]);
  assert.equal(ask('ALgg5h', none), true, 'no seed: the "does not have" branch');
  assert.equal(ask('seWDU3', none), false, 'no seed: not the "has" branch');
  assert.equal(ask('ALgg5h', weapon), false);
  assert.equal(ask('seWDU3', weapon), true);
  assert.equal(ask('not-a-pennant-step', weapon), null, 'an unrelated step is left alone');
});

test('the missing step is filled with the trade only while a seed is held', () => {
  const p = player([TOOL_SEED, 1]);
  const event = { player: p, stepId: '-N8YQe' };
  actions[0](event);
  assert.equal(event.handled, true);
  assert.match(event.steps[0].text, /Crystal tool seed for 1 x Crystal acorn/);
  assert.equal(event.steps[1].type, 'choice');
  const tradeOption = event.steps[1].options[0].steps[0];
  assert.deepEqual({ action: tradeOption.action, seed: tradeOption.seed }, { action: 'pennant-trade', seed: 'CRYSTAL_TOOL_SEED' });

  const bare = { player: player(), stepId: 'jmiq6v' };
  actions[0](bare);
  assert.equal(bare.handled, undefined, 'no seed, no trade');
});

test('the trade takes the chosen seed and gives the acorn, crediting pennant:crystal-acorn', () => {
  const p = player([ARMOUR_SEED, 1]);
  const event = { player: p, action: 'pennant-trade', seed: 'CRYSTAL_ARMOUR_SEED' };
  actions[1](event);
  assert.equal(event.handled, true);
  assert.equal(p.items.get(ARMOUR_SEED), 0, 'the seed leaves the pack');
  assert.equal(p.items.get(ACORN), 1, 'the acorn lands');
  assert.deepEqual(emitted.at(-1), { name: 'pennant:crystal-acorn', payload: { player: p, itemId: ACORN } });
});

test('no seed and no room refuse the trade without crediting it', () => {
  const before = emitted.length;
  const bare = { player: player(), action: 'pennant-trade', seed: 'CRYSTAL_WEAPON_SEED' };
  actions[1](bare);
  assert.match(bare.player.messages.join(' '), /don't have a suitable crystal seed/);
  assert.equal(emitted.length, before, 'nothing credited');

  const full = player([WEAPON_SEED, 1], [0, 1]);
  const packed = { player: full, action: 'pennant-trade', seed: 'CRYSTAL_WEAPON_SEED' };
  actions[1](packed);
  assert.match(full.messages.join(' '), /enough room for the crystal acorn/);
  assert.equal(full.items.get(WEAPON_SEED), 1, 'a packed pack keeps the seed');
  assert.equal(emitted.length, before, 'still nothing credited');
});
