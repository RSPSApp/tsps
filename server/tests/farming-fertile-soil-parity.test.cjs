const assert = require('node:assert/strict');
const { test, before } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
let core, Data, Model, Patches, Spells, spell;
const COST = [['Astral rune', 3], ['Nature rune', 2], ['Earth rune', 15]];
before(async () => {
    await CachePipeline.initialize(require('node:path').resolve(__dirname, '..'));
    core = PluginManager.getCoreApi();
    require('../plugins/skills/farming/Core.Farming').init({ core });
    Data = require('../plugins/skills/farming/Data.Farming');
    Model = require('../plugins/skills/farming/Model.Farming');
    Patches = require('../plugins/skills/farming/Patches.Farming');
    Spells = require('../plugins/skills/farming/Spells.Farming');
    Data.initializeFarmingData();
    spell = core.CacheDefinitions.getSpellByName('Fertile Soil');
    assert.ok(spell);
});
function prepare(t, { upgraded = false, ash = 0, status = 'growing', runes = true, level = 99 } = {}) {
    const player = new Player(null), xp = [], messages = [], animations = [], bits = new Map();
    const sender = new Proxy({}, { get: (_, name) => name === 'getVarbit' ? id => bits.get(id) ?? 0
        : name === 'sendVarbit' ? (id, value) => { bits.set(id, value); return sender; } : () => sender });
    player.getPacketSender = () => sender; player.sendMessage = text => messages.push(text);
    player.performAnimation = value => animations.push(value);
    player.setSpellbook(core.MagicSpellbook.LUNAR);
    const skills = player.getSkillManager();
    skills.setMaxLevels(core.Skill.MAGIC, 99, false).setCurrentLevels(core.Skill.MAGIC, level, false);
    t.mock.method(skills, 'addExperiences', (skill, amount) => { xp.push([skill, amount]); return skills; });
    t.mock.method(core.MapObjects, 'get', () => null);
    const patch = Data.CACHE.patches.find(p => p.type === 'HERB' && p.x === 3058);
    const farm = { offset: 0, patches: {}, tools: {}, ultraFertile: upgraded };
    const state = { ...Model.emptyPatch(Date.now(), farm), crop: 'RANARR', status,
        stage: status === 'grown' ? 4 : 1, lives: status === 'grown' ? 3 : 0 };
    farm.patches[Data.patchKey(patch)] = state; player.setAttribute(Patches.FARM_ATTRIBUTE, farm);
    if (runes) for (const [name, count] of COST) player.getInventory().add(new core.Item(Data.itemId(name), count), false);
    if (ash) player.getInventory().add(new core.Item(Data.itemId('Volcanic ash'), ash), false);
    const cast = () => Spells.farmingSpell({ player, spellWidget: spell.widgetId,
        spellItemId: spell.itemId, spellId: spell.widgetId }, patch);
    return { player, patch, state, cast, xp, messages, animations,
        runes: () => COST.map(([name]) => player.getInventory().getAmount(Data.itemId(name))),
        ash: () => player.getInventory().getAmount(Data.itemId('Volcanic ash')),
        farmingXp: () => xp.filter(([skill]) => skill === core.Skill.FARMING).map(([, amount]) => amount),
        magicXp: () => xp.filter(([skill]) => skill === core.Skill.MAGIC).map(([, amount]) => amount) };
}
test('ordinary Fertile Soil grants 18 Farming XP and 87 Magic XP while applying supercompost', t => {
    const f = prepare(t);
    f.cast();
    assert.equal(f.state.compost, 2);
    assert.deepEqual(f.farmingXp(), [18]);
    assert.deepEqual(f.magicXp(), [87]);
    assert.deepEqual(f.runes(), [0, 0, 0]);
});
test('upgraded Fertile Soil keeps the same XP and spends two ash for ultracompost', t => {
    const f = prepare(t, { upgraded: true, ash: 3 });
    f.cast();
    assert.equal(f.state.compost, 3);
    assert.equal(f.ash(), 1);
    assert.deepEqual(f.farmingXp(), [18]);
    assert.deepEqual(f.magicXp(), [87]);
    assert.deepEqual(f.runes(), [0, 0, 0]);
});
test('an upgraded spell without enough ash falls back to supercompost with its normal spell XP', t => {
    const f = prepare(t, { upgraded: true, ash: 1 });
    f.cast();
    assert.equal(f.state.compost, 2);
    assert.equal(f.ash(), 1);
    assert.deepEqual(f.farmingXp(), [18]);
});
test('fully grown crops reject the spell before consuming runes, ash, XP or lives', t => {
    const f = prepare(t, { upgraded: true, ash: 2, status: 'grown' }), original = { ...f.state };
    f.cast();
    assert.deepEqual(f.state, original);
    assert.deepEqual(f.runes(), [3, 2, 15]);
    assert.equal(f.ash(), 2);
    assert.deepEqual(f.xp, []);
    assert.deepEqual(f.animations, []);
});
test('the spell plays its own cast animation, not the bucket pour', t => {
    const f = prepare(t);
    f.cast();
    assert.deepEqual(f.animations.map(animation => animation.id), [4413]);
});
test('bucket and bottomless applications retain their tier-specific Farming XP', t => {
    for (const [tier, xp, name] of [[1, 18, 'Compost'], [2, 26, 'Supercompost'], [3, 36, 'Ultracompost']]) {
        const f = prepare(t);
        f.player.getInventory().add(new core.Item(Data.itemId(name)), false);
        assert.equal(Patches.fertilize(f.player, f.patch, tier), true);
        assert.deepEqual(f.farmingXp(), [xp]);
        const bottomless = prepare(t);
        assert.equal(Patches.fertilize(bottomless.player, bottomless.patch, tier, false), true);
        assert.deepEqual(bottomless.farmingXp(), [xp]);
    }
});
test('low Magic or missing runes cannot apply compost or grant either XP award', t => {
    for (const options of [{ level: 82 }, { runes: false }]) {
        const f = prepare(t, options), runes = f.runes();
        f.cast();
        assert.equal(f.state.compost, 0);
        assert.deepEqual(f.xp, []);
        assert.deepEqual(f.runes(), runes);
    }
});
