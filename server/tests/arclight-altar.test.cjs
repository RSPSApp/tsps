// Run after `yarn build`: node --test tests/arclight-altar.test.cjs
//
// Making Arclight (Wiki: Arclight; rsprox 3333, rev 235): with three ancient shards, Darklight is combined on the
// Catacombs of Kourend altar (loc 28900 at 1663,10047), and away from the altar the shards on Darklight are refused.
//   tick 3081 (away from the altar): if_buttont shard (19677) on Darklight (6746) -> message_game mesbox, then
//     OBJECTBOX_DOUBLE (interface 11) with both items: "You require additional power from the catacombs altar to
//     create Arclight."
//   tick 4099-4105 (at the altar): oploct on the altar with Darklight -> "Combine Darklight with three ancient
//     shards?" Yes./No. (interface 219, script 58); Yes (resume 219:1 sub=1) -> message_game mesbox, then OBJECTBOX
//     (interface 193) with Arclight: "You combine Darklight with the shards and it seems to glow in your hands
//     creating Arclight. Your Arclight has 1000 charges.", Arclight in Darklight's slot, 32 shards -> 29.
// Everything here is real dispatch: real packets through the connection, the real plugins, the real inventory,
// dialogue manager and prompt. The one stand-in is the Equipment Stats Wield (which does not close the question):
// it is played by emptying the slot.
const assert = require('node:assert/strict');
const path = require('node:path');
const { test, before, after } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const { ClientConnection } = require('../dist/net/NetworkBuilder');

const core = PluginManager.getCoreApi();
const I = core.ItemIdentifiers;
const MESBOX = 115;
const REFUSAL = 'You require additional power from the catacombs altar to create Arclight.';
const MADE = 'You combine Darklight with the shards and it seems to glow in your hands creating Arclight. Your Arclight has 1000 charges.';
const QUESTION = 'Combine Darklight with three ancient shards?';
let next = 2950;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  PluginManager.loadFromDirectory(path.resolve(__dirname, '../plugins'));
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(1663, 10047);
  PluginManager.emitServerStartup({});
});
after(() => PluginManager.emitServerShutdown({}));

function actor(t, at = [1664, 10048]) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++); p.setUsername('arclight' + next); p.setRegistered(true); p.setLocation(new core.Location(at[0], at[1], 0)); p.needsPlacement = false;
  const c = new ClientConnection(channel); c.player = p;
  const boxes = [], typed = [], scripts = [];
  const sender = p.getPacketSender(), dialogues = p.getDialogueManager();
  const startDialogues = dialogues.startDialogues.bind(dialogues);
  t.mock.method(dialogues, 'startDialogues', (builder) => { boxes.push(builder.getDialogues().get(0)); return startDialogues(builder); });
  const sendTypedMessage = sender.sendTypedMessage.bind(sender);
  t.mock.method(sender, 'sendTypedMessage', (type, text, ...rest) => { typed.push([type, text]); return sendTypedMessage(type, text, ...rest); });
  const sendClientScript = sender.sendClientScript.bind(sender);
  t.mock.method(sender, 'sendClientScript', (...args) => { scripts.push(args); return sendClientScript(...args); });
  t.after(() => { PluginManager.emitPlayerLogout({ player: p, username: p.getUsername() }); p.setRegistered(false); core.TaskManager.cancelTasks(p.getIndex()); });
  return { p, c, boxes, typed, scripts };
}
async function drain(f) { for (let i = 0; i < 12; i++) { core.TaskManager.processWalkTo(f.p.getIndex()); f.p.getMovementQueue().process(); core.TaskManager.process(); } }
async function send(f, packet) { await f.c.dispatch([packet]); f.c.processTurnPackets(); await drain(f); }
function give(f, shards = 32) {
  f.p.getInventory().add(new core.Item(I.DARKLIGHT, 1), true);
  if (shards) f.p.getInventory().add(new core.Item(I.ANCIENT_SHARD, shards), true);
}
const slotOf = (f, id) => f.p.getInventory().getSlotForItemId(id);
const shards = (f) => f.p.getInventory().getAmount(I.ANCIENT_SHARD);
async function useOnAltar(f) {
  await send(f, { type: 'item_on_object', widgetId: 149 << 16, objectId: core.ObjectIdentifiers.ALTAR_52, itemId: I.DARKLIGHT, slot: slotOf(f, I.DARKLIGHT), x: 1663, y: 10047 });
}
const answer = (f, option) => send(f, { type: 'dialogue_continue', widgetId: (219 << 16) | 1, childIndex: option });

test('shards used on Darklight away from the altar are refused in the captured item box, and nothing is spent', async (t) => {
  const f = actor(t, [3222, 3218]); give(f);
  await send(f, { type: 'inventory_use_on', slot: slotOf(f, I.ANCIENT_SHARD), itemId: I.ANCIENT_SHARD, target: { kind: 'inventory', slot: slotOf(f, I.DARKLIGHT) } });
  assert.equal(f.boxes.length, 1);
  assert.ok(f.boxes[0] instanceof core.DoubleItemStatementDialogue, 'OBJECTBOX_DOUBLE (interface 11)');
  assert.deepEqual(f.boxes[0].getItemIds(), [I.ANCIENT_SHARD, I.DARKLIGHT]);
  assert.equal(f.boxes[0].getText(), REFUSAL);
  assert.deepEqual(f.typed, [[MESBOX, REFUSAL]], 'and the same line in the chat, as a mesbox');
  assert.equal(shards(f), 32);
  assert.ok(slotOf(f, I.DARKLIGHT) >= 0 && slotOf(f, I.ARCLIGHT) < 0);
});

test('Darklight on the altar asks before it spends anything', async (t) => {
  const f = actor(t); give(f);
  await useOnAltar(f);
  const prompt = f.scripts.find((args) => args[0] === 58);
  assert.ok(prompt, 'the question opens');
  assert.deepEqual([prompt[1], prompt[2]], [QUESTION, 'Yes.|No.']);
  assert.equal(shards(f), 32);
  assert.ok(slotOf(f, I.DARKLIGHT) >= 0 && slotOf(f, I.ARCLIGHT) < 0, 'still Darklight until the answer');
});

test('Yes combines: Arclight with 1000 charges in Darklight\'s slot, three shards spent, the captured item box', async (t) => {
  const f = actor(t); give(f);
  const slot = slotOf(f, I.DARKLIGHT);
  await useOnAltar(f);
  await answer(f, 1);
  assert.equal(slotOf(f, I.ARCLIGHT), slot);
  assert.equal(require('../plugins/items/Arclight.plugin').state(f.p.getInventory().getItems()[slot]).charges, 1000);
  assert.equal(shards(f), 29, 'rsprox 3333: 32 shards become 29');
  assert.equal(f.boxes.length, 1);
  assert.ok(f.boxes[0] instanceof core.ItemStatementDialogue, 'OBJECTBOX (interface 193)');
  assert.equal(f.boxes[0].getItemId(), I.ARCLIGHT);
  assert.equal(f.boxes[0].getText(), MADE);
  assert.deepEqual(f.typed, [[MESBOX, MADE]]);
});

test('No leaves Darklight and the shards alone', async (t) => {
  const f = actor(t); give(f);
  await useOnAltar(f);
  await answer(f, 2);
  assert.ok(slotOf(f, I.DARKLIGHT) >= 0 && slotOf(f, I.ARCLIGHT) < 0);
  assert.equal(shards(f), 32);
  assert.deepEqual(f.boxes, []);
});

test('Yes after the shards are gone makes no Arclight', async (t) => {
  const f = actor(t); give(f);
  await useOnAltar(f);
  f.p.getInventory().deleteNumber(I.ANCIENT_SHARD, 30);
  await answer(f, 1);
  assert.ok(slotOf(f, I.DARKLIGHT) >= 0 && slotOf(f, I.ARCLIGHT) < 0);
  assert.equal(shards(f), 2);
  assert.deepEqual(f.boxes, []);
});

test('Yes after the Darklight has left the inventory (wielded while the question was open) spends nothing', async (t) => {
  const f = actor(t); give(f);
  const slot = slotOf(f, I.DARKLIGHT);
  await useOnAltar(f);
  f.p.getInventory().deleteAtSlot(slot, 1); // the Equipment Stats Wield leaves the old object detached, still saying Darklight
  await answer(f, 1);
  assert.equal(shards(f), 32, 'no shards lost');
  assert.equal(f.p.getInventory().getAmount(I.ARCLIGHT), 0);
  assert.deepEqual(f.boxes, []);
  assert.deepEqual(f.typed, []);
});
