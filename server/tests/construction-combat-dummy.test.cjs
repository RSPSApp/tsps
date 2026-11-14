// Combat room dummies (docs/construction.md, "Combat room"). rsprox.net recs 2765 and 2767
// (rev 229): Attach puts the dummy NPC up with "You attach the sand bag."; while it is up, the
// NPC's Upgrade (op4) says "You should detach the sand bag first." and its Remove (op5) "You must
// detach the sand bag before you can remove this.", both on the click tick; Detach puts the loc back.
process.env.DISABLE_PLAYER_BOTS = '1';
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, after, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const { ClientConnection } = require('../dist/net/NetworkBuilder');

const POSITION = { plane: 1, x: 4, y: 6 };
let core, House, Instance, Data, C;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  core = PM.getCoreApi(); core.RegionManager.init(); core.ObjectDefinition.init();
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins'));
  PM.emitServerStartup({});
  C = core.CacheDefinitions;
  House = require('../plugins/skills/construction/House.Construction');
  Instance = require('../plugins/skills/construction/Instance.Construction');
  Data = require('../plugins/skills/construction/Data.Construction');
});
after(() => PM.emitServerShutdown({}));

let index = 0;
function owner(t, buildableKey) {
  const ch = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(ch)), conn = new ClientConnection(ch); conn.player = p;
  p.setUsername(`dummy${++index}`); p.setLongUsername(core.Misc.stringToLongBigInt(p.getUsername()));
  p.setAttribute('bot-skip-persistence', true);
  const save = Instance.createDefaultHouseSave(); save.location = 6;
  save.rooms[POSITION.plane][POSITION.x][POSITION.y] = { roomKey: 'COMBAT_ROOM', rotation: 0, furniture: { COMBAT_DUMMY: buildableKey } };
  p.setAttribute('construction:house', save);
  assert.equal(core.World.getPlayers().add(p), true);
  let house;
  t.after(() => {
    try { PM.emitPlayerLogout({ player: p, username: p.getUsername() }); }
    finally { House.releaseHouse(p, true); core.World.getPlayers().remove(p); core.TaskManager.cancelTasks(p); if (house) core.TaskManager.cancelTasks(house); }
  });
  assert.equal(House.enterHouse(p, false), true);
  house = House.houseFor(p); assert.equal(house.buildingMode, false);
  const messages = [];
  const message = p.sendMessage.bind(p);
  t.mock.method(p, 'sendMessage', text => { messages.push(String(text)); return message(text); });
  const dummyLoc = Data.BUILDABLE_BY_KEY.get(buildableKey).objectIds[0];
  const object = house.furnitureObjects.find(entry => entry.getId() === dummyLoc);
  assert.ok(object, `the combat room draws ${buildableKey}`);
  const tile = { x: object.getLocation().getX(), y: object.getLocation().getY() };
  p.moveTo(new core.Location(tile.x + 1, tile.y, POSITION.plane)); p.setNeedsPlacement(false);
  return { p, conn, house, messages, tile, dummyLoc };
}

function turn(f) {
  f.p.resetUpdating(); core.World.processCycle = (core.World.processCycle + 1) & 0x7fffffff;
  core.TaskManager.process(); f.conn.processTurnPackets();
  const q = f.p.getMovementQueue(); q.beginCycle(); q.processEntityPursuit(); if (q.hasPendingWork()) q.process();
  core.TaskManager.processWalkTo(f.p.getIndex());
}

async function act(f, packet, until) {
  await f.conn.dispatch([packet]);
  for (let i = 0; i < 10 && !until(); i++) turn(f);
}

function dummyNpc(f, npcId) {
  return f.house.npcs?.find?.(npc => npc.getId() === npcId)
    ?? [...core.World.getNpcs()].find(npc => npc && npc.getId() === npcId && npc.getLocation().getX() === f.tile.x && npc.getLocation().getY() === f.tile.y);
}

for (const [buildableKey, npcName] of [['COMBAT_DUMMY', 'poh_combat_dummy_npc'], ['UNDEAD_COMBAT_DUMMY', 'poh_combat_dummy_undeadslayer_npc']]) {
  test(`${buildableKey}: the attached NPC's Upgrade and Remove refuse until it is detached`, async t => {
    const f = owner(t, buildableKey);
    const npcId = C.getNpcId(npcName);
    await act(f, { type: 'object_option', id: f.dummyLoc, x: f.tile.x, y: f.tile.y, action: 'Attach' }, () => f.messages.length > 0);
    assert.deepEqual(f.messages, ['You attach the sand bag.']);
    const npc = dummyNpc(f, npcId);
    assert.ok(npc, `${npcName} stands in for the loc`);
    const options = core.CacheDefinitions.getNpc(npcId).options ?? core.CacheDefinitions.getNpc(npcId).actions;
    assert.equal(options?.[3], 'Upgrade'); assert.equal(options?.[4], 'Remove');

    f.messages.length = 0;
    await act(f, { type: 'npc_option', index: npc.getIndex(), clickType: 4 }, () => f.messages.length > 0);
    assert.deepEqual(f.messages, ['You should detach the sand bag first.']);
    f.messages.length = 0;
    await act(f, { type: 'npc_option', index: npc.getIndex(), clickType: 5 }, () => f.messages.length > 0);
    assert.deepEqual(f.messages, ['You must detach the sand bag before you can remove this.']);
    assert.ok(npc.isRegistered(), 'the dummy stays up');
    assert.ok(f.house.getFurnitureAt({ x: f.tile.x, y: f.tile.y, z: POSITION.plane }, f.dummyLoc, 10), 'the dummy is still built');

    f.messages.length = 0;
    await act(f, { type: 'npc_option', index: npc.getIndex(), clickType: 3 }, () => f.messages.length > 0);
    assert.deepEqual(f.messages, ['You detach the sand bag.']);
    assert.equal(npc.isRegistered(), false);
  });
}
