// Run after `yarn build`: node --test tests/rogue-trader-clothes.test.cjs
//
// Rogue Trader, the clothes errand (rsprox 3170 rev 232, 549 rev 227; Wiki: Rogue Trader, Transcript:Rogue Trader), found by 912:
//   3170 t1044-1076  Siamun (4205, 3314,2785): the first talk, 912 1 -> 2 at "Ok, I'll get you the materials.", the dye, 912 -> 3 and
//                    "You give the merchant the dye." (the Menaphite clothing)
//   3170 t1357-1369  the second talk (912 3 -> 4 and 915 -> 0, "You give the merchant the animal pelts.": the desert outfits)
//   549  t3142-3151  no materials: "Ummm.. No." / "Keh! Come back when you have what I need." / [Umm... What do you need again?|Ok.]
//   3170 t1125-1158  Ali's report on the clothes (915 -> 1), the menu with five options, the garments' stock, 922 = 5
// Not captured, so ours/Wiki: the pelts of one kind needed together, the "After giving" lines, the dye talk (Wiki: the desert
// outfits' switch back), what a player with 912 = 2 meets, the stock of the desert outfits (3170 t1448: 312, ids below).
// Real packets, real dispatch.
const assert = require('node:assert/strict');
const { before, after, test } = require('node:test');
const H = require('./helpers/rogue-trader-replay.cjs');

let core;
before(async () => { core = await H.setup(); });
after(() => H.teardown());

const SIAMUN = 4205;
const state = (f) => f.p.getAttribute('rogue-trader:state');
function siamun(f) {
  core.RegionManager.loadMapFiles(3314, 2785);
  f.p.setLocation(new core.Location(3313, 2785, 0)); f.p.setNeedsPlacement(false);
  const npc = core.NPC.create(SIAMUN, new core.Location(3314, 2785, 0));
  core.World.getNpcs().add(npc); npc.setRegistered(true);
  return npc;
}
const give = (f, id, n) => { for (let i = 0; i < n; i++) f.p.getInventory().add(new core.Item(id, 1), true); };
const count = (f, id) => f.p.getInventory().getAmount(id);

test('3170 t1044-1076: the first talk, the dye, 912 = 1 -> 2 -> 3, the message box', async (t) => {
  const f = H.actor(t); const npc = siamun(f);
  H.setState(f, { clothes: 1, blackjacks: 1 });
  give(f, core.ItemIdentifiers.BLUE_DYE, 3);
  await H.replay(f, H.fixture('sia-first'), { start: () => H.talkTo(f, npc) });
  assert.equal(count(f, core.ItemIdentifiers.BLUE_DYE), 0, 'the three dyes are taken');
  assert.equal(state(f).clothes, 3);
});

test('549 t3142-3151: without the materials Siamun sends the player away; the state stays 2', async (t) => {
  const f = H.actor(t); const npc = siamun(f);
  H.setState(f, { clothes: 1, blackjacks: 1 });
  await H.talkTo(f, npc);
  const first = await H.read(f);
  assert.deepEqual(first.pending.options, ['What do you mean by animal pelt?', "Ok, I'll get you the materials."]);
  await H.choose(f, 2);
  const { lines, pending } = await H.read(f);
  assert.deepEqual(lines.slice(-3), ['Unless you\'ve got the materials on you?', 'Ummm.. No.', 'Keh! Come back when you have what I need.']);
  assert.deepEqual(pending.options, ['Umm... What do you need again?', 'Ok.']);
  assert.equal(state(f).clothes, 2);
  await H.choose(f, 2);
  assert.deepEqual((await H.read(f)).lines, ['Ok.']);
});

test('"What do you mean by animal pelt?" explains and goes on to the same question (Wiki)', async (t) => {
  const f = H.actor(t); const npc = siamun(f);
  H.setState(f, { clothes: 1, blackjacks: 1 });
  await H.talkTo(f, npc); await H.read(f); await H.choose(f, 1);
  const { lines } = await H.read(f);
  assert.ok(lines.includes('Just get me 3 cowhides, 3 wolf or snake skins or the shearings of 3 sheep. Simpler still get me 3 pots of dye and, remember, I won\'t accept banknotes.'));
  assert.equal(state(f).clothes, 2);
});

test('pelts of one kind are the other way in: three cowhides give the desert outfits straight away (Wiki)', async (t) => {
  const f = H.actor(t); const npc = siamun(f);
  H.setState(f, { clothes: 1, blackjacks: 1 });
  give(f, core.ItemIdentifiers.COWHIDE, 3);
  await H.talkTo(f, npc); await H.read(f); await H.choose(f, 2); await H.read(f);
  assert.equal(count(f, core.ItemIdentifiers.COWHIDE), 0);
  assert.equal(state(f).clothes, 4);
});

test('three different pelts are not three of a kind', async (t) => {
  const f = H.actor(t); const npc = siamun(f);
  H.setState(f, { clothes: 1, blackjacks: 1 });
  give(f, core.ItemIdentifiers.COWHIDE, 1); give(f, core.ItemIdentifiers.BEAR_FUR, 1); give(f, core.ItemIdentifiers.WOOL, 1);
  await H.talkTo(f, npc); await H.read(f); await H.choose(f, 2); await H.read(f);
  assert.equal(count(f, core.ItemIdentifiers.COWHIDE), 1);
  assert.equal(state(f).clothes, 2);
});

test('3170 t1357-1369: the second talk takes three pelts: 912 -> 4, 915 -> 0', async (t) => {
  const f = H.actor(t); const npc = siamun(f);
  H.setState(f, { clothes: 3, blackjacks: 4, garments: 1 });
  give(f, core.ItemIdentifiers.GREY_WOLF_FUR, 3);
  await H.replay(f, H.fixture('sia-desert'), { start: () => H.talkTo(f, npc) });
  assert.equal(count(f, core.ItemIdentifiers.GREY_WOLF_FUR), 0);
});

test('banknotes and preset items are not accepted', async (t) => {
  const f = H.actor(t); const npc = siamun(f);
  H.setState(f, { clothes: 1, blackjacks: 1 });
  const inventory = f.p.getInventory();
  for (let i = 0; i < 3; i++) inventory.setItem(inventory.getItems().findIndex((x) => !x || x.getId() < 0), new core.Item(core.ItemIdentifiers.BLUE_DYE, 1).setMetaValue(core.Item.PRESET_META, true));
  await H.talkTo(f, npc); await H.read(f); await H.choose(f, 2); await H.read(f);
  assert.equal(state(f).clothes, 2);
  assert.equal(count(f, core.ItemIdentifiers.BLUE_DYE), 3);
});

test('after supplying and before Ali has asked, Siamun only asks about the sales (Wiki)', async (t) => {
  const f = H.actor(t); const npc = siamun(f);
  H.setState(f, { clothes: 3, blackjacks: 4, garments: 0 });
  await H.talkTo(f, npc);
  const { lines, pending } = await H.read(f);
  assert.ok(lines.includes('Hello adventurer. Have you checked with Ali M whether my garments are selling or not?'), lines.join('|'));
  assert.equal(pending, null);
});

test('3170 t1125-1158: Ali\'s report on the clothes (915 -> 1), five options, the garments stock and 922 = 5', async (t) => {
  const f = H.actor(t);
  H.setState(f, { clothes: 3, blackjacks: 4, toldAli: 1, runes: 5, stallvar: 2, cheapflights: 1 });
  await H.replay(f, H.fixture('ali-clothes-report'), { start: async () => { await H.talk(f); for (let i = 0; i < 3; i++) await H.nextLine(f); } });
  const stock = core.ShopDefinition.forId(f.shops[0]).getOriginalStock();
  assert.deepEqual(stock.map((s) => s.id), [6392, 6394, 6396, 6398, 6400, 6402, 6404, 6406], 'Menaphite hat, top, robe, kilt, then red (3170 t1158: 311)');
  assert.ok(stock.every((s) => s.amount === 25));
});

test('the desert outfits\' stock after the pelts (3170 t1448: 312), 922 = 3', async (t) => {
  const f = H.actor(t);
  H.setState(f, { clothes: 4, blackjacks: 4, toldAli: 1, garments: 1, runes: 5, stallvar: 2 });
  await H.talk(f, 'Trade');
  const { pending } = await H.read(f);
  assert.deepEqual(pending.options, ['View blackjacks.', 'View clothes.', 'View runes.', 'View general stock.']);
  await H.choose(f, 2);
  const stock = core.ShopDefinition.forId(f.shops[0]).getOriginalStock();
  assert.deepEqual(stock.map((s) => s.id), [6382, 6384, 6386, 6388, 6390]);
  assert.equal(state(f).stallvar, 3);
});

test('with all three errands done the menu has "I hear you\'re planning to expand your business here..." and no reminder (3170 t1146)', async (t) => {
  const f = H.actor(t);
  H.setState(f, { clothes: 3, blackjacks: 4, toldAli: 1, garments: 1, runes: 5 });
  await H.talk(f);
  const { pending } = await H.read(f);
  assert.equal(pending.options.at(-1), "I hear you're planning to expand your business here...");
  assert.ok(!pending.options.includes('Who did you want me to talk to again?'));
});

test('the expand answers follow the Wiki and end in a junk sale (ours: the Captain Dalbur branch is left out)', async (t) => {
  const f = H.actor(t);
  H.setState(f, { clothes: 3, blackjacks: 4, toldAli: 1, garments: 1, runes: 5 });
  f.p.getInventory().add(new core.Item(core.ItemIdentifiers.COINS, 100), true);
  await H.talk(f); await H.read(f); await H.choose(f, 5);
  const first = await H.read(f);
  assert.ok(first.lines.includes('Of course, my friend. Any good salesman ought to take the opportunities that present themselves.'));
  assert.deepEqual(first.pending.options, ["Aren't you going to do anything about your men?", 'Well, good luck with your business.']);
  await H.choose(f, 2);
  const { lines, pending } = await H.read(f);
  assert.ok(lines.includes('Before you go, have a look at my wares.'));
  assert.deepEqual(pending.options, ["No, I'm really too busy.", 'Okay.']);
  await H.choose(f, 2);
  await H.read(f); // the player's Okay, then the shop
  assert.ok(f.shops.includes(1008), "the page's open_shop opens Ali's Discount Wares.");
});
