// Run after `yarn build`: node --test tests/rogue-trader-final.test.cjs
//
// Final review of #2623 (2623/final-review.md):
//  1. Ali pays 50% of an item's value for runes (Wiki: the rune tables have buymultiplier=500, blood and soul "sell for 200 and
//     150"), in every shop of his rune stock, so a casket bought at a discount cannot be sold back for more than it cost.
//  2. The street urchin is paid once; the payment is saved.
//  3. Siamun's materials are looked at again when they are handed over, not chosen before the lines.
//  5. A line that is not on the Wiki is not in the Wiki scenes.
const assert = require('node:assert/strict');
const { before, after, test } = require('node:test');
const H = require('./helpers/rogue-trader-replay.cjs');
const DATA = require('../plugins/npcs/data/rogue-trader.json');

let core;
before(async () => { core = await H.setup(); });
after(() => H.teardown());

const constant = (t, value) => t.mock.method(Math, 'random', () => value);
const state = (f) => f.p.getAttribute('rogue-trader:state');
const sellPrice = (f, shopId, itemId) => core.ShopManager.sellPrice(core.ShopManager.shopsById.get(shopId), core.ItemDefinition.forId(itemId), f.p);
const buyPrice = (shopId, itemId) => core.ShopDefinition.forId(shopId).getOriginalStock().find((s) => s.id === itemId).price ?? core.ItemDefinition.forId(itemId).getValue();

async function reachOffer(f, t) {
  constant(t, 0.0);
  H.setState(f, { clothes: 1, blackjacks: 1, runes: 2, stallvar: 1 });
  await H.talk(f); await H.read(f); await H.choose(f, 1); await H.read(f);
  await H.choose(f, 1); await H.read(f); await H.choose(f, 1);
  return H.read(f);
}

test('1. runes sell back for half their value in the casket shop, the elemental shop and the other-runes shop', async (t) => {
  const f = H.actor(t);
  await reachOffer(f, t);
  await H.choose(f, 2); // Find out what the runes are.
  const dump = f.shops[0];
  assert.equal(sellPrice(f, dump, 554), 2, 'fire rune, value 4');
  await H.talk(f, 'Trade'); await H.read(f); await H.choose(f, 1); await H.read(f); await H.choose(f, 3);
  const retail = f.shops[f.shops.length - 1];
  assert.equal(sellPrice(f, retail, 556), 2);
  H.setState(f, { clothes: 1, blackjacks: 1, runes: 5, stallvar: 1 });
  await H.talk(f, 'Trade'); await H.read(f); await H.choose(f, 1); await H.read(f); await H.choose(f, 4);
  const wholesale = f.shops[f.shops.length - 1];
  assert.equal(sellPrice(f, wholesale, 565), 200, 'blood rune: "sell for 200" (Wiki)');
  assert.equal(sellPrice(f, wholesale, 566), 150, 'soul rune: "sell for 150" (Wiki)');
  assert.equal(sellPrice(f, wholesale, 563), 120, 'law rune, value 240');
});

test('1. no rune is bought for less than it sells for, in any of the shops', async (t) => {
  const f = H.actor(t);
  H.setState(f, { clothes: 1, blackjacks: 1, runes: 5, stallvar: 1 });
  await H.talk(f, 'Trade'); await H.read(f); await H.choose(f, 1); await H.read(f); await H.choose(f, 3);
  const retail = f.shops[0];
  await H.talk(f, 'Trade'); await H.read(f); await H.choose(f, 1); await H.read(f); await H.choose(f, 4);
  const wholesale = f.shops[1];
  for (const shop of [retail, wholesale]) {
    for (const entry of core.ShopDefinition.forId(shop).getOriginalStock()) {
      assert.ok(sellPrice(f, shop, entry.id) <= buyPrice(shop, entry.id), `${entry.id} sells for no more than it costs`);
    }
  }
});

test('1. the casket offer, sold back at once, loses money (the 3170 large offer: 33156 for runes worth less than half of that)', async (t) => {
  const f = H.actor(t);
  H.setState(f, { clothes: 1, blackjacks: 1, runes: 3, stallvar: 1 });
  constant(t, 0.99);
  await H.talk(f); await H.read(f); await H.choose(f, 1); await H.read(f); await H.choose(f, 2); await H.read(f); await H.choose(f, 3);
  for (const c of require('./fixtures/rogue-trader/runedoku-puzzle8-clicks.json')) {
    if (c.k === 'cell') await H.click(f, 292, 14, c.sub); else if (c.k === 'rune') await H.click(f, 292, 9, c.sub); else await H.click(f, 292, 10);
  }
  const { pending } = await H.read(f);
  const offer = Number(pending.options[0].replace(/\D/g, ''));
  await H.choose(f, 2);
  const dump = f.shops[0];
  let back = 0;
  for (const entry of core.ShopDefinition.forId(dump).getOriginalStock()) back += entry.amount * sellPrice(f, dump, entry.id);
  assert.ok(back < offer, `selling back ${back} is less than the ${offer} paid`);
});

function urchinNear(f) {
  core.RegionManager.loadMapFiles(3355, 2972);
  f.p.setLocation(new core.Location(3354, 2972, 0)); f.p.setNeedsPlacement(false);
  const npc = core.NPC.create(3539, new core.Location(3355, 2972, 0));
  core.World.getNpcs().add(npc); npc.setRegistered(true);
  return npc;
}

test('2. the urchin is paid once: asked again he does not offer, and takes nothing', async (t) => {
  const f = H.actor(t); const urchin = urchinNear(f);
  H.setState(f, { clothes: 1, blackjacks: 2 });
  f.p.getInventory().add(new core.Item(core.ItemIdentifiers.COINS, 1000), true);
  await H.talkTo(f, urchin); await H.read(f); await H.choose(f, 2); await H.read(f);
  const after = f.p.getInventory().getAmount(core.ItemIdentifiers.COINS);
  await H.talkTo(f, urchin);
  const { lines, pending } = await H.read(f);
  assert.equal(pending, null, 'no offer');
  assert.equal(f.p.getInventory().getAmount(core.ItemIdentifiers.COINS), after);
  assert.ok(lines.includes('Now walk up to the merchant, engage him in conversation and leave the rest up to me.'));
});

test('2. the payment survives a logout before the theft', async (t) => {
  const f = H.actor(t); const urchin = urchinNear(f);
  H.setState(f, { clothes: 1, blackjacks: 2 });
  f.p.getInventory().add(new core.Item(core.ItemIdentifiers.COINS, 1000), true);
  await H.talkTo(f, urchin); await H.read(f); await H.choose(f, 2); await H.read(f);
  const { PlayerSave } = require('../dist/game/entity/impl/player/persistence/PlayerSave');
  const PM = require('../dist/plugins/PluginManager').PluginManager;
  PM.emitPlayerLogout({ player: f.p, username: f.p.getUsername() });
  const g = H.actor(t);
  PlayerSave.fromPlayer(f.p).applyToPlayer(g.p);
  PM.emitPlayerLogin({ player: g.p, username: g.p.getUsername(), isNewAccount: false });
  assert.equal(state(g).urchinPaid, 1);
});

test('the theft uses the payment up', async (t) => {
  const f = H.actor(t);
  core.RegionManager.loadMapFiles(3351, 2971);
  f.p.setLocation(new core.Location(3350, 2971, 0)); f.p.setNeedsPlacement(false);
  const seller = core.NPC.create(6135, new core.Location(3351, 2971, 0));
  core.World.getNpcs().add(seller); seller.setRegistered(true);
  H.setState(f, { clothes: 1, blackjacks: 2, urchinPaid: 1 });
  await H.talkTo(f, seller); await H.read(f);
  assert.equal(state(f).urchinPaid, 0);
  assert.equal(state(f).weapons, 2);
});

function siamunNear(f) {
  core.RegionManager.loadMapFiles(3314, 2785);
  f.p.setLocation(new core.Location(3313, 2785, 0)); f.p.setNeedsPlacement(false);
  const npc = core.NPC.create(4205, new core.Location(3314, 2785, 0));
  core.World.getNpcs().add(npc); npc.setRegistered(true);
  return npc;
}
async function toTheHandOver(f) {
  for (let i = 0; i < 40; i++) {
    const text = f.p.getDialogueManager().getCurrent()?.getText?.();
    if (text && text.startsWith("Yup, I've got what you want")) return;
    await H.nextLine(f);
  }
  throw new Error('never reached the hand-over line');
}

test('3. dyes dropped while Siamun talks are not paid for: nothing is given and nothing is taken', async (t) => {
  const f = H.actor(t); const npc = siamunNear(f);
  H.setState(f, { clothes: 1, blackjacks: 1 });
  for (let i = 0; i < 3; i++) f.p.getInventory().add(new core.Item(core.ItemIdentifiers.BLUE_DYE, 1), true);
  await H.talkTo(f, npc); await H.read(f); await H.choose(f, 2);
  await toTheHandOver(f);
  f.p.getInventory().deleteNumber(core.ItemIdentifiers.BLUE_DYE, 3);
  f.p.getInventory().add(new core.Item(core.ItemIdentifiers.COWHIDE, 1), true); // whatever now sits in a freed slot
  await H.nextLine(f);
  const { lines } = await H.read(f);
  assert.equal(state(f).clothes, 2, 'no outfit');
  assert.equal(f.p.getInventory().getAmount(core.ItemIdentifiers.COWHIDE), 1, 'the item now in the slot is untouched');
  assert.ok(!f.messages.includes('You give the merchant the dye.'));
});

test('3. dyes moved to other slots while Siamun talks are still taken', async (t) => {
  const f = H.actor(t); const npc = siamunNear(f);
  H.setState(f, { clothes: 1, blackjacks: 1 });
  for (let i = 0; i < 3; i++) f.p.getInventory().add(new core.Item(core.ItemIdentifiers.BLUE_DYE, 1), true);
  await H.talkTo(f, npc); await H.read(f); await H.choose(f, 2);
  await toTheHandOver(f);
  f.p.getInventory().deleteNumber(core.ItemIdentifiers.BLUE_DYE, 3);
  for (let i = 0; i < 3; i++) f.p.getInventory().add(new core.Item(core.ItemIdentifiers.BLUE_DYE, 1), true);
  await H.nextLine(f); await H.read(f);
  assert.equal(state(f).clothes, 3);
  assert.equal(f.p.getInventory().getAmount(core.ItemIdentifiers.BLUE_DYE), 0);
});

test('5. a line that is not on the Wiki is not in the Wiki scenes', () => {
  assert.equal(DATA.wikiScenes.bjKnockedOut, undefined);
  assert.ok(DATA.oursScenes.bjKnockedOut, 'it is kept as ours');
});
