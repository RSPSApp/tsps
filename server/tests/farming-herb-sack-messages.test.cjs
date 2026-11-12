const assert = require('node:assert/strict');
const { before, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
let core, Data, Guild, Common;
before(async () => {
    await CachePipeline.initialize(require('node:path').resolve(__dirname, '..'));
    core = PluginManager.getCoreApi();
    require('../plugins/skills/farming/Core.Farming').init({ core });
    Data = require('../plugins/skills/farming/Data.Farming');
    Guild = require('../plugins/skills/farming/Guild.Farming');
    Common = require('../plugins/skills/herblore/Common.Herblore');
    Common.init({ core });
    Data.initializeFarmingData();
});

/** A player carrying `name` in slot 0 with `stored` herbs in it, recording every line sent. */
function fixture(t, { name = 'Open herb sack', stored = {}, carry = [], fillers = 0 } = {}) {
    const player = new Player(null), lines = [];
    const sender = new Proxy({}, { get: (_, key) => key === 'sendTypedMessage' ? (type, text) => { lines.push([type === core.ChatType.SPAM ? 'spam' : 'game', text]); return sender; } : () => sender });
    player.getPacketSender = () => sender;
    player.sendMessage = text => lines.push(['game', text]);
    player.getSkillManager().setCurrentLevel(core.Skill.HERBLORE, 99, false);
    t.mock.method(core.PluginManager, 'emitCustomEvent', (event, request) => {
        if (event === 'herblore:clean') Common.answerClean(request);
    });
    const inventory = player.getInventory(), id = Data.itemId(name);
    inventory.add(new core.Item(id, 1, { 'farming:stored': Object.fromEntries(Object.entries(stored).map(([herb, n]) => [Data.itemId(herb), n])) }), false);
    for (const [item, n = 1] of carry) for (let i = 0; i < n; i++) inventory.add(new core.Item(Data.itemId(item)), false);
    for (let i = 0; i < fillers; i++) inventory.add(new core.Item(Data.itemId('Spade')), false);
    const sack = inventory.forSlot(0);
    return {
        player, inventory, lines, sack,
        stored: () => sack.getMetaValue('farming:stored'),
        option: option => { lines.length = 0; Guild.storageAction({ player, slot: 0, itemId: id, option }); return lines; },
    };
}

test('Fill searches, then adds the herbs (both spam)', t => {
    const f = fixture(t, { carry: [['Grimy ranarr weed', 2], ['Grimy guam leaf']] });
    assert.deepEqual(f.option('Fill'), [
        ['spam', 'You search your inventory for herbs appropriate to put in the sack...'],
        ['spam', 'You add the herbs to your sack.'],
    ]);
    assert.equal(f.stored()[Data.itemId('Grimy ranarr weed')], 2);
    assert.equal(f.inventory.getAmount(Data.itemId('Grimy guam leaf')), 0);
});

test('Fill with no room for any carried herb searches, then refuses with a game message', t => {
    const f = fixture(t, { stored: { 'Grimy ranarr weed': 30 }, carry: [['Grimy ranarr weed']] });
    assert.deepEqual(f.option('Fill'), [
        ['spam', 'You search your inventory for herbs appropriate to put in the sack...'],
        ['game', "You don't have enough space for the herbs."],
    ]);
    assert.equal(f.inventory.getAmount(Data.itemId('Grimy ranarr weed')), 1);
});

test('Fill with no grimy herb carried only refuses; clean herbs do not count', t => {
    const f = fixture(t, { carry: [['Ranarr weed'], ['Spade']] });
    assert.deepEqual(f.option('Fill'), [['game', 'You have no grimy herbs in your inventory that can be stored in the sack.']]);
});

test('Check lists one game message per herb, lowest Herblore level first, after the header', t => {
    const f = fixture(t, { name: 'Herb sack', stored: { 'Grimy torstol': 3, 'Grimy ranarr weed': 30, 'Grimy guam leaf': 1 } });
    assert.deepEqual(f.option('Check'), [
        ['game', 'You look in your herb sack and see:'],
        ['game', '1 x Grimy guam leaf'],
        ['game', '30 x Grimy ranarr weed'],
        ['game', '3 x Grimy torstol'],
    ]);
});

test('Check on an empty sack sends the header, then the empty line', t => {
    assert.deepEqual(fixture(t).option('Check'), [
        ['game', 'You look in your herb sack and see:'],
        ['game', 'The herb sack is empty.'],
    ]);
});

test('the silklined sack names itself in Check and the empty line', t => {
    assert.deepEqual(fixture(t, { name: 'Silklined herb sack' }).option('Check'), [
        ['game', 'You look in your silklined herb sack and see:'],
        ['game', 'The silklined herb sack is empty.'],
    ]);
    assert.deepEqual(fixture(t, { name: 'Open silklined herb sack' }).option('Empty'), [['game', 'The silklined herb sack is empty.']]);
});

test('Empty rummages (spam) and withdraws', t => {
    const f = fixture(t, { stored: { 'Grimy guam leaf': 2 } });
    assert.deepEqual(f.option('Empty'), [['spam', 'You rummage around to see if you can extract any herbs from your herb sack.']]);
    assert.equal(f.inventory.getAmount(Data.itemId('Grimy guam leaf')), 2);
    assert.deepEqual(f.stored(), {});
});

test('Empty with a full inventory refuses and keeps the herbs', t => {
    const f = fixture(t, { stored: { 'Grimy guam leaf': 2 }, fillers: 27 });
    assert.deepEqual(f.option('Empty'), [['game', 'You have no space to put any herbs!']]);
    assert.equal(f.stored()[Data.itemId('Grimy guam leaf')], 2);
});

test('Empty on an empty sack says so, even with a full inventory', t => {
    assert.deepEqual(fixture(t, { fillers: 27 }).option('Empty'), [['game', 'The herb sack is empty.']]);
});

test('an item other than a grimy herb used on the sack would spoil it', t => {
    const f = fixture(t, { carry: [['Ranarr weed']] });
    const event = { player: f.player, usedItemId: Data.itemId('Ranarr weed'), usedItemSlot: 1, usedWithItemId: f.sack.getId(), usedWithItemSlot: 0 };
    Guild.storagePair(event);
    assert.equal(event.handled, true);
    assert.deepEqual(f.lines, [['game', "You can't possibly put that in there, it would spoil your sack."]]);
    assert.equal(f.inventory.getAmount(Data.itemId('Ranarr weed')), 1);
});

test('a grimy herb used on a sack with no room for it gets the Fill refusal', t => {
    const f = fixture(t, { stored: { 'Grimy guam leaf': 30 }, carry: [['Grimy guam leaf']] });
    Guild.storagePair({ player: f.player, usedItemId: Data.itemId('Grimy guam leaf'), usedItemSlot: 1, usedWithItemId: f.sack.getId(), usedWithItemSlot: 0 });
    assert.deepEqual(f.lines, [['game', "You don't have enough space for the herbs."]]);
});

test('the bank Empty option on an empty sack says the sack is empty', t => {
    const f = fixture(t);
    t.mock.method(core.Bank, 'isOpen', () => true);
    Guild.bankStorageOp({ player: f.player, op: 9, slot: 0, item: f.sack });
    assert.deepEqual(f.lines, [['game', 'The herb sack is empty.']]);
});

test('a seed box emptied into a full inventory says there is no space after what fitted', t => {
    const f = fixture(t, { name: 'Seed box', fillers: 26 });
    f.sack.setMetaValue('farming:stored', { [Data.itemId('Guam seed')]: 3, [Data.itemId('Ranarr seed')]: 2 });
    const lines = f.option('Empty');
    assert.equal(lines.length, 2);
    assert.equal(lines[0][0], 'spam');
    assert.match(lines[0][1], /^Emptied \d+ x .* seed to your inventory\.$/);
    assert.deepEqual(lines[1], ['game', "You don't have space in your inventory for that."]);
});
