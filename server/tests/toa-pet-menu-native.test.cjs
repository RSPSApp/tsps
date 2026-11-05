// Run after `yarn build`: node --test tests/toa-pet-menu-native.test.cjs
//
// Tumeken's guardian's Metamorphosis is a menu, not a cycle (rsprox 1757, rev 227):
//   tick 26423: opnpc3 on Tumeken's Guardian (11812), if_opensub 164:16 interface 187, script 217
//     ("Choose metamorph", "Tumeken's guardian|Elidinis' guardian|<grey>Akkhito|Babi|Kephriti</grey>|Zebo|<grey>
//     Tumeken's damaged guardian|Elidinis' damaged guardian</grey>", true), events on 187:3.
//   tick 26425: resume_pausebutton 187:3 sub=5 -> transformation 11849 (Zebo) straight from Tumeken's.
//   ticks 28912 and 31408: a remnant used on the pet while it is Zebo (11849) is accepted.
// The unlocks are TOA_UNLOCKED_PET_MORPH_* (14498 Akkha .. 14501 Zebak, 14502 and 14503 the ancient remnant), kept
// by Items.TombsOfAmascut in "toa:pet-morphs". Tumeken's and Elidinis' guardian are free (Wiki). Real interface
// dispatch as rift-guardian-menu-native.test.cjs: the menu opens through the pet's cache option, the choice
// arrives as the interface's resume packet.
const assert = require('node:assert/strict'), path = require('node:path');
const { before, after, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const { ClientConnection } = require('../dist/net/NetworkBuilder');
let core, next = 1850;
const bots = process.env.DISABLE_PLAYER_BOTS;
const UNLOCKS = 'toa:pet-morphs';
const TUMEKEN = 11812, ELIDINIS = 11813, ZEBO = 11849, TUMEKEN_DAMAGED = 11850, ELIDINIS_DAMAGED = 11851;
const GREY = (name) => `<col=858585>${name}</col>`;
const MENU = 'menu:lj_layer1';
before(async () => {
  process.env.DISABLE_PLAYER_BOTS = '1';
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins'));
  core = PM.getCoreApi();
  core.RegionManager.init(); core.RegionManager.loadMapFiles(3222, 3218);
  PM.emitServerStartup({});
});
after(() => {
  PM.emitServerShutdown({});
  if (bots === undefined) delete process.env.DISABLE_PLAYER_BOTS; else process.env.DISABLE_PLAYER_BOTS = bots;
});

function actor(t) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++); p.setUsername('toapet' + next); p.setRegistered(true); p.setLocation(new core.Location(3222, 3218, 0)); p.needsPlacement = false;
  const c = new ClientConnection(channel); c.player = p;
  const messages = [];
  t.mock.method(p.getPacketSender(), 'sendMessage', (m) => { messages.push(m); return p.getPacketSender(); });
  t.after(() => {
    PM.emitPlayerLogout({ player: p, username: p.getUsername() }); p.setRegistered(false); core.TaskManager.cancelTasks(p.getIndex());
    for (const n of [...core.World.getNpcs()]) if (n?.getOwner?.() === p) core.World.getNpcs().remove(n);
  });
  return { p, c, messages };
}
async function drain(f) { for (let i = 0; i < 10; i++) { core.TaskManager.processWalkTo(f.p.getIndex()); f.p.getMovementQueue().process(); core.TaskManager.process(); } }
async function send(f, packet) { await f.c.dispatch([packet]); f.c.processTurnPackets(); await drain(f); }
async function summon(f) {
  const id = core.ItemIdentifiers.TUMEKENS_GUARDIAN;
  f.p.getInventory().add(new core.Item(id), true);
  f.p.getPacketSender().sendInterfaceRemoval();
  await send(f, { type: 'inventory_action', slot: f.p.getInventory().getSlotForItemId(id), itemId: id, widgetId: 149 << 16, option: 'Drop', optionIndex: 5 });
  const pet = f.p.getAttribute('pets:current');
  assert.ok(pet?.isRegistered(), 'the guardian follows');
  assert.equal(pet.getId(), TUMEKEN);
  return pet;
}
async function action(f, n, name) {
  f.p.getPacketSender().sendInterfaceRemoval();
  n.setLocation(new core.Location(f.p.getLocation().getX() + 1, f.p.getLocation().getY(), 0));
  const index = n.getDefinition().getActions().findIndex((a) => a === name);
  assert.ok(index >= 0, 'the active cache definition exposes ' + name);
  await send(f, { type: 'npc_option', index: n.getIndex(), clickType: index + 1 });
}
async function use(f, n, itemId) {
  f.p.getInventory().add(new core.Item(itemId), true);
  f.p.getPacketSender().sendInterfaceRemoval();
  n.setLocation(new core.Location(f.p.getLocation().getX() + 1, f.p.getLocation().getY(), 0));
  await send(f, { type: 'item_on_npc', targetIndex: n.getIndex(), itemId, slot: f.p.getInventory().getSlotForItemId(itemId), widgetId: 149 << 16 });
}
async function pick(f, slot) { await send(f, { type: 'dialogue_continue', widgetId: core.CacheDefinitions.getComponentId(MENU), childIndex: slot }); }
function captureScripts(t, f) {
  const scripts = [], sender = f.p.getPacketSender(), original = sender.sendClientScript;
  t.mock.method(sender, 'sendClientScript', function (...args) { scripts.push(args); return original.apply(this, args); });
  return scripts;
}
const menuOf = (scripts) => scripts.find((args) => args[0] === 217);

test('Metamorphosis opens the captured menu: eight forms in order, locked ones grey (1757 tick 26423)', async (t) => {
  const f = actor(t), n = await summon(f), scripts = captureScripts(t, f);
  f.p.setAttribute(UNLOCKS, [14501]);
  await action(f, n, 'Metamorphosis');
  assert.equal(f.p.getInterfaceId(), core.CacheDefinitions.getInterfaceId('menu'));
  const script = menuOf(scripts);
  assert.ok(script, 'script 217');
  assert.equal(script[2], 'Choose metamorph');
  assert.equal(script[3], ["Tumeken's guardian", "Elidinis' guardian", GREY('Akkhito'), GREY('Babi'), GREY('Kephriti'), 'Zebo',
    GREY("Tumeken's damaged guardian"), GREY("Elidinis' damaged guardian")].join('|'));
});

test('with nothing unlocked only the two default forms are open', async (t) => {
  const f = actor(t), n = await summon(f), scripts = captureScripts(t, f);
  await action(f, n, 'Metamorphosis');
  assert.equal(menuOf(scripts)[3], ["Tumeken's guardian", "Elidinis' guardian", GREY('Akkhito'), GREY('Babi'), GREY('Kephriti'), GREY('Zebo'),
    GREY("Tumeken's damaged guardian"), GREY("Elidinis' damaged guardian")].join('|'));
});

test("choosing Zebo (slot 5) goes straight from Tumeken's guardian (1757 tick 26425)", async (t) => {
  const f = actor(t), n = await summon(f);
  f.p.setAttribute(UNLOCKS, [14501]);
  await action(f, n, 'Metamorphosis');
  await pick(f, 5);
  assert.equal(n.getId(), ZEBO);
  assert.notEqual(f.p.getInterfaceId(), core.CacheDefinitions.getInterfaceId('menu'), 'the menu closes');
});

test('a locked form is refused and the pet stays as it was', async (t) => {
  const f = actor(t), n = await summon(f);
  await action(f, n, 'Metamorphosis');
  await pick(f, 5);
  assert.equal(n.getId(), TUMEKEN);
});

test("Tumeken's and Elidinis' guardian change into each other freely, both ways (Wiki)", async (t) => {
  const f = actor(t), n = await summon(f);
  await action(f, n, 'Metamorphosis'); await pick(f, 1);
  assert.equal(n.getId(), ELIDINIS);
  await action(f, n, 'Metamorphosis'); await pick(f, 0);
  assert.equal(n.getId(), TUMEKEN, 'back again with nothing unlocked');
});

test("the ancient remnant's two forms are entries seven and eight, Elidinis' damaged guardian included", async (t) => {
  const f = actor(t), n = await summon(f);
  f.p.setAttribute(UNLOCKS, [14502, 14503]);
  await action(f, n, 'Metamorphosis'); await pick(f, 7);
  assert.equal(n.getId(), ELIDINIS_DAMAGED);
  await action(f, n, 'Metamorphosis'); await pick(f, 6);
  assert.equal(n.getId(), TUMEKEN_DAMAGED);
});

test('forged and stale choices cannot select an unlocked-looking form', async (t) => {
  const f = actor(t), n = await summon(f);
  f.p.setAttribute(UNLOCKS, [14501]);
  await action(f, n, 'Metamorphosis');
  await pick(f, 99); await pick(f, 5);
  assert.equal(n.getId(), TUMEKEN, 'out of range, then the menu is gone');
  await action(f, n, 'Metamorphosis');
  await send(f, { type: 'interface_close' });
  await pick(f, 5);
  assert.equal(n.getId(), TUMEKEN, 'a closed menu cannot be answered');
});

test('a remnant used on the pet unlocks its form, and the menu then offers it (1757 tick 26419 onward)', async (t) => {
  const f = actor(t), n = await summon(f), scripts = captureScripts(t, f);
  await use(f, n, core.ItemIdentifiers.REMNANT_OF_ZEBAK);
  assert.deepEqual(f.p.getAttribute(UNLOCKS), [14501]);
  assert.equal(f.p.getInventory().getAmount(core.ItemIdentifiers.REMNANT_OF_ZEBAK), 0, 'spent when used on the pet');
  await action(f, n, 'Metamorphosis');
  assert.match(menuOf(scripts)[3], /\|Zebo\|/);
  await pick(f, 5);
  assert.equal(n.getId(), ZEBO);
  assert.equal(f.p.getInventory().getAmount(core.ItemIdentifiers.REMNANT_OF_ZEBAK), 0, 'the change itself takes nothing');
});

test('a remnant used on a pet that has already changed form is accepted (1757 ticks 28912 and 31408 on Zebo)', async (t) => {
  const f = actor(t), n = await summon(f);
  f.p.setAttribute(UNLOCKS, [14501]);
  await action(f, n, 'Metamorphosis'); await pick(f, 5);
  assert.equal(n.getId(), ZEBO);
  await use(f, n, core.ItemIdentifiers.REMNANT_OF_KEPHRI);
  assert.deepEqual([...f.p.getAttribute(UNLOCKS)].sort(), [14500, 14501]);
  assert.equal(f.p.getInventory().getAmount(core.ItemIdentifiers.REMNANT_OF_KEPHRI), 0);
  assert.ok(f.messages.some((m) => /unlocked a new metamorphosis option/.test(m)));
});
