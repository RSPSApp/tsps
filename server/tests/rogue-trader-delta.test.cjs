// Run after `yarn build`: node --test tests/rogue-trader-delta.test.cjs
//
// Delta review of #2639 (2623/maintainer-delta-review.md):
//  1. Every errand still at 0 is given on a later visit, in the introduction's order (Siamun's if Icthlarin's Little Helper is done,
//     the blackjack seller's, the runes), so a player who left a menu of the introduction can still finish: each state of the table
//     below is walked through Aubury, the seller, the urchin and Siamun to Ali's thanks and the 914 reward.
//  2. A per-player shop leaves "Ali's Discount Wares." (the page's open_shop target) the only shop with that exact name.
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
const PROPOSAL = "Actually, I'm here with a business proposal from Ali Morrisane.";
const COINS = () => core.ItemIdentifiers.COINS;

/** An NPC of this id beside the given tile (kept per fixture so it is made once), the player moved next to it. */
function npcAt(f, id, x, y) {
  f.npcs ??= new Map();
  core.RegionManager.loadMapFiles(x, y);
  f.p.setLocation(new core.Location(x - 1, y, 0)); f.p.setNeedsPlacement(false);
  if (!f.npcs.has(id)) {
    const npc = core.NPC.create(id, new core.Location(x, y, 0));
    core.World.getNpcs().add(npc); npc.setRegistered(true);
    f.npcs.set(id, npc);
  }
  f.p.closeInterruptibleInterfaces();
  return f.npcs.get(id);
}
const seller = (f) => npcAt(f, 6135, 3351, 2971);
const urchin = (f) => npcAt(f, 3539, 3355, 2972);
const siamun = (f) => npcAt(f, 4205, 3314, 2785);
const aubury = (f) => npcAt(f, 2886, 3253, 3403);
const ali = (f) => { f.p.closeInterruptibleInterfaces(); f.p.setLocation(new core.Location(3303, 3211, 0)); f.p.setNeedsPlacement(false); };

/** The rest of the line by real talks: the seller, the urchin and the theft, Aubury, Siamun, then Ali's thanks. */
async function throughToTheFinish(f) {
  f.p.getInventory().add(new core.Item(COINS(), 1000), true);
  for (let i = 0; i < 3; i++) f.p.getInventory().add(new core.Item(core.ItemIdentifiers.BLUE_DYE, 1), true);
  H.Quests().questNamed('Rune Mysteries').complete(f.p, done);
  await H.talkTo(f, seller(f)); await H.read(f); await H.choose(f, 1); await H.read(f); // proposal, the cunning plan
  assert.equal(state(f).blackjacks, 2);
  await H.talkTo(f, urchin(f)); await H.read(f); await H.choose(f, 2); await H.read(f); // 100 gold
  await H.talkTo(f, seller(f)); await H.read(f); // the theft
  await H.talkTo(f, seller(f)); await H.read(f); // he will change them
  assert.equal(state(f).blackjacks, 4);
  await H.talkTo(f, aubury(f));
  const menu = await H.read(f);
  await H.choose(f, menu.pending.options.indexOf(PROPOSAL) + 1); await H.read(f);
  assert.equal(state(f).runes, 2);
  await H.talkTo(f, siamun(f)); await H.read(f); await H.choose(f, 2); await H.read(f);
  assert.equal(state(f).clothes, 3);
  ali(f);
  await H.talk(f);
  const { lines } = await H.read(f);
  assert.ok(lines.some((l) => l.includes('selfless help')), 'Ali thanks the player');
  assert.equal(state(f).cheapflights, 1);
}

// the state the player is left in, whether Icthlarin's Little Helper is already done when they left ('start') or only by the later visit
const TABLE = [
  ["left the first menu with Siamun's errand given: {clothes:1}", { clothes: 1 }, 'start', ['blackjack seller', 'rune']],
  ['left the second menu: {clothes:1, blackjacks:1}', { clothes: 1, blackjacks: 1 }, 'start', ['rune']],
  ["left the first menu without Icthlarin's Little Helper, done by the later visit: {blackjacks:1}", { blackjacks: 1 }, 'later', ['Siamun', 'rune']],
  ["left the runes briefing, Icthlarin's Little Helper done later: {blackjacks:1, runes:1}", { blackjacks: 1, runes: 1 }, 'later', ['Siamun']],
];
for (const [name, start, ilh, expectedLines] of TABLE) {
  test('1. ' + name + ' gets what is missing on the next visit and can finish', async (t) => {
    const f = H.actor(t, { icthlarin: ilh === 'start' });
    H.setState(f, { ...start });
    if (ilh === 'later') finishIlh(f);
    await H.talk(f);
    const first = await H.read(f);
    for (const word of expectedLines) assert.ok(first.lines.some((l) => l.includes(word)), `${word}: ${first.lines.join(' | ')}`);
    assert.deepEqual(['clothes', 'blackjacks', 'runes'].map((k) => state(f)[k]), [1, 1, 1], 'every errand is given');
    const missing = [!start.blackjacks && 911, !start.clothes && 912, !start.runes && 913].filter(Boolean);
    assert.deepEqual(f.varbits.map(([id]) => id).filter((id) => [911, 912, 913].includes(id)).sort(), missing, 'only the missing varbits are sent');
    f.p.closeInterruptibleInterfaces();
    await H.talk(f); // a second visit gives nothing again
    const second = await H.read(f);
    assert.ok(!second.lines.some((l) => l.includes('one more product type') || l.includes('cloth merchant Siamun') || l.includes('blackjack seller in Pollnivneach')), 'not twice');
    await throughToTheFinish(f);
  });
}

test('1. a player who is done gets no catch-up', async (t) => {
  const done3 = H.actor(t);
  H.setState(done3, { clothes: 3, blackjacks: 4, runes: 5, toldAli: 1, garments: 1, cheapflights: 1 });
  await H.talk(done3);
  const { lines } = await H.read(done3);
  assert.ok(!lines.some((l) => l.includes('cloth merchant Siamun') || l.includes('blackjack seller in Pollnivneach') || l.includes('one more product type')));
  assert.deepEqual(done3.varbits, [], 'and no varbit changes');
});

test('2. a per-player shop does not make "Ali\'s Discount Wares." ambiguous (the page\'s open_shop needs exactly one)', async (t) => {
  const f = H.actor(t);
  H.setState(f, { clothes: 1, blackjacks: 1, runes: 5, stallvar: 1 });
  await H.talk(f, 'Trade'); await H.read(f); await H.choose(f, 1); await H.read(f); await H.choose(f, 3);
  const exact = core.ShopDefinition.all().filter((shop) => shop.getName() === "Ali's Discount Wares.");
  assert.equal(exact.length, 1);
  assert.ok(core.ShopDefinition.all().some((shop) => shop.getName() === "Ali's Discount wares."), 'the per-player shop is there, named as the capture has it');
});
