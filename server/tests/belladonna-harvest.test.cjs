const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const FarmingCore = require('../plugins/skills/farming/Core.Farming');
let core, Data, Model, Patches, patch, hooks;

before(async () => {
    await CachePipeline.initialize(require('node:path').resolve(__dirname, '..'));
    core = PluginManager.getCoreApi();
    FarmingCore.init({ core });
    Data = require('../plugins/skills/farming/Data.Farming');
    Model = require('../plugins/skills/farming/Model.Farming');
    Patches = require('../plugins/skills/farming/Patches.Farming');
    Data.initializeFarmingData();
    patch = Data.CACHE.patches.find(p => p.type === 'BELLADONNA');
    hooks = {};
    Patches.attach(new Proxy({}, { get: (_, name) => (...args) => (hooks[name] ??= []).push(args[0]) }));
});

function prepare(t) {
    // Equipment, items, skill XP and damage are real; only scenery/action decoding
    // and optional seed/pet rewards are doubled.
    t.mock.property(FarmingCore, 'ObjectDefinition', { forPlayer: () => ({ getInteractions: () => ['Pick'] }) });
    t.mock.property(FarmingCore, 'MapObjects', { get: () => null });
    const Services = require('../plugins/skills/farming/Services.Farming');
    t.mock.method(Services, 'cropRewards', () => {});
    t.mock.method(Math, 'random', () => 0);
}

function farmer(worn = null, { slot, carried = null, full = false } = {}) {
    const p = new Player(null);
    p.setUsername('belladonna-regression');
    const varbits = new Map();
    const shown = [];
    const sender = new Proxy({}, { get: (_, key) => {
        if (key === 'getVarbit') return id => varbits.get(id) ?? 0;
        if (key === 'sendVarbit') return (id, value) => { varbits.set(id, value); return sender; };
        return () => sender;
    } });
    p.getPacketSender = () => sender;
    p.isRegistered = () => true;
    p.sendMessage = () => {};
    p.performAnimation = () => {};
    p.busy = () => false;
    p.getClickDelay = () => ({ elapsedTime: () => true, reset() {} });
    p.getLocation().setX(patch.x);
    p.getLocation().setY(patch.y);
    p.getLocation().setZ(patch.z);
    p.getSkillManager().setCurrentLevel(core.Skill.FARMING, 99);
    p.addTickHit = hit => shown.push({ amount: hit.getDamage(), mask: hit.getHitmask() });
    p.getInventory().add(new core.Item(Data.itemId('Spade')), false);
    if (carried) p.getInventory().add(new core.Item(Data.itemId(carried)), false);
    if (worn) p.getEquipment().setItem(slot ?? core.Equipment.HANDS_SLOT, new core.Item(Data.itemId(worn)));
    if (full) p.getInventory().add(new core.Item(Data.itemId('Rune scimitar'), p.getInventory().getFreeSlots()), false);
    const state = { ...Model.emptyPatch(Date.now(), { offset: 0 }), crop: 'BELLADONNA', status: 'grown', stage: 4, lives: 1, checked: true };
    p.setAttribute(Patches.FARM_ATTRIBUTE, { offset: 0, patches: { [Data.patchKey(patch)]: state }, tools: {} });
    varbits.set(patch.varbit, Model.patchValue(patch, state));
    // The pick swings at once and the produce lands on the third farming tick after it.
    const pick = () => {
        hooks.onObjectInteraction[0]({ player: p, object: { getId: () => patch.id },
            location: { x: patch.x, y: patch.y, z: patch.z }, clickType: 1 });
        for (let i = 0; i < 3; i++) Patches.tick();
    };
    return { p, state, pick, shown, produce: () => p.getInventory().getAmount(Data.itemId('Nightshade')) };
}

test('safe bracelets, hooks, bracers and gloves harvest without damage', t => {
    prepare(t);
    for (const name of ['Regen bracelet', "Pirate's hook", 'Crab claw', 'Ancient bracers', 'Leather gloves']) {
        const f = farmer(name);
        const hp = f.p.getHitpoints();
        f.pick();
        f.p.getCombat().getHitQueue().process(1);
        assert.equal(f.produce(), 6, name);
        assert.ok(f.p.getSkillManager().getExperience(core.Skill.FARMING) > 0, name);
        assert.equal(f.p.getHitpoints(), hp, name);
        assert.equal(f.p.getAttribute(Patches.FARM_ATTRIBUTE).patches[Data.patchKey(patch)].crop, undefined);
    }
});

test('bare hands and decorative gloves take one green hit without produce, XP or crop loss', t => {
    prepare(t);
    for (const name of ['Mime gloves', 'Warm gloves', 'Ancient ceremonial gloves', null]) {
        const f = farmer(name);
        const label = name ?? 'bare hands';
        const hp = f.p.getHitpoints();
        const xp = f.p.getSkillManager().getExperience(core.Skill.FARMING);
        f.pick();
        assert.equal(f.produce(), 0, label);
        assert.equal(f.p.getSkillManager().getExperience(core.Skill.FARMING), xp, label);
        assert.equal(f.state.lives, 1, label);
        assert.equal(f.p.getAttribute(Patches.FARM_ATTRIBUTE).patches[Data.patchKey(patch)], f.state, label);
        assert.equal(f.p.getCombat().getHitQueue().getQueuedDamage(), 2, label);
        f.p.getCombat().getHitQueue().process(1);
        assert.equal(f.p.getHitpoints(), hp - 2, label);
        assert.deepEqual(f.shown, [{ amount: 2, mask: core.HitMask.GREEN }], label);
        assert.equal(f.p.isPoisoned(), false, 'a green hitsplat does not apply a persistent poison status');
    }
});

test('only the actual hands slot protects, not carried gloves or gloves in another slot', t => {
    prepare(t);
    for (const options of [{ carried: 'Leather gloves' }, { slot: core.Equipment.WEAPON_SLOT }]) {
        const f = farmer(options.carried ? null : 'Leather gloves', options);
        f.pick();
        assert.equal(f.produce(), 0);
        assert.equal(f.p.getCombat().getHitQueue().getQueuedDamage(), 2);
        assert.equal(f.state.lives, 1);
    }
});

test('safe harvesting with a full inventory leaves the crop and XP unchanged', t => {
    prepare(t);
    const f = farmer('Regen bracelet', { full: true });
    const xp = f.p.getSkillManager().getExperience(core.Skill.FARMING);
    f.pick();
    assert.equal(f.produce(), 0);
    assert.equal(f.state.lives, 1);
    assert.equal(f.p.getSkillManager().getExperience(core.Skill.FARMING), xp);
    assert.equal(f.p.getCombat().getHitQueue().getQueuedDamage(), 0);
});

test('protective cache variants exclude notes and placeholders and cover graceful recolours', () => {
    const graceful = [];
    for (let id = 0; id < core.CacheDefinitions.getCounts().items; id++) {
        const item = core.CacheDefinitions.getItem(id);
        if (item.name === 'Graceful gloves' && item.wearPos === core.Equipment.HANDS_SLOT &&
            item.noteTemplate < 0 && item.placeholderTemplate < 0) graceful.push(id);
    }
    assert.ok(graceful.length > 1, 'the cache includes multiple recolours');
    for (const id of graceful) assert.ok(Data.BELLADONNA_HANDWEAR.has(id), `Graceful variant ${id}`);
    for (const id of Data.BELLADONNA_HANDWEAR) {
        const item = core.CacheDefinitions.getItem(id);
        assert.equal(item.wearPos, core.Equipment.HANDS_SLOT);
        assert.ok(item.noteTemplate < 0);
        assert.ok(item.placeholderTemplate < 0);
    }
});
