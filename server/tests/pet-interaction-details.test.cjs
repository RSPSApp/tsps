const assert = require('node:assert/strict');
const path = require('node:path');
const { before, after, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const { ClientConnection } = require('../dist/net/NetworkBuilder');
const { PlayerSave } = require('../dist/game/entity/impl/player/persistence/PlayerSave');
const { encodeSound } = require('../dist/net/protocol/ClientProtocol');
let core, next = 1700;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins')); core = PM.getCoreApi();
  core.RegionManager.init(); core.RegionManager.loadMapFiles(2611, 3295); PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));
function actor(t) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel)); p.setIndex(next++); p.setUsername('petdetails' + next);
  p.setRegistered(true); p.setLocation(new core.Location(2611, 3295, 0)); p.needsPlacement = false;
  const c = new ClientConnection(channel); c.player = p;
  const messages = [], packets = [];
  t.mock.method(p.getPacketSender(), 'sendMessage', m => { messages.push(m); return p.getPacketSender(); });
  const send = p.getSession().sendClientPacket.bind(p.getSession());
  t.mock.method(p.getSession(), 'sendClientPacket', frame => { packets.push(Buffer.from(frame)); return send(frame); });
  t.after(() => {
    PM.emitPlayerLogout({ player: p, username: p.getUsername() }); p.setRegistered(false);
    core.TaskManager.cancelTasks(p.getIndex());
    for (const n of [...core.World.getNpcs()]) if (n?.getOwner?.() === p) core.World.getNpcs().remove(n);
  });
  return { p, c, messages, packets };
}
async function send(f, message) {
  await f.c.dispatch([message]); f.c.processTurnPackets();
  for (let i = 0; i < 10; i++) { core.TaskManager.processWalkTo(f.p.getIndex()); f.p.getMovementQueue().process(); core.TaskManager.process(); }
}
async function summon(f, id = core.ItemIdentifiers.LIL_ZIK) {
  f.p.getPacketSender().sendInterfaceRemoval(); f.p.getInventory().add(new core.Item(id), true);
  await send(f, { type: 'inventory_action', itemId: id, slot: f.p.getInventory().getSlotForItemId(id), widgetId: 149 << 16, option: 'Drop', optionIndex: 5 });
  const n = f.p.getAttribute('pets:current'); assert.ok(n?.isRegistered()); return n;
}
async function pickup(f, n) {
  n.setLocation(f.p.getLocation().clone().add(1, 0));
  const op = n.getDefinition().getActions().findIndex(x => x === 'Pick-up') + 1; assert.ok(op > 0);
  await send(f, { type: 'npc_option', index: n.getIndex(), clickType: op });
}
const sounds = f => f.packets.filter(b => b[0] === encodeSound(2582, { loops: 1, delay: 20 })[0]);

test('native Lil Zik pickup sends captured synth2582 delay20 once; duplicate pickup cannot mint items or replay it', async t => {
  const f = actor(t), n = await summon(f); f.packets.length = 0;
  await pickup(f, n); await pickup(f, n);
  assert.deepEqual(sounds(f), [encodeSound(2582, { loops: 1, delay: 20 })]);
  assert.equal(f.p.getInventory().getAmount(core.ItemIdentifiers.LIL_ZIK), 1);
  assert.equal(f.p.getAttribute('pets:current'), null);
});
test('full inventory and foreign native pickup send no sound and preserve the real follower', async t => {
  const f = actor(t), g = actor(t), n = await summon(f);
  while (f.p.getInventory().getFreeSlots()) f.p.getInventory().add(new core.Item(core.ItemIdentifiers.RAKE), false);
  f.packets.length = 0; g.packets.length = 0; await pickup(f, n); await pickup(g, n);
  assert.deepEqual(sounds(f), []); assert.deepEqual(sounds(g), []); assert.equal(f.p.getAttribute('pets:current'), n);
  f.p.getInventory().deleteAtSlot(27); await pickup(f, n);
  assert.equal(f.p.getInventory().getAmount(core.ItemIdentifiers.LIL_ZIK), 1);
  assert.deepEqual(sounds(f), [encodeSound(2582, { loops: 1, delay: 20 })]);
});
test('real bank deposit/withdraw and save/fresh login preserve pickup sound and single item ownership', async t => {
  const f = actor(t), id = core.ItemIdentifiers.LIL_ZIK, n = await summon(f); await pickup(f, n);
  f.p.getBank(0).open(); core.Bank.deposit(f.p, id, f.p.getInventory().getSlotForItemId(id), 1, false);
  core.Bank.withdraw(f.p, id, f.p.getBank(0).getSlotForItemId(id), 1, 0);
  PM.emitPlayerLogout({ player: f.p, username: f.p.getUsername() });
  const g = actor(t); PlayerSave.fromPlayer(f.p).applyToPlayer(g.p); PM.emitPlayerLogin({ player: g.p, username: g.p.getUsername(), isNewAccount: false }); g.p.needsPlacement = false;
  assert.equal(g.p.getInventory().getAmount(id), 1); g.p.getInventory().deleteAtSlot(g.p.getInventory().getSlotForItemId(id));
  const restored = await summon(g, id); g.packets.length = 0; await pickup(g, restored);
  assert.deepEqual(sounds(g), [encodeSound(2582, { loops: 1, delay: 20 })]); assert.equal(g.p.getInventory().getAmount(id), 1);
});
for (const key of ['LIL_ZIK', 'GIANT_SQUIRREL', 'PET_KRAKEN']) test(`native Probita recovery uses the actual cache item name for ${key}`, async t => {
  const f = actor(t), id = core.ItemIdentifiers[key]; assert.ok(id > 0);
  f.p.setAttribute('pets.owned', [id]);
  const n = core.NPC.create(core.NpcIdentifiers.PROBITA, f.p.getLocation().clone().add(1, 0)); core.World.getNpcs().add(n); t.after(() => core.World.getNpcs().remove(n));
  await send(f, { type: 'npc_option', index: n.getIndex(), clickType: n.getDefinition().getActions().findIndex(x => x === 'Check') + 1 });
  assert.equal(f.p.getInterfaceId(), 148);
  const index = [...core.CacheDefinitions.getEnumValues(985)].find(([, item]) => item === id)[0];
  for (const [child, slot] of [[11, 6 + 5 * index], [37, 0], [37, 0]]) await send(f, { type: 'widget_action', widgetId: (148 << 16) | child, groupId: 148, childId: child, slot, buttonNum: 1 });
  assert.equal(f.p.getInventory().getAmount(id), 1);
  // rsprox 229/02785:21374: "You reclaim your Beaver." (its token sentence is gone with the tokens, Wiki 10 Sep 2025).
  assert.equal(f.messages.filter(m => m.startsWith('You reclaim your ')).length, 1);
  assert.ok(f.messages.includes(`You reclaim your ${core.ItemDefinition.forId(id).getName()}.`), JSON.stringify(f.messages));
});
