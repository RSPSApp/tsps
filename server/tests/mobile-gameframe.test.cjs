// Run after `yarn build`: node --test tests/mobile-gameframe.test.cjs
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const {
  decodeClientPackets,
  encodeGameframeBootstrap,
  XPDROPS_ENABLED_ATTRIBUTE,
  MOBILE_CLIENT_ATTRIBUTE,
  MOBILE_GAMEFRAME_ROOT,
  orbsGroupFor,
  resolveGameframeRoot,
} = require('../dist/net/protocol/ClientProtocol');

const player = (attrs) => ({ getAttribute: (key) => attrs[key] });

test('desktop clients boot their saved layout root', () => {
  assert.equal(resolveGameframeRoot(player({ 'client-layout-root': 548 })), 548);
  assert.equal(resolveGameframeRoot(player({ 'client-layout-root': 164 })), 164);
  assert.equal(resolveGameframeRoot(player({ 'client-layout-root': 161 })), 161);
});

test('missing or unknown saved roots fall back to 161', () => {
  assert.equal(resolveGameframeRoot(player({})), 161);
  assert.equal(resolveGameframeRoot(player({ 'client-layout-root': 601 })), 161);
});

test('mobile clients are locked to the mobile gameframe', () => {
  assert.equal(MOBILE_GAMEFRAME_ROOT, 601);
  assert.equal(resolveGameframeRoot(player({ [MOBILE_CLIENT_ATTRIBUTE]: true, 'client-layout-root': 548 })), 601);
  assert.equal(resolveGameframeRoot(player({ [MOBILE_CLIENT_ATTRIBUTE]: true, 'client-layout-root': 164 })), 601);
});

test('the mobile gameframe mounts its own orbs (orbs_osm), as live does', () => {
  assert.equal(orbsGroupFor(MOBILE_GAMEFRAME_ROOT), 897);
  for (const root of [161, 164, 548]) assert.equal(orbsGroupFor(root), 160);
});

test('handshake decodes the mobile client type byte', () => {
  const name = Buffer.from('Tester\0', 'latin1');
  const mobile = Buffer.concat([name, Buffer.from([0, 1])]);
  const desktop = Buffer.concat([name, Buffer.from([0, 0])]);
  const legacy = Buffer.concat([name, Buffer.from([0])]);
  const frame = (payload) => Buffer.concat([Buffer.from([202, payload.length]), payload]);

  assert.deepEqual(decodeClientPackets(frame(mobile)), [
    { type: 'handshake', name: 'Tester', clientType: 1 },
  ]);
  assert.deepEqual(decodeClientPackets(frame(desktop)), [
    { type: 'handshake', name: 'Tester', clientType: 0 },
  ]);
  assert.deepEqual(decodeClientPackets(frame(legacy)), [
    { type: 'handshake', name: 'Tester', clientType: 0 },
  ]);
});

function welcomeHarness({ mobile = false, wilderness = false, bot = false, newAccount = false, root = 161, config = {} } = {}) {
  const hooks = {}, events = [], packets = [];
  const player = {
    getLocation: () => ({ wilderness }),
    isPlayerBot: () => bot,
    getUsername: () => 'WelcomeTester',
    getAttribute: key => key === MOBILE_CLIENT_ATTRIBUTE ? mobile : key === 'client-layout-root' ? root : false,
    getSession: () => ({ sendClientPacket: packet => packets.push(['frame', packet]) }),
    getPacketSender: () => ({
      sendRootInterface: id => packets.push(['root', id]),
      sendInterfaceFlags: (...args) => packets.push(['flags', ...args]),
      sendString: (text, uid) => packets.push(['text', uid, text]),
    }),
  };
  require('../plugins/interface/WelcomeScreen.plugin').register({
    core: { MOBILE_CLIENT_ATTRIBUTE, XPDROPS_ENABLED_ATTRIBUTE, encodeGameframeBootstrap,
      resolveGameframeRoot, Wilderness: { isInLocation: location => location.wilderness } },
    onPlayerLogin: fn => { hooks.login = fn; },
    onCustomEvent: (name, fn) => { hooks[name] = fn; },
    onInterfaceActionButton: (id, fn) => { hooks.play = fn; },
    onPlayerDisconnect: fn => { hooks.disconnect = fn; },
    onPlayerLogout: fn => { hooks.logout = fn; },
    emitCustomEvent: name => events.push(name),
    getPluginConfig: (key, fallback) => key in config ? config[key] : fallback,
    log() {},
  });
  hooks.login({ player, isNewAccount: newAccount });
  return { hooks, player, packets, events };
}

test('welcome screen waits for synchronous login initialization and restores the saved frame once', async () => {
  for (const root of [161, 164, 548]) {
    const h = welcomeHarness({ root });
    assert.deepEqual(h.packets, [], 'login initializes the frame before the root swap microtask');
    assert.equal(h.hooks['player:gameframe-bootstrap'], undefined, 'core does not delegate bootstrap control to Welcome');
    await Promise.resolve();
    assert.deepEqual(h.packets, [['root', 378], ['flags', (378 << 16) | 72, 2],
      ['text', (378 << 16) | 6, 'Welcome to Old School RuneScape!']]);
    assert.deepEqual(h.events, ['welcome-screen:shown']);
    h.hooks.play({ player: h.player });
    h.hooks.play({ player: h.player });
    assert.deepEqual(h.packets.slice(3).map(row => row[1]), encodeGameframeBootstrap('WelcomeTester', root));
    assert.deepEqual(h.events, ['welcome-screen:shown', 'gameframe:ready']);
  }
});

test('the message of the week scroll takes the world config text', async () => {
  const h = welcomeHarness({ config: { 'WelcomeScreen:messageOfTheWeek': 'Double XP this weekend!' } });
  await Promise.resolve();
  assert.deepEqual(h.packets.find(row => row[0] === 'text'), ['text', (378 << 16) | 6, 'Double XP this weekend!']);
});

test('new, mobile, bot and Wilderness logins keep the immediate gameframe', async () => {
  for (const options of [{ newAccount:true }, { mobile:true }, { bot:true }, { wilderness:true }]) {
    const h = welcomeHarness(options);
    await Promise.resolve();
    assert.deepEqual(h.packets, []);
  }
});

test('logout and disconnect cancel both queued and visible welcome screens', async () => {
  for (const hook of ['logout', 'disconnect']) for (const visible of [false, true]) {
    const h = welcomeHarness();
    if (visible) await Promise.resolve();
    h.hooks[hook]({ player: h.player });
    await Promise.resolve();
    h.hooks.play({ player: h.player });
    assert.equal(h.packets.some(row => row[0] === 'frame'), false, hook);
    assert.equal(h.packets.some(row => row[0] === 'root'), visible, hook);
  }
});

test('real login bootstraps before snapshots and completes recovery before desktop Play', async (t) => {
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize(require('node:path').resolve(__dirname, '..'));
  const { ClientConnection } = require('../dist/net/NetworkBuilder');
  const { PluginManager } = require('../dist/plugins/PluginManager');
  const { World } = require('../dist/game/World');
  const { Sailing } = require('../dist/game/content/sailing/Sailing');
  const { PacketSender } = require('../dist/net/packet/PacketSender');
  const { MagicSpellbook } = require('../dist/game/model/MagicSpellbook');
  const { Location } = require('../dist/game/model/Location');
  const { MAIN_PROFILE } = require('../dist/game/entity/impl/player/persistence/PlayerProfile');
  const hooks = {}, order = [];
  const core = PluginManager.getCoreApi();
  require('../plugins/interface/WelcomeScreen.plugin').register({
    core,
    onPlayerLogin: fn => { hooks.login = fn; },
    onInterfaceActionButton: (_id, fn) => { hooks.play = fn; },
    onPlayerLogout() {}, onPlayerDisconnect() {}, log() {}, getPluginConfig: (_key, fallback) => fallback,
    emitCustomEvent: name => order.push(name),
  });
  t.mock.method(World, 'refreshActiveRegions', () => {});
  t.mock.method(World.getPlayers(), 'add', p => { p.setIndex(1); return true; });
  t.mock.method(Sailing, 'onLogin', () => {});
  t.mock.method(PluginManager, 'emitPlayerLogin', event => {
    hooks.login(event);
    event.player.setSpellbook(MagicSpellbook.ANCIENT);
    const prayers = event.player.getQuickPrayers();
    const sync = prayers.sync.bind(prayers);
    t.mock.method(prayers, 'sync', () => { order.push('quick-prayers'); sync(); });
  });
  t.mock.method(PluginManager, 'emitCustomEvent', (name, { player }) => {
    order.push(name);
    if (name === 'player:bootstrap-complete') player.getPacketSender().sendConfig(29, 42);
  });
  for (const name of ['sendTabInterface', 'sendInterfaceScript', 'sendItemContainer', 'sendSkillsSnapshot', 'sendRunEnergy']) {
    const original = PacketSender.prototype[name];
    t.mock.method(PacketSender.prototype, name, function (...args) {
      order.push([name, ...args]);
      return original.apply(this, args);
    });
  }
  for (const mobile of [false, true]) {
    order.length = 0;
    const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true,
      send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
    const connection = new ClientConnection(channel);
    connection.pending = { username: 'BootstrapTester', profile: MAIN_PROFILE, passwordHash: '',
      save: { applyToPlayer: p => p.setLocation(new Location(3210, 3220, 0)) } };
    try {
      connection.enterWorld(mobile ? 1 : 0);
      const tabIndex = order.findIndex(row => row[0] === 'sendTabInterface');
      const memberIndex = order.findIndex(row => row[0] === 'sendInterfaceScript' && row[1] === 828);
      const inventoryIndex = order.findIndex(row => row[0] === 'sendItemContainer');
      const skillsIndex = order.findIndex(row => row[0] === 'sendSkillsSnapshot');
      assert.ok(tabIndex < memberIndex && memberIndex < inventoryIndex && inventoryIndex < skillsIndex);
      assert.ok(skillsIndex < order.indexOf('quick-prayers'));
      assert.ok(order.indexOf('quick-prayers') < order.indexOf('player:bootstrap-complete'));
      assert.equal(order.filter(row => row === 'player:bootstrap-complete').length, 1);
      assert.equal(order.includes('player:gameframe-bootstrap'), false);
      const expectedRoot = encodeGameframeBootstrap('BootstrapTester', mobile ? 601 : 161)[1];
      const rootPacket = connection.player.getSession().pendingPackets.find(packet => packet[0] === expectedRoot[0]);
      assert.deepEqual(rootPacket, expectedRoot);
      assert.equal(connection.player.getPacketSender().getVarbit(4070), 1, 'saved spellbook is published at login');
      assert.equal(connection.player.getPacketSender().getVarp(29), 42, 'quest state is recovered before Play');
      await Promise.resolve();
      assert.equal(order.includes('welcome-screen:shown'), !mobile);
      hooks.play({ player: connection.player });
      assert.equal(order.filter(row => row === 'player:bootstrap-complete').length, 1, 'Play cannot re-run quest recovery');
      assert.equal(order.filter(row => row[0] === 'sendTabInterface').length, 1, 'Play cannot overwrite varps with spell unlocks again');
      assert.equal(connection.player.getPacketSender().getVarbit(4070), 1);
      assert.equal(connection.player.getPacketSender().getVarp(29), 42);
    } finally {
      clearInterval(connection.idleCheck);
    }
  }
});
