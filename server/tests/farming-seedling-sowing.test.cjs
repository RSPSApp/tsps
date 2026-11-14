// Tree seeds sown in plant pots and seedlings watered in the pack, from rsprox captures 127 (rev
// 227) and 2879 (rev 230) and the index's other sowings.
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
let core, Data, Patches, hooks;
before(async () => {
    await CachePipeline.initialize(require('node:path').resolve(__dirname, '..'));
    core = PluginManager.getCoreApi();
    require('../plugins/skills/farming/Core.Farming').init({ core });
    Data = require('../plugins/skills/farming/Data.Farming');
    Patches = require('../plugins/skills/farming/Patches.Farming');
    Data.initializeFarmingData();
    hooks = {};
    Patches.attach(new Proxy({}, { get: (_, name) => (...args) => {
        if (name === 'onItemOnItem') hooks[name] = args[0];
    } }));
});
function prepare(level = 99) {
    const player = new Player(null), lines = [], boxes = [], animations = [];
    const sender = new Proxy({}, { get: (_, name) => name === 'sendTypedMessage'
        ? (type, text) => { lines.push({ type, text }); return sender; } : () => sender });
    player.getPacketSender = () => sender;
    player.sendMessage = text => lines.push({ type: 'game', text });
    player.performAnimation = animation => animations.push(animation);
    player.getDialogueManager = () => ({ startDialogues: chain => {
        for (const dialogue of chain.getDialogues().values()) boxes.push(dialogue.getText());
    } });
    player.getSkillManager().setCurrentLevel(core.Skill.FARMING, level, false);
    return { player, inventory: player.getInventory(), lines, boxes, animations };
}
function use(f, a, b) {
    const slotOf = id => f.inventory.getItems().findIndex(item => item?.getId() === id);
    hooks.onItemOnItem({ player: f.player, usedItemId: a, usedItemSlot: slotOf(a), usedWithItemId: b, usedWithItemSlot: slotOf(b) });
}
const SOWN = {
    YEW: 'You sow a yew tree seed in the plantpot.<br>It needs watering before it will grow.',
    MAPLE: 'You sow a maple tree seed in the plantpot.<br>It needs watering before it will grow.',
    MAGIC: 'You sow a Magic Tree seed in the plantpot.<br>It needs watering before it will grow.',
    SPIRIT_TREE: 'You sow a Spirit Tree seed in the plantpot.<br>It needs watering before it will grow.',
    ORANGE: 'You sow an orange tree seed in the plantpot.<br>It needs watering before it will grow.',
    PALM: 'You sow a palm tree seed in the plantpot.<br>It needs watering before it will grow.',
    CALQUAT: 'You sow a calquat tree seed in the plantpot.<br>It needs watering before it will grow.',
    MAHOGANY: 'You sow a mahogany seed in the plantpot.<br>It needs watering before it will grow.',
    TEAK: 'You sow a teak seed in the plantpot.<br>It needs watering before it will grow.',
    CRYSTAL_TREE: 'You sow a crystal acorn in the plantpot.<br>It needs watering before it will grow.',
};
const WATERED = {
    YEW: 'You water the yew seed.', MAPLE: 'You water the maple seed.', MAGIC: 'You water the magic tree seed.',
    SPIRIT_TREE: 'You water the spirit tree seed.', ORANGE: 'You water the orange tree seed.',
    PALM: 'You water the palm tree seed.', CALQUAT: 'You water the calquat tree seed.',
    MAHOGANY: 'You water the plantpot.', TEAK: 'You water the plantpot.', CRYSTAL_TREE: 'You water the crystal acorn.',
};
test('sowing a tree seed sends the captured spam line in either use order', () => {
    for (const [key, line] of Object.entries(SOWN)) for (const reverse of [false, true]) {
        const f = prepare(), crop = Data.CROPS.get(key), pot = Data.itemId('Filled plant pot');
        f.inventory.add(new core.Item(Data.itemId('Gardening trowel')), false)
            .add(new core.Item(crop.seed, 2), false).add(new core.Item(pot), false);
        reverse ? use(f, pot, crop.seed) : use(f, crop.seed, pot);
        assert.deepEqual(f.lines, [{ type: core.ChatType.SPAM, text: line }], key);
        assert.equal(f.inventory.getAmount(crop.seedling), 1);
        assert.equal(f.inventory.getAmount(crop.seed), 1);
        assert.equal(f.inventory.getAmount(pot), 0);
        assert.equal(f.animations.length, 0);
    }
});
test('a seed above the Farming level opens the captured message box and sows nothing', () => {
    const f = prepare(74), crop = Data.CROPS.get('MAGIC'), pot = Data.itemId('Filled plant pot');
    f.inventory.add(new core.Item(Data.itemId('Gardening trowel')), false)
        .add(new core.Item(crop.seed), false).add(new core.Item(pot), false);
    use(f, crop.seed, pot);
    assert.equal(f.lines.length, 0);
    assert.deepEqual(f.boxes.map(String), ['You need level 75 Farming to plant that.']);
    assert.equal(f.inventory.getAmount(crop.seed), 1);
    assert.equal(f.inventory.getAmount(pot), 1);
});
test('watering a seedling sends the captured line in place, without an animation', () => {
    for (const [key, line] of Object.entries(WATERED)) {
        const f = prepare(), crop = Data.CROPS.get(key), can = Data.itemId('Watering can(8)');
        f.inventory.add(new core.Item(can), false).add(new core.Item(crop.seedling), false);
        use(f, can, crop.seedling);
        assert.deepEqual(f.lines, [{ type: core.ChatType.SPAM, text: line }], key);
        assert.equal(f.inventory.forSlot(0).getId(), Data.itemId('Watering can(7)'));
        assert.equal(f.inventory.forSlot(1).getId(), crop.wateredSeedling);
        assert.equal(f.animations.length, 0, key);
    }
});
