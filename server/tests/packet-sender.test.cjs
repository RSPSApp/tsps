// Run after `yarn build`: node --test tests/packet-sender.test.cjs
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { PacketSender } = require('../dist/net/packet/PacketSender');

test('server chat translates legacy colour tags into native font markup', () => {
  const frames = [];
  const sender = Object.assign(Object.create(PacketSender.prototype), {
    player: { getSession: () => ({ sendClientPacket: frame => frames.push(frame) }) },
  });
  sender.sendMessage('@red@Warning @whi@white @gre@green @bla@black');
  sender.sendTypedMessage(14, '@dre@Pet @or2@announcement');
  const text = frame => frame.toString('latin1', 3, frame.indexOf(0, 3));
  assert.equal(text(frames[0]), '<col=ff0000>Warning <col=ffffff>white <col=00ff00>green <col=000000>black');
  assert.equal(text(frames[1]), '<col=800000>Pet <col=ff7000>announcement');
  sender.sendMessage('<col=123456>Native</col> email@example.com @xyz@');
  assert.equal(text(frames[2]), '<col=123456>Native</col> email@example.com @xyz@');

  const { encodeChatMessage } = require('../dist/net/protocol/ClientProtocol');
  for (const kind of ['public', 'private_in', 'private_out', 'channel', 'clan', 'trade']) {
    assert.equal(text(encodeChatMessage(kind, '@red@literal')), '@red@literal', `${kind} keeps player-authored text literal`);
  }
  assert.equal(text(encodeChatMessage('server', '@blu@Notice')), '<col=0000ff>Notice');
});

const sender = (interfaceId, tracked) => ({
  resetInterfaceState: () => interfaceId,
  closeTrackedInterfaces: () => tracked,
  endBankSearch() {},
  emitInterfaceClosed() {},
  sendSubInterface() {},
  player: { getSession: () => ({ sendClientPacket: () => true }) },
});

test('sendInterfaceRemoval keeps its `this` contract when nothing is open', () => {
  // The Slayer assignment chain calls .sendMessage() on this result; an
  // undefined return used to crash the right-click path with no interface open.
  const none = sender(-1, false);
  assert.equal(PacketSender.prototype.sendInterfaceRemoval.call(none), none);
  const tracked = sender(1, true);
  assert.equal(PacketSender.prototype.sendInterfaceRemoval.call(tracked), tracked);
});

test('sendSystemUpdate emits the SYSTEM_UPDATE packet (opcode 220, big-endian seconds)', () => {
  // The legacy implementation wrote opcode 114 (WIDGET_SET_ANIMATION) with a
  // little-endian short, which the web client misparsed and stalled the batch.
  const frames = [];
  const fake = {
    resetInterfaceState: () => -1,
    closeTrackedInterfaces: () => false,
    sendSubInterface() {},
    player: { getSession: () => ({ sendClientPacket: (frame) => { frames.push(frame); return true; } }) },
  };
  const result = PacketSender.prototype.sendSystemUpdate.call(fake, 125);
  assert.equal(result, fake);
  assert.equal(frames.length, 1);
  assert.deepEqual(Buffer.from(frames[0]), Buffer.from([220, 0, 0, 0, 125]));
});

test('sendTab runs toplevel_sidebutton_switch (script 915) rather than writing a 1-byte opcode 106', () => {
  // 106 is WIDGET_SET_HIDDEN (uid + hidden, five bytes), so the old one-byte packet was
  // dropped by the encoder and the tab never switched: quick-prayer setup, alchemy's return
  // to the spellbook and ring alchemy's inventory tab all silently did nothing.
  const frames = [];
  const fake = Object.assign(Object.create(PacketSender.prototype), {
    player: { getSession: () => ({ sendClientPacket: (frame) => { frames.push(Buffer.from(frame)); return true; } }) },
  });
  for (const tab of [3, 5, 6]) {
    const result = fake.sendTab(tab);
    assert.equal(result, fake, 'chainable');
    const frame = frames.at(-1);
    assert.equal(frame[0], 170, 'RUN_CLIENT_SCRIPT');
    assert.equal(frame.readUInt16BE(1), 8, 'script id + one integer argument');
    assert.equal(frame.readUInt16BE(3), 915, 'toplevel_sidebutton_switch');
    assert.equal(frame[5], 1, 'one argument');
    assert.equal(frame[6], 1, 'integer argument tag');
    assert.equal(frame.readInt32BE(7), tab, 'the tab index');
  }
  assert.equal(frames.length, 3);
});

test('sendCollectionLogSnapshot emits opcode 190 with the owned collection_log items', () => {
  let frame;
  const fake = {
    player: { getSession: () => ({ sendClientPacket: (bytes) => { frame = bytes; return true; } }) },
  };
  const result = PacketSender.prototype.sendCollectionLogSnapshot.call(fake, [
    { slot: 0, itemId: 13247, quantity: 1 },
    { slot: 1, itemId: 20659, quantity: 1 },
  ]);
  assert.equal(result, fake);
  const buf = Buffer.from(frame);
  assert.equal(buf[0], 190);
  assert.equal(buf.readUInt16BE(1), 18);
  assert.equal(buf.readUInt16BE(3), 2);
  assert.equal(buf.readUInt16BE(5), 0);
  assert.equal(buf.readUInt16BE(7), 13247);
  assert.equal(buf.readInt32BE(9), 1);
  assert.equal(buf.readUInt16BE(13), 1);
  assert.equal(buf.readUInt16BE(15), 20659);
  assert.equal(buf.readInt32BE(17), 1);
});

test("a dialogue box opened again resends its texts: the client turns 'Click here to continue' into 'Please wait...' on its own", () => {
  // Two NPC lines in a row (Gee): the second line's "Click here to continue" was skipped as
  // unchanged, so the client kept the "Please wait..." it shows after a continue click.
  const { FrameUpdater } = require('../dist/util/FrameUpdater');
  const frames = [];
  const updater = new FrameUpdater();
  const fake = {
    chatboxGroupId: -1,
    subInterfaceTargets: new Map(),
    rememberSubInterface: PacketSender.prototype.rememberSubInterface,
    emitInterfaceClosed() {},
    player: {
      getSession: () => ({ sendClientPacket: (frame) => { frames.push(Buffer.from(frame)); return true; } }),
      getFrameUpdater: () => updater,
    },
  };
  const CONTINUE = (231 << 16) | 5;
  const sent = () => frames.filter((frame) => frame.includes('Click here to continue')).length;
  for (let line = 0; line < 2; line++) {
    PacketSender.prototype.sendChatboxInterface.call(fake, 231);
    PacketSender.prototype.sendString.call(fake, 'Click here to continue', CONTINUE);
  }
  assert.equal(sent(), 2, 'sent with every line');
  // Without reopening, an unchanged text is still skipped.
  PacketSender.prototype.sendString.call(fake, 'Click here to continue', CONTINUE);
  assert.equal(sent(), 2);
});

test('chatbox replacement, explicit close and interface removal notify their previous group', () => {
  const { PluginManager } = require('../dist/plugins/PluginManager');
  const original = PluginManager.emitCustomEvent;
  const closed = [];
  const fake = Object.assign(Object.create(PacketSender.prototype), {
    chatboxGroupId: -1,
    subInterfaceTargets: new Map(),
    player: {
      getSession: () => ({ sendClientPacket: () => true }),
      getFrameUpdater: () => ({ clearGroup() {} }),
      getInterfaceId: () => -1,
    },
  });
  PluginManager.emitCustomEvent = (name, event) => {
    if (name === 'interface:closed') closed.push([event.interfaceId, fake.getChatboxGroupId()]);
  };
  try {
    fake.sendChatboxInterface(233);
    fake.sendChatboxInterface(231);
    fake.sendChatboxInterface(231);
    fake.closeInterface(231);
    fake.sendChatboxInterface(233);
    fake.closeTrackedInterfaces();
    assert.deepEqual(closed, [[233, 231], [231, -1], [233, -1]]);
  } finally { PluginManager.emitCustomEvent = original; }
});


test('interface script packets preserve 64-bit price totals', () => {
  const { encodeWidgetRunScript } = require('../dist/net/protocol/ClientProtocol');
  const frame = encodeWidgetRunScript(785, [12345678901n]);
  assert.equal(frame[8], 2, 'long argument tag');
  assert.equal(frame.readBigInt64BE(9), 12345678901n);
});

test('interface transitions emit close before replacement and changed after assignment', () => {
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const { PluginManager } = require('../dist/plugins/PluginManager');
  const original = PluginManager.emitCustomEvent;
  const events = [];
  PluginManager.emitCustomEvent = (name, event) => events.push([name, event.interfaceId, event.player.interfaceId]);
  try {
    const player = { interfaceId: 464 };
    Player.prototype.setInterfaceId.call(player, 465);
    Player.prototype.setInterfaceId.call(player, 465);
    Player.prototype.setInterfaceId.call(player, -1);
    assert.deepEqual(events, [
      ['interface:closed', 464, 464],
      ['interface:changed', 465, 465],
      ['interface:changed', -1, -1],
    ]);
    assert.equal(player.interfaceId, -1);
  } finally { PluginManager.emitCustomEvent = original; }
});


test('NPC spawn payload preserves current-cache16-bit type IDs and a16-bit index/sentinel', () => {
  const { createNpcSyncState, encodeNpcSync } = require('../dist/net/protocol/ClientProtocol');
  const local = { x:3200, y:3200, level:0 };
  const views = [49,16433,16538].map((typeId, offset) => ({
    ...local, index:7+offset, typeId, rotation:0, walkDirection:-1, runDirection:-1,
  }));
  const body = encodeNpcSync(1, local, views, createNpcSyncState()).subarray(3);
  assert.equal(body.readUInt16BE(9),21);
  // count8, three spawns(index16, flags3, offsets5+5, rotation3, type16), sentinel16.
  assert.equal(body.subarray(11).toString('hex'),'0000070000003100080000403100090000409affff');
});

test('sub-interface mount ownership survives same-ID replacement, relocation and another player',async()=>{
  require('../dist/Server').Server.installProductionPathResolver();
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize(process.cwd());
  const {PluginManager}=require('../dist/plugins/PluginManager');
  const {Player}=require('../dist/game/entity/impl/player/Player');
  const {PlayerSession}=require('../dist/net/PlayerSession');
  const {encodeWidgetCloseSub}=require('../dist/net/protocol/ClientProtocol');
  const core=PluginManager.getCoreApi();
  const target=core.CacheDefinitions.getComponentId('toplevel:overlay_atmosphere');
  const group=core.CacheDefinitions.getInterfaceId('fade_overlay');
  assert.ok(Number.isInteger(target)&&Number.isInteger(group));
  const delivered=[];
  const session=new PlayerSession({isOpen:()=>true,send:frame=>delivered.push(Buffer.from(frame))});
  const player=new Player(session);session.setPlayer(player);player.setUsername('mountowner');
  const sender=player.getPacketSender();
  const first=sender.mountSubInterface(target,group,1);
  assert.equal(Object.isFrozen(first),true,'a caller cannot mutate the sender-owned mount identity');
  assert.equal(sender.getSubInterfaceAt(target),first);
  assert.equal(sender.sendSubInterface(target,group,1),sender,'legacy chaining still returns the sender');
  const replacement=sender.getSubInterfaceAt(target);
  assert.notEqual(replacement,first,'same-ID remount has its own lifetime');
  const before=session.pendingPackets.length;
  assert.equal(sender.closeSubInterfaceMount(first),false,'delayed cleanup must not close the replacement');
  assert.equal(session.pendingPackets.length,before,'stale cleanup emits no native close packet');
  assert.equal(sender.closeSubInterfaceMount(replacement),true);
  assert.ok(session.pendingPackets.at(-1).equals(encodeWidgetCloseSub(target)));
  assert.equal(sender.getSubInterfaceAt(target),undefined);
  assert.equal(sender.closeSubInterfaceMount(replacement),false);
  const moving=sender.mountSubInterface(target,group,1);
  sender.sendSubInterface(target+1,group,1);
  assert.equal(sender.getSubInterfaceAt(target),undefined,'a group moved to another parent no longer occupies its old target');
  assert.equal(sender.closeSubInterfaceMount(moving),false);
  const moved=sender.getSubInterfaceAt(target+1);
  const otherSession=new PlayerSession({isOpen:()=>true,send:()=>{}}),other=new Player(otherSession);otherSession.setPlayer(other);
  const otherSender=other.getPacketSender(),otherMount=otherSender.mountSubInterface(target+1,group,1);
  assert.equal(otherSender.closeSubInterfaceMount(moved),false,'a different player cannot supply this sender a valid mount token');
  assert.equal(otherSender.getSubInterfaceAt(target+1),otherMount);
  assert.equal(otherSender.closeSubInterfaceMount(otherMount),true);
  assert.equal(sender.closeSubInterfaceMount(moved),true,'the legitimate current owner can still clean up');
  const prayerTarget=(161<<16)|81;
  const prayer=sender.mountSubInterface(prayerTarget,541,1);
  sender.sendTabInterface(5,17200);
  const afterPrayer=session.pendingPackets.length;
  assert.equal(sender.closeSubInterfaceMount(prayer),false,'legacy tab replacement also retires an old token');
  assert.equal(session.pendingPackets.length,afterPrayer);
  assert.equal(sender.getSubInterfaceAt(prayerTarget).groupId,77);
  const chatTarget=(162<<16)|568;
  const chat=sender.mountSubInterface(chatTarget,231,0);
  sender.sendChatboxInterface(233);
  assert.equal(sender.closeSubInterfaceMount(chat),false);
  const currentChat=sender.getSubInterfaceAt(chatTarget);
  sender.closeInterface(233);
  assert.equal(sender.closeSubInterfaceMount(currentChat),false,'native chatbox close retires the mount');
  sender.sendChatboxInterface(231);
  const removedChat=sender.getSubInterfaceAt(chatTarget);
  sender.sendInterfaceRemoval();
  assert.equal(sender.closeSubInterfaceMount(removedChat),false,'modal removal retires the chatbox mount');
  await Promise.resolve();
  assert.ok(delivered.length,'the actual session delivers the native mount/close packets');
});

test('a crater full of ground items goes as a snapshot and deltas, each inside one game message', () => {
  // A browser-host world drops the connection on a message over 64 KiB; Bounty Hunter bot loot
  // made one ground-items snapshot pass that, so dying there disconnected the player.
  const { MAX_GAME_MESSAGE_BYTES } = require('../dist/net/BinaryChannel');
  const frames = [];
  const player = { getUsername: () => 'p', getIndex: () => 1, getSession: () => ({ sendClientPacket: (frame) => { frames.push(frame); return true; } }) };
  const items = Array.from({ length: 5000 }, (_, id) => ({
    getId: () => id, getItem: () => ({ getId: () => 526, getAmount: () => 1 }),
    getPosition: () => ({ getX: () => 3423, getY: () => 4061, getZ: () => 0 }),
  }));
  new PacketSender(player).sendGroundItems(items);
  assert.ok(frames.length > 1);
  assert.ok(frames.every((frame) => frame.length <= MAX_GAME_MESSAGE_BYTES), 'every frame fits one message');
  assert.deepEqual(frames.map((frame) => frame[0]), [54, ...frames.slice(1).map(() => 55)], 'snapshot, then deltas');
  // Header: opcode, u16 size, i32 serial, u16 stack count.
  assert.equal(frames.reduce((total, frame) => total + frame.readUInt16BE(7), 0), items.length);
  new PacketSender(player).sendGroundItems([]);
  assert.equal(frames.at(-1)[0], 54, 'an empty view still clears the client');
});

test('a spellbook re-mount keeps the quest stages that share the spell unlock varps', async () => {
  require('../dist/Server').Server.installProductionPathResolver();
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize(process.cwd());
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const { PlayerSession } = require('../dist/net/PlayerSession');
  const session = new PlayerSession({ isOpen: () => true, send: () => {} });
  const player = new Player(session); session.setPlayer(player);
  const sender = player.getPacketSender();
  const MM_MAIN = 365, NORMAL_SPELLBOOK = 1151;
  sender.sendTabInterface(6, NORMAL_SPELLBOOK);
  assert.equal(sender.getVarp(MM_MAIN), 0x7fffffff, 'the login mount unlocks the Ape Atoll Dungeon Teleport');
  sender.sendConfig(MM_MAIN, 3); // Monkey Madness I re-sends its stage after the bootstrap
  sender.sendTabInterface(6, NORMAL_SPELLBOOK); // unwielding a greegree, a ferry, a spellbook change
  assert.equal(sender.getVarp(MM_MAIN), 3, 'a later mount does not mark the quest complete again');
  assert.equal(sender.getVarbit(4070), 0, 'the mount still publishes the spellbook');
});
