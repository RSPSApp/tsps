// Run after `yarn build`: node --test tests/rogue-trader-maintainer.test.cjs
//
// Maintainer review of #2639:
//  1. A player who starts Rogue Trader before finishing Icthlarin's Little Helper is given the Siamun errand (912 = 1) on a later
//     visit once it is done, and can go through Siamun to the finish and the 914 reward. Checked for every gate in the start: only the
//     Siamun errand is gated at the first talk (Aubury's proposal waits for Rune Mysteries at his own talk, not at Ali's).
//  2. A casket's runes in the casket shop are surplus (original amount 0): bought out, they stay out however long the shop restocks.
//  3. Ali's menus, the expand answers and the blackjack and clothes hand-over lines are the generated page's variant
//     standard-dialogue-after-completing-rogue-trader, cut to what the player has unlocked.
//  4. Switching the outfit either way resets 915, so Siamun only offers the next switch after Ali's next report.
// Real packets, real dispatch.
const assert = require('node:assert/strict');
const { before, after, test } = require('node:test');
const H = require('./helpers/rogue-trader-replay.cjs');

let core;
before(async () => { core = await H.setup(); });
after(() => H.teardown());

const state = (f) => f.p.getAttribute('rogue-trader:state');
const done = { experience: false, scroll: false, announce: false };
const finishIlh = (f) => H.Quests().questNamed("Icthlarin's Little Helper").complete(f.p, done);
const constant = (t, value) => t.mock.method(Math, 'random', () => value);
function siamunNear(f) {
  core.RegionManager.loadMapFiles(3314, 2785);
  f.p.setLocation(new core.Location(3313, 2785, 0)); f.p.setNeedsPlacement(false);
  const npc = core.NPC.create(4205, new core.Location(3314, 2785, 0));
  core.World.getNpcs().add(npc); npc.setRegistered(true);
  return npc;
}
function backAtAli(f) {
  f.p.setLocation(new core.Location(3303, 3211, 0)); f.p.setNeedsPlacement(false);
}
const give = (f, id, n) => { for (let i = 0; i < n; i++) f.p.getInventory().add(new core.Item(id, 1), true); };

test('1. started before Icthlarin\'s Little Helper, finished after: Ali gives the Siamun errand on the next visit (the reported repro)', async (t) => {
  const f = H.actor(t, { icthlarin: false });
  H.setState(f, { blackjacks: 1, runes: 1 });
  await H.talk(f);
  const before = await H.read(f);
  assert.ok(before.lines.some((l) => l.includes('~Sigh.')), 'without it Ali still sighs');
  assert.equal(state(f).clothes, undefined);
  finishIlh(f);
  f.p.closeInterruptibleInterfaces();
  await H.talk(f);
  const { lines } = await H.read(f);
  assert.ok(lines.some((l) => l.includes('I have an old friend - a cloth merchant Siamun')), lines.join('|'));
  assert.equal(state(f).clothes, 1);
  assert.deepEqual(f.varbits.filter(([id]) => id === 912), [[912, 1]]);
  assert.ok(!lines.some((l) => l.includes('~Sigh.')));
});

test('1. the same on the later-visit menu (Aubury asked, caskets not yet)', async (t) => {
  const f = H.actor(t, { icthlarin: false });
  H.setState(f, { blackjacks: 4, runes: 2, toldAli: 1, cheapflights: 1 });
  finishIlh(f);
  await H.talk(f);
  const { lines } = await H.read(f);
  assert.ok(lines.some((l) => l.includes('I have an old friend - a cloth merchant Siamun')));
  assert.equal(state(f).clothes, 1);
});

test('1. through Siamun to the finish: the errand completes and the reward comes', async (t) => {
  const f = H.actor(t, { icthlarin: false }); const siamun = siamunNear(f);
  H.setState(f, { blackjacks: 4, runes: 2, toldAli: 1 });
  finishIlh(f);
  backAtAli(f);
  await H.talk(f); await H.read(f);
  assert.equal(state(f).clothes, 1);
  give(f, core.ItemIdentifiers.BLUE_DYE, 3);
  f.p.setLocation(new core.Location(3313, 2785, 0)); f.p.setNeedsPlacement(false); // back beside Siamun after Ali
  await H.talkTo(f, siamun); await H.read(f); await H.choose(f, 2); await H.read(f);
  assert.equal(state(f).clothes, 3);
  backAtAli(f);
  f.p.closeInterruptibleInterfaces();
  await H.talk(f);
  const { lines } = await H.read(f);
  assert.ok(lines.some((l) => l.includes('selfless help')), 'the finishing talk plays');
  assert.equal(state(f).cheapflights, 1);
});

test('2. a casket shop that is really bought out stays out, and what is left falls back by one every 100 ticks', async (t) => {
  const f = H.actor(t); constant(t, 0.0);
  f.p.getInventory().add(new core.Item(core.ItemIdentifiers.COINS, 100000), true);
  H.setState(f, { clothes: 1, blackjacks: 1, runes: 2, stallvar: 1 });
  await H.talk(f); await H.read(f); await H.choose(f, 1); await H.read(f);
  await H.choose(f, 1); await H.read(f); await H.choose(f, 1); await H.read(f);
  core.ShopManager.open.mock.restore(); // the shop opens for real, so it can be bought from
  await H.choose(f, 2); // Find out what the runes are.
  const id = core.ShopManager.activeShopByPlayer.get(f.p);
  const shop = core.ShopManager.shopsById.get(id);
  assert.ok([...shop.originalAmounts.values()].every((n) => n === 0), 'none of the casket\'s runes is original stock');
  const [first, second] = [...shop.stock.keys()];
  const left = shop.stock.get(second);
  assert.ok(left >= 3, 'enough of the second rune to watch it fall');
  const display = core.ShopManager.displayEntries(shop);
  const buy = (itemId, option) => core.ShopManager.handleWidgetAction(f.p, {
    groupId: core.ShopManager.MAIN_INTERFACE_ID, childId: 16, buttonNum: 0, option, slot: display.findIndex((e) => e.itemId === itemId) + 1, itemId,
  });
  for (let i = 0; i < 20 && (shop.stock.get(first) ?? 0) > 0; i++) buy(first, 'Buy 50');
  assert.equal(shop.stock.get(first) ?? 0, 0, 'the first rune is bought out');
  for (let tick = 0; tick < 1000; tick++) core.ShopManager.restockShop(shop);
  assert.equal(shop.stock.get(first) ?? 0, 0, 'and stays out');
  assert.equal(shop.stock.get(second) ?? 0, 0, 'what was left fell back to nothing (one every 100 ticks), it did not restock');
});

test('2. the elemental, other-runes, blackjack and clothes shops keep their Wiki base as original stock (they restock to it)', async (t) => {
  const f = H.actor(t);
  H.setState(f, { clothes: 3, blackjacks: 4, runes: 5, stallvar: 1, toldAli: 1, garments: 1, cheapflights: 1 });
  const original = () => core.ShopManager.shopsById.get(f.shops.at(-1)).originalAmounts;
  await H.talk(f, 'Trade'); await H.read(f); await H.choose(f, 1); // View blackjacks.
  assert.deepEqual([...original().values()], [25, 25, 25, 25, 25]);
  await H.talk(f, 'Trade'); await H.read(f); await H.choose(f, 2); // View clothes.
  assert.deepEqual([...original().values()], [25, 25, 25, 25, 25, 25, 25, 25]);
  await H.talk(f, 'Trade'); await H.read(f); await H.choose(f, 3); await H.read(f); await H.choose(f, 3); // View runes., Buy elemental runes.
  assert.deepEqual([...original().values()], [20, 20, 20, 20, 3, 3, 3, 3]);
  await H.talk(f, 'Trade'); await H.read(f); await H.choose(f, 3); await H.read(f); await H.choose(f, 4); // Buy other runes.
  assert.deepEqual([...original().values()], [100, 100, 100, 100, 100, 100, 100, 10, 100, 5, 5]);
});

test('3. Ali\'s later visit is the generated page\'s variant, expand answers included', async (t) => {
  const PM = require('../dist/plugins/PluginManager').PluginManager;
  const starts = [];
  const emit = PM.emitCustomEvent.bind(PM);
  t.mock.method(PM, 'emitCustomEvent', (name, event) => { if (name === 'npc-dialogue:start' && event?.variant) starts.push(event.variant); return emit(name, event); });
  const generated = require('../data/definitions/npc-dialogues.json')['Ali Morrisane'].variants['standard-dialogue-after-completing-rogue-trader'];
  const expand = generated.find((step) => step.type === 'choice').options.find((o) => o.text.includes('expand your business'));
  const f = H.actor(t);
  H.setState(f, { clothes: 3, blackjacks: 4, runes: 5, stallvar: 1, toldAli: 1, garments: 1, cheapflights: 1 });
  await H.talk(f); await H.read(f);
  assert.deepEqual(starts.at(-1), { page: 'Ali Morrisane', variant: 'standard-dialogue-after-completing-rogue-trader' });
  await H.choose(f, 5);
  const { lines } = await H.read(f);
  for (const step of expand.steps.filter((s) => s.npc)) assert.ok(lines.includes(step.npc.replace(/\s+/g, ' ')), `"${step.npc}" is the page\'s`);
});

test('3. the Captain Dalbur options of the generated page are not offered (nothing tracks the question; fails if aliCondition goes)', async (t) => {
  const f = H.actor(t);
  H.setState(f, { clothes: 3, blackjacks: 4, runes: 5, toldAli: 1, garments: 1, cheapflights: 1 });
  await H.talk(f); await H.read(f); await H.choose(f, 5);
  const { pending } = await H.read(f);
  assert.ok(!pending.options.includes('What will you do about the gnomes?'));
});

test('4. switching back to the Menaphite clothes resets 915 as well: Siamun asks about the sales until Ali\'s next report', async (t) => {
  const f = H.actor(t); const siamun = siamunNear(f);
  H.setState(f, { clothes: 4, blackjacks: 4, runes: 5, garments: 1, toldAli: 1, cheapflights: 1 });
  give(f, core.ItemIdentifiers.BLUE_DYE, 3);
  await H.talkTo(f, siamun); await H.read(f); await H.choose(f, 2); await H.read(f);
  assert.equal(state(f).clothes, 3);
  assert.equal(state(f).garments, 0, '915 -> 0 on this switch too');
  f.p.closeInterruptibleInterfaces();
  await H.talkTo(f, siamun);
  const { lines, pending } = await H.read(f);
  assert.ok(lines.includes('Hello adventurer. Have you checked with Ali M whether my garments are selling or not?'));
  assert.equal(pending, null, 'no offer to switch again');
});

// The condition handler answers Ali's page only. The dialogue runtime asks every plugin; a handler that matches on the text alone also
// answered Gianne jnr.'s "Captain Dalbur:" delivery steps (Gnome Restaurant, npc 2547), which are not ours to answer.
const askCondition = (f, npcId, text) => require('../dist/plugins/PluginManager').PluginManager.emitNpcDialogueCondition({ player: f.p, npc: f.npc, npcId, pages: [], text });

test("3a. the Dalbur condition of Ali's page is answered false for Ali (3533)", async (t) => {
  const f = H.actor(t);
  assert.equal(askCondition(f, 3533, 'If the player has asked Captain Dalbur what he thinks of Ali Morrisane:'), false);
  assert.equal(askCondition(f, 3533, 'If the player has asked Captain Dalbur what he thinks of Ali'), false);
});

test("3b. Gianne jnr.'s Captain Dalbur: delivery step (2547) is not answered by Rogue Trader", async (t) => {
  const f = H.actor(t);
  assert.notEqual(askCondition(f, 2547, 'Captain Dalbur:'), false, 'not forced to false by our handler');
  assert.equal(askCondition(f, 2547, 'Captain Dalbur:'), null, 'and nothing else answers it either');
});
