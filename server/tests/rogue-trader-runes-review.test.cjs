// Run after `yarn build`: node --test tests/rogue-trader-runes-review.test.cjs
//
// Review of the runes errand (2623/mid-review.md): buying a whole casket needs room first, a player's rune shop keeps its
// stock across opens (so purchases and the casket's runes stay), the runedoku opens as the capture does (script 2524, the
// mainmodal open, before interface 292: rsprox 3170 t344), and Aubury's proposal is only offered through the generated
// dialogue's own menu, never over a Rune Mysteries conversation.
const assert = require('node:assert/strict');
const { before, after, test } = require('node:test');
const H = require('./helpers/rogue-trader-replay.cjs');

let core;
before(async () => { core = await H.setup(); });
after(() => H.teardown());

const randoms = (t, value) => t.mock.method(Math, 'random', () => value); // other code also calls Math.random: one constant
const COINS = () => core.ItemIdentifiers.COINS;

async function reachOffer(f, t) {
  randoms(t, 0.0);
  H.setState(f, { clothes: 1, blackjacks: 1, runes: 2, stallvar: 1 });
  await H.talk(f); await H.read(f); await H.choose(f, 1); await H.read(f);
  await H.choose(f, 1); await H.read(f); await H.choose(f, 1);
  return H.read(f);
}

test('Buy all the runes takes no coins when the runes do not fit', async (t) => {
  const f = H.actor(t);
  f.p.getInventory().add(new core.Item(COINS(), 100000), true);
  const start = f.p.getInventory().getAmount(COINS());
  for (let i = 0; i < 27; i++) f.p.getInventory().add(new core.Item(core.ItemIdentifiers.BRONZE_SWORD, 1), true);
  const { pending } = await reachOffer(f, t);
  assert.match(pending.options[0], /^Buy all the runes for \d+$/);
  await H.choose(f, 1);
  assert.equal(f.p.getInventory().getAmount(COINS()), start, 'nothing was paid');
  for (const id of [554, 555, 556, 557]) assert.equal(f.p.getInventory().getAmount(id), 0);
  assert.ok(f.messages.some((m) => /enough space in your inventory/i.test(m)), f.messages.join('|'));
});

test('Buy all the runes pays and gives every rune when they fit', async (t) => {
  const f = H.actor(t);
  f.p.getInventory().add(new core.Item(COINS(), 100000), true);
  const start = f.p.getInventory().getAmount(COINS());
  const { pending } = await reachOffer(f, t);
  const price = Number(pending.options[0].replace(/\D/g, ''));
  await H.choose(f, 1);
  assert.equal(f.p.getInventory().getAmount(COINS()), start - price);
  for (const id of [554, 555, 556, 557]) assert.ok(f.p.getInventory().getAmount(id) > 0);
});

test('a player\'s rune shop is registered once and keeps its stock when opened again', async (t) => {
  const registered = [];
  const register = core.ShopManager.registerShop.bind(core.ShopManager);
  t.mock.method(core.ShopManager, 'registerShop', (definition) => { registered.push(definition.getId()); return register(definition); });
  const f = H.actor(t);
  H.setState(f, { clothes: 1, blackjacks: 1, runes: 5, stallvar: 1 });
  for (let i = 0; i < 2; i++) {
    await H.talk(f, 'Trade'); await H.read(f); await H.choose(f, 1); await H.read(f); await H.choose(f, 3);
  }
  assert.equal(registered.length, 1, 'the second open reuses the shop');
  const id = f.shops[0];
  assert.equal(f.shops[1], id);
  // a purchase made in between stays
  core.ShopManager.shopsById.get(id).stock.set(554, 7);
  await H.talk(f, 'Trade'); await H.read(f); await H.choose(f, 1); await H.read(f); await H.choose(f, 3);
  assert.equal(core.ShopManager.shopsById.get(id).stock.get(554), 7);
});

test('the casket\'s runes are added to the player\'s retail stock above its base, to fall back with the restock timer', async (t) => {
  const f = H.actor(t);
  const { pending } = await reachOffer(f, t);
  assert.ok(pending);
  await H.choose(f, 2); // Find out what the runes are.
  await H.talk(f, 'Trade'); await H.read(f); await H.choose(f, 1); await H.read(f); await H.choose(f, 3);
  const retail = core.ShopManager.shopsById.get(f.shops[f.shops.length - 1]);
  const dump = core.ShopManager.shopsById.get(f.shops[0]).stock.get(554); // the casket's runes are surplus: read the running stock
  assert.equal(retail.stock.get(554), 20 + dump);
  assert.equal(retail.originalAmounts.get(554), 20, 'the base stays 20, so the extra decays');
});

test('the runedoku opens as the capture does: script 2524 (-1, -1), then the interface (3170 t344)', async (t) => {
  const f = H.actor(t); randoms(t, 0.99);
  H.setState(f, { clothes: 1, blackjacks: 1, runes: 3, stallvar: 1 });
  const log = [];
  const sender = f.p.getPacketSender();
  const script = sender.sendClientScript.bind(sender), iface = sender.sendInterface.bind(sender);
  t.mock.method(sender, 'sendClientScript', (id, ...a) => { log.push(['script', id, ...a]); return script(id, ...a); });
  t.mock.method(sender, 'sendInterface', (id) => { log.push(['interface', id]); return iface(id); });
  await H.talk(f); await H.read(f); await H.choose(f, 1); await H.read(f);
  await H.choose(f, 2); await H.read(f); await H.choose(f, 3);
  const open = log.findIndex((e) => e[0] === 'interface' && e[1] === 292);
  assert.ok(open > 0, 'interface 292 opened');
  const before = log.slice(0, open).filter((e) => e[0] === 'script' && e[1] === 2524);
  assert.deepEqual(before.map((e) => e.slice(1)), [[2524, -1, -1]]);
});

test('Aubury\'s proposal is offered only to a player who has finished Rune Mysteries', async (t) => {
  const starts = [];
  const PM = require('../dist/plugins/PluginManager').PluginManager;
  const original = PM.emitCustomEvent.bind(PM);
  t.mock.method(PM, 'emitCustomEvent', (name, event) => { if (name === 'npc-dialogue:start' && event?.select) starts.push(event.player); return original(name, event); });
  const mid = H.actor(t, { runeMysteries: false }); H.aubury(mid);
  H.setState(mid, { clothes: 1, blackjacks: 1, runes: 1 });
  await H.talkTo(mid, mid.aubury);
  assert.ok(!starts.includes(mid.p), 'the Rune Mysteries conversation is left alone');
  const done = H.actor(t); H.aubury(done);
  H.setState(done, { clothes: 1, blackjacks: 1, runes: 1 });
  await H.talkTo(done, done.aubury);
  assert.ok(starts.includes(done.p));
});
