// Run after `yarn build`: node --test tests/farming-willow-branches-growth-rate.test.cjs
// A grown willow regrows one branch every 5 minutes (Wiki: Willow branch), at the world's
// Farming:growthMultiplier as its crops are. Real Player and Inventory; only the packets are stubbed.
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
let core, Data, Model, Patches, tree;
before(async () => {
    await CachePipeline.initialize(require('node:path').resolve(__dirname, '..'));
    core = PluginManager.getCoreApi();
    require('../plugins/skills/farming/Core.Farming').init({ core });
    Data = require('../plugins/skills/farming/Data.Farming');
    Data.initializeFarmingData();
    Model = require('../plugins/skills/farming/Model.Farming');
    Patches = require('../plugins/skills/farming/Patches.Farming');
    tree = Data.CACHE.patches.find((patch) => patch.type === 'TREE');
});
const now = Date.UTC(2026, 8, 30);

function willow(t, rate, sinceCut, savedRate = rate) {
    Model.setGrowthMultiplier(rate);
    t.after(() => Model.setGrowthMultiplier(1));
    t.mock.method(Date, 'now', () => now);
    const player = new Player(null), messages = [];
    const sender = new Proxy({}, { get: () => () => sender });
    player.getPacketSender = () => sender; player.sendMessage = (text) => messages.push(text);
    player.getInventory().add(new core.Item(Data.itemId('Secateurs'), 1), false);
    const farm = { offset: 0, tools: {}, autoWeed: false, growthMultiplier: savedRate === 1 ? undefined : savedRate, patches: {
        [Data.patchKey(tree)]: { crop: 'WILLOW', status: 'grown', checked: true, stage: 7, lives: 1, nextAt: Infinity,
            branches: 0, branchAt: now - sinceCut } } };
    player.setAttribute(Patches.FARM_ATTRIBUTE, farm);
    const cut = () => Patches.cure(player, tree, true, Data.itemId('Secateurs'));
    const branches = () => player.getInventory().getAmount(Data.itemId('Willow branch'));
    return { messages, cut, branches };
}

test('at 1x a cut-bare willow has no branch 30 seconds later, and one after 5 minutes', (t) => {
    const early = willow(t, 1, 30_000);
    assert.equal(early.cut(), false);
    assert.deepEqual(early.messages, ['There are no branches ready to cut yet.']);
    const later = willow(t, 1, 5 * 60_000);
    assert.equal(later.cut(), true);
    assert.equal(later.branches(), 1);
});

test('at 10x a branch grows back in 30 seconds', (t) => {
    const f = willow(t, 10, 30_000);
    assert.equal(f.cut(), true, JSON.stringify(f.messages));
    assert.equal(f.branches(), 1);
});

// A farm saved at one rate and loaded at another keeps the branch progress it had (Model.applyGrowthRate).
test('a rate change keeps the willow branch progress since its last cut', (t) => {
    // 4 of the 5 minutes at 1x is 24 of the 30 seconds at 10x: still no branch.
    const faster = willow(t, 10, 4 * 60_000, 1);
    assert.equal(faster.cut(), false);
    assert.deepEqual(faster.messages, ['There are no branches ready to cut yet.']);
    // 60 seconds at 10x is two branches' worth, which at 1x is 10 minutes: two to cut.
    const slower = willow(t, 1, 60_000, 10);
    assert.equal(slower.cut(), true, JSON.stringify(slower.messages));
    assert.equal(slower.cut(), true, JSON.stringify(slower.messages));
    assert.equal(slower.cut(), false);
    assert.equal(slower.branches(), 2);
});
