const assert = require('node:assert/strict');
const { test, before } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
let core, Data, Patches, Tithe;
const TIERS = [['Golovanova', 34], ['Bologano', 54], ['Logavano', 74]];
before(async () => {
    await CachePipeline.initialize(require('node:path').resolve(__dirname, '..'));
    core = PluginManager.getCoreApi();
    require('../plugins/skills/farming/Core.Farming').init({ core });
    Data = require('../plugins/skills/farming/Data.Farming');
    Patches = require('../plugins/skills/farming/Patches.Farming');
    Tithe = require('../plugins/skills/farming/Tithe.Farming');
    Data.initializeFarmingData();
});
function prepare(t, tier = 0, { boosted = false } = {}) {
    const player = new Player(null), [name, level] = TIERS[tier];
    const prompts = [];
    const sender = new Proxy({}, { get: (_target, method) => (...args) => {
        if (method === 'sendEnterAmountPrompt') prompts.push(args[0]);
        return sender;
    } });
    player.getPacketSender = () => sender; player.sendMessage = () => {};
    player.moveTo(new core.Location(1802, 3501, 0));
    player.getSkillManager().setMaxLevels(core.Skill.FARMING, boosted ? level - 1 : level, false)
        .setCurrentLevel(core.Skill.FARMING, level, false);
    let entries;
    t.mock.method(Patches, 'choose', (_player, options) => { entries = options; });
    Tithe.titheObject({ player, object: { getId: () => core.ObjectIdentifiers.SEED_TABLE,
        getLocation: () => new core.Location(1802, 3501, 0) } });
    const reopen = () => entries[tier][1](), id = Data.itemId(name + ' seed');
    assert.deepEqual(entries.map(([label]) => label), TIERS.map(([crop, need]) => `${crop} seeds (level ${need})`));
    reopen();
    // Issue 6474: the table asks how many, it does not offer 100, 1000 and 10000.
    assert.equal(prompts.length, 1, 'one amount prompt');
    assert.ok(player.getEnteredAmountAction(), 'the typed amount has somewhere to go');
    return { player, level, id, reopen, prompts, take: (amount = 100) => player.getEnteredAmountAction()?.execute(amount),
        inventory: player.getInventory(), seeds: () => player.getInventory().getAmount(id) };
}
test('a decayed boost cannot take seeds after the quantity prompt opens', t => {
    for (let tier = 0; tier < TIERS.length; tier++) {
        const f = prepare(t, tier, { boosted: true });
        f.player.getSkillManager().setCurrentLevel(core.Skill.FARMING, f.level - 1, false);
        f.take();
        assert.equal(f.seeds(), 0, TIERS[tier][0]);
    }
});
test('a maintained boost meets each tier requirement at confirmation', t => {
    for (let tier = 0; tier < TIERS.length; tier++) {
        const f = prepare(t, tier, { boosted: true });
        f.take();
        assert.equal(f.seeds(), 100, TIERS[tier][0]);
    }
});
test('newly acquired different-tier seeds or fruit block the pending confirmation', t => {
    for (const suffix of [' seed', ' fruit']) {
        const f = prepare(t), foreign = Data.itemId('Bologano' + suffix);
        f.inventory.add(new core.Item(foreign, 1), false);
        f.take();
        assert.equal(f.seeds(), 0, suffix);
        assert.equal(f.inventory.getAmount(foreign), 1);
    }
});
test('top-ups and repeated confirmations respect the10000 seed cap', t => {
    const f = prepare(t);
    f.inventory.add(new core.Item(f.id, 9950), false);
    f.take(); f.reopen(); f.take(10000);
    assert.equal(f.seeds(), 10000);
});
test('exact tier levels can take the typed quantity', t => {
    for (let tier = 0; tier < TIERS.length; tier++) {
        const f = prepare(t, tier);
        f.take(1000);
        assert.equal(f.seeds(), 1000, TIERS[tier][0]);
    }
});
test('any typed amount is taken as typed, and one over the cap gives the 10,000 maximum', t => {
    const odd = prepare(t);
    odd.take(37);
    assert.equal(odd.seeds(), 37);
    const over = prepare(t);
    over.take(2_000_000_000);
    assert.equal(over.seeds(), 10000);
    const topUp = prepare(t);
    topUp.inventory.add(new core.Item(topUp.id, 9990), false);
    topUp.take(5000);
    assert.equal(topUp.seeds(), 10000);
});
test('nothing, a negative or a non-number takes no seeds, and one answer is used once', t => {
    for (const typed of [0, -5, NaN, null]) {
        const f = prepare(t);
        f.take(typed);
        assert.equal(f.seeds(), 0, String(typed));
    }
    const f = prepare(t), action = f.player.getEnteredAmountAction();
    action.execute(10);
    action.execute(10);
    assert.equal(f.seeds(), 10, 'a stale prompt cannot be answered again');
});
test('walking away and a full inventory cannot produce seeds', t => {
    const away = prepare(t);
    away.player.moveTo(new core.Location(3200, 3200, 0));
    away.take();
    assert.equal(away.seeds(), 0);
    const full = prepare(t);
    full.inventory.add(new core.Item(Data.itemId('Spade'), 28), false);
    full.take();
    assert.equal(full.seeds(), 0);
    assert.equal(full.inventory.getAmount(Data.itemId('Spade')), 28);
});
