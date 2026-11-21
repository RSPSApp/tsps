// Scarecrow making against rsprox captures (local 1000341 t12816-12849, 1846; rev 227 Leagues)
// and the Wiki (Scarecrow, Hay sack): lines, channels, sounds, slots and XP.
const assert = require('node:assert/strict');
const { before, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
let core, Data, Patches, hooks;
before(async () => {
    await CachePipeline.initialize(require('node:path').resolve(__dirname, '..'));
    core = PluginManager.getCoreApi();
    core.ObjectDefinition.init();
    require('../plugins/skills/farming/Core.Farming').init({ core });
    Data = require('../plugins/skills/farming/Data.Farming');
    Patches = require('../plugins/skills/farming/Patches.Farming');
    Data.initializeFarmingData();
    hooks = {};
    Patches.attach(new Proxy({}, { get: (_, name) => (...args) => {
        if (['onItemOnObject', 'onItemOnItem'].includes(name)) hooks[name] = args[0];
    } }));
});
const id = name => Data.itemId(name);
function fixture(t, items) {
    const player = new Player(null), said = [], sounds = [], anims = [];
    const sender = new Proxy({}, { get: (_, name) => name === 'sendTypedMessage' ? (_type, text) => { said.push(['spam', text]); return sender; }
        : name === 'sendSound' ? (sound, _volume, delay) => { sounds.push([sound, delay]); return sender; } : () => sender });
    player.getPacketSender = () => sender; player.sendMessage = text => said.push(['game', text]);
    player.performAnimation = animation => anims.push(animation.getId());
    player.getSkillManager().setCurrentLevel(core.Skill.FARMING, 99, false);
    t.mock.method(core.MapObjects, 'get', () => null);
    items.forEach((item, slot) => { if (item) player.getInventory().setItem(slot, new core.Item(typeof item === 'number' ? item : id(item))); });
    const onLoc = (locId, itemSlot) => {
        const event = { player, itemId: player.getInventory().forSlot(itemSlot).getId(), itemSlot, object: { getId: () => locId }, location: { x: 3019, y: 3297, z: 0 } };
        hooks.onItemOnObject(event);
        return event;
    };
    const combine = (used, usedWith, usedItemSlot, usedWithItemSlot) => {
        const inv = player.getInventory();
        const event = { player, usedItemId: used, usedWithItemId: usedWith,
            usedItemSlot: usedItemSlot ?? inv.getSlotForItemId(used), usedWithItemSlot: usedWithItemSlot ?? inv.getSlotForItemId(usedWith) };
        hooks.onItemOnItem(event);
        return event;
    };
    return { player, said, sounds, anims, onLoc, combine, slot: s => player.getInventory().forSlot(s)?.getId() ?? -1 };
}
const HAY_BALE = 8713;

test('an empty sack on a hay bale fills in its own slot with the pickup animation and delayed sound', t => {
    const f = fixture(t, ['Bronze spear', 'Watermelon', 'Empty sack']);
    assert.equal(f.onLoc(HAY_BALE, 2).handled, true);
    assert.equal(f.slot(2), core.ItemIdentifiers.HAY_SACK);
    assert.deepEqual([f.anims, f.sounds, f.said], [[832], [[2584, 10]], [['spam', 'You fill the sack with straw.']]]);
});

test('every hay bale and haystack name fills the sack, but a Shayzien loc does not', t => {
    for (const loc of [298, 300, 8714, 10362]) {
        const f = fixture(t, ['Empty sack']);
        assert.equal(f.onLoc(loc, 0).handled, true, `loc ${loc}`);
        assert.equal(f.slot(0), core.ItemIdentifiers.HAY_SACK, `loc ${loc}`);
    }
    const f = fixture(t, ['Empty sack']);
    assert.notEqual(f.onLoc(41850, 0).handled, true, 'Shayzien statue');
    assert.equal(f.slot(0), id('Empty sack'));
});

test('a bronze spear goes through the hay sack with its sound, then a watermelon finishes it for 25 XP', t => {
    const f = fixture(t, ['Bronze spear', 'Watermelon', null, null, null, null, null, null, core.ItemIdentifiers.HAY_SACK]);
    const xp = () => f.player.getSkillManager().getExperience(core.Skill.FARMING);
    const start = xp();
    assert.equal(f.combine(id('Bronze spear'), core.ItemIdentifiers.HAY_SACK).handled, true);
    assert.deepEqual([f.slot(0), f.slot(8)], [core.ItemIdentifiers.HAY_SACK_2, -1]);
    assert.deepEqual(f.sounds, [[2584, 0]]);
    assert.equal(xp(), start, 'no XP for the spear step');
    assert.equal(f.combine(id('Watermelon'), core.ItemIdentifiers.HAY_SACK_2).handled, true);
    assert.deepEqual([f.slot(0), f.slot(1)], [core.ItemIdentifiers.SCARECROW, -1]);
    assert.deepEqual(f.said, [
        ['spam', 'You stick the bronze spear through the hay sack.'],
        ['spam', 'You stick a watermelon on top of the hay sack.'],
        ['game', 'This would be ideal for scaring birds!'],
    ]);
    assert.deepEqual(f.sounds, [[2584, 0]], 'the watermelon step has no sound');
    assert.ok(xp() - start >= 25, 'Farming XP for the scarecrow');
});

test('any other spear, poisoned bronze too, is refused and kept', t => {
    for (const spear of ['Iron spear', 'Bronze spear(p)']) {
        const f = fixture(t, [spear, core.ItemIdentifiers.HAY_SACK]);
        assert.equal(f.combine(id(spear), core.ItemIdentifiers.HAY_SACK).handled, true);
        assert.deepEqual([f.slot(0), f.slot(1)], [id(spear), core.ItemIdentifiers.HAY_SACK]);
        assert.deepEqual(f.said, [['game', 'Waste this spear on a scarecrow? I think not - maybe I should find a bronze spear instead.']]);
    }
});

test('below level 23 neither step happens', t => {
    const f = fixture(t, ['Bronze spear', core.ItemIdentifiers.HAY_SACK]);
    f.player.getSkillManager().setCurrentLevel(core.Skill.FARMING, 22, false);
    assert.equal(f.combine(id('Bronze spear'), core.ItemIdentifiers.HAY_SACK).handled, true);
    assert.deepEqual([f.slot(0), f.slot(1)], [id('Bronze spear'), core.ItemIdentifiers.HAY_SACK]);
    assert.deepEqual(f.sounds, []);
});

test('the result takes the lower of the two used slots, not the first free one', t => {
    const f = fixture(t, ['Coins', null, null, null, null, 'Bronze spear', null, 'Watermelon', core.ItemIdentifiers.HAY_SACK]);
    f.combine(id('Bronze spear'), core.ItemIdentifiers.HAY_SACK);
    assert.deepEqual([f.slot(1), f.slot(5), f.slot(8)], [-1, core.ItemIdentifiers.HAY_SACK_2, -1]);
    f.combine(id('Watermelon'), core.ItemIdentifiers.HAY_SACK_2);
    assert.deepEqual([f.slot(5), f.slot(7)], [core.ItemIdentifiers.SCARECROW, -1]);
});

test('Hunter spear tips are not a spear', t => {
    const f = fixture(t, ['Hunter spear tips', core.ItemIdentifiers.HAY_SACK]);
    assert.notEqual(f.combine(id('Hunter spear tips'), core.ItemIdentifiers.HAY_SACK).handled, true);
    assert.deepEqual(f.said, []);
});

test('the clicked hay sack is the one speared when two are carried', t => {
    const S = core.ItemIdentifiers.HAY_SACK;
    const f = fixture(t, ['Coins', S, null, null, null, null, 'Bronze spear', S]);
    f.combine(id('Bronze spear'), S, 6, 7);
    assert.deepEqual([f.slot(1), f.slot(6), f.slot(7)], [S, core.ItemIdentifiers.HAY_SACK_2, -1]);
});
