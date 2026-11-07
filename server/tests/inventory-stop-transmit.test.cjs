const assert = require('node:assert/strict');
const { test, before } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { Item } = require('../dist/game/model/Item');
const { Bank } = require('../dist/game/model/container/impl/Bank');
const { PlayerSave } = require('../dist/game/entity/impl/player/persistence/PlayerSave');
const { ClientConnection } = require('../dist/net/NetworkBuilder');
const { decodeClientPackets } = require('../dist/net/protocol/ClientProtocol');

before(async () => { await CachePipeline.initialize(process.cwd()); });
function actor(t) {
    const player = new Player(null), packets = [];
    player.setUsername('containerqa');
    t.mock.method(player, 'getSession', () => ({ sendClientPacket: b => packets.push(Buffer.from(b)) }));
    return { player, sender: player.getPacketSender(), packets };
}
const stops = packets => packets.filter(b => b[0] === 56).map(b => b.readUInt16BE(1));

test('closing a real bank releases its client cache and reopening sends the preserved contents', t => {
    const { player, sender, packets } = actor(t);
    player.getBank(0).add(new Item(995, 100), false);
    player.getBank(0).open();
    sender.sendInterfaceRemoval();
    assert.deepEqual(stops(packets), [95]);
    assert.equal(Bank.isOpen(player), false);
    assert.equal(player.getBank(0).getAmount(995), 100);
    const before = packets.length;
    player.getBank(0).open();
    assert.ok(packets.slice(before).some(b => b[0] === 52));
    assert.equal(player.getBank(0).getAmount(995), 100);
});

test('replacement releases only the old owner, while remounting the same group keeps its cache', t => {
    const { sender, packets } = actor(t), target = (161 << 16) | 74;
    sender.sendSubInterface(target, 81, 3);
    sender.sendInventory(516, 28, [{ id: 995, amount: 7 }], 81);
    sender.sendSubInterface(target, 81, 3);
    assert.deepEqual(stops(packets), []);
    sender.sendSubInterface(target, 15, 3);
    assert.deepEqual(stops(packets), [516]);
    sender.closeSubInterface(target);
    assert.deepEqual(stops(packets), [516]);
});

test('explicit repeated and unknown stops are harmless and do not suppress subsequent updates', t => {
    const { player, sender, packets } = actor(t);
    player.getInventory().add(new Item(995, 20), false);
    sender.sendInventoryStopTransmit(646).sendInventoryStopTransmit(646);
    sender.sendInventoryStopTransmit(65535);
    sender.sendInventory(646, 2, [{ id: 995, amount: 9 }]);
    assert.deepEqual(stops(packets), [646, 646, 65535]);
    assert.equal(player.getInventory().getAmount(995), 20);
    assert.equal(packets.at(-1)[0], 110);
    for (const id of [-1, 65536, 1.5, NaN]) assert.throws(() => sender.sendInventoryStopTransmit(id), RangeError);
});

test('a transferred container lifetime survives closing its previous owner', t => {
    const { sender, packets } = actor(t);
    sender.sendSubInterface(100, 81, 3).sendSubInterface(101, 12, 0);
    sender.sendInventory(516, 28, [{ id: 995, amount: 1 }], 81);
    sender.sendInventory(516, 28, [{ id: 995, amount: 1 }], 12);
    sender.closeSubInterface(100);
    assert.deepEqual(stops(packets), []);
    sender.closeSubInterface(101);
    assert.deepEqual(stops(packets), [516]);
});

test('native IF_CLOSE preserves a real deposit/withdraw and saved bank plus bag metadata', async t => {
    const { player, sender, packets } = actor(t);
    player.getInventory().add(new Item(995, 100), false);
    const bag = new Item(11941, 1, { lootingBag: [{ id: 554, amount: 7, meta: null }] });
    player.getInventory().add(bag, false);
    player.getBank(0).open();
    Bank.deposits(player, 995, player.getInventory().getSlotForItemId(995), 40);
    assert.equal(player.getInventory().getAmount(995), 60);
    assert.equal(player.getBank(0).getAmount(995), 40);
    sender.sendInventory(516, 28, [{ id: 554, amount: 7 }], 12);
    const channel = { send: () => true, isOpen: () => true, close() {}, onData() {}, onClose() {}, onError() {} };
    const connection = new ClientConnection(channel);
    connection.player = player;
    const close = decodeClientPackets(Buffer.from([55]));
    assert.deepEqual(close, [{ type: 'interface_close' }]);
    await connection.dispatch(close);
    connection.processTurnPackets();
    assert.deepEqual(stops(packets), [95, 516]);
    assert.equal(Bank.isOpen(player), false);
    const loaded = new Player(null);
    PlayerSave.fromPlayer(player).applyToPlayer(loaded);
    assert.equal(loaded.getBank(0).getAmount(995), 40);
    assert.deepEqual(loaded.getInventory().getItems().find(i => i.getId() === 11941).getMeta(), bag.getMeta());
    player.getBank(0).open();
    Bank.withdraw(player, 995, player.getBank(0).getSlotForItemId(995), 10, 0);
    assert.equal(player.getInventory().getAmount(995), 70);
    assert.equal(player.getBank(0).getAmount(995), 30);
});
