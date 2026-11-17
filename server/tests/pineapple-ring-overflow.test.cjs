// Native item-use, the real Cooking registration, inventory and ground-item owners.
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, after, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const { ClientConnection } = require('../dist/net/NetworkBuilder');
const { MultiChatboxPrompt } = require('../dist/game/model/menu/MultiChatboxPrompt');
const { CREATION_MENU_GROUP_ID, CREATION_MENU_FIRST_ITEM_COMPONENT } = require('../dist/net/packet/PacketSender');
let core, serial = 0;
const errors = [], originalError = console.error;
before(async () => {
  console.error = (...args) => { errors.push(args.map(String).join(' ')); originalError(...args); };
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  core = PM.getCoreApi();
  require('../plugins/skills/Cooking.plugin').register(PM.createApi('Cooking'));
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(3226, 3218);
  PM.emitServerStartup({});
});
after(() => {
  try { PM.emitServerShutdown({}); assert.deepEqual(errors, [], 'no required hook errors'); }
  finally { console.error = originalError; }
});
function fixture(t, freeSlots = 0, fruitName = 'pineapple') {
  const packets = [];
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true,
    send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const session = new PlayerSession(channel);
  session.sendClientPacket = packet => { packets.push(packet); return true; };
  const p = new Player(session); session.setPlayer(p);
  p.setUsername('fruitcheck' + ++serial);
  p.setLongUsername(core.Misc.stringToLongBigInt(p.getUsername()));
  p.setAttribute('bot-skip-persistence', true);
  p.setLocation(new core.Location(3226, 3218, 0));
  assert.equal(core.World.getPlayers().add(p), true);
  p.needsPlacement = false;
  const inv = p.getInventory(), id = name => core.CacheDefinitions.getObjId(name);
  for (const name of ['knife', fruitName]) inv.add(new core.Item(id(name), 1), false);
  inv.add(new core.Item(id('bread'), inv.getFreeSlots() - freeSlots), false);
  const knifeSlot = inv.getSlotForItemId(id('knife')), fruitSlot = inv.getSlotForItemId(id(fruitName));
  const knife = inv.getItems()[knifeSlot];
  const c = new ClientConnection(channel); c.player = p;
  const send = async packet => { await c.dispatch([packet]); c.processTurnPackets(); };
  const use = () => send({type: 'inventory_use_on', itemId: id('knife'), slot: knifeSlot,
    target: {kind: 'inventory', id: id(fruitName), slot: fruitSlot}});
  const floor = () => core.ItemOnGroundManager.ownedBy(p.getUsername()).filter(g =>
    !g.isPendingRemoval() && g.getPosition().equals(p.getLocation()) && g.getPrivateArea() === p.getPrivateArea());
  const choose = async output => {
    const menu = p.getCreationMenu();
    assert.ok(menu, 'native fruit choice must have a current skillmulti menu');
    const index = menu.getItems().indexOf(id(output));
    assert.ok(index >= 0);
    return send({type: 'dialogue_continue', widgetId: (CREATION_MENU_GROUP_ID << 16) |
      (CREATION_MENU_FIRST_ITEM_COMPONENT + index), childIndex: 1});
  };
  t.after(() => {
    p.closeInterruptibleInterfaces();
    PM.emitPlayerDisconnect({player:p, username:p.getUsername()});
    for (const g of core.ItemOnGroundManager.ownedBy(p.getUsername())) core.ItemOnGroundManager.deregister(g);
    core.ItemOnGroundManager.process();
    core.TaskManager.cancelTasks(p); core.TaskManager.cancelTasks(p.getIndex());
    if (p.isRegistered()) core.World.getPlayers().removes(p);
  });
  const turn = () => {
    core.World.processCycle = (core.World.processCycle + 1) & 0x7fffffff;
    core.TaskManager.processWalkTo(p.getIndex());
    p.getMovementQueue().beginCycle(); p.getMovementQueue().process();
    core.TaskManager.process();
  };
  const slice = () => choose('pineapple_ring');
  return {p, inv, id, knife, knifeSlot, fruitSlot, send, use, choose, slice, floor, packets, turn};
}
test('pineapple knife-use mounts the recorded Slice/Dice skillmulti menu', async t => {
  const f = fixture(t, 3); await f.use();
  const menu = f.p.getCreationMenu();
  assert.ok(menu, 'native use must open skillmulti rather than a text choice');
  assert.equal(menu.getTitle(), 'How would you like to cut the pineapple?');
  assert.deepEqual(menu.getItems(), [f.id('pineapple_ring'), f.id('pineapple_chunks')]);
  assert.deepEqual(menu.getOptions(), {mode:12, maxAmount:1, lastAmount:1,
    labels:['Slice it into 4 rings', 'Dice it']});
});
test('Slice preserves all four rings with no free inventory slot', async t => {
  const f = fixture(t), before = f.p.getSkillManager().getExperience(core.Skill.COOKING);
  assert.equal(f.inv.getFreeSlots(), 0); await f.use(); await f.slice();
  const floorRings = f.floor().filter(g => g.getItem().getId() === f.id('pineapple_ring'));
  assert.equal(f.inv.getAmount(f.id('pineapple_ring')) + floorRings.reduce((sum,g) => sum+g.getItem().getAmount(),0), 4,
    'Slice conserves four rings across inventory and owned ground');
  assert.equal(f.inv.getAmount(f.id('pineapple')), 0);
  assert.equal(f.inv.getAmount(f.id('pineapple_ring')), 1);
  assert.equal(f.inv.getItems()[f.knifeSlot], f.knife);
  assert.equal(f.p.getSkillManager().getExperience(core.Skill.COOKING), before);
});

test('Slice fits exactly the available slots and spills the remainder once', async t => {
  for (const free of [1, 2, 3, 4]) await t.test(`${free} free slots before cutting`, async t => {
    const f = fixture(t, free), ring = f.id('pineapple_ring');
    const others = () => f.inv.getItems().filter(item => item.getId() > 0 &&
      ![f.id('pineapple'), ring].includes(item.getId())).map(item => [item.getId(), item.getAmount(), item.getMeta()]);
    const before = others(), xp = f.p.getSkillManager().getExperience(core.Skill.COOKING);
    await f.use(); await f.slice();
    assert.equal(f.inv.getAmount(ring), Math.min(4, free + 1));
    assert.equal(f.floor().reduce((n,g) => n + (g.getItem().getId() === ring ? g.getItem().getAmount() : 0), 0), Math.max(0, 3-free));
    assert.deepEqual(others(), before);
    assert.equal(f.p.getSkillManager().getExperience(core.Skill.COOKING), xp);
    await f.send({type:'dialogue_continue', widgetId:(CREATION_MENU_GROUP_ID<<16)|CREATION_MENU_FIRST_ITEM_COMPONENT, childIndex:1});
    assert.equal(f.inv.getAmount(ring), Math.min(4, free + 1), 'repeat selection cannot produce more rings');
    assert.equal(f.p.getCreationMenu(), null);
  });
});

test('overflow belongs to its player and native Take preserves it across full and partial pickup', async t => {
  const f = fixture(t), other = fixture(t, 3), ring = f.id('pineapple_ring');
  await f.use(); await f.slice();
  const pile = f.floor().find(g => g.getItem().getId() === ring);
  assert.ok(pile); assert.equal(pile.getItem().getAmount(), 3);
  assert.equal(pile.getOwner(), f.p.getUsername());
  assert.equal(core.ItemOnGroundManager.canOperate(other.p, pile, 3), false);
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  const take = async actor => {
    now += 600; // Advance the real shared pickup cooldown without sleeping.
    await actor.send({type:'ground_item_action', itemId:ring, x:3226, y:3218, option:'Take', stackId:pile.getId()});
    for (let n=0;n<3;n++) actor.turn();
  };
  await take(other);
  assert.equal(other.inv.getAmount(ring), 0);
  await take(f); assert.equal(pile.getItem().getAmount(), 3, 'full bag leaves all overflow on ground');
  const bread = f.id('bread');
  await f.send({type:'inventory_action', itemId:bread, slot:f.inv.getSlotForItemId(bread), widgetId:149<<16, option:'Drop', optionIndex:5});
  await take(f);
  assert.equal(f.inv.getAmount(ring), 2); assert.equal(pile.getItem().getAmount(), 2);
  assert.equal(f.inv.getAmount(ring)+pile.getItem().getAmount(), 4);
});

test('Dice and other fruits keep their original output and consume no knife', async t => {
  const f = fixture(t); await f.use(); await f.choose('pineapple_chunks');
  assert.equal(f.inv.getAmount(f.id('pineapple_chunks')), 1);
  assert.equal(f.inv.getItems()[f.knifeSlot], f.knife); assert.equal(f.floor().length, 0);
  const lemon = fixture(t, 0, 'lemon'); await lemon.use();
  assert.deepEqual(MultiChatboxPrompt.getPending(lemon.p)?.options, ['Dice','Slice']);
  await lemon.send({type:'dialogue_continue',widgetId:MultiChatboxPrompt.OPTIONS_WIDGET_ID,childIndex:2});
  assert.equal(lemon.inv.getAmount(lemon.id('lemon_slices')), 1);
  assert.equal(lemon.inv.getItems()[lemon.knifeSlot], lemon.knife); assert.equal(lemon.floor().length, 0);
});

test('closing and real ingredient Drop invalidate the pending native selection', async t => {
  for (const action of ['close','drop']) await t.test(action, async t => {
    const f = fixture(t, 3); await f.use();
    if (action === 'close') f.p.closeInterruptibleInterfaces();
    else await f.send({type:'inventory_action', itemId:f.id('pineapple'), slot:f.fruitSlot, widgetId:149<<16, option:'Drop', optionIndex:5});
    await f.send({type:'dialogue_continue', widgetId:(CREATION_MENU_GROUP_ID<<16)|CREATION_MENU_FIRST_ITEM_COMPONENT, childIndex:1});
    assert.equal(f.inv.getAmount(f.id('pineapple_ring')), 0);
    assert.equal(f.inv.getAmount(f.id('pineapple')), action === 'close' ? 1 : 0);
    assert.equal(f.inv.getItems()[f.knifeSlot], f.knife);
  });
});
