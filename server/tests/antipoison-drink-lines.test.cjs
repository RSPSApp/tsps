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

// rsprox: each potion's own drink line first, then its effect's lines, then the doses left
// ("You have 3 doses of potion left.", "You have 1 dose of potion left.") or "You have finished your potion."
test('a drink sends its recorded line, the effect, then the doses left', t => {
  const { Item } = require('../dist/game/model/Item');
  const drinkFrom = (id) => {
    const f = drinker(t);
    t.mock.method(f.p, 'performAnimation', () => {});
    f.p.getInventory().setItem(0, new Item(id, 1));
    const item = f.p.getInventory().getItems()[0];
    assert.equal(PluginManager.emitItemAction({ player: f.p, item, itemId: id, slot: 0, clickType: 1, handled: false }), true);
    return f.lines;
  };
  assert.deepEqual(drinkFrom(I.PRAYER_POTION_4_), [
    [ChatType.SPAM, 'You drink some of your restore prayer potion.'], [ChatType.SPAM, 'You have 3 doses of potion left.']]);
  assert.deepEqual(drinkFrom(I.ANTI_VENOM_2_), [
    [ChatType.SPAM, 'You drink some of your antivenom potion.'], [ChatType.SPAM, 'It grants you immunity from poison.'],
    [ChatType.SPAM, 'You have 1 dose of potion left.']]);
  assert.deepEqual(drinkFrom(I.SUPER_ATTACK_1_), [
    [ChatType.SPAM, 'You drink some of your attack potion.'], [ChatType.SPAM, 'You have finished your potion.']]);
});

function drinkItem(t, id, { inside = null, smash = false } = {}) {
  const { Item } = require('../dist/game/model/Item');
  const f = drinker(t);
  t.mock.method(f.p, 'performAnimation', () => {});
  if (smash) t.mock.method(f.p.getPacketSender(), 'getVarbit', (varbit) => (varbit === 5668 ? 1 : 0));
  if (inside) {
    const emit = PluginManager.emitCustomEvent.bind(PluginManager);
    t.mock.method(PluginManager, 'emitCustomEvent', (name, event, ...rest) => {
      const result = emit(name, event, ...rest);
      if (name === 'potions:area' && event?.area === inside) event.inside = true;
      return result;
    });
  }
  f.p.getInventory().setItem(0, new Item(id, 1));
  const item = f.p.getInventory().getItems()[0];
  assert.equal(PluginManager.emitItemAction({ player: f.p, item, itemId: id, slot: 0, clickType: 1, handled: false }), true);
  t.mock.restoreAll();
  return f.lines;
}

// rsprox 239/04272.txt:6910 and the 619 recorded Vampyrium supply drinks: their own spam line, and nothing after it.
test('Vampyrium supplies send only their own recorded line, at every dose', t => {
  const cases = [
    [[I.RANCID_SLIMY_POTION_4_, I.RANCID_SLIMY_POTION_1_], 'You drink the rancid slimy potion. You feel oddly robust.'],
    [[I.FOUL_CHUNKY_POTION_4_, I.FOUL_CHUNKY_POTION_1_], 'You drink the foul chunky potion. You feel oddly reinvigorated.'],
    [[I.RANK_FROTHY_POTION_4_, I.RANK_FROTHY_POTION_1_], 'You drink the rank frothy potion. You feel oddly powerful.'],
    [[I.JAR_OF_CONGEALED_BLOOD], 'You eat the congealed blood. It tastes better than expected and leaves you feeling fully refreshed.'],
  ];
  for (const [ids, line] of cases) {
    for (const id of ids) assert.deepEqual(drinkItem(t, id, { inside: 'vampyrium' }), [[ChatType.SPAM, line]], String(id));
  }
});

// rsprox 236/03932.txt:72353-72354 and 237/01104.txt:464410 (62 recorded): the drink line, the finished line, then the smash.
test('with vial smashing on, the last dose says it is finished before the smash', t => {
  assert.deepEqual(drinkItem(t, I.SUPER_ATTACK_1_, { smash: true }), [
    [ChatType.SPAM, 'You drink some of your attack potion.'], [ChatType.SPAM, 'You have finished your potion.'],
    [ChatType.SPAM, 'You quickly smash the empty vial using the trick a Barbarian taught you.']]);
});

// rsprox.net recs 433, 435 (rev 232) and 3034 (rev 231): Sanfew serum(4) sends both immunity lines,
// then its drink line, then the doses left, already immune or not.
test('Sanfew serum: poison and disease immunity lines before the drink line', t => {
  const expected = (left) => [
    [ChatType.SPAM, "You're temporarily immunised against poison."], [ChatType.SPAM, "You've become immunised against disease."],
    [ChatType.SPAM, 'You drink some of your Sanfew Serum.'], [ChatType.SPAM, left]];
  assert.deepEqual(drinkItem(t, I.SANFEW_SERUM_4_), expected('You have 3 doses of potion left.'));
  assert.deepEqual(drinkItem(t, I.SANFEW_SERUM_1__2), expected('You have finished your potion.'));
});
