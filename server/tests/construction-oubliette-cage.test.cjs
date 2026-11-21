// Run after `yarn build`: node --test tests/construction-oubliette-cage.test.cjs
// The oubliette's floor sits inside the cage, so the cage's Build-in reaches it (rsprox.net recs 2872
// ticks 176 and 196, 2873, 2877; rev 230): with an empty floor it opens the floor space's build menu
// (Spikes, Tentacle pool, Flame pit, Rocnar); with one built it asks "Select an option" / "Remove the
// contents of the oubliette|Never mind", then "Really remove it?", and Yes takes the floor out.
// Real engine: every plugin, a real Player, a real house instance and the real packets.
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

const POSITION = { plane: 0, x: 4, y: 4 };
const FLOOR_ROWS = ['SPIKES', 'TENTACLE_POOL', 'FLAME_PIT', 'ROCNAR'];
let core, House, Instance, Data, Construction;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  core = PM.getCoreApi(); core.RegionManager.init(); core.ObjectDefinition.init();
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins'));
  PM.emitServerStartup({});
  House = require('../plugins/skills/construction/House.Construction');
  Instance = require('../plugins/skills/construction/Instance.Construction');
  Data = require('../plugins/skills/construction/Data.Construction');
  Construction = require('../plugins/skills/construction/Core.Construction');
});
after(() => PM.emitServerShutdown({}));

let index = 0;
function owner(t) {
  const ch = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(ch)), conn = new ClientConnection(ch); conn.player = p;
  p.setUsername(`oubcage${++index}`); p.setLongUsername(core.Misc.stringToLongBigInt(p.getUsername()));
  p.setAttribute('bot-skip-persistence', true);
  const save = Instance.createDefaultHouseSave(); save.location = 6;
  save.rooms[POSITION.plane][POSITION.x][POSITION.y] = { roomKey: 'OUBLIETTE', rotation: 0, furniture: {} };
  p.setAttribute('construction:house', save);
  assert.equal(core.World.getPlayers().add(p), true);
  let house;
  t.after(() => {
    try { PM.emitPlayerLogout({ player: p, username: p.getUsername() }); }
    finally { House.releaseHouse(p, true); core.World.getPlayers().remove(p); core.TaskManager.cancelTasks(p); if (house) core.TaskManager.cancelTasks(house); }
  });
  const skill = core.Skill.CONSTRUCTION;
  p.getSkillManager().setMaxLevels(skill, 99, false).setExperiences(skill, core.SkillManager.getExperienceForLevel(99), false).setCurrentLevel(skill, 99, false);
  assert.equal(House.enterHouse(p, true), true);
  house = House.houseFor(p); assert.equal(house.buildingMode, true);
  const inv = p.getInventory();
  for (const id of [core.ItemIdentifiers.HAMMER, core.ItemIdentifiers.SAW]) inv.add(new core.Item(id, 1), false);
  const prompts = [];
  t.mock.method(Construction.api, 'sendMultiChatboxPrompt', (player, title, ...pairs) => { prompts.push({ title, pairs }); });
  const scripts = [], sender = p.getPacketSender(), script = sender.sendClientScript.bind(sender);
  t.mock.method(sender, 'sendClientScript', (id, ...args) => { scripts.push([id, ...args]); return script(id, ...args); });
  const tiles = house.hotspotTiles(POSITION);
  const floor = tiles.find(tile => Data.hotspotIn('OUBLIETTE', tile.id)?.key === 'OUBLIETTE_FLOOR_SPACE');
  p.moveTo(new core.Location(floor.x - 3, floor.y - 3, POSITION.plane)); p.setNeedsPlacement(false);
  return { p, conn, house, inv, tiles, prompts, scripts };
}

function turn(f) {
  f.p.resetUpdating(); core.World.processCycle = (core.World.processCycle + 1) & 0x7fffffff;
  core.TaskManager.process(); f.conn.processTurnPackets();
  const q = f.p.getMovementQueue(); q.beginCycle(); q.processEntityPursuit(); if (q.hasPendingWork()) q.process();
  core.TaskManager.processWalkTo(f.p.getIndex());
}

const group = () => core.CacheDefinitions.getInterfaceId('poh_furniture_creation');
const rows = f => f.scripts.filter(s => s[0] === 1404).map(s => s[2]);

/** Clicks `action` on the loc at `tile` and runs turns until the build menu or a prompt is up. */
async function click(f, tile, action) {
  f.scripts.length = 0; f.prompts.length = 0;
  await f.conn.dispatch([{ type: 'object_option', id: tile.id, x: tile.x, y: tile.y, action }]);
  for (let i = 0; i < 30 && f.p.getInterfaceId() !== group() && f.prompts.length === 0; i++) turn(f);
}

/** Gives the materials for `key` and picks it in the open build menu (script 1405's one-based child index). */
async function pick(f, key) {
  for (const material of Data.BUILDABLE_BY_KEY.get(key).materials) {
    const id = material.itemId ?? (material.source === 'NAILS' ? core.ItemIdentifiers.STEEL_NAILS : null);
    if (id != null) f.inv.add(new core.Item(id, material.amount), false);
  }
  const row = f.scripts.find(s => s[0] === 1404 && s[2] === Data.BUILDABLE_BY_KEY.get(key).menuRowId);
  assert.ok(row, `${key} is offered`);
  await f.conn.dispatch([{ type: 'dialogue_continue', widgetId: (group() << 16) | 2, childIndex: row[1] }]);
  for (let i = 0; i < 10; i++) turn(f);
}

/** Builds an oak cage on the prison space, the way a player does. */
async function buildCage(f) {
  const prison = f.tiles.find(tile => Data.hotspotIn('OUBLIETTE', tile.id)?.key === 'PRISON');
  await click(f, prison, 'Build');
  assert.equal(f.p.getInterfaceId(), group(), 'the prison space opens its build menu');
  await pick(f, 'OAK_CAGE');
  const cage = f.house.furnitureObjects.find(object => object.getId() === core.CacheDefinitions.getLocId('poh_cage_dungeon_oak'));
  assert.ok(cage, 'the oak cage stands');
  return { id: cage.getId(), x: cage.getLocation().getX(), y: cage.getLocation().getY() };
}

const floorPiece = f => Object.values(f.house.getRoom(POSITION).furnitureByLocation ?? {}).find(entry => entry.hotspotKey === 'OUBLIETTE_FLOOR_SPACE');

test('Build-in on the cage opens the oubliette floor menu, and building from it lays the floor', async t => {
  const f = owner(t);
  const cage = await buildCage(f);
  await click(f, cage, 'Build-in');
  assert.equal(f.p.getInterfaceId(), group(), 'the floor space build menu opens');
  assert.deepEqual(rows(f), FLOOR_ROWS.map(key => Data.BUILDABLE_BY_KEY.get(key).menuRowId), 'Spikes, Tentacle pool, Flame pit, Rocnar');
  await pick(f, 'FLAME_PIT');
  assert.equal(floorPiece(f)?.buildableKey, 'FLAME_PIT');
  assert.ok(f.house.furnitureObjects.some(object => object.getId() === core.CacheDefinitions.getLocId('poh_oubliette_floor_fire')), 'the flame pit is drawn');
});

test('with a floor built, Build-in offers to remove the contents, and Yes takes the floor out', async t => {
  const f = owner(t);
  const cage = await buildCage(f);
  await click(f, cage, 'Build-in');
  await pick(f, 'SPIKES');
  assert.equal(floorPiece(f)?.buildableKey, 'SPIKES');

  await click(f, cage, 'Build-in');
  assert.notEqual(f.p.getInterfaceId(), group(), 'no build menu over a built floor');
  assert.equal(f.prompts.length, 1);
  const [menu] = f.prompts;
  assert.equal(menu.title, 'Select an option');
  assert.deepEqual([menu.pairs[0], menu.pairs[2]], ['Remove the contents of the oubliette', 'Never mind']);

  menu.pairs[3]();
  assert.equal(f.prompts.length, 1, 'Never mind does nothing');
  assert.equal(floorPiece(f)?.buildableKey, 'SPIKES');

  menu.pairs[1]();
  assert.equal(f.prompts.length, 2);
  const confirm = f.prompts[1];
  assert.equal(confirm.title, 'Really remove it?');
  assert.deepEqual([confirm.pairs[0], confirm.pairs[2]], ['Yes', 'No']);
  confirm.pairs[1]();
  assert.equal(floorPiece(f), undefined, 'the spikes are gone');
  assert.equal(f.house.getRoom(POSITION).furniture.OUBLIETTE_FLOOR_SPACE, undefined);
  assert.ok(f.house.furnitureObjects.some(object => object.getId() === cage.id), 'the cage stays');
});

test('outside building mode Build-in does nothing', async t => {
  const f = owner(t);
  const cage = await buildCage(f);
  f.house.rebuild(f.p, false);
  f.house.buildingMode = false;
  await click(f, cage, 'Build-in');
  assert.notEqual(f.p.getInterfaceId(), group());
  assert.equal(f.prompts.length, 0);
});
