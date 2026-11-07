const assert = require('node:assert/strict');
const { test, before } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSave } = require('../dist/game/entity/impl/player/persistence/PlayerSave');
const { ClientConnection } = require('../dist/net/NetworkBuilder');
const { decodeClientPackets } = require('../dist/net/protocol/ClientProtocol');
const Retrieval = require('../plugins/areas/deathsoffice/Retrieval.DeathsOffice');
const Common = require('../plugins/areas/deathsoffice/Common.DeathsOffice');
const Storage = require('../plugins/world/gravestones/Storage.Gravestones');
let inventoryId;

before(async () => {
    await CachePipeline.initialize(process.cwd());
    const api = PluginManager.createApi('DeathOfficeLifecycle');
    Storage.attach(api);
    require('../plugins/world/gravestones/Events.Gravestones').attach(api);
    Retrieval.attach(api);
    inventoryId = api.core.CacheDefinitions.getInventoryId('death_permanent');
    assert.equal(inventoryId, 636);
});

function actor(t, save) {
    const player = new Player(null), packets = [];
    player.setUsername('officelifecycle');
    t.mock.method(player, 'getSession', () => ({ sendClientPacket: b => { packets.push(Buffer.from(b)); return true; } }));
    if (save) save.applyToPlayer(player);
    const channel = { send: () => true, isOpen: () => true, close() {}, onData() {}, onClose() {}, onError() {} };
    const connection = new ClientConnection(channel);
    connection.player = player;
    const dispatch = async packets => { await connection.dispatch(packets); connection.processTurnPackets(); };
    const close = () => dispatch(decodeClientPackets(Buffer.from([55])));
    const click = (uid, slot = -1) => dispatch([{ type: 'widget_action', widgetId: uid,
        groupId: uid >>> 16, childId: uid & 65535, slot, buttonNum: 1 }]);
    return { player, sender: player.getPacketSender(), packets, close, click, connection };
}
const stops = packets => packets.filter(b => b[0] === 56).map(b => b.readUInt16BE(1));
const seed = player => {
    Storage.setOffice(player, [{ id: 4152, amount: 2, meta: { provenance: 'office' } }]);
    Storage.setCoffer(player, 1000000);
};

test('native close stops the office mirror, preserves holdings/fee funds, and permits fresh saved reopen', async t => {
    const f = actor(t); seed(f.player);
    const held = structuredClone(Storage.office(f.player));
    Retrieval.open(f.player);
    await f.close();
    assert.deepEqual(stops(f.packets), [inventoryId]);
    assert.equal(f.sender.isSubInterfaceOpen(Common.ID.officeInterface), false);
    assert.deepEqual(Storage.office(f.player), held);
    assert.equal(Storage.coffer(f.player), 1000000);
    await f.close();
    assert.deepEqual(stops(f.packets), [inventoryId], 'duplicate close does not release twice');
    const loaded = actor(t, PlayerSave.fromPlayer(f.player));
    assert.deepEqual(Storage.office(loaded.player), held);
    assert.equal(Storage.coffer(loaded.player), 1000000);
    Retrieval.open(loaded.player);
    assert.ok(loaded.packets.some(b => b[0] === 110), 'fresh login receives a full office snapshot');
    await loaded.close();
    assert.deepEqual(stops(loaded.packets), [inventoryId]);
});

test('modal replacement releases only the office; reopening releases the old lifetime before the fresh snapshot', t => {
    const f = actor(t); seed(f.player);
    Retrieval.open(f.player);
    f.sender.sendInventory(516, 28, [{ id: 554, amount: 7 }], 81);
    f.sender.sendSubInterface(Common.COMPONENT.mainModal, 15, 0);
    assert.deepEqual(stops(f.packets), [inventoryId]);
    Retrieval.open(f.player);
    const start = f.packets.length;
    Retrieval.open(f.player);
    const next = f.packets.slice(start);
    assert.deepEqual(stops(next), [inventoryId]);
    assert.ok(next.findIndex(b => b[0] === 56) < next.findIndex(b => b[0] === 110));
    assert.equal(Storage.office(f.player)[0].amount, 2);
    assert.equal(Storage.coffer(f.player), 1000000);
});

test('paid confirmation can close the mirror without losing its transaction; accepting transfers and charges once', async t => {
    const f = actor(t); seed(f.player);
    const fee = Common.state(f.player).office[0].fee;
    assert.ok(fee > 0);
    Retrieval.open(f.player);
    await f.click(Common.COMPONENT.officeTakeEverything);
    assert.deepEqual(stops(f.packets), [inventoryId]);
    assert.equal(Storage.office(f.player)[0].amount, 2);
    assert.equal(Storage.coffer(f.player), 1000000);
    assert.equal(f.sender.isChatboxInterface(219), true);
    const options = require('../dist/game/model/menu/MultiChatboxPrompt');
    // The real chatmenu dispatcher owns the pending callback after the office closes.
    const { MultiChatboxPrompt } = options;
    assert.ok(MultiChatboxPrompt.getPending(f.player));
    const accept = async () => {
        await f.connection.dispatch([{ type: 'dialogue_continue', widgetId: MultiChatboxPrompt.OPTIONS_WIDGET_ID, childIndex: 1 }]);
        f.connection.processTurnPackets();
    };
    await accept();
    assert.equal(f.player.getInventory().getAmount(4152), 2);
    assert.equal(Storage.office(f.player).length, 0);
    assert.equal(Storage.coffer(f.player), 1000000 - fee * 2);
    assert.equal(f.sender.isSubInterfaceOpen(Common.ID.officeInterface), true);
    await accept();
    assert.equal(f.player.getInventory().getAmount(4152), 2);
    assert.equal(Storage.coffer(f.player), 1000000 - fee * 2);
    await f.close();
    assert.deepEqual(stops(f.packets), [inventoryId, inventoryId]);
});
