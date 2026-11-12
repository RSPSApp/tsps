const assert = require('node:assert/strict');
const path = require('node:path');
const { before, after, test } = require('node:test');
// NPC/player bot simulation is outside this interface test; every content plugin is loaded.
process.env.DISABLE_PLAYER_BOTS = '1';
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSave } = require('../dist/game/entity/impl/player/persistence/PlayerSave');
const { MultiChatboxPrompt } = require('../dist/game/model/menu/MultiChatboxPrompt');
const common = require('../plugins/skills/sailing/porttasks/Common.PortTasks');
const master = require('../plugins/skills/sailing/porttasks/PortMaster.PortTasks');
let core, nextIndex = 1800;
before(async () => {
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize();
  PluginManager.loadPluginSwitches = () => ({ switches: new Map() });
  const quiet = [console.log, console.info, console.debug, console.warn];
  console.log = console.info = console.debug = console.warn = () => {};
  try { PluginManager.loadFromDirectory(path.join(__dirname, '../plugins')); }
  finally { [console.log, console.info, console.debug, console.warn] = quiet; }
  core = PluginManager.getCoreApi();
  core.RegionManager.init();
  PluginManager.emitServerStartup({});
  assert.ok(PluginManager.loadedPlugins.includes('Sailing'));
});
after(() => PluginManager.emitServerShutdown({}));
function captain(t, level = 99) {
  const player = new Player(null);
  player.setIndex(nextIndex++);
  player.setUsername(`LogTest${nextIndex}`);
  player.setRegistered(true);
  player.getSession = () => ({ sendClientPacket: () => true, write: () => true });
  player.getSkillManager().setMaxLevels(core.Skill.SAILING, level, false);
  player.getSkillManager().setCurrentLevel(core.Skill.SAILING, level, false);
  const messages = [], packets = [];
  t.mock.method(player, 'sendMessage', text => messages.push(text));
  const sender = player.getPacketSender();
  for (const name of ['sendSubInterface', 'sendInterfaceFlagsRange', 'sendInterfaceScript', 'sendVarbit', 'sendConfig']) {
    const original = sender[name];
    t.mock.method(sender, name, function (...args) { packets.push([name, ...args]); return original.apply(this, args); });
  }
  t.after(() => { player.setRegistered(false); core.TaskManager.cancelTasks(player); });
  return { player, sender, messages, packets };
}
function read(f, option = 'View-tasks', id = 31986) {
  f.player.getInventory().setItem(0, new core.Item(id, 1));
  const event = { player: f.player, interfaceId: 149, item: f.player.getInventory().getItems()[0], itemId: id,
    slot: 0, clickType: option === 'View-tasks' ? 4 : 3, option, handled: false };
  PluginManager.emitItemAction(event);
  return event;
}
function click(f, childId, slot = -1, action = 1) {
  const event = { player: f.player, groupId: 935, childId, buttonId: (935 << 16) | childId, slot, action, handled: false };
  PluginManager.emitInterfaceActionClick(event);
  return event;
}
function hold(f, ids = [20]) {
  common.setSlots(f.player, ids.map(id => ({ id, taken: 0, delivered: 0 })));
}
function answer(f, number) {
  return PluginManager.emitInterfaceActionClick({ player: f.player, groupId: 219, childId: 1,
    buttonId: (219 << 16) | 1, slot: number, action: 1, handled: false });
}
test('native item options open the real floating log with slot and menu flags', t => {
  const f = captain(t); hold(f);
  assert.equal(read(f).handled, true);
  assert.equal(f.sender.isSubInterfaceOpen(935), true);
  assert.equal(f.sender.getVarbit(18572), 1);
  assert.equal(f.sender.getVarbit(19574), 20);
  assert.ok(f.packets.some(p => JSON.stringify(p) === JSON.stringify(['sendInterfaceFlagsRange', (935 << 16) | 16, 0, 12, 2])));
  assert.ok(f.packets.some(p => p[0] === 'sendInterfaceScript' && p[1] === 8709));
  read(f, 'View-charts');
  assert.equal(f.sender.getVarbit(18572), 0);
  click(f, 7, 12); assert.equal(f.sender.getVarbit(18572), 1);
  click(f, 7, 10); assert.equal(f.sender.getVarbit(18572), 0);
  read(f, 'View-tasks', 31985); assert.equal(f.sender.getVarbit(18572), 1);
});
test('selection is native slot+1; Back and Close prevent a later cancel', t => {
  const f = captain(t); hold(f, [20, 1]); read(f);
  click(f, 16, 1); assert.equal(f.sender.getVarbit(19135), 2);
  click(f, 23); click(f, 25);
  assert.equal(MultiChatboxPrompt.getPending(f.player), null);
  assert.equal(common.slots(f.player)[1].id, 1);
  click(f, 16, 0); click(f, 8); click(f, 25);
  assert.equal(f.sender.isSubInterfaceOpen(935), false);
  assert.equal(common.slots(f.player)[0].id, 20);
});
test('confirmation No preserves the task; Yes uses the shared cancellation owner', t => {
  const f = captain(t); hold(f); read(f); click(f, 16, 0); click(f, 25);
  assert.ok(MultiChatboxPrompt.getPending(f.player));
  answer(f, 2); assert.equal(common.slots(f.player)[0].id, 20);
  click(f, 16, 0); click(f, 25); answer(f, 1);
  assert.equal(common.slots(f.player)[0], null);
  assert.ok(f.messages.includes('You have cancelled the <col=0090bc>Port Sarim jewellery delivery</col> port task.'));
  assert.equal(f.sender.isSubInterfaceOpen(935), true);
  assert.ok(f.packets.some(p => p[0] === 'sendInterfaceScript' && p[1] === 8663),
    'cancellation redraws the native task cards; port_tasks_general does not transmit a slot change');
});
test('a replaced slot, Back, Close and floater replacement invalidate confirmation', t => {
  for (const transition of ['slot', 'back', 'close', 'replace']) {
    const f = captain(t); hold(f); read(f); click(f, 16, 0); click(f, 25);
    if (transition === 'slot') hold(f, [1]);
    if (transition === 'back') click(f, 23);
    if (transition === 'close') click(f, 8);
    if (transition === 'replace') f.sender.sendSubInterface((161 << 16) | 18, 621, 1);
    answer(f, 1);
    assert.equal(common.slots(f.player)[0].id, transition === 'slot' ? 1 : 20, transition);
  }
});
test('warning disabled cancels directly; protected quest tasks cannot be cancelled by either entry point', t => {
  const f = captain(t); hold(f); f.sender.sendVarbit(18130, 1); read(f); click(f, 16, 0); click(f, 25);
  assert.equal(common.slots(f.player)[0], null);
  hold(f, [599]); read(f); click(f, 16, 0); click(f, 25);
  assert.equal(common.slots(f.player)[0].id, 599);
  assert.equal(master.cancel(f.player, 0), false);
  assert.equal(common.slots(f.player)[0].id, 599);
});
test('blank/locked/invalid slots cannot create selection or cancellation', t => {
  const f = captain(t, 1); hold(f); read(f);
  for (const slot of [1, 4, -1, 5, 0.5]) { click(f, 16, slot); click(f, 25); }
  assert.equal(MultiChatboxPrompt.getPending(f.player), null);
  assert.equal(common.slots(f.player)[0].id, 20);
});
test('shared task-slot changes redraw an open log and discard its old selection only while mounted', t => {
  const f = captain(t); hold(f); read(f); click(f, 16, 0);
  f.packets.length = 0;
  hold(f, [1]);
  assert.ok(f.packets.some(p => p[0] === 'sendInterfaceScript' && p[1] === 8663), 'shared owner triggers native redraw');
  assert.ok(f.packets.some(p => p[0] === 'sendInterfaceScript' && p[1] === 8709), 'old detail is hidden');
  click(f, 25);
  assert.equal(MultiChatboxPrompt.getPending(f.player), null);
  assert.equal(common.slots(f.player)[0].id, 1);
  click(f, 8); f.packets.length = 0;
  hold(f, [20]);
  assert.equal(f.packets.some(p => p[0] === 'sendInterfaceScript' && p[1] === 8663), false);
});
test('opening refuses dead/busy players and a stale inventory item', t => {
  const dead = captain(t); dead.player.setHitpoints(0); read(dead);
  assert.equal(dead.sender.isSubInterfaceOpen(935), false);
  const busy = captain(t); busy.player.setInterfaceId(12); read(busy);
  assert.equal(busy.sender.isSubInterfaceOpen(935), false);
  const stale = captain(t);
  const item = new core.Item(31986, 1);
  PluginManager.emitItemAction({ player: stale.player, interfaceId: 149, item, itemId: 31986,
    slot: 0, clickType: 4, option: 'View-tasks', handled: false });
  assert.equal(stale.sender.isSubInterfaceOpen(935), false);
});
test('log cancellation removes its real hand, crew and all boat cargo while preserving other tasks', t => {
  const f = captain(t); hold(f, [20, 1]);
  const cargo = require('../plugins/skills/sailing/Cargo.Sailing');
  f.player.setSailing({ boats: [0, 1].map(slot => ({ slot, type: 'raft', name: [0, 0, 0], hitpoints: 100,
    damage: 0, facilities: [], parts: {}, location: { kind: 'docked', dock: 'the_pandemonium' }, cargo: [] })) });
  const [first, second] = f.player.getSailing().boats;
  const crate = common.taskById(20).crate, other = common.taskById(1).crate;
  assert.equal(cargo.store(first, crate, 2), 2);
  assert.equal(cargo.store(second, crate, 1), 1);
  assert.equal(cargo.store(first, other, 1), 1);
  common.setCrewCargo(f.player, 0, { crate, amount: 1, boatSlot: 0 });
  common.setCrewCargo(f.player, 1, { crate: other, amount: 1, boatSlot: 0 });
  common.carry(f.player, crate, 0);
  read(f); click(f, 16, 0); click(f, 25); answer(f, 1);
  assert.equal(common.heldCrate(f.player), undefined);
  assert.equal(cargo.countIn(first, crate) + cargo.countIn(second, crate), 0);
  assert.equal(cargo.countIn(first, other), 1);
  assert.equal(common.crewAmount(f.player, 0), 0);
  assert.equal(common.crewAmount(f.player, 1), 1);
  assert.equal(common.slots(f.player)[1].id, 1);
});
test('save hydration resends held progress and completed count without retaining selection', t => {
  const f = captain(t); hold(f); common.setSlots(f.player, [{ id: 20, taken: 1, delivered: 0 }]);
  f.player.setAttribute(common.COMPLETED_ATTRIBUTE, { total: 37, today: 2, day: '2026-10-29' });
  read(f); click(f, 16, 0);
  const save = PlayerSave.fromPlayer(f.player);
  assert.equal(save.attributes[common.SLOTS_ATTRIBUTE][0].id, 20);
  const loaded = captain(t); save.applyToPlayer(loaded.player);
  PluginManager.emitPlayerLogin({ player: loaded.player, username: loaded.player.getUsername() });
  assert.equal(common.slots(loaded.player)[0]?.id, 20, 'held slot survives real login hooks');
  assert.equal(loaded.sender.getVarbit(19574), 20, JSON.stringify(loaded.packets.filter(p => p[0] === 'sendVarbit' && p[1] >= 19574 && p[1] <= 19589)));
  assert.equal(loaded.sender.getVarbit(19575), 1);
  assert.equal(loaded.sender.getVarp(5207), 37);
  read(loaded); click(loaded, 25);
  assert.equal(MultiChatboxPrompt.getPending(loaded.player), null);
});
test('the mapped ledger updates the same progress sent when the log reopens', t => {
  const f = captain(t); hold(f);
  const tile = new core.Location(3061, 2985, 0);
  core.RegionManager.loadMapFiles(tile.getX(), tile.getY());
  const object = core.MapObjects.get(60324, tile, null);
  assert.ok(object, 'the Pandemonium ledger exists in the shipped map');
  f.player.setLocation(new core.Location(3061, 2984, 0));
  const definition = core.ObjectDefinition.forPlayer(object.getId(), f.player);
  const clickType = definition.getActions().indexOf('Take-cargo') + 1;
  assert.ok(clickType > 0);
  const event = { player: f.player, object, objectId: object.getId(), definition, clickType,
    location: { x: tile.getX(), y: tile.getY(), z: 0 }, handled: false };
  PluginManager.emitObjectInteraction(event);
  assert.equal(event.handled, true);
  assert.equal(common.heldCrate(f.player), common.taskById(20).crate);
  assert.equal(common.slots(f.player)[0].taken, 1);
  read(f);
  assert.equal(f.sender.getVarbit(19575), 1);
  assert.equal(f.sender.getVarbit(19576), 0);
  const destination = new core.Location(3028, 3194, 0);
  core.RegionManager.loadMapFiles(destination.getX(), destination.getY());
  const ledger = core.MapObjects.get(60322, destination, null);
  assert.ok(ledger, 'the destination ledger exists in the shipped map');
  f.player.setLocation(new core.Location(3028, 3193, 0));
  const deliveryDefinition = core.ObjectDefinition.forPlayer(ledger.getId(), f.player);
  const deliveryOp = deliveryDefinition.getActions().indexOf('Deposit-cargo') + 1;
  assert.ok(deliveryOp > 0);
  t.mock.method(Math, 'random', () => 0.5); // normal coin bag; no shark paint, unrelated reward RNG
  PluginManager.emitObjectInteraction({ player: f.player, object: ledger, objectId: ledger.getId(),
    definition: deliveryDefinition, clickType: deliveryOp,
    location: { x: destination.getX(), y: destination.getY(), z: 0 }, handled: false });
  assert.equal(common.slots(f.player)[0], null);
  assert.equal(common.heldCrate(f.player), undefined);
  read(f);
  assert.equal(f.sender.getVarbit(19574), 0);
  assert.equal(f.sender.getVarp(5207), 1);
});
test('the native cancellation-warning setting toggles and survives save/relogin through Settings', t => {
  const f = captain(t); hold(f);
  const definitions = core.CacheDefinitions;
  let category, row;
  for (const [, structId] of [...definitions.getEnumValues(422)].sort(([a], [b]) => a - b)) {
    const params = definitions.getStructParams(Number(structId));
    const settings = [...definitions.getEnumValues(Number(params.get(745)))].sort(([a], [b]) => a - b);
    const at = settings.findIndex(([, id]) => definitions.getStructParams(Number(id)).get(1077) === 457);
    if (at >= 0) { category = Number(params.get(743)); row = at; break; }
  }
  assert.ok(Number.isInteger(row), 'setting457 is present in the active cache catalog');
  const settingClick = (player, childId, slot = -1) => PluginManager.emitInterfaceActionClick({ player,
    groupId: 134, childId, buttonId: (134 << 16) | childId, action: 1, slot, handled: false });
  require('../plugins/interface/Settings.plugin').openAllSettings(f.player);
  settingClick(f.player, 24, category);
  settingClick(f.player, 20, row);
  assert.equal(f.sender.getVarbit(18130), 1);
  assert.equal(f.player.getAttribute('settings:values')['varbit:18130'], 1);
  settingClick(f.player, 4);
  const loaded = captain(t); PlayerSave.fromPlayer(f.player).applyToPlayer(loaded.player);
  PluginManager.emitPlayerLogin({ player: loaded.player, username: loaded.player.getUsername() });
  assert.equal(loaded.sender.getVarbit(18130), 1);
  read(loaded); click(loaded, 16, 0); click(loaded, 25);
  assert.equal(common.slots(loaded.player)[0], null);
  assert.equal(MultiChatboxPrompt.getPending(loaded.player), null);
});
