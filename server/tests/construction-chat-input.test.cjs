// rsprox captures (close_modal on menu 187 and poh_jewellery_box 590, rev 224-239): both stop chat
// input while open (menu script 217 with numbers shown, poh_jewellery_box_init), and live sends
// chatdefault_restoreinput (2158) right after their if_closesub. Issue #4184.
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, after, test } = require('node:test');
process.env.DISABLE_PLAYER_BOTS = '1';
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const { ClientConnection } = require('../dist/net/NetworkBuilder');

const RESTORE_INPUT = 2158;
let core, Menu;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  core = PM.getCoreApi();
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins'));
  PM.emitServerStartup({});
  Menu = require('../plugins/skills/construction/Menu.Construction');
});
after(() => PM.emitServerShutdown({}));

let index = 0;
function actor(t) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true,
    send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  const conn = new ClientConnection(channel); conn.player = p;
  p.setUsername(`chatinput${++index}`); p.setLongUsername(core.Misc.stringToLongBigInt(p.getUsername()));
  p.setAttribute('bot-skip-persistence', true);
  assert.equal(core.World.getPlayers().add(p), true);
  t.after(() => {
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    core.World.getPlayers().remove(p);
  });
  const sender = p.getPacketSender(), log = [];
  const closeSub = sender.closeSubInterface.bind(sender), script = sender.sendClientScript.bind(sender);
  t.mock.method(sender, 'closeSubInterface', (...args) => { log.push('closesub'); return closeSub(...args); });
  t.mock.method(sender, 'sendClientScript', (id, ...args) => { log.push(`script ${id}`); return script(id, ...args); });
  return { p, conn, log, restores: () => log.filter(entry => entry === `script ${RESTORE_INPUT}`).length };
}

async function send(f, packet) {
  await f.conn.dispatch([packet]);
  f.conn.processTurnPackets();
}

test('closing a construction menu gives the chat its typing back', async t => {
  const f = actor(t);
  const menu = core.CacheDefinitions.getInterfaceId('menu');
  Menu.openMenu(f.p, 'Pick one', ['One', 'Two'], () => assert.fail('nothing was picked'));
  assert.equal(f.p.getInterfaceId(), menu);
  f.log.length = 0;
  await send(f, { type: 'interface_close' });
  assert.equal(f.p.getInterfaceId(), -1);
  assert.deepEqual(f.log.slice(-2), ['closesub', `script ${RESTORE_INPUT}`]);
  assert.equal(f.restores(), 1);
});

test('a construction menu pick restores chat input once, then runs the choice', async t => {
  const f = actor(t);
  const picks = [];
  Menu.openMenu(f.p, 'Pick one', ['One', 'Two'], choice => picks.push(choice));
  f.log.length = 0;
  const options = core.CacheDefinitions.getComponentId('menu:lj_layer1');
  await send(f, { type: 'dialogue_continue', widgetId: options, childIndex: 1 });
  assert.deepEqual(picks, [1]);
  assert.equal(f.restores(), 1);
});

test('one construction menu replacing another restores once, for the one that closed', async t => {
  const f = actor(t);
  const picks = [];
  Menu.openMenu(f.p, 'First', ['One'], () => Menu.openMenu(f.p, 'Second', ['Two'], choice => picks.push(choice)));
  const options = core.CacheDefinitions.getComponentId('menu:lj_layer1');
  f.log.length = 0;
  await send(f, { type: 'dialogue_continue', widgetId: options, childIndex: 0 });
  assert.equal(f.p.getInterfaceId(), core.CacheDefinitions.getInterfaceId('menu'));
  assert.equal(f.restores(), 1);
  await send(f, { type: 'interface_close' });
  assert.equal(f.restores(), 2);
  assert.deepEqual(picks, []);
});

test('the menu interface opened by other content is left to that content', async t => {
  const f = actor(t);
  f.p.getPacketSender().sendInterface(core.CacheDefinitions.getInterfaceId('menu'));
  f.log.length = 0;
  await send(f, { type: 'interface_close' });
  assert.equal(f.restores(), 0);
});

test('closing the jewellery box gives the chat its typing back', async t => {
  const f = actor(t);
  f.p.getPacketSender().sendInterface(core.CacheDefinitions.getInterfaceId('poh_jewellery_box'));
  f.log.length = 0;
  await send(f, { type: 'interface_close' });
  assert.deepEqual(f.log.slice(-2), ['closesub', `script ${RESTORE_INPUT}`]);
  assert.equal(f.restores(), 1);
});
