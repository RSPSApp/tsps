// Bottomless compost bucket parity: pouring, Check and filling, from rsprox captures (local
// recordings 1001537, 1001562, 1001663, 1001664, 1001928) and the Wiki transcript.
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
let core, Data, Patches, Services, Model, hooks;
before(async () => {
    await CachePipeline.initialize(require('node:path').resolve(__dirname, '..'));
    core = PluginManager.getCoreApi();
    require('../plugins/skills/farming/Core.Farming').init({ core });
    Data = require('../plugins/skills/farming/Data.Farming');
    Patches = require('../plugins/skills/farming/Patches.Farming');
    Services = require('../plugins/skills/farming/Services.Farming');
    Model = require('../plugins/skills/farming/Model.Farming');
    Data.initializeFarmingData();
    hooks = {};
    Patches.attach(new Proxy({}, { get: (_target, name) => (...args) => {
        if (name === 'onItemOnItem' || name === 'onItemOnObject') hooks[name] = args[0];
    } }));
});
const EMPTY = () => core.ItemIdentifiers.BOTTOMLESS_COMPOST_BUCKET;
const FILLED = () => core.ItemIdentifiers.BOTTOMLESS_COMPOST_BUCKET_4;
const WARNING = 'Filling the bucket with compost will make the bucket untradeable. If emptied, it will become tradeable again - however <col=7f0000>ALL</col> remaining compost inside it will be <col=7f0000>LOST</col>.';
const NOTED_LINE = 'As you deposit noted buckets of compost into your bottomless compost bucket, you mysteriously receive noted empty buckets back.';

function prepare(t, charges = 0, tier = 3) {
    const player = new Player(null), varbits = new Map(), prompts = [], sounds = [], animations = [];
    const sender = new Proxy({}, { get: (_, name) => name === 'getVarbit' ? id => varbits.get(id) ?? 0
        : name === 'sendVarbit' ? (id, value) => { varbits.set(id, value); return sender; }
        : name === 'sendEnterAmountPrompt' ? title => { prompts.push(title); return sender; }
        : name === 'sendSound' ? id => { sounds.push(id); return sender; } : () => sender });
    player.getPacketSender = () => sender;
    player.messages = [];
    player.sendMessage = text => player.messages.push(text);
    player.performAnimation = animation => animations.push(animation.getId?.() ?? animation.id);
    player.getClickDelay = () => ({ elapsedTime: () => true, reset() {} });
    t.mock.method(core.MapObjects, 'get', () => null);
    const bucket = new core.Item(charges ? FILLED() : EMPTY());
    if (charges) bucket.setMetaValue('farming:charges', charges).setMetaValue('farming:tier', tier);
    player.getInventory().add(bucket, false);
    return { player, prompts, sounds, animations, get bucket() { return player.getInventory().forSlot(0); },
        box: () => player.getDialogueManager().getCurrent()?.getText?.() };
}
const compostId = (tier, noted = false) => {
    const id = Data.itemId(['', 'Compost', 'Supercompost', 'Ultracompost'][tier]);
    return noted ? core.CacheDefinitions.getItem(id).note : id;
};
function useOnBucket(f, inputId) {
    const slot = f.player.getInventory().getItems().findIndex(item => item?.getId() === inputId);
    const event = { player: f.player, usedItemId: inputId, usedItemSlot: slot, usedWithItemId: f.bucket.getId(), usedWithItemSlot: 0 };
    hooks.onItemOnItem(event);
    return event;
}
function option(f, name) {
    Services.farmingItemAction({ player: f.player, itemId: f.bucket.getId(), slot: 0, option: name });
}
function answer(f, count) {
    const action = f.player.getEnteredAmountAction();
    assert.ok(action, 'a count prompt is open');
    f.player.setEnteredAmountAction(null);
    action.execute(count);
}
function proceed(f, choice) {
    assert.equal(f.box(), WARNING);
    f.player.getDialogueManager().advance();
    const menu = f.player.getDialogueManager().getCurrent();
    assert.equal(menu.getTitle(), 'Do you wish to proceed?');
    f.player.getDialogueManager().handleResume(core.OptionDialogue.OPTIONS_WIDGET_ID, choice);
}
function pour(f) {
    const patch = Data.CACHE.patches.find(p => p.type === 'HERB'), farm = Patches.farmFor(f.player);
    f.player.moveTo(new core.Location(patch.x, patch.y, patch.z));
    const state = { ...Model.emptyPatch(Date.now(), farm), weeds: 0 };
    farm.patches[Data.patchKey(patch)] = state;
    const event = { player: f.player, itemId: f.bucket.getId(), itemSlot: 0,
        object: { getId: () => patch.id }, location: { x: patch.x, y: patch.y, z: patch.z } };
    hooks.onItemOnObject(event);
    for (let i = 0; i < 2; i++) Patches.tick();
    return state;
}

test('pouring plays the bottomless pour and warns on the captured counts before the treat line', t => {
    const quiet = prepare(t, 102);
    pour(quiet);
    assert.deepEqual(quiet.animations, [8197]);
    assert.deepEqual(quiet.player.messages, ['You treat the herb patch with ultracompost.']);
    for (const [charges, line] of [
        [101, 'Your bottomless compost bucket has 100 uses of ultracompost remaining.'],
        [51, 'Your bottomless compost bucket has 50 uses of ultracompost remaining.'],
        [21, 'Your bottomless compost bucket has 20 uses of ultracompost remaining.'],
        [8, 'Your bottomless compost bucket has 7 uses of ultracompost remaining.'],
        [2, 'Your bottomless compost bucket has a single use of ultracompost remaining.'],
    ]) {
        const f = prepare(t, charges);
        assert.equal(pour(f).compost, 3);
        assert.deepEqual(f.player.messages, [line, 'You treat the herb patch with ultracompost.'], `${charges}`);
        assert.equal(f.bucket.getId(), FILLED());
    }
    const last = prepare(t, 1, 2);
    pour(last);
    assert.deepEqual(last.player.messages, ['Your bottomless compost bucket has run out of compost!', 'You treat the herb patch with supercompost.']);
    assert.equal(last.bucket.getId(), EMPTY());
});

test('Check shows the captured item box, or the Wiki line when empty', t => {
    const full = prepare(t, 500);
    option(full, 'Check');
    assert.equal(full.box(), 'Your bottomless compost bucket is currently holding 500 uses of ultracompost.');
    const empty = prepare(t);
    option(empty, 'Check');
    assert.equal(empty.box(), 'Your compost bucket is currently empty.');
});

test('noted ultracompost on an empty bucket: count, warning, Yes, the noted line and the total box', t => {
    const f = prepare(t);
    f.player.getInventory().add(new core.Item(compostId(3, true), 250), false);
    assert.equal(useOnBucket(f, compostId(3, true)).handled, true);
    assert.deepEqual(f.prompts, ['How many Ultracompost would you like to fill with? (1 - 250)']);
    answer(f, 250);
    proceed(f, 1);
    assert.deepEqual(f.player.messages, [NOTED_LINE]);
    assert.deepEqual(f.sounds, [2584]);
    assert.equal(f.box(), 'You fill your bottomless compost bucket with 250 buckets of ultracompost. Your bottomless compost bucket now contains a total of 500 uses.');
    assert.equal(f.bucket.getId(), FILLED());
    assert.equal(f.bucket.getMetaValue('farming:charges'), 500);
    assert.equal(f.player.getInventory().getAmount(compostId(3, true)), 0);
    assert.equal(f.player.getInventory().getAmount(core.CacheDefinitions.getItem(Data.itemId('Bucket')).note), 250);
});

test('No on the warning keeps everything; a filled bucket skips the warning', t => {
    const f = prepare(t);
    f.player.getInventory().add(new core.Item(compostId(3, true), 2000), false);
    useOnBucket(f, compostId(3, true));
    assert.deepEqual(f.prompts, ['How many Ultracompost would you like to fill with? (1 - 2000)']);
    answer(f, 2000);
    proceed(f, 2);
    assert.equal(f.bucket.getId(), EMPTY());
    assert.equal(f.player.getInventory().getAmount(compostId(3, true)), 2000);
    const g = prepare(t, 4);
    g.player.getInventory().add(new core.Item(compostId(3)), false);
    option(g, 'Fill');
    assert.deepEqual(g.prompts, ['How many Ultracompost would you like to fill with? (1 - 1)']);
    answer(g, 1);
    assert.deepEqual(g.player.messages, []);
    assert.equal(g.box(), 'You fill your bottomless compost bucket with a single bucket of ultracompost. Your bottomless compost bucket now contains a total of 6 uses.');
    assert.equal(g.player.getInventory().getAmount(Data.itemId('Bucket')), 1);
});

test('Fill and compost refusals: none carried, only another type, another type used, full buckets', t => {
    const none = prepare(t);
    option(none, 'Fill');
    assert.deepEqual(none.player.messages, ["You don't have any compost to fill your bottomless compost bucket with."]);
    const other = prepare(t, 10, 3);
    other.player.getInventory().add(new core.Item(compostId(1)), false);
    option(other, 'Fill');
    assert.deepEqual(other.player.messages, ["Your bottomless compost bucket contains ultracompost. Sadly you don't have any more to fill it with any further."]);
    useOnBucket(other, compostId(1));
    assert.equal(other.player.messages.at(-1), 'Your bottomless compost bucket already contains ultracompost. You cannot fill it with compost.');
    assert.equal(other.prompts.length, 0);
    for (const [charges, line] of [
        [10000, "Your bottomless compost bucket is full. You won't be able to squeeze any more compost in there."],
        [9999, "Your bottomless compost bucket is just about full. You won't be able to squeeze any more compost in there."],
    ]) {
        const f = prepare(t, charges, 2);
        f.player.getInventory().add(new core.Item(compostId(2)), false);
        option(f, 'Fill');
        assert.deepEqual(f.player.messages, [line]);
        assert.equal(f.prompts.length, 0);
    }
    const last = prepare(t, 9998, 2);
    last.player.getInventory().add(new core.Item(compostId(2, true), 5), false);
    useOnBucket(last, compostId(2, true));
    assert.deepEqual(last.prompts, ['How many Supercompost would you like to fill with? (1 - 1)']);
    answer(last, 5);
    assert.deepEqual(last.player.messages, [NOTED_LINE, 'Your bottomless compost bucket is now full!']);
    assert.equal(last.bucket.getMetaValue('farming:charges'), 10000);
    assert.equal(last.player.getInventory().getAmount(compostId(2, true)), 4);
});
