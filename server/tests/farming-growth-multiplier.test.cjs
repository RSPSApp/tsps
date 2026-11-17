// Run after `yarn build`: node --test tests/farming-growth-multiplier.test.cjs
// world.json pluginConfig "Farming:growthMultiplier": 1 (the default) is OSRS's speed and never
// rewrites a farm; above 1 crops grow that many times faster, online and offline alike.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
require('../dist/game/World');
const { PluginManager } = require('../dist/plugins/PluginManager');
require('../plugins/skills/farming/Core.Farming').init({ core: PluginManager.getCoreApi() });
const Data = require('../plugins/skills/farming/Data.Farming');
const Model = require('../plugins/skills/farming/Model.Farming');
const Patches = require('../plugins/skills/farming/Patches.Farming');

Data.CROPS.set('RANARR', { ...Data.CACHE.timing.RANARR, key: 'RANARR' });
const now = Date.UTC(2026, 8, 30);
const herb = Data.CACHE.patches.find((p) => p.type === 'HERB' && p.x === 3058);
const key = Data.patchKey(herb);

function planted() {
    const farm = { offset: 7 * Model.MINUTE, patches: {}, tools: {}, autoWeed: false };
    farm.patches[key] = { ...Model.emptyPatch(now, farm), crop: 'RANARR', protected: true,
        nextAt: Model.nextGrowth(now, Data.CROPS.get('RANARR').minutes, farm.offset), compost: 3 };
    return farm;
}

function withRate(t, rate) {
    Model.setGrowthMultiplier(rate);
    t.after(() => Model.setGrowthMultiplier(1));
}

test('the default rate keeps the Wiki cycles and leaves a saved farm as it is', () => {
    assert.equal(Model.growthDuration(20), 20 * Model.MINUTE);
    const saved = { patches: { [key]: { crop: 'RANARR', status: 'growing', nextAt: now + 20 * Model.MINUTE } } };
    const before = JSON.parse(JSON.stringify(saved));
    Model.applyGrowthRate(saved, now);
    assert.deepEqual(saved, before);
    const farm = planted();
    const first = farm.patches[key].nextAt;
    Model.advanceFarm(farm, first, () => 1);
    assert.equal(farm.patches[key].stage, 1);
    assert.equal(farm.patches[key].nextAt - first, 20 * Model.MINUTE, 'a herb stage is 20 minutes');
});

test('at 10x a crop grows ten times as fast, and offline catch-up matches online growth', (t) => {
    withRate(t, 10);
    assert.equal(Model.growthDuration(20), 2 * Model.MINUTE);
    const online = planted();
    const crop = Data.CROPS.get('RANARR');
    const complete = online.patches[key].nextAt + (crop.stages - 1) * Model.growthDuration(crop.minutes);
    assert.ok(complete - now <= 8 * Model.MINUTE, 'four 20-minute stages in 8 minutes');
    const offline = JSON.parse(JSON.stringify(online));
    for (let at = now; at < complete; at += 30_000) Model.advanceFarm(online, at, () => 1);
    assert.notEqual(online.patches[key].status, 'grown', 'not ripe before the last stage');
    Model.advanceFarm(online, complete, () => 1);
    Model.advanceFarm(offline, complete, () => 1);
    assert.equal(online.patches[key].status, 'grown');
    assert.deepEqual(online, offline);
});

test('weeds and Tithe Farm keep their speed at 10x', (t) => {
    withRate(t, 10);
    const weeds = Model.emptyPatch(now, { offset: 0, patches: {} });
    assert.equal(weeds.nextAt - now, 5 * Model.MINUTE);
    const tithe = { stage: 0, nextAt: now, watered: true, fertilized: false };
    Model.advanceTithe(tithe, now);
    assert.equal(tithe.nextAt - now, Model.MINUTE);
});

test('a farm saved at another rate keeps its growth and runs the rest of the stage at the new one, once', (t) => {
    withRate(t, 10);
    const farm = { patches: {
        [key]: { crop: 'RANARR', status: 'growing', nextAt: now + 20 * Model.MINUTE },
        dead: { crop: 'RANARR', status: 'dead', nextAt: now + 20 * Model.MINUTE },
        empty: { weeds: 1, nextAt: now + 5 * Model.MINUTE },
    } };
    Model.applyGrowthRate(farm, now);
    assert.equal(farm.patches[key].nextAt, now + 2 * Model.MINUTE);
    assert.equal(farm.patches.dead.nextAt, now + 20 * Model.MINUTE, 'a dead crop is not growing');
    assert.equal(farm.patches.empty.nextAt, now + 5 * Model.MINUTE, 'weeds are not rescaled');
    assert.equal(farm.growthMultiplier, 10);
    Model.applyGrowthRate(farm, now);
    assert.equal(farm.patches[key].nextAt, now + 2 * Model.MINUTE, 'rescaled only once');
    Model.setGrowthMultiplier(1);
    Model.applyGrowthRate(farm, now);
    assert.equal(farm.patches[key].nextAt, now + 20 * Model.MINUTE);
    assert.equal('growthMultiplier' in farm, false, 'back at 1 the farm saves as before');
});

test('farmFor brings a player\'s farm onto the configured rate, read from world.json', (t) => {
    const config = t.mock.method(PluginManager, 'getPluginConfig', (name, fallback) => (name === 'Farming:growthMultiplier' ? 4 : fallback));
    t.mock.method(Date, 'now', () => now);
    t.after(() => Model.setGrowthMultiplier(1));
    Patches.readGrowthMultiplier();
    assert.equal(config.mock.calls[0].arguments[0], 'Farming:growthMultiplier');
    assert.equal(Model.growthDuration(20), 5 * Model.MINUTE);
    const attributes = new Map([[Patches.FARM_ATTRIBUTE, { offset: 0, tools: {}, patches: {
        [key]: { crop: 'RANARR', status: 'growing', nextAt: now + 20 * Model.MINUTE } } }]]);
    const player = { getAttribute: (name) => attributes.get(name), setAttribute: (name, value) => attributes.set(name, value) };
    assert.equal(Patches.farmFor(player).patches[key].nextAt, now + 5 * Model.MINUTE);
});

test('a crop already overdue when the rate changes grows as far as it would have at the old rate', (t) => {
    // Saved at 1x with its stage 47 minutes overdue: by now it has grown three 20-minute stages.
    const overdue = () => {
        const farm = planted();
        farm.patches[key].nextAt = Model.nextGrowth(now - 50 * Model.MINUTE, Data.CROPS.get('RANARR').minutes, farm.offset);
        return farm;
    };
    const atOldRate = overdue();
    Model.advanceFarm(atOldRate, now, () => 1);
    assert.equal(atOldRate.patches[key].stage, 3);
    withRate(t, 10);
    const farm = overdue();
    Model.applyGrowthRate(farm, now);
    Model.advanceFarm(farm, now, () => 1);
    assert.equal(farm.patches[key].status, 'growing', 'the overdue time is not replayed at ten times the speed');
    assert.equal(farm.patches[key].stage, atOldRate.patches[key].stage);
    assert.ok(farm.patches[key].nextAt > now && farm.patches[key].nextAt - now <= Model.growthDuration(20),
        'the next stage runs at the new rate');
});

test('a growth multiplier that is not a positive number counts as 1', (t) => {
    t.after(() => Model.setGrowthMultiplier(1));
    for (const invalid of [0, -2, NaN, Infinity]) {
        Model.setGrowthMultiplier(invalid);
        assert.equal(Model.growthDuration(5), 5 * Model.MINUTE, String(invalid));
    }
});
