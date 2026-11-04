// Patch actions against rsprox captures of live OSRS (docs/farming.md): lines, channels and ticks.
const assert = require('node:assert/strict');
const { before, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
let core, Data, Model, Patches, hooks;
before(async () => {
    await CachePipeline.initialize(require('node:path').resolve(__dirname, '..'));
    core = PluginManager.getCoreApi();
    require('../plugins/skills/farming/Core.Farming').init({ core });
    Data = require('../plugins/skills/farming/Data.Farming');
    Model = require('../plugins/skills/farming/Model.Farming');
    Patches = require('../plugins/skills/farming/Patches.Farming');
    Data.initializeFarmingData();
    hooks = {};
    Patches.attach(new Proxy({}, { get: (_, name) => (...args) => {
        if (['onObjectInteraction', 'onItemOnObject'].includes(name)) hooks[name] = args[0];
        if (name === 'onInterfaceActionClick' && args[0].name === 'farmingOptionClick') hooks[name] = args[0];
    } }));
});
const ticks = (n) => { for (let i = 0; i < n; i++) Patches.tick(); };
/** A player at a patch of `type`; `said` records [channel, text] with 'game' or 'spam', `sounds` the synth ids. */
function fixture(t, type, items = []) {
    const player = new Player(null), said = [], sounds = [], anims = [];
    const sender = new Proxy({}, { get: (_, name) => name === 'sendTypedMessage' ? (_type, text) => { said.push(['spam', text]); return sender; }
        : name === 'sendSound' ? id => { sounds.push(id); return sender; } : () => sender });
    player.getPacketSender = () => sender; player.sendMessage = text => said.push(['game', text]);
    player.performAnimation = animation => anims.push(animation.getId());
    player.busy = () => false; player.getClickDelay().elapsedTime = () => true;
    player.getSkillManager().setCurrentLevel(core.Skill.FARMING, 99, false);
    t.mock.method(core.MapObjects, 'get', () => null);
    const patch = typeof type === 'string' ? Data.CACHE.patches.find(p => p.type === type) : type;
    player.moveTo(new core.Location(patch.x, patch.y, patch.z));
    for (const name of items) player.getInventory().add(new core.Item(Data.itemId(name)), false);
    const state = Patches.stateFor(player, patch);
    state.weeds = 0;
    const event = extra => ({ player, object: { getId: () => patch.id }, location: { x: patch.x, y: patch.y, z: patch.z }, clickType: 1, ...extra });
    const use = name => hooks.onItemOnObject(event({ itemId: Data.itemId(name), itemSlot: player.getInventory().getSlotForItemId(Data.itemId(name)) }));
    const click = option => {
        t.mock.method(core.ObjectDefinition, 'forPlayer', () => ({ getInteractions: () => [option] }));
        hooks.onObjectInteraction(event());
    };
    return { player, patch, state, said, sounds, anims, use, click };
}

test('a seed is dibbed with its sound and named with the patch three ticks later', t => {
    const f = fixture(t, 'ALLOTMENT', ['Seed dibber', 'Potato seed', 'Potato seed', 'Potato seed']);
    f.use('Potato seed');
    assert.deepEqual([f.anims, f.sounds], [[2291], [2432]]);
    assert.equal(f.player.getInventory().getAmount(Data.itemId('Potato seed')), 0);
    ticks(2);
    assert.equal(f.state.crop, undefined);
    ticks(1);
    assert.equal(f.state.crop, 'POTATO');
    assert.equal(f.state.plantedTick, Model.tickIndex(f.state.plantedAt, Patches.farmFor(f.player).offset));
    assert.deepEqual(f.said, [['spam', 'You plant 3 potato seeds in the allotment.']]);
});

test('planting below the crop level is refused before a seed or patch state changes', t => {
    const f = fixture(t, 'HERB', ['Seed dibber', 'Ranarr seed']);
    f.player.getSkillManager().setCurrentLevel(core.Skill.FARMING, 31, false);
    f.use('Ranarr seed');
    assert.deepEqual(f.said, [['game', 'You need level 32 Farming to plant that.']]);
    assert.equal(f.player.getInventory().getAmount(Data.itemId('Ranarr seed')), 1);
    assert.equal(f.state.crop, undefined);
    ticks(3);
    assert.equal(f.state.crop, undefined, 'a refused seed schedules no growth');
});

test('the crop level from the wiki is the planting gate, and boosts count', t => {
    const f = fixture(t, 'HERB', ['Seed dibber', 'Ranarr seed']);
    f.player.getSkillManager().setMaxLevels(core.Skill.FARMING, 30, false).setCurrentLevel(core.Skill.FARMING, 32, false);
    f.use('Ranarr seed');
    ticks(3);
    assert.equal(f.state.crop, 'RANARR');
});

test('a sapling is dug in and named the next tick; hardwood saplings are "the plantpot"', t => {
    for (const [type, sapling, line] of [['TREE', 'Yew sapling', 'You plant the yew sapling in the tree patch.'],
        ['TREE', 'Magic sapling', 'You plant the magic tree sapling in the tree patch.'],
        ['FRUIT_TREE', 'Palm sapling', 'You plant the palm tree sapling in the fruit tree patch.'],
        ['HARDWOOD_TREE', 'Mahogany sapling', 'You plant the plantpot in the hardwood tree patch.'],
        ['SPIRIT_TREE', 'Spirit sapling', 'You plant the Spirit Tree sapling.']]) {
        const f = fixture(t, type, ['Spade', sapling]);
        f.use(sapling);
        assert.deepEqual([f.anims, f.sounds], [[830], [1470]], sapling);
        ticks(1);
        assert.deepEqual(f.said, [['spam', line]], sapling);
        assert.equal(f.player.getInventory().getAmount(Data.itemId('Plant pot')), 1, sapling);
    }
});

test('a Varrock tree patch captured by RSProx accepts a yew sapling', t => {
    // Recording 127 (rev 227): OpLocT(id=8391, x=3192, z=3230, selectedObj=5373).
    const patch = Data.CACHE.patches.find(p => p.id === 8391 && p.x === 3192 && p.y === 3230 && p.z === 0);
    assert.ok(patch, 'captured tree patch is present in the Farming patch table');
    const f = fixture(t, patch, ['Rake', 'Spade', 'Yew sapling']);
    f.state.weeds = 3;
    f.click('Rake');
    ticks(14);
    assert.equal(f.state.weeds, 0, 'raking makes the initially weedy tree patch plantable');
    f.use('Yew sapling');
    ticks(1);
    assert.equal(f.state.crop, 'YEW');
    assert.deepEqual(f.said, [['spam', 'You plant the yew sapling in the tree patch.']]);
});

test('planting XP waits until a harvest or check-health event', t => {
    const f = fixture(t, 'FLOWER', ['Seed dibber', 'Marigold seed', 'Spade']);
    const xp = [];
    t.mock.method(f.player.getSkillManager(), 'addExperiences', (skill, amount) => xp.push([skill, amount]));
    f.use('Marigold seed');
    ticks(3);
    assert.deepEqual(xp, []);
    Object.assign(f.state, { stage: Data.CROPS.get('MARIGOLD').stages, status: 'grown', lives: 1,
        nextAt: Number.MAX_SAFE_INTEGER, plantExperiencePending: true });
    t.mock.method(core.ObjectDefinition, 'forPlayer', () => ({ getInteractions: () => ['Pick'] }));
    hooks.onObjectInteraction({ player: f.player, object: { getId: () => f.patch.id },
        location: { x: f.patch.x, y: f.patch.y, z: f.patch.z }, clickType: 1 });
    ticks(3);
    assert.deepEqual(xp.map(([, amount]) => amount), [Data.CROPS.get('MARIGOLD').harvest, Data.CROPS.get('MARIGOLD').plant]);
});

test('checking a tree awards pending planting XP with its health-check XP', t => {
    const f = fixture(t, 'TREE');
    const crop = Data.CROPS.get('YEW'), xp = [];
    t.mock.method(f.player.getSkillManager(), 'addExperiences', (skill, amount) => xp.push([skill, amount]));
    Object.assign(f.state, { crop: crop.key, stage: crop.stages, status: 'grown', lives: 0,
        checked: false, plantExperiencePending: true, nextAt: Number.MAX_SAFE_INTEGER });
    f.click('Check-health');
    assert.deepEqual(xp.map(([, amount]) => amount), [crop.check, crop.plant]);
    assert.equal(f.state.plantExperiencePending, false);
});

test('a persisted herb without the new XP flag gets its deferred planting XP at harvest', t => {
    const patch = Data.CACHE.patches.find(p => p.type === 'HERB' && (p.x !== 2826 || p.y !== 3694));
    const f = fixture(t, patch);
    const crop = Data.CROPS.get('GUAM'), xp = [];
    Object.assign(f.state, { crop: crop.key, stage: crop.stages, status: 'grown', checked: false,
        lives: 1, nextAt: Number.MAX_SAFE_INTEGER });
    delete f.state.plantExperiencePending;
    t.mock.method(f.player.getSkillManager(), 'addExperiences', (skill, amount) => xp.push([skill, amount]));
    t.mock.method(Math, 'random', () => 0.999999);
    assert.equal(Patches.harvest(f.player, f.patch), false, 'the last herb pick clears the crop');
    assert.deepEqual(xp.map(([, amount]) => amount), [crop.harvest, crop.plant]);
    assert.equal(f.state.plantExperiencePending, false);
});

test('legacy non-herbs and explicit false do not receive planting XP twice', t => {
    const nonHerb = fixture(t, 'ALLOTMENT');
    Object.assign(nonHerb.state, { crop: 'POTATO' });
    delete nonHerb.state.plantExperiencePending;
    const xp = [];
    t.mock.method(nonHerb.player.getSkillManager(), 'addExperiences', (skill, amount) => xp.push(amount));
    assert.equal(Patches.awardPendingPlantExperience(nonHerb.player, nonHerb.patch, nonHerb.state), false);
    assert.deepEqual(xp, []);

    const paid = fixture(t, 'HERB');
    Object.assign(paid.state, { crop: 'GUAM', plantExperiencePending: false });
    t.mock.method(paid.player.getSkillManager(), 'addExperiences', (skill, amount) => xp.push(amount));
    assert.equal(Patches.awardPendingPlantExperience(paid.player, paid.patch, paid.state), false);
    assert.deepEqual(xp, []);
});

test('single-crop patches reject early clearing; multi-crop patches allow it without XP', t => {
    const unique = fixture(t, 'MUSHROOM', ['Spade']);
    const uniqueCrop = Data.CROPS.get('MUSHROOM');
    Object.assign(unique.state, { crop: uniqueCrop.key, stage: 1, status: 'growing', plantExperiencePending: true });
    unique.use('Spade');
    assert.deepEqual(unique.said, [['game', 'You cannot dig up a healthy crop while it is growing in this patch.']]);
    assert.equal(unique.state.crop, 'MUSHROOM');

    const multi = fixture(t, 'ALLOTMENT', ['Spade']);
    Object.assign(multi.state, { crop: 'POTATO', stage: 1, status: 'growing', plantExperiencePending: true });
    const xp = [];
    t.mock.method(multi.player.getSkillManager(), 'addExperiences', (skill, amount) => xp.push([skill, amount]));
    multi.use('Spade');
    assert.ok(multi.player.getDialogueManager().getCurrent() instanceof core.OptionDialogue);
    hooks.onInterfaceActionClick({ player: multi.player, buttonId: core.OptionDialogue.OPTIONS_WIDGET_ID, action: 1 });
    ticks(5);
    assert.equal(Patches.stateFor(multi.player, multi.patch).crop, undefined);
    assert.deepEqual(xp, [], 'clearing a healthy immature crop gives no planting XP');
});

test('a healthy herb can be cleared early at the unlocked Troll Stronghold patch', t => {
    const patch = Data.CACHE.patches.find(p => p.type === 'HERB' && p.x === 2826 && p.y === 3694 && p.z === 0);
    assert.ok(patch, 'the normal Troll Stronghold herb patch is present');
    const f = fixture(t, patch, ['Spade']);
    t.mock.method(core.PluginManager, 'emitCustomEvent', (name, request) => {
        if (name === 'quest:is-complete' && request.key === 'my_arms_big_adventure') request.complete = true;
    });
    Object.assign(f.state, { crop: 'GUAM', stage: 1, status: 'growing', plantExperiencePending: true });
    const xp = [];
    t.mock.method(f.player.getSkillManager(), 'addExperiences', (skill, amount) => xp.push(amount));
    f.use('Spade');
    assert.ok(f.player.getDialogueManager().getCurrent() instanceof core.OptionDialogue);
    hooks.onInterfaceActionClick({ player: f.player, buttonId: core.OptionDialogue.OPTIONS_WIDGET_ID, action: 1 });
    ticks(5);
    assert.equal(Patches.stateFor(f.player, patch).crop, undefined);
    assert.deepEqual(xp, [], 'clearing a healthy immature herb gives no planting XP');
});

test('a sapling in the wrong patch names the patch it belongs in', t => {
    const f = fixture(t, 'TREE', ['Spade', 'Palm sapling']);
    f.use('Palm sapling');
    assert.deepEqual(f.said, [['game', 'You can only plant palm tree saplings in a fruit tree patch.']]);
});

test('compost is poured at once and the patch treated and named two ticks later', t => {
    const f = fixture(t, 'TREE', ['Ultracompost']);
    f.use('Ultracompost');
    assert.deepEqual([f.anims, f.sounds], [[2283], [2427]]);
    ticks(1);
    assert.equal(f.state.compost, 0);
    ticks(1);
    assert.equal(f.state.compost, 3);
    assert.equal(f.player.getInventory().getAmount(Data.itemId('Bucket')), 1);
    assert.deepEqual(f.said, [['game', 'You treat the tree patch with ultracompost.']]);
});

test('inspect is one paragraph about the patch, with the gardener line when protected', t => {
    const f = fixture(t, 'FRUIT_TREE');
    f.click('Inspect');
    Object.assign(f.state, { crop: 'PALM', stage: 3, status: 'growing', compost: 3, protected: true });
    f.click('Inspect');
    assert.deepEqual(f.said.map(([, text]) => text), [
        'This is a fruit tree patch. The soil has not been treated. The patch is empty and weeded.',
        'This is a fruit tree patch. The soil has been treated with ultracompost. The patch has Palm tree growing in it and is at state 3/6.',
        'A nearby gardener is looking after this patch for you.']);
});

test('raking swings two ticks after the click and pulls a weed every four ticks after that', t => {
    const f = fixture(t, 'HERB', ['Rake']);
    f.state.weeds = 2;
    f.click('Rake');
    ticks(1);
    assert.deepEqual(f.anims, []);
    ticks(1);
    assert.deepEqual([f.anims, f.sounds], [[2273], [2442]]);
    ticks(4);
    assert.equal(f.state.weeds, 1);
    ticks(4);
    assert.equal(f.state.weeds, 0);
    assert.equal(f.anims.length, 2);
});

test('an allotment harvest says it begins, digs every three ticks and says when it is empty', t => {
    const f = fixture(t, 'ALLOTMENT', ['Spade']);
    Object.assign(f.state, { crop: 'POTATO', stage: 4, status: 'grown', lives: 1, nextAt: Number.MAX_SAFE_INTEGER });
    t.mock.method(Math, 'random', () => 0.999999);
    f.click('Harvest');
    assert.deepEqual([f.anims, f.sounds], [[830], [1470]]);
    assert.deepEqual(f.said, [['spam', 'You begin to harvest the allotment.']]);
    ticks(1);
    assert.equal(f.player.getInventory().getAmount(Data.itemId('Potato')), 1);
    assert.deepEqual(f.said.at(-1), ['game', 'The allotment is now empty.']);
});

test('a fruit tree picks high and names each fruit two ticks after the pick', t => {
    const f = fixture(t, 'FRUIT_TREE');
    Object.assign(f.state, { crop: 'PALM', stage: 6, status: 'grown', checked: true, lives: 6, nextAt: Number.MAX_SAFE_INTEGER });
    f.click('Pick-coconut');
    assert.deepEqual(f.anims, [2280]);
    ticks(1);
    assert.equal(f.player.getInventory().getAmount(Data.itemId('Coconut')), 0);
    ticks(1);
    assert.deepEqual([f.sounds, f.said], [[2437], [['spam', 'You pick a coconut.']]]);
    ticks(1);
    assert.deepEqual(f.anims, [2280, 2280]);
});

test('a healthy tree is examined for disease on the spam channel', t => {
    for (const [type, crop, line] of [['TREE', 'YEW', 'You examine the tree for signs of disease and find that it is in perfect health.'],
        ['SPIRIT_TREE', 'SPIRIT_TREE', 'You examine the Spirit Tree for signs of disease and find that it is in perfect health.']]) {
        const f = fixture(t, type);
        t.mock.method(Math, 'random', () => 0.999999);
        Object.assign(f.state, { crop, stage: Data.CROPS.get(crop).stages, status: 'grown', lives: 0, nextAt: Number.MAX_SAFE_INTEGER });
        f.click('Check-health');
        assert.deepEqual(f.said, [['spam', line]], crop);
    }
});

test('digging up a dead crop digs twice and clears the patch five ticks after the click', t => {
    const f = fixture(t, 'HERB', ['Spade']);
    const xp = [];
    t.mock.method(f.player.getSkillManager(), 'addExperiences', (skill, amount) => xp.push([skill, amount]));
    Object.assign(f.state, { crop: 'GUAM', stage: 2, status: 'dead', plantExperiencePending: true,
        nextAt: Number.MAX_SAFE_INTEGER });
    f.click('Clear');
    assert.deepEqual(f.said, [['spam', 'You start digging the farming patch...']]);
    ticks(3);
    assert.deepEqual(f.anims, [830, 830]);
    ticks(1);
    assert.equal(Patches.stateFor(f.player, f.patch).crop, 'GUAM');
    ticks(1);
    assert.equal(Patches.stateFor(f.player, f.patch).crop, undefined);
    assert.deepEqual(f.said.at(-1), ['spam', 'You have successfully cleared this patch for new crops.']);
    assert.deepEqual(xp.map(([, amount]) => amount), [Data.CROPS.get('GUAM').plant]);
});

test('a missing rake names the farming patch', t => {
    const f = fixture(t, 'HOPS');
    f.state.weeds = 3;
    f.click('Rake');
    assert.deepEqual(f.said, [['game', 'You need a rake to weed a farming patch.']]);
});
