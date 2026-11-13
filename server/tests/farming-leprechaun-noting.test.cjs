const assert = require('node:assert/strict');
const { test, before } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
let core, Data, Services;
const MAX_STACK = 2147483647;
before(async () => {
    await CachePipeline.initialize(require('node:path').resolve(__dirname, '..'));
    core = PluginManager.getCoreApi();
    require('../plugins/skills/farming/Core.Farming').init({ core });
    Data = require('../plugins/skills/farming/Data.Farming');
    Services = require('../plugins/skills/farming/Services.Farming');
    Data.initializeFarmingData();
});
function prepare(name = 'Potato', { produce = 3, notes = 0, filler = 0, meta } = {}) {
    const player = new Player(null), messages = [];
    const sender = new Proxy({}, { get: () => () => sender });
    player.getPacketSender = () => sender; player.sendMessage = text => messages.push(text);
    const id = Data.itemId(name), note = core.CacheDefinitions.getItem(id).note;
    assert.ok(note > 0);
    const inventory = player.getInventory();
    inventory.add(new core.Item(id, produce), false);
    if (notes) inventory.add(new core.Item(note, notes, meta), false);
    if (filler) inventory.add(new core.Item(Data.itemId('Spade'), filler), false);
    const event = { player, itemId: id, slot: inventory.getSlotForItemId(id),
        target: { getLocation: () => new core.Location(2810, 3464, 0) },
        definition: { getName: () => 'Tool Leprechaun' } };
    return { player, inventory, id, note, messages, noteProduce: () => Services.farmingItemOnNpc(event) };
}
test('noting refuses an overflowing note stack without deleting any produce', () => {
    const f = prepare('Potato', { notes: MAX_STACK - 1 });
    f.noteProduce();
    assert.equal(f.inventory.getAmount(f.id), 3);
    assert.equal(f.inventory.getAmount(f.note), MAX_STACK - 1);
});
test('an exact-fit note stack accepts all produce', () => {
    const f = prepare('Potato', { notes: MAX_STACK - 3 });
    f.noteProduce();
    assert.equal(f.inventory.getAmount(f.id), 0);
    assert.equal(f.inventory.getAmount(f.note), MAX_STACK);
});
test('a full bag without notes can use a slot freed by the produce', () => {
    const f = prepare('Potato', { filler: 25 });
    assert.equal(f.inventory.getFreeSlots(), 0);
    f.noteProduce();
    assert.equal(f.inventory.getAmount(f.id), 0);
    assert.equal(f.inventory.getAmount(f.note), 3);
    assert.equal(f.inventory.getAmount(Data.itemId('Spade')), 25);
});
test('existing metadata notes are preserved and new notes use the freed produce slot', () => {
    const f = prepare('Potato', { notes: MAX_STACK, filler: 24, meta: { source: 'fixture' } });
    assert.equal(f.inventory.getFreeSlots(), 0);
    f.noteProduce();
    const notes = f.inventory.getValidItems().filter(item => item.getId() === f.note);
    assert.equal(f.inventory.getAmount(f.id), 0);
    assert.equal(notes.length, 2);
    assert.ok(notes.some(item => item.getAmount() === MAX_STACK && item.getMeta()?.source === 'fixture'));
    assert.ok(notes.some(item => item.getAmount() === 3 && item.getMeta() === null));
});
test('clean herbs and willow branches retain normal all-produce noting behavior', () => {
    for (const name of ['Ranarr weed', 'Willow branch']) {
        const f = prepare(name);
        f.noteProduce();
        assert.equal(f.inventory.getAmount(f.id), 0, name);
        assert.equal(f.inventory.getAmount(f.note), 3, name);
    }
});
test('noting sends the captured mesbox line and objectbox with the unnoted produce', () => {
    const f = prepare('Potato');
    const typed = [], boxes = [];
    const sender = new Proxy({}, { get: (_, key) => key === 'sendTypedMessage'
        ? (type, text) => { typed.push([type, text]); return sender; } : () => sender });
    f.player.getPacketSender = () => sender;
    f.player.getDialogueManager = () => ({ startDialogues: chain => boxes.push(chain) });
    f.noteProduce();
    assert.equal(f.inventory.getAmount(f.note), 3);
    const text = 'The leprechaun exchanges your items for banknotes.';
    assert.deepEqual(typed, [[core.ChatType.MESBOX, text]]);
    assert.equal(boxes.length, 1);
    const entry = boxes[0].getDialogues().get(0);
    assert.ok(entry instanceof core.ItemStatementDialogue);
    assert.equal(entry.getItemId(), f.id);
    assert.equal(entry.getText(), text);
});
test('a refused overflow sends no exchange box', () => {
    const f = prepare('Potato', { notes: MAX_STACK - 1 });
    const boxes = [];
    f.player.getDialogueManager = () => ({ startDialogues: chain => boxes.push(chain) });
    f.noteProduce();
    assert.equal(boxes.length, 0);
});
test('a single item gets the captured singular line', () => {
    const f = prepare('Coconut', { produce: 1, notes: 5 });
    const typed = [], boxes = [];
    const sender = new Proxy({}, { get: (_, key) => key === 'sendTypedMessage'
        ? (type, text) => { typed.push(text); return sender; } : () => sender });
    f.player.getPacketSender = () => sender;
    f.player.getDialogueManager = () => ({ startDialogues: chain => boxes.push(chain) });
    f.noteProduce();
    assert.equal(f.inventory.getAmount(f.note), 6);
    const text = 'The leprechaun exchanges your item for a banknote.';
    assert.deepEqual(typed, [text]);
    assert.equal(boxes[0].getDialogues().get(0).getText(), text);
});
