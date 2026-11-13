// Run after `yarn build`: node --test tests/extreme-energy-potion.test.cjs
// Wiki (Extreme energy potion): 40% run energy a dose, no other effect.
const assert = require('node:assert/strict');
const path = require('node:path');
const { test, before } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { TaskManager } = require('../dist/game/task/TaskManager');
const { ItemIdentifiers: I } = require('../dist/util/ItemIdentifiers');
const { Item } = require('../dist/game/model/Item');
let Potions;
before(async () => {
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize(process.cwd());
  PluginManager.loadFromDirectory(path.resolve(__dirname, '../plugins'));
  Potions = require('../plugins/items/Potions.plugin');
});

function drinker(t, energy) {
  const p = new Player(null); const lines = [];
  p.setRegistered(true);
  t.mock.method(p, 'getSession', () => ({ sendClientPacket: () => true }));
  t.mock.method(p, 'sendMessage', m => lines.push(m));
  t.mock.method(p, 'performAnimation', () => {});
  t.mock.method(p.getPacketSender(), 'sendTypedMessage', (type, m) => { lines.push(m); return p.getPacketSender(); });
  t.after(() => { p.setRegistered(false); TaskManager.cancelTasks(p); });
  p.setRunEnergy(energy);
  return { p, lines };
}

test('each dose drinks for 40% run energy and leaves the next dose, then a vial', t => {
  const chain = [I.EXTREME_ENERGY_POTION_4_, I.EXTREME_ENERGY_POTION_3_, I.EXTREME_ENERGY_POTION_2_, I.EXTREME_ENERGY_POTION_1_, I.VIAL];
  for (let i = 0; i < 4; i++) {
    const f = drinker(t, 5);
    f.p.getInventory().setItem(0, new Item(chain[i], 1));
    const item = f.p.getInventory().getItems()[0];
    assert.equal(PluginManager.emitItemAction({ player: f.p, item, itemId: chain[i], slot: 0, clickType: 1, handled: false }), true, String(chain[i]));
    assert.equal(f.p.getRunEnergy(), 45, String(chain[i]));
    assert.equal(f.p.getInventory().getItems()[0].getId(), chain[i + 1]);
  }
});

test('run energy caps at 100 and no stamina effect starts', t => {
  const f = drinker(t, 80);
  Potions._test.findPotionEntry(I.EXTREME_ENERGY_POTION_4_).potion.effect(f.p);
  assert.equal(f.p.getRunEnergy(), 100);
  assert.equal(f.p.getAttribute('potions:stamina:end') ?? null, null);
});
