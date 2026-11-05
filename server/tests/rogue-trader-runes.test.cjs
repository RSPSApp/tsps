// Run after `yarn build`: node --test tests/rogue-trader-runes.test.cjs
//
// Rogue Trader, the runes errand (rsprox 3170, rev 232; Aubury also 549, rev 227; found by varbits 911-922):
//   t115-135   Aubury's "business proposal" option: 913 1 -> 2 and 917 0 -> 1.
//   t179-249   back at Ali: "Good job on getting the rune shipments sorted" (917 -> 0), the runes menu, "Hang on a
//              second." (922 -> 1), the casket menus, Force box -> "You fail to open the chest."
//   t258-285   Force box succeeds: "You force the lock open with a combination of your strength and agility." 913 2 -> 3,
//              "Buy all the runes for N" / "Find out what the runes are." -> the casket's own shop.
//   t289-328   the large casket: Force and Pick fail with their own lines.
//   t330-481   Examine lock: interface 292 (roguetrader_sudoku). The server sends the board in the varps 2980-2990 (81
//              nibbles, LSB first, 0 empty), the player's clicks set cells to the selected rune (varbit 12162), and
//              the Open button after a valid solve says "You hear the locking mechanism click open!" (913 3 -> 5).
//   t496-518   Trade: "View runes." -> Buy elemental runes. / Buy other runes. open the two rune shops.
// Not captured, so ours: small-casket Pick success, small-casket Examine, the strength/agility drains, the price of
// "Buy all" beyond the two offers (890 for the small contents, 33156 for the large), a wrong solution doing nothing.
// Real packets, real dispatch; the casket rolls use Math.random, which the tests pin.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { before, after, test } = require('node:test');
const H = require('./helpers/rogue-trader-replay.cjs');

let core;
before(async () => { core = await H.setup(); });
after(() => H.teardown());

const PUZZLES = { 6: { transpose: 8, board: '530402090901030070000080050000805100000000000008601000070040000090050804040109035' },
                  8: { transpose: 2, board: '007400980084000050590061000600009500002000800008500004000720098010000640029004700' } };
const board = (f) => {
  let bits = '';
  for (let i = 0; i < 11; i++) bits += ((f.p.getPacketSender().getVarp(2980 + i) >>> 0).toString(2).padStart(32, '0')).split('').reverse().join('');
  let out = '';
  for (let c = 0; c < 81; c++) out += parseInt(bits.slice(c * 4, c * 4 + 4).split('').reverse().join(''), 2);
  return out;
};
// Other code (dialogue, drains) also calls Math.random, so a sequence of values drifts: one constant, and levels that make it decisive.
// Strength 99 passes below 170/256 = 0.66, Agility 1 passes below 121/256 = 0.47: 0.0 passes both, 0.6 passes Strength only, 0.99 fails both.
const randoms = (t, value) => t.mock.method(Math, 'random', () => value);
const levels = (f, strength, agility) => {
  for (const [skill, level] of [[core.Skill.STRENGTH, strength], [core.Skill.AGILITY, agility]]) {
    f.p.getSkillManager().setCurrentLevel(skill, level, true); f.p.getSkillManager().setMaxLevel(skill, level, true);
  }
};
const clicks = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'fixtures', 'rogue-trader', 'runedoku-puzzle8-clicks.json'), 'utf8'));
const open292 = () => core.CacheDefinitions.getInterfaceId('roguetrader_sudoku');

test('3170 t115-135: Aubury takes Ali\'s proposal (913 -> 2, 917 -> 1) once Ali has asked', async (t) => {
  const f = H.actor(t); H.aubury(f);
  H.setState(f, { clothes: 1, blackjacks: 1, runes: 1 });
  await H.replay(f, H.fixture('aubury-proposal'), { start: () => H.talkTo(f, f.aubury), looseMenu: true });
});

test('without Ali\'s request Aubury has no such option', async (t) => {
  const f = H.actor(t); H.aubury(f);
  await H.talkTo(f, f.aubury);
  const { pending } = await H.read(f);
  assert.ok(!pending.options.some((o) => o.includes('business proposal')));
});

test('3170 t179-249: the return to Ali, the casket menus, and a failed Force box (agility roll)', async (t) => {
  const f = H.actor(t); levels(f, 99, 1); randoms(t, 0.6);
  H.setState(f, { clothes: 1, blackjacks: 1, runes: 2, obtRunes: 1 });
  await H.replay(f, H.fixture('runes-return-force-fail'));
  assert.equal(H.varbit(f, 922), 1);
});

test('3170 t258-285: Force box succeeds -> 913 = 3, the offer for the whole casket, and its shop', async (t) => {
  const f = H.actor(t); levels(f, 99, 1); randoms(t, 0.0);
  H.setState(f, { clothes: 1, blackjacks: 1, runes: 2, stallvar: 1 });
  await H.replay(f, H.fixture('runes-small-force-success'));
  assert.equal(H.varbit(f, 913), 3);
  assert.equal(f.shops.length, 1);
  // the casket's runes are surplus now (original amount 0), so the stock is read from the shop as it runs
  const stock = [...core.ShopManager.shopsById.get(f.shops[0]).stock].map(([id, amount]) => ({ id, amount }));
  assert.deepEqual(stock.map((s) => s.id).sort(), [554, 555, 556, 557], 'fire, water, air, earth');
  assert.ok(stock.every((s) => s.amount > 0));
});

test('a failed strength roll shows the arms-tire line before the failure (3170 t532, Strength then the chest line)', async (t) => {
  const f = H.actor(t); levels(f, 99, 1); randoms(t, 0.99);
  H.setState(f, { clothes: 1, blackjacks: 1, runes: 2, stallvar: 1 });
  await H.talk(f); await H.read(f);
  await H.choose(f, 1); await H.read(f); await H.choose(f, 1); await H.read(f); await H.choose(f, 1);
  await H.nextLine(f);
  assert.ok(f.messages.includes('Your arms tire from the exertions of trying to open the casket...'));
  assert.ok(f.messages.includes('You fail to open the chest.'));
});

test('3170 t289-306: forcing the large casket always fails with its own line', async (t) => {
  const f = H.actor(t);
  H.setState(f, { clothes: 1, blackjacks: 1, runes: 3, stallvar: 1 });
  await H.replay(f, H.fixture('runes-large-force-fail'));
});

test('3170 t309-328: picking the large casket always fails with its own line', async (t) => {
  const f = H.actor(t);
  H.setState(f, { clothes: 1, blackjacks: 1, runes: 3, stallvar: 1 });
  await H.replay(f, H.fixture('runes-large-pick-fail'));
});

test('3170 t330-344: Examine lock opens the runedoku with a captured board in the varps', async (t) => {
  const f = H.actor(t); randoms(t, 0.99);
  H.setState(f, { clothes: 1, blackjacks: 1, runes: 3, stallvar: 1 });
  await H.replay(f, H.fixture('runes-large-examine'));
  assert.equal(f.p.getInterfaceId(), open292());
  const id = H.varbit(f, 12161);
  assert.ok(PUZZLES[id], 'puzzle id is one of the captured');
  assert.equal(H.varbit(f, 934), PUZZLES[id].transpose);
  assert.equal(H.varbit(f, 12163), 1);
  assert.equal(board(f), PUZZLES[id].board);
});

test('3170 t411-481: the captured clicks solve puzzle 8; Open says the lock clicks open, 913 -> 5, the whole-casket offer', async (t) => {
  const f = H.actor(t); randoms(t, 0.99);
  H.setState(f, { clothes: 1, blackjacks: 1, runes: 3, stallvar: 1 });
  await H.talk(f); await H.read(f); await H.choose(f, 1); await H.read(f);
  await H.choose(f, 2); await H.read(f); await H.choose(f, 3);
  assert.equal(H.varbit(f, 12161), 8);
  for (const c of clicks) {
    if (c.k === 'cell') await H.click(f, 292, 14, c.sub);
    else if (c.k === 'rune') await H.click(f, 292, 9, c.sub);
    else await H.click(f, 292, 10);
  }
  assert.ok(f.messages.includes('You hear the locking mechanism click open!'));
  assert.equal(H.varbit(f, 913), 5);
  const { pending } = await H.read(f);
  assert.match(pending.options[0], /^Buy all the runes for \d+$/);
  assert.equal(pending.options[1], 'Find out what the runes are.');
});

test('the selected rune follows 292:9 clicks (varbit 12162), and Open on an unsolved board does nothing (ours)', async (t) => {
  const f = H.actor(t); randoms(t, 0.99);
  H.setState(f, { clothes: 1, blackjacks: 1, runes: 3, stallvar: 1 });
  await H.talk(f); await H.read(f); await H.choose(f, 1); await H.read(f);
  await H.choose(f, 2); await H.read(f); await H.choose(f, 3);
  await H.click(f, 292, 9, 5);
  assert.equal(H.varbit(f, 12162), 5);
  await H.click(f, 292, 10);
  assert.ok(!f.messages.includes('You hear the locking mechanism click open!'));
  assert.equal(f.p.getAttribute('rogue-trader:state').runes, 3);
});

test('3170 t496-518: Trade, View runes -> the elemental shop and the other-runes shop, with the Wiki base stock', async (t) => {
  const f = H.actor(t);
  H.setState(f, { clothes: 1, blackjacks: 1, runes: 5, stallvar: 1 });
  await H.replay(f, H.fixture('runes-trade-elemental'), { start: () => H.talk(f, 'Trade') });
  const retail = core.ShopDefinition.forId(f.shops[0]).getOriginalStock();
  assert.deepEqual(retail.map((s) => s.id), [554, 555, 556, 557, 12734, 12730, 12728, 12732]);
  assert.deepEqual(retail.map((s) => s.amount), [20, 20, 20, 20, 3, 3, 3, 3]);
  await H.replay(f, H.fixture('runes-trade-other').filter((e) => e.k !== 'msg'), { start: () => H.talk(f, 'Trade') });
  const wholesale = core.ShopDefinition.forId(f.shops[1]).getOriginalStock();
  assert.deepEqual(wholesale.map((s) => s.id), [561, 563, 562, 560, 558, 559, 565, 564, 566, 12736, 12738]);
  assert.equal(wholesale.find((s) => s.id === 563).price, 300, '"Law rune: currently costs 300 coins." (3170 t515)');
});

test('the runes progress is saved and its varbits come back at login', async (t) => {
  const f = H.actor(t);
  H.setState(f, { clothes: 1, blackjacks: 1, runes: 5, stallvar: 1 });
  const { PlayerSave } = require('../dist/game/entity/impl/player/persistence/PlayerSave');
  const PM = require('../dist/plugins/PluginManager').PluginManager;
  PM.emitPlayerLogout({ player: f.p, username: f.p.getUsername() });
  const g = H.actor(t);
  PlayerSave.fromPlayer(f.p).applyToPlayer(g.p);
  PM.emitPlayerLogin({ player: g.p, username: g.p.getUsername(), isNewAccount: false });
  assert.ok(g.varbits.some(([id, v]) => id === 913 && v === 5));
  assert.ok(g.varbits.some(([id, v]) => id === 922 && v === 1));
});
