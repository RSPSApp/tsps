// The portal nexus Teleport Menu: Scry Mode, its refusals, and where teleports land (nexus and portal frames).
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
const { GameObject } = require('../dist/game/entity/impl/object/GameObject');
const { ObjectDefinition } = require('../dist/game/definition/ObjectDefinition');
let core, House, Instance, Nexus, Portals, yanillePortal, scryVarbit;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  core = PM.getCoreApi();
  core.RegionManager.init();
  ObjectDefinition.init();
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins'));
  PM.emitServerStartup({});
  House = require('../plugins/skills/construction/House.Construction');
  Instance = require('../plugins/skills/construction/Instance.Construction');
  Nexus = require('../plugins/skills/construction/Nexus.Construction');
  Portals = require('../plugins/skills/construction/Portals.Construction');
  yanillePortal = require('../plugins/skills/construction/Estate.Construction').HOUSE_LOCATIONS.find(entry => entry.id === 6).portal;
  scryVarbit = core.CacheDefinitions.getVarbitId('poh_nexus_tele_scry_mode');
});
after(() => PM.emitServerShutdown({}));

let actorIndex = 0;
function connect(t, name) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true,
    send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  const conn = new ClientConnection(channel); conn.player = p;
  p.setUsername(name); p.setLongUsername(core.Misc.stringToLongBigInt(name));
  p.setAttribute('bot-skip-persistence', true);
  assert.equal(core.World.getPlayers().add(p), true);
  t.after(() => {
    const taskIndex = p.getIndex();
    try { PM.emitPlayerLogout({ player: p, username: p.getUsername() }); }
    finally {
      try { House.releaseHouse(p, true); } finally { core.World.getPlayers().remove(p); }
      core.TaskManager.cancelTasks(p); core.TaskManager.cancelTasks(taskIndex);
    }
  });
  return { p, conn };
}

/** An owner in their Yanille house with a marble nexus (or a teak portal frame) and the given slots. */
function actor(t, { slots = [], frame = false } = {}) {
  const { p, conn } = connect(t, `pohscry${++actorIndex}`);
  const messages = [];
  const send = p.sendMessage.bind(p);
  p.sendMessage = (message, ...rest) => { messages.push(message); return send(message, ...rest); };
  const save = Instance.createDefaultHouseSave(); save.location = 6;
  save.rooms[1][4][6] = frame
    ? { roomKey: 'PORTAL_CHAMBER', rotation: 0, furniture: { PORTAL_1: 'TEAK_PORTAL_FRAME', TELEPORT_FOCUS: 'TELEPORT_FOCUS' } }
    : { roomKey: 'PORTAL_NEXUS', rotation: 0, furniture: { PORTAL_NEXUS: 'MARBLE_PORTAL_NEXUS' } };
  p.setAttribute('construction:house', save);
  p.getSkillManager().setMaxLevels(core.Skill.MAGIC, 99, false).setCurrentLevel(core.Skill.MAGIC, 99, false);
  p.getSkillManager().setMaxLevels(core.Skill.CONSTRUCTION, 99, false).setCurrentLevel(core.Skill.CONSTRUCTION, 99, false);
  const portalAt = new core.Location(2542, 3097, 0);
  p.moveTo(new core.Location(2542, 3096, 0)); p.setNeedsPlacement(false);
  const portal = new GameObject(yanillePortal, portalAt, 10, 2, null);
  const definition = ObjectDefinition.forPlayer(yanillePortal, p) ?? ObjectDefinition.forId(yanillePortal);
  assert.equal(PM.emitObjectInteraction({ player: p, object: portal, objectId: yanillePortal, definition, clickType: 2,
    location: { x: 2542, y: 3097, z: 0 }, sourceLocation: { x: 2542, y: 3096, z: 0 }, handled: false }), true);
  for (let tick = 0; tick < 3; tick++) core.TaskManager.process();
  const house = House.houseFor(p);
  assert.ok(house instanceof Instance.PlayerHouseInstance);
  const room = house.save.rooms[1][4][6];
  const furnishing = Object.values(room.furnitureByLocation).find(f => f.hotspotKey === (frame ? 'PORTAL_1' : 'PORTAL_NEXUS'));
  const object = house.furnitureObjects.find(candidate => {
    const at = candidate.getLocation();
    return house.getFurnitureAt({ x: at.getX(), y: at.getY(), z: at.getZ() }, candidate.getId(), candidate.getType()) === furnishing;
  });
  assert.ok(object);
  if (!frame) p.setAttribute('construction:nexus', { slots: slots.map(idOf), left: 0 });
  return { p, conn, house, furnishing, object, messages };
}

const idOf = name => [...Nexus.destinations().values()].find(d => d.spellName === name || d.name === name).id;

function objectAction(f, action) {
  const at = f.object.getLocation(), id = f.object.getId();
  f.p.moveTo(new core.Location(at.getX() - 1, at.getY(), at.getZ())); f.p.setNeedsPlacement(false);
  const definition = ObjectDefinition.forPlayer(id, f.p) ?? ObjectDefinition.forId(id);
  const index = definition.getInteractions().findIndex(s => s?.toLowerCase() === action);
  assert.notEqual(index, -1, `real cache action ${action}`);
  const source = f.p.getLocation();
  assert.equal(PM.emitObjectInteraction({ player: f.p, object: f.object, objectId: id, definition, clickType: index + 1,
    location: { x: at.getX(), y: at.getY(), z: at.getZ() },
    sourceLocation: { x: source.getX(), y: source.getY(), z: source.getZ() }, handled: false }), true);
}

async function pause(f, component, sub = -1) {
  const widgetId = core.CacheDefinitions.getComponentId(`telenexus_teleport:${component}`);
  await f.conn.dispatch([{ type: 'dialogue_continue', widgetId, childIndex: sub }]);
  f.conn.processTurnPackets();
}

async function continueBox(f) {
  await f.conn.dispatch([{ type: 'dialogue_continue', widgetId: (229 << 16) | 2, childIndex: -1 }]);
  f.conn.processTurnPackets();
}

async function scryOn(f) {
  objectAction(f, 'teleport menu');
  await pause(f, 'options_layer', 3);
  assert.equal(f.p.getPacketSender().getVarbit(scryVarbit), 1);
  assert.equal(f.p.getInterfaceId(), core.CacheDefinitions.getInterfaceId('telenexus_teleport'), 'the menu opens again');
}

const at = f => [f.p.getLocation().getX(), f.p.getLocation().getY(), f.p.getLocation().getZ()];
const within = (tile, centre, radius) => tile[2] === centre[2]
  && Math.abs(tile[0] - centre[0]) <= radius && Math.abs(tile[1] - centre[1]) <= radius;

test('Scry Mode: the toggle sets the varbit, makes the nexus icon clickable and is kept', async t => {
  const f = actor(t, { slots: ['lumbridge teleport'] });
  const sender = f.p.getPacketSender(), flags = [];
  const range = sender.sendInterfaceFlagsRange.bind(sender);
  t.mock.method(sender, 'sendInterfaceFlagsRange', (uid, ...args) => { flags.push([uid, ...args]); return range(uid, ...args); });
  await scryOn(f);
  const model = core.CacheDefinitions.getComponentId('telenexus_teleport:nexus_model');
  assert.ok(flags.some(([uid, from, to]) => uid === model && from === -1 && to === -1));
  assert.equal(f.p.getAttribute('construction:nexus-scry'), 1);
  await pause(f, 'options_layer', 2);
  assert.equal(f.p.getPacketSender().getVarbit(scryVarbit), 0);
  assert.equal(f.p.getAttribute('construction:nexus-scry'), 0);
});

test('Scry Mode: a pick views the destination, then counts the players there and comes back', async t => {
  const f = actor(t, { slots: ['varrock teleport', 'lumbridge teleport'] });
  await scryOn(f);
  await pause(f, 'rows1', 1);
  assert.equal(House.houseFor(f.p), null, 'the view is outside the house');
  assert.deepEqual(at(f), [3219, 3217, 0]);
  assert.equal(f.p.getPacketSender().isChatboxInterface(229), true);
  const overlay = core.CacheDefinitions.getInterfaceId('poh_scrying_pool');
  assert.ok(overlay > 0);
  await continueBox(f);
  assert.ok(f.messages.includes('You see no adventurers in the area.'), f.messages.join(' | '));
  for (let tick = 0; tick < 4; tick++) core.TaskManager.process();
  assert.ok(House.houseFor(f.p), 'back in the house');
});

test('Scry Mode: other players near the view are counted', async t => {
  const f = actor(t, { slots: ['falador teleport'] });
  const others = [connect(t, `pohscryx${++actorIndex}`), connect(t, `pohscryy${++actorIndex}`)];
  for (const { p } of others) { p.moveTo(new core.Location(2962, 3383, 0)); p.setNeedsPlacement(false); }
  await scryOn(f);
  await pause(f, 'rows1', 0);
  assert.deepEqual(at(f), [2960, 3385, 0]);
  await continueBox(f);
  assert.ok(f.messages.includes('You see 2 adventurers in the area.'), f.messages.join(' | '));
});

test('Scry Mode: the alternates and the nexus icon view their places', async t => {
  const f = actor(t, { slots: ['varrock teleport'] });
  await scryOn(f);
  await pause(f, 'rows2', 1);
  assert.deepEqual(at(f), [2724, 3487, 0], "Seers' Village");
  await continueBox(f);
  for (let tick = 0; tick < 4; tick++) core.TaskManager.process();
  objectAction(f, 'teleport menu');
  await pause(f, 'nexus_model');
  assert.deepEqual(at(f), [2544, 3096, 0], 'the house portal');
});

test('Scry Mode: building mode refuses it and a Wilderness destination only counts players', async t => {
  const f = actor(t, { slots: ['varrock teleport', 'ghorrock teleport'] });
  await scryOn(f);
  f.house.buildingMode = true;
  await pause(f, 'rows1', 0);
  assert.ok(f.messages.includes('You cannot use the scrying function while in building mode.'));
  assert.equal(f.p.getInterfaceId(), -1);
  assert.ok(House.houseFor(f.p), 'still in the house');
  f.house.buildingMode = false;
  objectAction(f, 'teleport menu');
  await pause(f, 'key_listeners', 1);
  assert.ok(f.messages.includes('You see no adventurers in the area.'));
  assert.equal(f.p.getInterfaceId(), -1);
  assert.ok(House.houseFor(f.p), 'no view of the Wilderness');
});

test('nexus teleports land anywhere in the spell\'s 5x5 square', async t => {
  const tiles = new Set();
  for (let i = 0; i < 12; i++) {
    const f = actor(t, { slots: ['varrock teleport'] });
    objectAction(f, 'teleport menu');
    await pause(f, 'rows1', 0);
    assert.equal(House.houseFor(f.p), null);
    assert.ok(within(at(f), [3213, 3424, 0], 2), at(f).join(','));
    tiles.add(at(f).join(','));
  }
  assert.ok(tiles.size > 1, 'not always the centre tile');
});

test('nexus alternates land in their own squares; Yanille on its tile', async t => {
  const expected = [[0, [3163, 3478, 0], 2], [1, [2726, 3484, 0], 2], [2, [2583, 3095, 0], 0]];
  for (const [sub, centre, radius] of expected) {
    const f = actor(t, { slots: ['varrock teleport'] });
    objectAction(f, 'teleport menu');
    await pause(f, 'rows2', sub);
    assert.ok(within(at(f), centre, radius), `${sub}: ${at(f).join(',')}`);
  }
});

test('portal frames land anywhere in the spell\'s 5x5 square', async t => {
  const tiles = new Set();
  for (let i = 0; i < 12; i++) {
    const f = actor(t, { frame: true });
    for (const [id, amount] of [[563, 100], [556, 300], [557, 100]]) f.p.getInventory().add(new core.Item(id, amount), false);
    assert.equal(Portals.configureHouseDestination(f.p, f.house, f.furnishing, 'lumbridge teleport'), true);
    f.object = f.house.furnitureObjects.find(candidate => {
      const where = candidate.getLocation();
      return f.house.getFurnitureAt({ x: where.getX(), y: where.getY(), z: where.getZ() }, candidate.getId(), candidate.getType()) === f.furnishing;
    });
    objectAction(f, 'enter');
    const pending = core.MultiChatboxPrompt.getPending(f.p);
    assert.ok(pending);
    const index = pending.options.findIndex(s => s === 'lumbridge teleport');
    assert.notEqual(index, -1, pending.options.join(','));
    await f.conn.dispatch([{ type: 'dialogue_continue', widgetId: core.MultiChatboxPrompt.OPTIONS_WIDGET_ID, childIndex: index + 1 }]);
    f.conn.processTurnPackets();
    for (let tick = 0; tick < 6; tick++) core.TaskManager.process();
    assert.ok(within(at(f), [3221, 3218, 0], 2), at(f).join(','));
    tiles.add(at(f).join(','));
  }
  assert.ok(tiles.size > 1, 'not always the centre tile');
  assert.equal(typeof Portals.landingTile, 'function');
});
