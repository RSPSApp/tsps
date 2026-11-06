// Native board dispatch seam. This does not assert scene reachability or client rendering.
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const { ClientConnection } = require('../dist/net/NetworkBuilder');
const { GameObject } = require('../dist/game/entity/impl/object/GameObject');
const { ObjectDefinition } = require('../dist/game/definition/ObjectDefinition');

let core, House, Ironman, api, boardId, boardGroup;
const entered = [];
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  ObjectDefinition.init();
  core = PluginManager.getCoreApi();
  api = PluginManager.createApi('IronmanHouseAdvertisementTest');
  require('../plugins/skills/construction/Core.Construction').init(api);
  House = require('../plugins/skills/construction/House.Construction');
  House.attach(api);
  Ironman = require('../plugins/modes/ironman/Common.Ironman');
  Ironman.init(api);
  require('../plugins/modes/ironman/Setup.Ironman')(api);
  api.onCustomEvent('poh:entered', (event) => entered.push(event));
  boardId = core.CacheDefinitions.getLocId('poh_board_yanille');
  boardGroup = core.CacheDefinitions.getInterfaceId('poh_board');
  assert.equal(boardId, 37389);
  assert.equal(boardGroup, 52);
});

function actor(t, username, mode = 'none') {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true,
    send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  player.setUsername(username);
  player.setAttribute('bot-skip-persistence', true);
  const save = require('../plugins/skills/construction/Instance.Construction').createDefaultHouseSave();
  save.location = 6;
  player.setAttribute('construction:house', save);
  const sender = player.getPacketSender(), scripts = [];
  t.mock.method(sender, 'sendClientScript', (id, ...args) => { scripts.push([id, ...args]); return sender; });
  t.after(() => { try { House.releaseHouse(player, true); } finally { core.World.getPlayers().remove(player); } });
  assert.equal(core.World.getPlayers().add(player), true);
  Ironman.setMode(player, mode);
  const query = { player, mode: 'none' };
  api.emitCustomEvent('ironman:mode', query);
  assert.equal(query.mode, mode);
  const connection = new ClientConnection(channel);
  connection.player = player;
  return { player, scripts, connection };
}

// Event dispatch uses the named board and cache definition; this bypasses scene routing.
function boardClick(player, clickType) {
  const location = new core.Location(2544, 3096, 0);
  const object = new GameObject(boardId, location, 10, 0, null);
  const definition = ObjectDefinition.forPlayer(boardId, player) ?? ObjectDefinition.forId(boardId);
  assert.equal(definition.getName(), 'House Advertisement');
  assert.equal(definition.getInteractions()[clickType - 1], clickType === 1 ? 'View' : 'Add-House');
  assert.equal(PluginManager.emitObjectInteraction({ player, object, definition, objectId: boardId,
    clickType, location: { x: 2544, y: 3096, z: 0 }, handled: false }), true);
}
function boardRows(who) {
  return who.scripts.filter(([id, index]) => id === 3110 && index !== 200).map((row) => String(row[3]).split('|')[0]);
}
async function select(who, name) {
  assert.equal(who.player.getInterfaceId(), boardGroup);
  assert.ok(who.player.getEnteredSyntaxAction());
  await who.connection.dispatch([{ type: 'dialogue_input', value: name }]);
  who.connection.processTurnPackets();
}

for (const mode of ['ironman', 'ultimate', 'hardcore']) {
  test(`${mode} owner sees and selects own advertisement while foreign house stays filtered`, async (t) => {
    const errors = [], report = console.error;
    t.mock.method(console, 'error', (...args) => { errors.push(args); report(...args); });
    const owner = actor(t, 'own' + mode, mode);
    const foreign = actor(t, 'foreign' + mode.slice(0, 4));
    const viewer = actor(t, 'viewer' + mode.slice(0, 4));
    boardClick(owner.player, 2);
    boardClick(foreign.player, 2);
    const ownedHouse = House.houseFor(owner.player), foreignHouse = House.houseFor(foreign.player);
    assert.equal(ownedHouse?.owner === owner.player, true);
    assert.equal(foreignHouse?.owner === foreign.player, true);
    assert.equal(ownedHouse !== foreignHouse, true);

    boardClick(viewer.player, 1);
    assert.deepEqual(new Set(boardRows(viewer)), new Set([owner.player.getUsername(), foreign.player.getUsername()]));
    await select(viewer, foreign.player.getUsername());
    assert.equal(House.houseFor(viewer.player) === foreignHouse, true, 'ordinary viewer can select foreign house');

    boardClick(owner.player, 1);
    assert.equal(owner.player.getInterfaceId(), boardGroup);
    const ownRows = boardRows(owner);
    assert.equal(ownRows.includes(foreign.player.getUsername()), false, 'foreign house stays filtered');
    assert.equal(ownRows.includes(owner.player.getUsername()), true, 'own advertised house stays listed');
    const prior = entered.filter((event) => event.player === owner.player).length;
    await select(owner, owner.player.getUsername());
    assert.equal(House.houseFor(owner.player) === ownedHouse, true, 'selection routes to the owned house');
    assert.equal(entered.filter((event) => event.player === owner.player).length, prior + 1, 'self-selection enters through own-house path');
    assert.equal(errors.length, 0, 'native hooks did not log an exception');
  });
}
