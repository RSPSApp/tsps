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
const { SERVER_PACKET_LENGTHS } = require('../dist/net/protocol/ServerPackets');
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
  session.setTurnPacketProcessor(() => c.processTurnPackets());
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
  return {p, inv, id, knife, knifeSlot, fruitSlot, send, use, choose, slice, floor, packets, turn, connection:c};
}

// Inspect the actual encoded client frames, rather than replacing PacketSender.
function wire(frame) {
  const opcode = frame[0], length = SERVER_PACKET_LENGTHS[opcode];
  const payload = frame.subarray(length === -2 ? 3 : length === -1 ? 2 : 1);
  if (opcode === 120) {
    const end = payload.indexOf(0);
    return {opcode, text:payload.toString('latin1',0,end), type:payload[end+1]};
  }
  if (opcode === 55) {
    const count = payload.readUInt16BE(4), upserts=[];
    for (let n=0;n<count;n++) {
      const b=payload.subarray(6+n*34,6+(n+1)*34);
      upserts.push({id:b.readInt32BE(0), itemId:b.readUInt16BE(4), amount:b.readInt32BE(6),
        created:b.readInt32BE(15), privateUntil:b.readInt32BE(19), expires:b.readInt32BE(23),
        ownerId:b.readInt32BE(27), private:b[31]===1, ownership:b[32]});
    }
    const start=6+count*34, removes=[];
    for(let n=0;n<payload.readUInt16BE(start);n++)removes.push(payload.readInt32BE(start+2+n*4));
    return {opcode,upserts,removes};
  }
  return {opcode};
}
const cuttingMessages = f => f.packets.map(wire).filter(p=>p.text?.startsWith('You cut the pineapple'));

test('successful pineapple choices send the recorded spam line once before inventory output', async t => {
  for(const [output,text] of [['pineapple_ring','You cut the pineapple into rings.'],
    ['pineapple_chunks','You cut the pineapple into chunks.']]) await t.test(output,async t=>{
    const f=fixture(t,4); await f.use(); f.packets.length=0; await f.choose(output);
    const packets=f.packets.map(wire), messages=cuttingMessages(f);
    assert.deepEqual(messages,[{opcode:120,text,type:core.ChatType.SPAM}]);
    const messageIndex=packets.findIndex(p=>p.text===text), inventoryIndex=packets.findIndex(p=>p.opcode===50||p.opcode===51);
    assert.ok(messageIndex>=0&&inventoryIndex>messageIndex,'recorded success chat precedes the committed inventory update');
    await f.send({type:'dialogue_continue',widgetId:(CREATION_MENU_GROUP_ID<<16)|CREATION_MENU_FIRST_ITEM_COMPONENT,childIndex:1});
    assert.equal(cuttingMessages(f).length,1,'stale repeat cannot announce another cut');
  });
});

test('pineapple overflow follows the real World ground lifecycle and encoded visibility boundaries', async t => {
  const f=fixture(t), other=fixture(t,3), ring=f.id('pineapple_ring');
  await f.connection.dispatch([{type:'inventory_use_on',itemId:f.id('knife'),slot:f.knifeSlot,
    target:{kind:'inventory',id:f.id('pineapple'),slot:f.fruitSlot}}]);
  core.World.process();
  assert.ok(f.p.getCreationMenu(),'World player-input pass opens the native menu');
  f.packets.length=0; other.packets.length=0;
  await f.connection.dispatch([{type:'dialogue_continue',widgetId:(CREATION_MENU_GROUP_ID<<16)|CREATION_MENU_FIRST_ITEM_COMPONENT,childIndex:1}]);
  const cutTick=core.World.getProcessCycle()+1;
  core.World.process();
  const pile=f.floor().find(g=>g.getItem().getId()===ring);
  assert.ok(pile); assert.equal(pile.getItem().getAmount(),3);
  // World ages ground before player input; the committed cut counts as its first floor tick.
  assert.equal(pile.getTick(),1); assert.equal(pile.getAgedCycle(),cutTick);
  const relevant=actor=>actor.packets.map(wire).filter(p=>p.opcode===55);
  const adds=actor=>relevant(actor).flatMap(p=>p.upserts).filter(p=>p.id===pile.getId());
  const removes=actor=>relevant(actor).flatMap(p=>p.removes).filter(id=>id===pile.getId());
  assert.equal(adds(f).length,1); assert.equal(adds(other).length,0);
  assert.deepEqual(adds(f)[0],{id:pile.getId(),itemId:ring,amount:3,created:cutTick-1,
    privateUntil:cutTick+99,expires:cutTick+299,ownerId:f.p.getIndex(),private:true,ownership:1});
  assert.equal(core.ItemOnGroundManager.canSee(f.p,pile),true);
  assert.equal(core.ItemOnGroundManager.canSee(other.p,pile),false);
  assert.deepEqual(cuttingMessages(f),[{opcode:120,text:'You cut the pineapple into rings.',type:core.ChatType.SPAM}]);
  while(pile.getTick()<99)core.World.process();
  assert.equal(core.World.getProcessCycle(),cutTick+98);
  assert.equal(adds(other).length,0); assert.equal(removes(f).length,0);
  core.World.process();
  assert.equal(pile.getTick(),100); assert.equal(core.World.getProcessCycle(),cutTick+99);
  assert.equal(core.ItemOnGroundManager.canSee(other.p,pile),true);
  assert.equal(removes(f).length,1,'private owner view is removed before the public update');
  assert.equal(adds(f).at(-1).private,false);
  assert.deepEqual(adds(other).at(-1),{id:pile.getId(),itemId:ring,amount:3,created:cutTick-1,
    privateUntil:0,expires:cutTick+299,ownerId:-1,private:false,ownership:2});
  while(pile.getTick()<299)core.World.process();
  assert.ok(core.World.getItems().includes(pile)); assert.equal(removes(other).length,0);
  core.World.process();
  assert.equal(core.World.getProcessCycle(),cutTick+299);
  assert.equal(pile.isPendingRemoval(),true); assert.equal(core.World.getItems().includes(pile),false);
  assert.equal(removes(other).length,1); assert.equal(removes(f).length,2);
  assert.equal(cuttingMessages(f).length,1,'aging and reveal cannot repeat success chat');
});
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
  assert.deepEqual(cuttingMessages(lemon), [], 'other fruit does not acquire pineapple feedback');
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
    assert.deepEqual(cuttingMessages(f), [], 'a cancelled choice cannot announce a successful cut');
  });
});
