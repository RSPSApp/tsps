// Run after `yarn build`: node --test tests/rogue-trader-finish.test.cjs
//
// Rogue Trader, the finish and the reward (rsprox 549 rev 227 t3703-3739; 3169 t8248 for the early discount):
//   Ali's first talk with all three errands done: the greeting, the runes request report (917 -> 0), the blackjack report (920),
//   the clothes report (915), then "I would like to commend you on all the selfless help you have given me." with 914 = 1 at
//   "...travel on the carpets at a discounted rate.", and the menu.
// The reward is the cheaper carpets (Wiki: 100 coins instead of 200, 75 instead of 100 with a Ring of Charos(a); free after the hard
// Desert Diary as before): the fare of a Rug Merchant's Travel menu follows 914.
// Not done, and not a capture: the four Alis (6552-6555, empty pages in the generated file).
// Dommik's menu and the shopkeeper condition gates are covered by rogue-trader-shopkeepers.test.cjs.
// Real packets, real dispatch.
const assert = require('node:assert/strict');
const { before, after, test } = require('node:test');
const H = require('./helpers/rogue-trader-replay.cjs');

let core;
before(async () => { core = await H.setup(); });
after(() => H.teardown());

const state = (f) => f.p.getAttribute('rogue-trader:state');
const RING_OF_CHAROS_A = 6465;

test('549 t3703-3739: the first talk with all three done ends in the finishing lines and 914 = 1', async (t) => {
  const f = H.actor(t);
  H.setState(f, { blackjacks: 4, clothes: 3, runes: 2, obtRunes: 1 });
  await H.replay(f, H.fixture('ali-finish'), { looseMenu: true });
  assert.equal(state(f).cheapflights, 1);
});

test('a player who already took the discount (3169) does not get the finishing lines again', async (t) => {
  const f = H.actor(t);
  H.setState(f, { blackjacks: 4, clothes: 3, runes: 5, toldAli: 1, garments: 1, cheapflights: 1 });
  await H.talk(f);
  const { lines } = await H.read(f);
  assert.ok(!lines.some((l) => l.includes('selfless help')));
});

test('the finishing lines wait for the third errand: with the clothes missing they do not play', async (t) => {
  const f = H.actor(t);
  H.setState(f, { blackjacks: 4, clothes: 1, runes: 2 });
  await H.talk(f);
  const { lines } = await H.read(f);
  assert.ok(!lines.some((l) => l.includes('selfless help')));
  assert.notEqual(state(f).cheapflights, 1);
});

function rugMerchant(f) {
  core.RegionManager.loadMapFiles(3311, 3109);
  f.p.setLocation(new core.Location(3310, 3109, 0)); f.p.setNeedsPlacement(false);
  const npc = core.NPC.create(17, new core.Location(3311, 3109, 0));
  core.World.getNpcs().add(npc); npc.setRegistered(true);
  return npc;
}
async function fareTitle(f, npc) {
  await H.talkTo(f, npc, 'Travel');
  return H.MultiChatboxPrompt.getPending(f.p)?.title;
}

test('carpet fares: 200, 100 with the Ring of Charos(a) (Wiki, as before)', async (t) => {
  const f = H.actor(t), npc = rugMerchant(f);
  assert.equal(await fareTitle(f, npc), 'Carpet rides cost 200 coins.');
  f.p.getEquipment().setItem(core.Equipment.RING_SLOT, new core.Item(RING_OF_CHAROS_A, 1));
  assert.equal(await fareTitle(f, npc), 'Carpet rides cost 100 coins.');
});

test('with 914 = 1 the fare is 100, and 75 with the Ring of Charos(a) (Wiki: Rogue Trader)', async (t) => {
  const f = H.actor(t), npc = rugMerchant(f);
  H.setState(f, { cheapflights: 1 });
  assert.equal(await fareTitle(f, npc), 'Carpet rides cost 100 coins.');
  f.p.getEquipment().setItem(core.Equipment.RING_SLOT, new core.Item(RING_OF_CHAROS_A, 1));
  assert.equal(await fareTitle(f, npc), 'Carpet rides cost 75 coins.');
});

test('the discount asked for early (3169 t8248) counts the same', async (t) => {
  const f = H.actor(t);
  await H.replay(f, H.fixture('start-whats-in').slice(0, 31), { start: () => H.talk(f) });
  f.p.closeInterruptibleInterfaces();
  assert.equal(state(f).cheapflights, 1);
  const npc = rugMerchant(f);
  assert.equal(await fareTitle(f, npc), 'Carpet rides cost 100 coins.');
});
