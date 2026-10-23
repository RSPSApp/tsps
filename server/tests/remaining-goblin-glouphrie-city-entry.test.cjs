// Real PluginManager + shipped map regression for the Dorgesh-Kaan city entrance transport.
// Run after yarn build: node --test tests/remaining-goblin-glouphrie-city-entry.test.cjs
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const ROOT = path.resolve(__dirname, '..');

let PluginManager, core, Player, CacheDefinitions, ObjectDefinition, MapObjects;

before(async () => {
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize(ROOT);
  ({ PluginManager } = require('../dist/plugins/PluginManager'));
  ({ CacheDefinitions } = require('../dist/game/cache/CacheDefinitions'));
  ({ ObjectDefinition } = require('../dist/game/definition/ObjectDefinition'));
  ({ MapObjects } = require('../dist/game/entity/impl/object/MapObjects'));
  PluginManager.loadPluginSwitches = () => ({ switches: new Map() });
  const quiet = [console.log, console.info, console.debug, console.warn];
  console.log = console.info = console.debug = console.warn = () => {};
  try {
    PluginManager.loadFromDirectory(path.join(ROOT, 'plugins'));
    core = PluginManager.getCoreApi();
    core.RegionManager.init();
  } finally {
    [console.log, console.info, console.debug, console.warn] = quiet;
  }
  ({ Player } = require('../dist/game/entity/impl/player/Player'));
  core.RegionManager.loadMapFiles(3317, 9601);
});


function player() {
  const p = new Player(null);
  p.setUsername('dorgesh');
  p.setLocation(new core.Location(3317, 9602, 0));
  const sender = new Proxy({}, { get: (_, key) => key === 'getVarbit' || key === 'getVarp' ? () => 0 : (...args) => sender });
  p.getPacketSender = () => sender;
  p.isRegistered = () => true;
  return p;
}

test('opening the city threshold dispatches the captured inter-zone transport, not a local swing', () => {
  for (const [id, x] of [[6919, 3317], [6920, 3318]]) {
    const p = player();
    const raw = MapObjects.getPrivateArea(p, id, new core.Location(x, 9601, 0));
    assert.ok(raw, `map has Dorgesh entrance leaf ${id}`);
    assert.equal(raw.getId(), id);
    const definition = ObjectDefinition.forPlayer(raw.getId(), p);
    assert.equal(definition.getName(), 'Door');
    assert.equal(definition.getInteractions()[0], 'Open');

    const event = { player: p, object: raw, objectId: raw.getId(), definition, clickType: 1, option: 'open', handled: false };
    assert.equal(PluginManager.emitObjectInteraction(event), true, 'the entrance option is handled');
    for (let i = 0; i < 5; i++) core.TaskManager.process();

    const at = p.getLocation();
    assert.deepEqual([at.getX(), at.getY(), at.getZ()], [2747, 5374, 0], 'captured Dorgesh-Kaan landing');
  }
  const p = player();
  const route = new (require('../dist/game/model/movement/path/RsmodRouteFinding').RsmodRouteFinding)(
    (x, y, z, area) => core.RegionManager.getClipping(x, y, z, area)
  );
  assert.equal(route.findRoute({
    level: 0, srcX: 2747, srcY: 5374, srcSize: 1,
    destX: 2704, destY: 5366, privateArea: null, moveNear: true,
  }).success, true, 'landing connects to Oldak lab by ordinary walking');
});
