// From server/: node --test tests/tzhaar-fire-cape-exchange.test.cjs (no build needed).
//
// TzHaar-Mej-Jal's fire cape exchange (Wiki: TzHaar-Mej-Jal): 8,000 TokKul, or the cape for a 1/200 TzRek-Jad roll.
const assert = require('node:assert/strict');
const { beforeEach, test } = require('node:test');
const Exchange = require('../plugins/minigames/tzhaar/FireCapeExchange.TzhaarFightCaves');

const ids = { FIRE_CAPE: 6570, TOKKUL: 6529, TZREK_JAD: 13225 };
let roll, events;

function player(items = {}) {
  const held = { ...items };
  const p = {
    messages: [],
    sendMessage: (text) => p.messages.push(text),
    held,
    getInventory: () => ({
      contains: (id) => (held[id] ?? 0) > 0,
      delete: (id, n) => { held[id] -= n; },
      adds: (id, n) => { held[id] = (held[id] ?? 0) + n; },
    }),
  };
  return p;
}
const mej = { getName: () => 'TzHaar-Mej-Jal' };

beforeEach(() => {
  roll = 0;
  events = [];
  Exchange.init({
    core: { ItemIdentifiers: ids, NpcIdentifiers: { TZHAAR_MEJ_JAL: 2180 }, Misc: { getRandom: () => roll } },
    emitCustomEvent: (name, event) => events.push([name, event]),
  });
});

test('selling a fire cape swaps it for 8,000 TokKul', () => {
  const p = player({ [ids.FIRE_CAPE]: 1 });
  Exchange.sellCape({ kind: 'message', stepId: 'wS-GnT', definition: mej, player: p });
  assert.equal(p.held[ids.FIRE_CAPE], 0);
  assert.equal(p.held[ids.TOKKUL], 8000);
});

test('selling without the cape ends the talk and pays nothing', () => {
  const p = player();
  const event = { kind: 'message', stepId: 'wS-GnT', definition: mej, player: p };
  Exchange.sellCape(event);
  assert.equal(event.end, true);
  assert.equal(p.held[ids.TOKKUL], undefined);
});

test('the pet bargain takes the cape; a lucky roll awards TzRek-Jad', () => {
  const p = player({ [ids.FIRE_CAPE]: 1 });
  Exchange.bargain({ option: "Yes, I know I won't get my cape back.", definition: mej, player: p });
  assert.equal(p.held[ids.FIRE_CAPE], 0);
  assert.equal(events.filter(([name]) => name === 'pets:award')[0][1].itemId, ids.TZREK_JAD);
  const ask = (text) => Exchange.answerCondition({ player: p, definition: mej, text });
  assert.equal(ask('Upon a successful roll:'), true);
  assert.equal(ask('Upon failing a roll:'), false);
});

test('an unlucky roll still takes the cape and gives no pet', () => {
  roll = 5;
  const p = player({ [ids.FIRE_CAPE]: 1 });
  Exchange.bargain({ option: "Yes, I know I won't get my cape back.", definition: mej, player: p });
  assert.equal(p.held[ids.FIRE_CAPE], 0);
  assert.equal(events.some(([name]) => name === 'pets:award'), false);
  const ask = (text) => Exchange.answerCondition({ player: p, definition: mej, text });
  assert.equal(ask('Upon a successful roll:'), false);
  assert.equal(ask('Upon failing a roll:'), true);
});

test('menu conditions follow the inventory and other NPCs are left alone', () => {
  const withCape = player({ [ids.FIRE_CAPE]: 1 });
  const ask = (p, text, definition = mej) => Exchange.answerCondition({ player: p, definition, text });
  assert.equal(ask(withCape, 'If the player has a firecape in their inventory:'), true);
  assert.equal(ask(withCape, 'If the player does not have a firecape in their inventory:'), false);
  assert.equal(ask(player(), 'If the player has a firecape in their inventory:'), false);
  assert.equal(ask(withCape, 'If the player has a firecape in their inventory:', { getName: () => 'Banker' }), null);
});

test('the Exchange option starts the cape offer, or says there is no cape', () => {
  const p = player({ [ids.FIRE_CAPE]: 1 });
  Exchange.exchange({ player: p, npc: {} });
  const start = events.find(([name]) => name === 'npc-dialogue:start')[1];
  const steps = [{ npc: 'x' }, { type: 'choice', options: [{ steps: ['offer'] }] }];
  assert.deepEqual(start.select(steps), ['offer']);
  const bare = player();
  Exchange.exchange({ player: bare, npc: {} });
  assert.equal(bare.messages.length, 1);
});
