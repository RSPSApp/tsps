// node --test tests/mm2-lemon-candle-note.test.cjs   (after yarn build)
// Monkey Madness II (#6688): the mysterious note is decrypted with lemon juice and heat, not by heat alone. Wiki: "Use your
// pestle and mortar on the lemon to apply it to the note", then "Use the note on the nearby candles". Real Player and Inventory;
// the quest plugin is attached through the real PluginManager and driven by its item-on-item, item-on-object and object events.
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');

const core = PluginManager.getCoreApi();
const I = core.ItemIdentifiers;
const CANDLES = core.ObjectIdentifiers.CANDLES_17;
const PLAIN = I.MYSTERIOUS_NOTE, LEMON_NOTE = 19507, HEATED = I.MYSTERIOUS_NOTE_3;
let index = 31000;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  core.ObjectDefinition.init();
  require('../plugins/quests/quests/MonkeyMadnessII.Quest')(PluginManager.createApi('MonkeyMadnessIITest'));
});

function actor(t, items) {
  const p = new Player(new PlayerSession({ kind: 'test', isOpen: () => true, send: () => true }))
    .setUsername(`mm2note${index}`).setIndex(index++);
  p.setRegistered(true); p.setNeedsPlacement(false);
  p.setLocation(new core.Location(2476, 3466, 0));
  t.after(() => { p.setRegistered(false); core.TaskManager.cancelTasks(p.getIndex()); });
  for (const [id, n] of items) p.getInventory().adds(id, n);
  const messages = [];
  p.sendMessage = (text) => { messages.push(text); };
  return { p, messages };
}
const count = (p, id) => p.getInventory().getAmount(id);
const useItems = (p, a, b) => {
  const inv = p.getInventory();
  const sa = inv.getSlotForItemId(a), sb = inv.getSlotForItemId(b);
  return PluginManager.emitItemOnItem({ player: p, usedItem: inv.get(sa), usedItemId: a, usedItemSlot: sa,
    usedWithItem: inv.get(sb), usedWithItemId: b, usedWithItemSlot: sb, handled: false });
};
const candleObject = () => new core.GameObject(CANDLES, new core.Location(2476, 3467), 10, 0);
const useOnCandles = (p, itemId) => PluginManager.emitItemOnObject({ player: p, itemId, objectId: CANDLES,
  object: candleObject(), location: p.getLocation(), handled: false });
const investigate = (p) => {
  const object = candleObject();
  const clickType = core.ObjectDefinition.forId(CANDLES).getActions().findIndex(a => a === 'Investigate') + 1;
  assert.ok(clickType > 0, 'candles have an Investigate option');
  return PluginManager.emitObjectInteraction({ player: p, object, objectId: CANDLES, location: object.getLocation(), clickType, handled: false });
};

test('lemon, pestle and mortar, candles, in order: one note at every step', (t) => {
  const { p } = actor(t, [[PLAIN, 1], [I.LEMON, 1], [I.PESTLE_AND_MORTAR, 1]]);
  assert.equal(useItems(p, I.PESTLE_AND_MORTAR, I.LEMON), true);
  assert.deepEqual([count(p, PLAIN), count(p, LEMON_NOTE), count(p, I.LEMON), count(p, I.PESTLE_AND_MORTAR)], [0, 1, 0, 1]);
  assert.equal(useOnCandles(p, LEMON_NOTE), true);
  assert.deepEqual([count(p, LEMON_NOTE), count(p, HEATED)], [0, 1]);
});

test('the plain note cannot be revealed by the candles, by use or by Investigate', (t) => {
  const { p, messages } = actor(t, [[PLAIN, 1]]);
  assert.equal(useOnCandles(p, PLAIN), true);
  assert.equal(investigate(p), true);
  assert.deepEqual([count(p, PLAIN), count(p, LEMON_NOTE), count(p, HEATED)], [1, 0, 0]);
  assert.ok(!messages.some(m => /hidden writing/.test(m)));
});

test('Investigate on the candles heats only the lemon note', (t) => {
  const { p } = actor(t, [[LEMON_NOTE, 1]]);
  assert.equal(investigate(p), true);
  assert.deepEqual([count(p, LEMON_NOTE), count(p, HEATED)], [0, 1]);
});

test('mashing the lemon without the note keeps the lemon and makes nothing', (t) => {
  const { p } = actor(t, [[I.LEMON, 1], [I.PESTLE_AND_MORTAR, 1]]);
  assert.equal(useItems(p, I.LEMON, I.PESTLE_AND_MORTAR), true);
  assert.deepEqual([count(p, I.LEMON), count(p, LEMON_NOTE), count(p, PLAIN)], [1, 0, 0]);
});
