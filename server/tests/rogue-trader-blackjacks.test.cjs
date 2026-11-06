// Run after `yarn build`: node --test tests/rogue-trader-blackjacks.test.cjs
//
// Rogue Trader, the blackjack errand (rsprox 3170, rev 232; Wiki: Rogue Trader, Transcript:Rogue Trader), found by 911:
//   t659-686   the seller (6135, 3351,2971): the proposal, 911 1 -> 2 at "He did?", then "Hmm... I'll have to think of a cunning plan."
//   t707-725   the street urchin (3539): 100 gold for his help
//   t726-756   back at the seller: "Yoink!", 916 = 2 and 919 = 1, and the message box about the swing
//   t762-768   the seller again: 916 -> 0, 911 -> 4 (the defensive blackjacks)
//   t1105-1124 Ali: "Fantastic job on the blackjacks" (920 -> 1)
//   t1197-1257 the seller, second time: knock-me-out, two hits, 916 1 -> 0, 920 -> 0, 911 4 -> 3 (the offensive blackjacks)
//   t807-812   Trade -> View blackjacks. -> the stall's blackjack shop, 922 = 2
// Not captured, so ours: the first-time knock-out route (the second time's lines are used), a hit that does knock the player
// out (Wiki: 3 damage, the talk again), the urchin's 300 gold after an unpaid Feud debt, Chicken out and the skip lines
// (Wiki), the afterwards lines (Wiki), the first blackjack shop switch back to defensive.
// Real packets, real dispatch.
const assert = require('node:assert/strict');
const { before, after, test } = require('node:test');
const H = require('./helpers/rogue-trader-replay.cjs');

let core;
before(async () => { core = await H.setup(); });
after(() => H.teardown());

const SELLER = 6135, URCHIN = 3539;
const constant = (t, value) => t.mock.method(Math, 'random', () => value);
function npcBeside(f, id, x, y) {
  core.RegionManager.loadMapFiles(x, y);
  f.p.setLocation(new core.Location(x - 1, y, 0)); f.p.setNeedsPlacement(false);
  const npc = core.NPC.create(id, new core.Location(x, y, 0));
  core.World.getNpcs().add(npc); npc.setRegistered(true);
  return npc;
}
const COINS = () => core.ItemIdentifiers.COINS;
const state = (f) => f.p.getAttribute('rogue-trader:state');

test('3170 t659-686: the proposal sets 911 = 2 at "He did?" and ends on the cunning-plan answer', async (t) => {
  const f = H.actor(t); const seller = npcBeside(f, SELLER, 3351, 2971);
  H.setState(f, { clothes: 1, blackjacks: 1 });
  await H.replay(f, H.fixture('bj-proposal'), { start: () => H.talkTo(f, seller) });
});

test('3170 t707-725: the urchin takes 100 gold for his help and sends the player to the seller', async (t) => {
  const f = H.actor(t); const urchin = npcBeside(f, URCHIN, 3355, 2972);
  H.setState(f, { clothes: 1, blackjacks: 2 });
  f.p.getInventory().add(new core.Item(COINS(), 1000), true);
  const before = f.p.getInventory().getAmount(COINS());
  await H.replay(f, H.fixture('bj-urchin'), { start: () => H.talkTo(f, urchin) });
  assert.equal(f.p.getInventory().getAmount(COINS()), before - 100);
});

test('without the coins the urchin does not take the deal (Wiki: "I don\'t have that much money on me.")', async (t) => {
  const f = H.actor(t); const urchin = npcBeside(f, URCHIN, 3355, 2972);
  H.setState(f, { clothes: 1, blackjacks: 2 });
  f.p.getInventory().deleteNumber(COINS(), f.p.getInventory().getAmount(COINS()));
  await H.talkTo(f, urchin);
  const { lines, pending } = await H.read(f);
  assert.ok(lines.includes("I don't have that much money on me."));
  assert.equal(pending, null);
});

test('3170 t726-756: the theft, then 916 = 2 and 919 = 1, then the box about the swing', async (t) => {
  const f = H.actor(t); const seller = npcBeside(f, SELLER, 3351, 2971);
  H.setState(f, { clothes: 1, blackjacks: 2 });
  H.setState(f, { clothes: 1, blackjacks: 2, urchinPaid: 1 });
  const sounds = []; t.mock.method(f.p.getPacketSender(), 'sendSound', (id) => { sounds.push(id); return f.p.getPacketSender(); });
  await H.replay(f, H.fixture('bj-theft'), { start: () => H.talkTo(f, seller) });
  assert.ok(sounds.includes(2508), 'synth 2508 for the swing (3170 t742)');
});

test('3170 t762-768: the seller after the theft; 916 -> 0, 911 -> 4', async (t) => {
  const f = H.actor(t); const seller = npcBeside(f, SELLER, 3351, 2971);
  H.setState(f, { clothes: 1, blackjacks: 2, weapons: 2, urchinGlove: 1 });
  await H.replay(f, H.fixture('bj-finish-defensive'), { start: () => H.talkTo(f, seller) });
  assert.equal(state(f).blackjacks, 4);
});

test('3170 t1197-1257: the second time the player lets the seller hit twice: 916 1 -> 0, 920 -> 0, 911 4 -> 3', async (t) => {
  const f = H.actor(t); const seller = npcBeside(f, SELLER, 3351, 2971); constant(t, 0.0);
  H.setState(f, { clothes: 1, blackjacks: 4, toldAli: 1 });
  const sounds = []; t.mock.method(f.p.getPacketSender(), 'sendSound', (id) => { sounds.push(id); return f.p.getPacketSender(); });
  await H.replay(f, H.fixture('bj-offensive'), { start: () => H.talkTo(f, seller) });
  assert.equal(state(f).blackjacks, 3);
  assert.deepEqual(sounds.filter((id) => id === 2508 || id === 2727), [2508, 2727, 2508, 2727], 'two swings, each with the thud (3170 t1227-1241)');
});

test('a hit that knocks the player out costs 3 damage and the talk starts again (Wiki; ours)', async (t) => {
  const f = H.actor(t); const seller = npcBeside(f, SELLER, 3351, 2971); constant(t, 0.99);
  H.setState(f, { clothes: 1, blackjacks: 4, toldAli: 1 });
  f.p.getSkillManager().setCurrentLevel(core.Skill.HITPOINTS, 10, true);
  await H.talkTo(f, seller); await H.read(f); await H.choose(f, 1); await H.read(f); await H.choose(f, 2);
  const { lines } = await H.read(f);
  assert.ok(!lines.some((l) => l.includes("You didn't knock me down")));
  assert.equal(f.p.getSkillManager().getCurrentLevel(core.Skill.HITPOINTS), 7);
  assert.equal(state(f).blackjacks, 4, 'nothing changed');
});

test('3170 t1105-1124: Ali\'s report on the blackjacks, once, then 920 = 1', async (t) => {
  const f = H.actor(t);
  H.setState(f, { clothes: 1, blackjacks: 4, runes: 5, stallvar: 1 });
  await H.replay(f, H.fixture('ali-bj-report'));
  await H.talk(f);
  const { lines } = await H.read(f);
  assert.ok(!lines.some((l) => l.startsWith('Fantastic job on the blackjacks')), 'not again until the seller changes them');
});

test('3170 t807-812: Trade offers the blackjacks; the defensive stock after the theft, 922 = 2', async (t) => {
  const f = H.actor(t);
  H.setState(f, { clothes: 1, blackjacks: 4, runes: 5, stallvar: 1, toldAli: 1 });
  await H.replay(f, H.fixture('bj-trade'), { start: () => H.talk(f, 'Trade') });
  const stock = core.ShopDefinition.forId(f.shops[0]).getOriginalStock();
  assert.deepEqual(stock.map((s) => s.id), [6410, 6414, 6420, 6416, 4600], 'oak (d), willow (d), maple (d), maple, willow');
  assert.ok(stock.every((s) => s.amount === 25));
  assert.equal(state(f).stallvar, 2);
});

test('the offensive blackjacks after the second change (3170 t1437: oak (o), willow (o), maple (o), maple, willow)', async (t) => {
  const f = H.actor(t);
  H.setState(f, { clothes: 1, blackjacks: 3, runes: 5, stallvar: 2, toldAli: 0 });
  await H.talk(f, 'Trade'); await H.read(f); await H.choose(f, 1);
  const stock = core.ShopDefinition.forId(f.shops[0]).getOriginalStock();
  assert.deepEqual(stock.map((s) => s.id), [6408, 6412, 6418, 6416, 4600]);
});

test('after the errand the seller and the urchin only chat (Wiki, ours)', async (t) => {
  const f = H.actor(t); const seller = npcBeside(f, SELLER, 3351, 2971);
  H.setState(f, { clothes: 1, blackjacks: 4, toldAli: 0 });
  await H.talkTo(f, seller);
  const { lines, pending } = await H.read(f);
  assert.ok(lines.includes('Have you checked with Ali Morrisane whether my blackjacks are selling or not?'), lines.join('|'));
  assert.equal(pending, null);
});
