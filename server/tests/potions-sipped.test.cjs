// Run after `yarn build`: node --test tests/potions-sipped.test.cjs
// Varp tracking_potions_sipped (4519): +1 per potion dose on every world, sent right after the drink
// line and before the doses-left line (rsprox.net 236/03932 ticks 13, 95, 167), and at login when
// above 0 (03932: 0 -> 166). Food, beers and the area-locked raid potions never move it (rsprox.net
// index, every inventory Drink from rev 228). docs/potion-drink-lines.md#potions-sipped.
const assert = require('node:assert/strict');
const path = require('node:path');
const { test, before, after } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { TaskManager } = require('../dist/game/task/TaskManager');
const { ItemIdentifiers: I } = require('../dist/util/ItemIdentifiers');
const { Item } = require('../dist/game/model/Item');

const VARP = 4519;
const ATTRIBUTE = 'potions:sipped';
let Potions;

before(async () => {
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize(process.cwd());
  PluginManager.loadFromDirectory(path.resolve(__dirname, '../plugins'));
  PluginManager.emitServerStartup({}); // content potions (goading) register at startup
  Potions = require('../plugins/items/Potions.plugin');
});

after(() => PluginManager.emitServerShutdown({}));

/** A player whose spam lines and varps land in one list, in the order they were sent. */
function drinker(t, sipped) {
  const p = new Player(null);
  const out = [];
  p.setRegistered(true);
  if (sipped !== undefined) p.setAttribute(ATTRIBUTE, sipped);
  t.mock.method(p, 'getSession', () => ({ sendClientPacket: () => true }));
  t.mock.method(p, 'sendMessage', (m) => out.push(m));
  t.mock.method(p, 'performAnimation', () => {});
  const sender = p.getPacketSender();
  t.mock.method(sender, 'sendTypedMessage', (type, m) => { out.push(m); return sender; });
  const sendConfig = sender.sendConfig.bind(sender);
  t.mock.method(sender, 'sendConfig', (id, value) => { if (id === VARP) out.push(`varp ${value}`); return sendConfig(id, value); });
  t.after(() => { p.setRegistered(false); TaskManager.cancelTasks(p); });
  return { p, out };
}

function drink(f, itemId) {
  f.p.getInventory().setItem(0, new Item(itemId, 1));
  const item = f.p.getInventory().getItems()[0];
  assert.equal(PluginManager.emitItemAction({ player: f.p, item, itemId, slot: 0, clickType: 1, handled: false }), true, String(itemId));
}

test('a potion dose counts right after its drink line, before the doses left', (t) => {
  const f = drinker(t, 166);
  drink(f, I.SUPER_RESTORE_4_);
  assert.deepEqual(f.out, ['You drink some of your super restore potion.', 'varp 167', 'You have 3 doses of potion left.']);
  assert.equal(f.p.getAttribute(ATTRIBUTE), 167);
});

test('the first sip counts from 0 and the last dose counts too', (t) => {
  const f = drinker(t);
  drink(f, I.PRAYER_POTION_1_);
  assert.deepEqual(f.out, ['You drink some of your restore prayer potion.', 'varp 1', 'You have finished your potion.']);
});

test('a potion with its own lines counts after the first (rsprox 238/04242: goading)', (t) => {
  const f = drinker(t, 322);
  drink(f, I.GOADING_POTION_4_);
  assert.equal(f.out[0], 'You drink some of your goading potion.');
  assert.equal(f.out[1], 'varp 323');
  assert.equal(f.out.filter((line) => String(line).startsWith('varp')).length, 1);
});

test('beers and spirits do not count', (t) => {
  for (const id of [I.BEER, I.KARAMJAN_RUM]) {
    const f = drinker(t, 5);
    drink(f, id);
    assert.ok(f.out.length > 0, `${id} was drunk`);
    assert.equal(f.out.some((line) => String(line).startsWith('varp')), false, String(id));
    assert.equal(f.p.getAttribute(ATTRIBUTE), 5);
  }
});

test('what counts, by registration: potions and mixes yes; drinks and area-locked potions no', () => {
  const sipped = (id) => Potions._test.findPotionEntry(id).potion.sipped;
  for (const id of [I.SUPER_RESTORE_4_, I.EGNIOL_POTION_4_, I.MOONLIGHT_POTION_4_, I.DIVINE_SUPER_COMBAT_POTION_4_,
    I.SANFEW_SERUM_4_, I.SARADOMIN_BREW_4_, I.GOADING_POTION_4_, I.STAMINA_POTION_4_, I.ATTACK_MIX_2_]) {
    assert.equal(sipped(id), true, String(id));
  }
  const tea = [...Potions._test.registeredPotions()].find((potion) => potion.name === 'Cup of tea');
  assert.equal(tea.sipped, false, 'cup of tea');
  for (const id of [I.BEER, I.KARAMJAN_RUM, I.RANK_FROTHY_POTION_4_]) {
    assert.equal(sipped(id), false, String(id));
  }
  const gourd = [...Potions._test.registeredPotions()].find((potion) => potion.area === 'chambers-of-xeric');
  assert.equal(gourd.sipped, false, gourd.name);
});

test('login sends the saved count, and nothing when there is none', (t) => {
  const saved = drinker(t, 318);
  PluginManager.emitPlayerLogin({ player: saved.p, username: 'sipper', isNewAccount: false });
  assert.ok(saved.out.includes('varp 318'));
  const fresh = drinker(t);
  PluginManager.emitPlayerLogin({ player: fresh.p, username: 'fresh', isNewAccount: true });
  assert.equal(fresh.out.includes('varp 0'), false);
});

test('"potions:sip" counts a dose another plugin drinks; "potions:sipped" answers the count', (t) => {
  const f = drinker(t, 140);
  PluginManager.emitCustomEvent('potions:sip', { player: f.p });
  assert.deepEqual(f.out, ['varp 141']);
  const query = { player: f.p, count: 0 };
  PluginManager.emitCustomEvent('potions:sipped', query);
  assert.equal(query.count, 141);
});
