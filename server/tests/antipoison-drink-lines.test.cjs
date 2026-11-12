// Run after `yarn build`: node --test tests/antipoison-drink-lines.test.cjs
// Recorded lines after the drink line (spam): antipoisons send none (473 drinks, rsprox_transcripts/223/00014.txt
// to 237/01105.txt); anti-venom "It cures your venom." when venomed (235/03340.txt), else "It grants you immunity
// from poison." (234/00799.txt); anti-venom+ and extended "It grants you immunity from venom." (226/01637.txt, 224/01439.txt).
const assert = require('node:assert/strict');
const path = require('node:path');
const { test, before } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { TaskManager } = require('../dist/game/task/TaskManager');
const { CombatPoisonEffect } = require('../dist/game/task/impl/CombatPoisonEffect');
const { ItemIdentifiers: I } = require('../dist/util/ItemIdentifiers');
const { ChatType } = require('../dist/net/protocol/ClientProtocol');
let Potions;
before(async () => {
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize(process.cwd());
  PluginManager.loadFromDirectory(path.resolve(__dirname, '../plugins'));
  Potions = require('../plugins/items/Potions.plugin');
});

function drinker(t, { venom = false, poison = 0 } = {}) {
  const p = new Player(null); const lines = [];
  p.setRegistered(true);
  t.mock.method(p, 'getSession', () => ({ sendClientPacket: () => true }));
  t.mock.method(p, 'sendMessage', m => lines.push(['game', m]));
  t.mock.method(p.getPacketSender(), 'sendTypedMessage', (type, m) => { lines.push([type, m]); return p.getPacketSender(); });
  if (poison) { p.setPoisonDamage(poison); p.setVenomed(venom); }
  t.after(() => { p.setRegistered(false); CombatPoisonEffect.suspend(p); TaskManager.cancelTasks(p); });
  return { p, lines, drink(id) { Potions._test.findPotionEntry(id).potion.effect(p); } };
}

test('antipoisons send no line of their own', t => {
  for (const id of [I.ANTIPOISON_4_, I.SUPERANTIPOISON_4_, I.ANTIDOTE_4_, I.ANTIDOTE_4__3]) {
    const f = drinker(t); f.drink(id);
    assert.deepEqual(f.lines, [], String(id));
  }
});

test('an antipoison weakens venom to poison with no line of its own (rsprox 234/03280.txt:69820)', t => {
  const f = drinker(t, { venom: true, poison: 8 }); f.drink(I.ANTIPOISON_4_);
  assert.equal(f.p.isVenomed(), false, 'the venom is now poison');
  assert.deepEqual(f.lines, []);
});

test('anti-venom: "It cures your venom." when venomed, else immunity from poison', t => {
  const venomed = drinker(t, { venom: true, poison: 8 }); venomed.drink(I.ANTI_VENOM_4_);
  assert.equal(venomed.p.isVenomed(), false);
  assert.deepEqual(venomed.lines, [[ChatType.SPAM, 'It cures your venom.']]);
  const clean = drinker(t); clean.drink(I.ANTI_VENOM_4_);
  assert.deepEqual(clean.lines, [[ChatType.SPAM, 'It grants you immunity from poison.']]);
});

test('anti-venom+ and extended anti-venom+: immunity from venom', t => {
  for (const id of [I.ANTI_VENOM_4__3, I.EXTENDED_ANTI_VENOM_4_]) {
    const f = drinker(t); f.drink(id);
    assert.deepEqual(f.lines, [[ChatType.SPAM, 'It grants you immunity from venom.']], String(id));
  }
});
