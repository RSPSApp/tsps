// Run after `yarn build`: node --test tests/rogue-trader-start.test.cjs
//
// Issue #2623, the start of Rogue Trader: after The Feud, Talk-to on Ali Morrisane (3533, Al Kharid) had no Rogue
// Trader at all. Captures (rsprox 3169 rev 232, 1756 rev 227; found by varbits 911-920 and NPC 3533):
//   3169 t8217-8289: the introduction, Siamun's errand (912 = 1), "So what's in this for me?" (914 = 1), the blackjack
//     errand (911 = 1), "What's in this" again, the runes briefing (913 = 1), "Ok I'll see what I can do.", the junk
//     line and Ali's Discount Wares.
//   1756 t13560-13599: "Ok I'll get on to it." does not end the talk, it goes on to the next errand.
// Varbits: 911 blackjacks, 912 clothes, 913 runes, 914 cheapflights. The wording is held in plugins/npcs/data/
// rogue-trader.json (the generated npc-dialogues.json has no page for the miniquest's own conversations). Real packets, real dispatch.
const assert = require('node:assert/strict');
const { before, after, test } = require('node:test');
const H = require('./helpers/rogue-trader-replay.cjs');

before(async () => { await H.setup(); });
after(() => H.teardown());

test('3169: the whole start by "So what\'s in this for me?", line by line and varbit by varbit, ends in the shop', async (t) => {
  const f = H.actor(t);
  await H.replay(f, H.fixture('start-whats-in'));
  assert.equal(H.varbit(f, 912), 1); assert.equal(H.varbit(f, 914), 1); assert.equal(H.varbit(f, 911), 1); assert.equal(H.varbit(f, 913), 1);
  assert.equal(f.shops.length, 1, 'Ok opens Ali\'s Discount Wares');
});

test('1756: "Ok I\'ll get on to it." goes on to the next errand instead of ending, to the runes menu', async (t) => {
  const f = H.actor(t);
  await H.replay(f, H.fixture('start-ok'));
  assert.equal(H.varbit(f, 912), 1); assert.equal(H.varbit(f, 911), 1); assert.equal(H.varbit(f, 913), 1);
  assert.notEqual(H.varbit(f, 914), 1, 'no discount without asking what is in it');
  assert.equal(f.shops.length, 0);
});

test('the start is saved and its varbits come back at login', async (t) => {
  const f = H.actor(t);
  await H.replay(f, H.fixture('start-ok'));
  const { PlayerSave } = require('../dist/game/entity/impl/player/persistence/PlayerSave');
  const PM = require('../dist/plugins/PluginManager').PluginManager;
  PM.emitPlayerLogout({ player: f.p, username: f.p.getUsername() });
  const g = H.actor(t);
  PlayerSave.fromPlayer(f.p).applyToPlayer(g.p);
  PM.emitPlayerLogin({ player: g.p, username: g.p.getUsername(), isNewAccount: false });
  assert.deepEqual(g.varbits.slice().sort(), [[911, 1], [912, 1], [913, 1]]);
});

test('before The Feud is complete Ali is still The Feud\'s and nothing starts', async (t) => {
  const f = H.actor(t, { feud: false });
  await H.talk(f); await H.read(f);
  assert.deepEqual(f.varbits, []);
});

test('without Icthlarin\'s Little Helper there is no Siamun errand: blackjacks first (Wiki transcript, not captured)', async (t) => {
  const f = H.actor(t, { icthlarin: false });
  await H.talk(f);
  const { lines, pending } = await H.read(f);
  assert.ok(lines.some((l) => l.includes("My friend in Sophanem... Ahh never mind him")));
  assert.ok(lines.some((l) => l.includes("There's a blackjack seller in Pollnivneach")));
  assert.ok(!lines.some((l) => l.includes('Siamun')));
  assert.deepEqual(f.varbits, [[911, 1]]);
  assert.deepEqual(pending.options, ["So what's in this for me?", "Ok I'll get on to it."], 'ours: the first menu is the same in the Wiki');
});

test('talking again after the start shows the reminder menu (Wiki transcript; the capture has only the later runes form)', async (t) => {
  const f = H.actor(t);
  await H.replay(f, H.fixture('start-ok'));
  f.p.closeInterruptibleInterfaces();
  await H.talk(f);
  const { lines, pending } = await H.read(f);
  assert.ok(lines.includes('Still selling.'));
  assert.ok(lines.includes('Is there any chance of getting you to look up a merchant to supply me?'));
  assert.deepEqual(pending.options, ['Who did you want me to talk to again?', "Ya, I'll get to it soon."]);
});
