// yarn build && node --test --test-concurrency=1 tests/camdozaal-native.test.cjs
// Real PM/cache/decoded inputs with preowned materials and a completed quest checkpoint.
// This is activity verification, not proof of a natural Below Ice Mountain playthrough.
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
const { Inventory } = require('../dist/game/model/container/impl/Inventory');
const { ObjectDefinition } = require('../dist/game/definition/ObjectDefinition');
const Runtime = require('../plugins/quests/QuestRuntime');
let core;
const errors = [];
const oldError = console.error;
console.error = (...args) => { errors.push(args.map(String)); oldError(...args); };

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins'));
  core = PM.getCoreApi();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(2950, 5800);
  core.RegionManager.loadMapFiles(2980, 5840);
  PM.emitServerStartup({});
});
after(() => {
  try { PM.emitServerShutdown({}); }
  finally { console.error = oldError; assert.deepEqual(errors, [], 'no runtime hook errors'); }
});

function obj(name) {
  const id = core.CacheDefinitions.getObjId(name);
  assert.ok(Number.isInteger(id), `cache item ${name}`);
  return id;
}
function sceneObjects() {
  const found = [];
  for (let x = 2910; x <= 3030; x++) for (let y = 5760; y <= 5865; y++) {
    for (const o of core.MapObjects.getObjectsAt(new core.Location(x, y, 0), null)) {
      const name = core.CacheDefinitions.getLocNames().get(o.getId()) ?? '';
      if (/camdozaal|sacred_forge/.test(name)) found.push({ object: o, name, x, y, id: o.getId(), type: o.getType(), face: o.getFace() });
    }
  }
  return found;
}
function locate(pattern) {
  const row = sceneObjects().find(o => pattern.test(o.name));
  assert.ok(row, `cache scene contains ${pattern}`);
  return row;
}
function stand(player, row) {
  const definition = ObjectDefinition.forPlayer(row.id, player);
  assert.ok(definition);
  const rect = [10, 11, 22].includes(row.type);
  const footprint = row.type === 22 ? definition : ObjectDefinition.forId(row.id);
  for (let dx = -2; dx <= 5; dx++) for (let dy = -2; dy <= 5; dy++) {
    const tile = new core.Location(row.x + dx, row.y + dy, 0);
    if (core.RegionManager.blocked(tile, player.getPrivateArea())) continue;
    player.moveTo(tile);
    if (core.PathFinder.reachedObject(player, row.x, row.y, rect ? footprint.getSizeX() : 1,
      rect ? footprint.getSizeY() : 1, row.face, rect ? 10 : row.type, rect ? definition.getBlockingMask() : 0)) return definition;
  }
  assert.fail('actual target has no reachable perimeter');
}
let next = 11000;
function actor(t) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  const username = `camdozaal${next++}`;
  player.setUsername(username);
  player.setLongUsername(core.Misc.stringToLongBigInt(username));
  player.setAttribute('bot-skip-persistence', true);
  assert.equal(core.World.getPlayers().add(player), true);
  t.after(() => {
    try { player.closeInterruptibleInterfaces(); }
    finally {
      core.TaskManager.cancelTasks(player);
      core.TaskManager.cancelTasks(player.getIndex());
      if (player.isRegistered()) core.World.getPlayers().remove(player);
    }
    assert.equal(player.isRegistered(), false);
    assert.equal(core.TaskManager.hasActiveTask(player.getIndex()), false);
    assert.deepEqual(errors, []);
  });
  const quest = Runtime.getRegisteredQuests().findLast(q => q.key === 'below_ice_mountain');
  assert.ok(quest);
  quest.setStage(player, 5);
  assert.equal(quest.isComplete(player), true);
  player.setAttribute('quest.below_ice_mountain.met-ramarno', 2);
  player.getPacketSender().sendVarbit(12068, 2);
  const connection = new ClientConnection(channel);
  connection.player = player;
  player.getSession().setPlayer(player);
  player.getSession().setTurnPacketProcessor(() => connection.processTurnPackets());
  assert.ok(player.getHitpoints() > 0);
  return { player, connection };
}
async function useItem(f, itemId, row) {
  const { player, connection } = f;
  const definition = stand(player, row);
  for (let tick = 0; tick < 3 && player.isNeedsPlacement(); tick++) core.World.process();
  assert.equal(player.isNeedsPlacement(), false, 'engine placement completes before ordinary input');
  const slot = player.getInventory().getItems().findIndex(i => i?.getId() === itemId);
  assert.ok(slot >= 0);
  let reached = 0;
  const original = PM.emitItemOnObject;
  PM.emitItemOnObject = function(event) {
    if (event.player === player && event.itemId === itemId) {
      reached++;
      assert.equal(event.object, row.object);
      assert.equal(event.itemSlot, slot);
    }
    return original.call(this, event);
  };
  try {
    await connection.dispatch([{ type: 'item_on_object', widgetId: Inventory.INTERFACE_ID,
      objectId: definition.id, itemId, slot, x: row.x, y: row.y }]);
    for (let i = 0; i < 20 && !reached; i++) core.World.process();
    assert.equal(reached, 1, 'decoded ordinary item use reaches the real object consumer');
  } finally { PM.emitItemOnObject = original; }
}

test('current cache provides actual Camdozaal activity and vault geometry', () => {
  const rows = sceneObjects();
  assert.ok(rows.some(r => /camdozaal_anvil/.test(r.name)));
  assert.ok(rows.some(r => /camdozaal_vault_door/.test(r.name)));
  console.log('CAMDOZAAL_CACHE_GEOMETRY', JSON.stringify(rows.map(({ object, ...row }) => row)));
});
test('ordinary shards-on-forge conserves shards in personal storage', async t => {
  const f = actor(t), id = obj('camdozaal_barronite_shard');
  f.player.getInventory().adds(id, 1000);
  const row = locate(/bim_ruins_wallkit_sacred_forge/);
  assert.equal(f.player.getInventory().getAmount(id), 1000);
  assert.equal(Number(f.player.getAttribute('camdozaal:stored-shards')) || 0, 0);
  await useItem(f, id, row);
  assert.equal(Number(f.player.getAttribute('camdozaal:stored-shards')) || 0, 1000,
    'ordinary Sacred Forge use stores shards');
  assert.equal(f.player.getInventory().getAmount(id), 0);
});
