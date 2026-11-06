const assert = require('node:assert/strict');
const { before, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
let core, Data, Patches, diary, Progress, hooks;
before(async () => {
    await CachePipeline.initialize(require('node:path').resolve(__dirname, '..'));
    core = PluginManager.getCoreApi();
    require('../plugins/skills/farming/Core.Farming').init({ core });
    Data = require('../plugins/skills/farming/Data.Farming');
    Patches = require('../plugins/skills/farming/Patches.Farming');
    Data.initializeFarmingData();
    diary = require('../plugins/achievements/diaries/Data.AchievementDiaries').BY_KEY.get('falador');
    Progress = require('../plugins/achievements/diaries/Progress.AchievementDiaries');
    hooks = {};
    Patches.attach(new Proxy({}, { get: (_, name) => (...args) => {
        if (['onObjectInteraction', 'onItemOnObject'].includes(name)) hooks[name] = args[0];
    } }));
});
function fixture(t, tier = 'medium') {
    const player = new Player(null), xp = [], sender = new Proxy({}, { get: () => () => sender });
    player.getPacketSender = () => sender; player.sendMessage = () => {};
    player.performAnimation = () => {}; player.busy = () => false;
    player.getClickDelay().elapsedTime = () => true;
    player.getSkillManager().setCurrentLevel(core.Skill.FARMING, 99, false);
    t.mock.method(core.MapObjects, 'get', () => null);
    player.setAttribute('achievement-diaries:tasks', { falador: tier ? diary.tiers[tier].tasks.map(t => t.key) : [] });
    t.mock.method(player.getSkillManager(), 'addExperiences', (skill, amount) => xp.push([skill, amount]));
    t.mock.method(core.PluginManager, 'emitCustomEvent', (name, request) => {
        if (name === 'diary:is-complete' && request.diary === 'falador') request.complete = Progress.isTierComplete(request.player, diary, request.tier);
    });
    const fertilize = patch => { Patches.stateFor(player, patch).weeds = 0; return Patches.fertilize(player, patch, 1, false); };
    return { player, xp, fertilize };
}
const isFalador = p => p.z === 0 && ['ALLOTMENT', 'FLOWER', 'HERB'].includes(p.type) && p.x >= 3050 && p.x <= 3058 && p.y >= 3303 && p.y <= 3311;
// Farming actions finish on later farming ticks, as in the captures.
const ticks = (n) => { for (let i = 0; i < n; i++) Patches.tick(); };
test('Medium Falador Diary boosts compost XP at each of the four South Falador patches', t => {
    const f = fixture(t), patches = Data.CACHE.patches.filter(isFalador);
    assert.equal(patches.length, 4);
    for (const patch of patches) {
        assert.equal(f.fertilize(patch), true);
        assert.ok(Math.abs(f.xp.at(-1)[1] - 19.8) < 1e-9, patch.type);
    }
});
test('easy-only and incomplete diaries retain normal XP without requiring a shield', t => {
    for (const tier of ['easy', null]) {
        const f = fixture(t, tier);
        f.fertilize(Data.CACHE.patches.find(isFalador));
        assert.equal(f.xp.at(-1)[1], 18);
    }
});
test('the bonus follows the patch, never the player location or every Farming award', t => {
    const f = fixture(t);
    f.player.moveTo(new core.Location(3058, 3310, 0));
    for (const patch of Data.CACHE.patches.filter(p => ['ALLOTMENT', 'FLOWER', 'HERB', 'TREE'].includes(p.type) && !isFalador(p))) {
        f.fertilize(patch);
        assert.equal(f.xp.at(-1)[1], 18, `${patch.type} ${patch.x},${patch.y}`);
    }
    Patches.award(f.player, 100);
    assert.equal(f.xp.at(-1)[1], 100);
});
test('same coordinates on another plane do not inherit the diary reward', t => {
    const f = fixture(t), patch = { ...Data.CACHE.patches.find(isFalador), z: 1 };
    f.fertilize(patch);
    assert.equal(f.xp.at(-1)[1], 18);
});
test('failed patch actions award no XP', t => {
    const f = fixture(t), patch = Data.CACHE.patches.find(isFalador);
    assert.equal(Patches.fertilize(f.player, patch, 1, false), false);
    assert.deepEqual(f.xp, []);
});
test('all planting XP is deferred to crop health check or final harvest, with patch rewards', t => {
    for (const key of ['MARIGOLD', 'GUAM']) {
        const f = fixture(t), crop = Data.CROPS.get(key);
        const patch = Data.CACHE.patches.find(p => isFalador(p) && p.type === crop.type);
        const state = Patches.stateFor(f.player, patch);
        state.weeds = 0;
        f.player.moveTo(new core.Location(patch.x, patch.y, 0));
        f.player.getInventory().add(new core.Item(crop.seed), false).add(new core.Item(Data.itemId('Seed dibber')), false).add(new core.Item(Data.itemId('Spade')), false);
        const event = { player: f.player, object: { getId: () => patch.id }, location: { x: patch.x, y: patch.y, z: 0 }, clickType: 1, itemId: crop.seed, itemSlot: 0 };
        hooks.onItemOnObject(event);
        ticks(3);
        assert.equal(state.crop, key);
        assert.deepEqual(f.xp, [], `${key} has no planting XP on planting`);
        Object.assign(state, { status: 'grown', stage: crop.stages, lives: 1, nextAt: Number.MAX_SAFE_INTEGER });
        f.xp.length = 0;
        t.mock.method(core.ObjectDefinition, 'forPlayer', () => ({ getInteractions: () => ['Pick'] }));
        t.mock.method(Math, 'random', () => 0.999999);
        hooks.onObjectInteraction({ ...event, handled: false });
        ticks(3);
        const expected = (crop.harvest + crop.plant) * 1.1;
        assert.ok(Math.abs(f.xp.reduce((sum, [, amount]) => sum + amount, 0) - expected) < 1e-9, key);
    }
});
test('raking weeds receives the same diary bonus', t => {
    const f = fixture(t), patch = Data.CACHE.patches.find(isFalador);
    f.player.moveTo(new core.Location(patch.x, patch.y, 0));
    f.player.getInventory().add(new core.Item(Data.itemId('Rake')), false);
    t.mock.method(core.ObjectDefinition, 'forPlayer', () => ({ getInteractions: () => ['Rake'] }));
    hooks.onObjectInteraction({ player: f.player, object: { getId: () => patch.id }, location: { x: patch.x, y: patch.y, z: 0 }, clickType: 1 });
    ticks(6);
    assert.equal(Patches.stateFor(f.player, patch).weeds, 2);
    assert.ok(Math.abs(f.xp.at(-1)[1] - 4.4) < 1e-9);
});
