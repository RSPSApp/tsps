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

/** A handler by the function the plugin registers, so an unregistered one fails here instead of in game. */
const handlerFor = (name) => {
  const index = actions.indexOf(Pennant._test[name]);
  assert.ok(index >= 0, `${name} is registered`);
  return actions[index];
};
const missingStep = () => handlerFor('onAction');
const tradeHandler = (event) => handlerFor('doTrade')(event);

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
  assert.equal(actions.length, 3, 'the missing-step, offer and trade handlers');
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

test('the missing step shows the transcript\'s seed menu while a seed is held', () => {
  const p = player([TOOL_SEED, 1]);
  const event = { player: p, stepId: '-N8YQe' };
  missingStep()(event);
  assert.equal(event.handled, true);
  // The Wiki's own menu: "Offer <seed>." and "Cancel.", nothing invented.
  const menu = event.steps[0];
  assert.equal(menu.type, 'choice');
  assert.equal(menu.prompt, 'Select an option');
  assert.deepEqual(menu.options.map((option) => option.text), ['Offer Crystal tool seed.', 'Cancel.']);
  assert.deepEqual(menu.options[0].steps[0], { type: 'action', action: 'pennant-offer', seed: 'CRYSTAL_TOOL_SEED' });
  assert.equal(menu.options[1].steps[0].type, 'end', 'Cancel ends the conversation');

  // With no seed, the transcript's own decline line, then the end.
  const bare = { player: player(), stepId: 'jmiq6v' };
  missingStep()(bare);
  assert.equal(bare.handled, true);
  assert.deepEqual(bare.steps, [
    { player: "Actually... I don't think I've got any crystal seeds to trade, right now." },
    { type: 'end' },
  ]);
});

test('offering a seed shows the transcript\'s item box and Yes / don\'t ask again / No confirm', () => {
  const p = player([ARMOUR_SEED, 1]);
  const offer = { player: p, action: 'pennant-offer', seed: 'CRYSTAL_ARMOUR_SEED' };
  // Through the registered handlers, as the dialogue runtime calls them: the missing-step one ignores
  // this action and the offer handler (which register must attach) plays the box and the confirm.
  for (const handler of actions) handler(offer);
  assert.equal(offer.handled, true, 'the offer handler is registered');
  assert.deepEqual(offer.steps[0].box, { items: [ACORN] });
  assert.match(offer.steps[0].text, /^You are about to trade 1 x Crystal armour seed for 1 x Crystal acorn\.$/);
  const confirm = offer.steps[1];
  assert.equal(confirm.type, 'choice');
  assert.equal(confirm.prompt, 'Are you sure you wish to continue?');
  assert.deepEqual(confirm.options.map((option) => option.text), ['Yes.', "Yes, and don't ask again.", 'No.']);
  assert.deepEqual(confirm.options[0].steps[0], { type: 'action', action: 'pennant-trade', seed: 'CRYSTAL_ARMOUR_SEED' });
  assert.deepEqual(confirm.options[1].steps[0], { type: 'action', action: 'pennant-trade', seed: 'CRYSTAL_ARMOUR_SEED' });
  assert.equal(confirm.options[2].steps[0].type, 'end');
});

test('the runtime passes the action step itself, so the seed is read off event.step', () => {
  const p = player([WEAPON_SEED, 1]);
  const offer = { player: p, action: 'pennant-offer', step: { type: 'action', action: 'pennant-offer', seed: 'CRYSTAL_WEAPON_SEED' } };
  require('../plugins/npcs/Pennant.plugin')._test.offer(offer);
  assert.equal(offer.handled, true);
  assert.match(offer.steps[0].text, /Crystal weapon seed/);
  const trade = { player: p, action: 'pennant-trade', step: { type: 'action', action: 'pennant-trade', seed: 'CRYSTAL_WEAPON_SEED' } };
  tradeHandler(trade);
  assert.equal(trade.handled, true);
  assert.equal(p.items.get(WEAPON_SEED), 0, 'the weapon seed leaves the pack');
  assert.equal(p.items.get(ACORN), 1);
  assert.deepEqual(emitted.at(-1), { name: 'pennant:crystal-acorn', payload: { player: p, itemId: ACORN } });
});

test('the trade takes the chosen seed and gives the acorn, crediting pennant:crystal-acorn', () => {
  const p = player([ARMOUR_SEED, 1]);
  const event = { player: p, action: 'pennant-trade', seed: 'CRYSTAL_ARMOUR_SEED' };
  tradeHandler(event);
  assert.equal(event.handled, true);
  assert.equal(p.items.get(ARMOUR_SEED), 0, 'the seed leaves the pack');
  assert.equal(p.items.get(ACORN), 1, 'the acorn lands');
  assert.deepEqual(emitted.at(-1), { name: 'pennant:crystal-acorn', payload: { player: p, itemId: ACORN } });
});

test('a seed gone or a full pack refuses the trade without crediting it', () => {
  const before = emitted.length;
  // The seed left the pack while the confirm was open: no line (the transcript has none) and no acorn.
  const bare = { player: player(), action: 'pennant-trade', seed: 'CRYSTAL_WEAPON_SEED' };
  tradeHandler(bare);
  assert.deepEqual(bare.player.messages, [], 'no invented refusal line');
  assert.equal(emitted.length, before, 'nothing credited');

  const full = player([WEAPON_SEED, 1], [0, 1]);
  const packed = { player: full, action: 'pennant-trade', seed: 'CRYSTAL_WEAPON_SEED' };
  tradeHandler(packed);
  assert.match(full.messages.join(' '), /enough inventory space/);
  assert.equal(full.items.get(WEAPON_SEED), 1, 'a packed pack keeps the seed');
  assert.equal(full.items.get(ACORN) ?? 0, 0, 'and no acorn is given');
  assert.equal(emitted.length, before, 'still nothing credited');
});

test('a filled missing step is not filled twice (a WeakSet, so finished dialogues are not retained)', () => {
  const p = player([TOOL_SEED, 1]);
  const event = { player: p, stepId: '-N8YQe' };
  missingStep()(event);
  const once = event.steps;
  event.handled = false;
  missingStep()(event);
  assert.equal(event.steps, once, 'the same event is not filled again');
});
