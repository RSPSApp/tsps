const assert = require('node:assert/strict');
const { test, before, after } = require('node:test');
const path = require('node:path');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const core = PluginManager.getCoreApi();
require('../plugins/skills/farming/Core.Farming').init({ core });
const Data = require('../plugins/skills/farming/Data.Farming');
const Model = require('../plugins/skills/farming/Model.Farming');
const Patches = require('../plugins/skills/farming/Patches.Farming');
const hooks = new Map(), events = new Map();
Patches.attach(new Proxy({
    onCustomEvent(name, fn) { events.set(name, fn); },
}, { get: (api, key) => api[key] ?? (fn => { if (!hooks.has(key)) hooks.set(key, fn); }) }));
const patch = Data.CACHE.patches.find(p => p.type === 'REDWOOD');
const realNow = Date.now, realGet = core.MapObjects.get, realGetType = core.MapObjects.getType;
let clock = Date.UTC(2026, 9, 24) + 1234;
let branches;
before(async () => {
    await CachePipeline.initialize(path.resolve(__dirname, '..'));
    Data.CROPS.set('REDWOOD', { ...Data.CACHE.timing.REDWOOD, key: 'REDWOOD', check: 22450 });
    branches = [[2, -2, 2], [4, -2, 0], [6, 2, 0], [8, 0, -2]].map(([part, dx, dy]) =>
        new core.GameObject(core.CacheDefinitions.getLocId(`farming_redwood_tree_patch_1_${part}`),
            new core.Location(patch.x + dx, patch.y + dy, 1), 10, 0, null));
    core.MapObjects.get = (id, loc) => branches.find(o => o.getId() === id && o.getLocation().equals(loc)) ?? null;
    core.MapObjects.getType = loc => branches.find(o => o.getLocation().equals(loc)) ?? null;
    Date.now = () => clock;
});
after(() => { Date.now = realNow; core.MapObjects.get = realGet; core.MapObjects.getType = realGetType; });
function farmer() {
    const farm = { offset: 0, patches: { [Data.patchKey(patch)]: {
        ...Model.emptyPatch(clock, { offset: 0 }), crop: 'REDWOOD', status: 'grown', checked: true, lives: 1,
    } } }, bits = new Map(), updates = [];
    const sender = { getVarbit: id => bits.get(id) ?? 0, getVarp: () => 0,
        sendVarbit(id, value) { bits.set(id, value); return this; },
        sendObjectRemoval(o) { updates.push(['remove', o.getId()]); return this; },
        sendObject(o) { updates.push(['add', o.getId()]); return this; } };
    const player = { farm, bits, updates, getAttribute: () => farm, setAttribute() {},
        getLocation: () => new core.Location(1225, 3755, 1), getPrivateArea: () => null,
        getInventory: () => ({ getItems: () => [] }), getBanks: () => [], getPacketSender: () => sender };
    return player;
}
const state = p => p.farm.patches[Data.patchKey(patch)];
function canCut(p, branch) {
    const event = { player: p, object: branches[branch], allow: true };
    events.get('woodcutting:validate-tree')(event);
    return event.allow;
}
function deplete(p, branch) {
    const event = { player: p, object: branches[branch], respawnTicks: 200, handled: false };
    events.get('woodcutting:deplete-tree')(event);
    assert.equal(event.handled, true);
}
test('depleting a private redwood spot leaves the other three spots and other players available', () => {
    const p = farmer(), other = farmer();
    deplete(p, 0);
    assert.equal(canCut(p, 0), false);
    for (const branch of [1, 2, 3]) assert.equal(canCut(p, branch), true);
    assert.equal(canCut(other, 0), true);
    assert.equal(state(p).stump, undefined, 'the whole redwood must not become a stump');
    assert.equal(p.bits.get(patch.varbit), 41, 'native bitmask hides only the first spot');
    assert.ok(p.updates.some(([op, id]) => op === 'add' && id === branches[0].getId()), 'upper-floor geometry refreshes');
});
test('all sixteen branch combinations resolve to the cache cut actions', () => {
    const p = farmer(), s = state(p);
    for (let mask = 0; mask < 16; mask++) {
        s.redwoodBranches = branches.map((_, i) => mask & (1 << i) ? clock + 120000 : 0);
        const value = Model.patchValue(patch, s);
        for (let i = 0; i < 4; i++) {
            const id = core.CacheDefinitions.getObject(branches[i].getId()).transforms[value];
            assert.equal(core.CacheDefinitions.getObject(id).actions.includes('Cut'), !(mask & (1 << i)), `mask=${mask} branch=${i}`);
        }
    }
});
test('independent branch deadlines regrow on the exact game tick, between minute sweeps', () => {
    const p = farmer();
    hooks.get('onPlayerLogin')({ player: p });
    const start = clock;
    deplete(p, 0);
    clock += 600;
    deplete(p, 1);
    clock = start + 199 * 600;
    Patches.tick();
    assert.equal(canCut(p, 0), false);
    clock = start + 200 * 600;
    Patches.tick();
    assert.equal(p.bits.get(patch.varbit), 42, 'first spot visibly regrows before the minute boundary');
    assert.equal(canCut(p, 0), true);
    assert.equal(canCut(p, 1), false);
    clock += 600;
    Patches.tick();
    assert.equal(p.bits.get(patch.varbit), 18);
    assert.equal(canCut(p, 1), true);
    hooks.get('onPlayerLogout')({ player: p });
});
test('saved branch deadlines survive relog and advance while offline', () => {
    const p = farmer();
    deplete(p, 2);
    const copy = JSON.parse(JSON.stringify(p.farm));
    const deadline = clock + 200 * 600;
    Model.advanceFarm(copy, deadline - 1);
    assert.equal(Model.patchValue(patch, copy.patches[Data.patchKey(patch)]), 44);
    Model.advanceFarm(copy, deadline);
    assert.equal(Model.patchValue(patch, copy.patches[Data.patchKey(patch)]), 18);
});
test('legacy whole-tree stumps recover and new patches start without branch deadlines', () => {
    const p = farmer(), s = state(p);
    s.stump = true; s.nextAt = clock + 1000;
    Model.advanceFarm(p.farm, clock);
    assert.equal(Model.patchValue(patch, s), 55);
    Model.advanceFarm(p.farm, clock + 1000);
    assert.equal(Model.patchValue(patch, s), 18);
    assert.equal(Model.emptyPatch(clock, p.farm).redwoodBranches, undefined);
});
test('unchecked trees and invalid branch objects cannot be chopped or gain a depletion deadline', () => {
    const p = farmer(), s = state(p);
    s.checked = false;
    assert.equal(canCut(p, 0), false);
    deplete(p, 0);
    assert.equal(s.redwoodBranches, undefined);
    s.checked = true;
    const impostor = new core.GameObject(branches[0].getId(), new core.Location(patch.x, patch.y, 0), 10, 0, null);
    const request = { player: p, object: impostor, allow: true };
    events.get('woodcutting:validate-tree')(request);
    assert.equal(request.allow, false);
});
test('clearing a depleted redwood cancels its old deadlines', () => {
    const p = farmer();
    hooks.get('onPlayerLogin')({ player: p });
    deplete(p, 3);
    Patches.clearPatch(p, patch);
    assert.equal(state(p).redwoodBranches, undefined);
    assert.equal(state(p).crop, undefined);
    clock += 200 * 600;
    Patches.tick();
    assert.equal(state(p).crop, undefined);
    assert.equal(state(p).redwoodBranches, undefined);
    hooks.get('onPlayerLogout')({ player: p });
});
test('the Woodcutting request uses per-log farmed depletion while wild redwoods retain Forestry', () => {
    const Woodcutting = require('../plugins/skills/Woodcutting.plugin');
    const tasks = [], custom = new Map(), depletions = [];
    Woodcutting.register(new Proxy({
        core,
        getTaskManager: () => ({ submit: task => tasks.push(task) }),
        getObjectManager: () => core.ObjectManager,
        getItemOnGroundManager: () => core.ItemOnGroundManager,
        onCustomEvent(name, fn) { custom.set(name, fn); },
        emitCustomEvent(name, event) {
            if (name === 'woodcutting:deplete-tree') depletions.push(event);
            events.get(name)?.(event);
        },
    }, { get: (api, key) => api[key] ?? (() => {}) }));
    const p = farmer();
    const axe = new core.Item(core.ItemIdentifiers.BRONZE_AXE);
    const inventory = new core.Inventory(p);
    p.getPacketSender().sendItemContainer = function () { return this; };
    p.getPacketSender().sendTypedMessage = function () { return this; };
    p.getPacketSender().sendConfig = function () { return this; };
    inventory.add(axe, false);
    Object.assign(p, {
        getInventory: () => inventory,
        getEquipment: () => ({ getItems: () => [], get: () => null }),
        getSkillManager: () => ({ getCurrentLevel: () => 99, stopSkillable() {}, addExperiences() {} }),
        getCombat: () => ({ reset() {} }), getForceMovement: () => null,
        getRunEnergyUnits: () => 10000,
        getMovementQueue: () => ({ size: () => 0 }), getHitpoints: () => 99, isRegistered: () => true,
        getLocation: () => branches[0].getLocation().clone(),
        setPositionToFace() {}, performAnimation() {}, sendMessage() {},
    });
    const request = { player: p, object: branches[0], logId: core.ItemIdentifiers.REDWOOD_LOGS, handled: false };
    custom.get('woodcutting:chop')(request);
    assert.equal(request.handled, true);
    const task = tasks.find(t => t.activeSessions);
    const profile = task.activeSessions.get(p).tree;
    assert.equal(profile.despawnTicks, 0);
    assert.equal(profile.depleteChance, 11);
    assert.equal(profile.respawnTicks, 200);
    const wild = Woodcutting.TREES.find(t => t.name === 'redwood');
    assert.equal(wild.despawnTicks, 440);
    assert.equal(wild.respawnTicks, 199);
    const random = Math.random;
    try {
        const rolls = [0, 0.99, 0.99, 0.99, 0.99, 0.99, 0.99, 0];
        Math.random = () => rolls.shift() ?? 0.99; // log, no nests, then depletion
        for (let i = 0; i < 4; i++) task.execute();
    } finally { Math.random = random; }
    assert.equal(inventory.getAmount(core.ItemIdentifiers.REDWOOD_LOGS), 1);
    assert.equal(depletions.length, 1, 'a single successful log can deplete a farmed spot');
    assert.equal(depletions[0].respawnTicks, 200);
    assert.equal(canCut(p, 0), false);
    assert.equal(canCut(p, 1), true);
    assert.equal(Woodcutting.isWoodcuttingActive(p), false);
});
