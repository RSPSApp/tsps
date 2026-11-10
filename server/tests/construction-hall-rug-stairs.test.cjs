// Issue #4189: the skill and quest halls' rug and stair spaces are one hotspot (the cache's
// poh_hotspot row stair_hotspot; Wiki Oak staircase/Opulent rug: "Rug space, stair space"), so a
// staircase takes the rug tiles and a hall rug takes the stair tile. Those placements draw no loc,
// and their Build ghosts must go with them: the server no longer offers a build there, so a click
// on one found nothing ("Object with ID 15387 does not exist").
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
const { encodeLocDel } = require('../dist/net/protocol/ClientProtocol');

const POSITION = { plane: 1, x: 4, y: 6 };
const RUG_SPACES = { QUEST_HALL_UP: [15387, 15388, 15389], SKILL_HALL_UP: [15377, 15378, 15379] };
const STAIR_SPACE = { QUEST_HALL_UP: 15390, SKILL_HALL_UP: 15380 };
let core, House, Instance, Data;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  core = PM.getCoreApi(); core.RegionManager.init(); core.ObjectDefinition.init();
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins'));
  PM.emitServerStartup({});
  House = require('../plugins/skills/construction/House.Construction');
  Instance = require('../plugins/skills/construction/Instance.Construction');
  Data = require('../plugins/skills/construction/Data.Construction');
  for (const [room, ids] of Object.entries(RUG_SPACES)) {
    for (const id of ids) assert.equal(core.CacheDefinitions.getObject(id).name, 'Rug space');
    assert.equal(core.CacheDefinitions.getObject(STAIR_SPACE[room]).name, 'Stair Space');
  }
});
after(() => PM.emitServerShutdown({}));

let index = 0;
function actor(t, roomKey, rotation = 0) {
  const ch = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(ch)), conn = new ClientConnection(ch); conn.player = p;
  p.setUsername(`hallrug${++index}`); p.setLongUsername(core.Misc.stringToLongBigInt(p.getUsername()));
  p.setAttribute('bot-skip-persistence', true);
  const save = Instance.createDefaultHouseSave(); save.location = 6;
  save.rooms[POSITION.plane][POSITION.x][POSITION.y] = { roomKey, rotation, furniture: {} };
  p.setAttribute('construction:house', save);
  assert.equal(core.World.getPlayers().add(p), true);
  let house;
  t.after(() => {
    try { PM.emitPlayerLogout({ player: p, username: p.getUsername() }); }
    finally { House.releaseHouse(p, true); core.World.getPlayers().remove(p); core.TaskManager.cancelTasks(p); if (house) core.TaskManager.cancelTasks(house); }
  });
  for (const skill of [core.Skill.CONSTRUCTION]) {
    p.getSkillManager().setMaxLevels(skill, 99, false).setExperiences(skill, core.SkillManager.getExperienceForLevel(99), false).setCurrentLevel(skill, 99, false);
  }
  assert.equal(House.enterHouse(p, true), true);
  house = House.houseFor(p); assert.equal(house.buildingMode, true);
  const inv = p.getInventory();
  for (const id of [core.ItemIdentifiers.HAMMER, core.ItemIdentifiers.SAW]) inv.add(new core.Item(id, 1), false);
  const packets = [], session = p.getSession(), send = session.sendClientPacket.bind(session), messages = [];
  t.mock.method(session, 'sendClientPacket', packet => { packets.push(Buffer.from(packet).toString('hex')); return send(packet); });
  const message = p.sendMessage.bind(p);
  t.mock.method(p, 'sendMessage', text => { messages.push(String(text)); return message(text); });
  const tiles = house.hotspotTiles(POSITION);
  const tile = id => tiles.find(entry => entry.id === id);
  p.moveTo(new core.Location(tile(STAIR_SPACE[roomKey]).x - 2, tile(STAIR_SPACE[roomKey]).y - 2, POSITION.plane)); p.setNeedsPlacement(false);
  return { p, conn, house, inv, packets, messages, tiles, tile, roomKey, rotation };
}

function turn(f) {
  f.p.resetUpdating(); core.World.processCycle = (core.World.processCycle + 1) & 0x7fffffff;
  core.TaskManager.process(); f.conn.processTurnPackets();
  const q = f.p.getMovementQueue(); q.beginCycle(); q.processEntityPursuit(); if (q.hasPendingWork()) q.process();
  core.TaskManager.processWalkTo(f.p.getIndex());
}

/** Clicks Build on `tile` and picks `key` in the furniture menu, through the real packets. */
async function build(f, t, tile, key) {
  const buildable = Data.BUILDABLE_BY_KEY.get(key);
  for (const material of buildable.materials) {
    const id = material.itemId ?? (material.source === 'NAILS' ? core.ItemIdentifiers.STEEL_NAILS : null);
    assert.ok(id != null, `${key} material ${material.source}`);
    f.inv.add(new core.Item(id, material.amount), false);
  }
  const scripts = [], sender = f.p.getPacketSender(), script = sender.sendClientScript.bind(sender);
  const mock = t.mock.method(sender, 'sendClientScript', (id, ...args) => { scripts.push([id, ...args]); return script(id, ...args); });
  await f.conn.dispatch([{ type: 'object_option', id: tile.id, x: tile.x, y: tile.y, action: 'Build' }]);
  const group = core.CacheDefinitions.getInterfaceId('poh_furniture_creation');
  let row;
  for (let i = 0; i < 30; i++) {
    turn(f);
    row = scripts.find(s => s[0] === 1404 && s[2] === buildable.menuRowId);
    if (row && f.p.getInterfaceId() === group && !f.p.getMovementQueue().hasPendingWork()) break;
  }
  assert.equal(f.p.getInterfaceId(), group, `the build menu opens on ${tile.id}`);
  assert.ok(row, `${key} is offered`);
  await f.conn.dispatch([{ type: 'dialogue_continue', widgetId: (group << 16) | 2, childIndex: row[1] }]);
  for (let i = 0; i < 10; i++) turn(f);
  mock.mock.restore();
}

const ghostRemoval = tile => Buffer.from(encodeLocDel(tile.x, tile.y, tile.plane, tile.type, tile.face)).toString('hex');
function templatePlacements(f) {
  // hotspotTiles gives world tiles (turned with the room); the template gives each one's shape and face.
  const template = Data.ROOM_BY_KEY.get(f.roomKey);
  const objects = Instance.PlayerHouseInstance.getTemplateObjects(0)
    .filter(o => o.sourceChunkX === template.sourceChunkX && o.sourceChunkY === template.sourceChunkY);
  return f.tiles.map((tile, i) => ({ ...tile, type: objects[i].type, face: (objects[i].face + f.rotation) & 3 }));
}

for (const [roomKey, rotation] of [['QUEST_HALL_UP', 0], ['SKILL_HALL_UP', 0], ['QUEST_HALL_UP', 1]]) {
  test(`${roomKey} turned ${rotation}: a staircase takes the rug spaces, and their Build ghosts go`, async t => {
    const f = actor(t, roomKey, rotation);
    const placements = templatePlacements(f);
    const rugs = placements.filter(tile => RUG_SPACES[roomKey].includes(tile.id));
    assert.equal(rugs.length, 36);
    f.packets.length = 0;
    await build(f, t, f.tile(STAIR_SPACE[roomKey]), 'OAK_STAIRCASE_UP');
    const room = f.house.getRoom(POSITION);
    assert.equal(Object.values(room.furnitureByLocation).filter(entry => entry.buildableKey === 'OAK_STAIRCASE_UP').length, 37);
    // The rebuild after the build removes every rug space's ghost, and draws the staircase.
    for (const rug of rugs) assert.ok(f.packets.includes(ghostRemoval(rug)), `rug space ${rug.id} at ${rug.x},${rug.y} is removed`);
    assert.ok(f.house.furnitureObjects.some(object => object.getId() === Data.BUILDABLE_BY_KEY.get('OAK_STAIRCASE_UP').objectIds[0]));
    assert.equal(f.messages.some(text => /does not exist/.test(text)), false);

    // Removing the staircase gives the rug spaces back, and a rug can then be built on them.
    const stairs = f.tile(STAIR_SPACE[roomKey]);
    assert.equal(f.house.removeFurniture({ x: stairs.x, y: stairs.y, z: stairs.plane }, 13497, 10)?.buildableKey, 'OAK_STAIRCASE_UP');
    f.packets.length = 0;
    f.house.rebuild(f.p, true);
    for (const rug of rugs) assert.equal(f.packets.includes(ghostRemoval(rug)), false, `rug space ${rug.id} is back`);
    await build(f, t, f.tile(RUG_SPACES[roomKey][0]), 'HALL_RUG');
    assert.equal(f.house.getRoom(POSITION).furniture[`${roomKey.replace('_UP', '')}_STAIRS_UP`], 'HALL_RUG');
    assert.equal(f.messages.some(text => /does not exist/.test(text)), false);
  });
}

test('a hall rug takes the stair space, and its Build ghost goes', async t => {
  const f = actor(t, 'QUEST_HALL_UP');
  const stairs = templatePlacements(f).find(tile => tile.id === STAIR_SPACE.QUEST_HALL_UP);
  f.packets.length = 0;
  await build(f, t, f.tile(15387), 'HALL_RUG');
  const room = f.house.getRoom(POSITION);
  assert.equal(room.furniture.QUEST_HALL_STAIRS_UP, 'HALL_RUG');
  assert.ok(f.packets.includes(ghostRemoval(stairs)), 'the stair space is removed');
  // The rug's own tiles draw the rug over their ghosts.
  const rugLocs = new Set(Data.BUILDABLE_BY_KEY.get('HALL_RUG').objectIds.filter(id => id >= 0));
  assert.equal(f.house.furnitureObjects.filter(object => rugLocs.has(object.getId())).length, 36);
  assert.equal(f.messages.some(text => /does not exist/.test(text)), false);
});

test('outside building mode every ghost is still removed once', async t => {
  const f = actor(t, 'QUEST_HALL_UP');
  const placements = templatePlacements(f).filter(tile => Data.hotspotIn('QUEST_HALL_UP', tile.id));
  f.packets.length = 0;
  f.house.rebuild(f.p, false);
  for (const tile of placements) assert.equal(f.packets.filter(packet => packet === ghostRemoval(tile)).length, 1);
});
