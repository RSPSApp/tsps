// Isolated state-machine and hook checks; no running server or sockets.
// Run after `yarn build`: node --test tests/farming-model.test.cjs
// The plugin hands the farming files api.core; outside the server the test does it.
require("../dist/game/World");
const { PluginManager } = require("../dist/plugins/PluginManager");
require("../plugins/skills/farming/Core.Farming").init({ core: PluginManager.getCoreApi() });
const Data = require("../plugins/skills/farming/Data.Farming");
const Model = require("../plugins/skills/farming/Model.Farming");
const assert = require("node:assert/strict");

const now = Date.UTC(2026, 8, 30);
for (const key of ["RANARR", "APPLE", "OAK", "MAPLE", "MAGIC", "YEW", "REDWOOD", "POTATO", "CACTUS", "POTATO_CACTUS", "WHITE_LILY", "ATTAS", "GRAPE", "CELASTRUS", "SPIRIT_TREE"]) {
    Data.CROPS.set(key, { ...Data.CACHE.timing[key], key, seed: 1, produce: 2, level: 1, plant: 0, harvest: 0,
        check: ["APPLE", "OAK"].includes(key) ? 1 : 0, seedCount: 1, payment: [] });
}
const herb = Data.CACHE.patches.find(p => p.type === "HERB" && p.x === 3058);
const tree = Data.CACHE.patches.find(p => p.type === "TREE");
function planted(key = "RANARR", patch = herb) {
    const farm = { offset: 7 * Model.MINUTE, patches: {}, tools: {}, autoWeed: false };
    farm.patches[Data.patchKey(patch)] = { ...Model.emptyPatch(now, farm), crop: key, nextAt: Model.nextGrowth(now, Data.CROPS.get(key).minutes, farm.offset), compost: 3 };
    return farm;
}
const oneShot = planted();
const stepped = planted();
const persisted = JSON.parse(JSON.stringify(oneShot));
const matureAt = now + 100 * Model.MINUTE;
Model.advanceFarm(oneShot, matureAt, () => 1);
Model.advanceFarm(persisted, matureAt, () => 1);
for (let at = now; at <= matureAt; at += Model.MINUTE) Model.advanceFarm(stepped, at, () => 1);
assert.deepEqual(oneShot, stepped, "offline and online growth must match");
assert.deepEqual(oneShot, persisted, "save/load preserves growth");
const ripe = oneShot.patches[Data.patchKey(herb)];
assert.equal(ripe.status, "grown");
assert.equal(ripe.lives, 6);
assert.ok(Number.isInteger(Model.patchValue(herb, ripe)));
Model.advanceFarm(oneShot, now + 365 * 1440 * Model.MINUTE, () => 0);
assert.equal(ripe.status, "grown", "mature crops cannot become diseased");

const diseased = planted();
const sick = diseased.patches[Data.patchKey(herb)];
Model.advanceFarm(diseased, sick.nextAt, () => 0);
assert.equal(sick.status, "diseased");
const deathAt = sick.nextAt;
Model.advanceFarm(diseased, deathAt - 1, () => 0);
assert.equal(sick.status, "diseased");
Model.advanceFarm(diseased, deathAt, () => 0);
assert.equal(sick.status, "dead");
assert.equal(Model.patchValue(herb, sick), Data.CACHE.states.HERB.ANYHERB.DEAD[sick.stage], "dead herbs use the shared dead-herb variants");
const protectedFarm = planted();
protectedFarm.patches[Data.patchKey(herb)].protected = true;
Model.advanceFarm(protectedFarm, matureAt, () => 0);
assert.equal(protectedFarm.patches[Data.patchKey(herb)].status, "grown");

const oakFarm = planted("OAK", tree);
Model.advanceFarm(oakFarm, now + 200 * Model.MINUTE, () => 1);
const oak = oakFarm.patches[Data.patchKey(tree)];
oak.checked = true;
const fullTree = Model.patchValue(tree, oak);
oak.stump = true;
oak.nextAt = matureAt;
assert.notEqual(Model.patchValue(tree, oak), fullTree);
Model.advanceFarm(oakFarm, matureAt, () => 1);
assert.equal(oak.stump, false);
assert.equal(Model.patchValue(tree, oak), fullTree);
const spirit = Data.CACHE.patches.find(p => p.type === "SPIRIT_TREE");
const spiritState = { ...oak, crop: "SPIRIT_TREE", checked: false };
assert.equal(Model.patchValue(spirit, spiritState), 44, "grown spirit trees must offer Check-health");
spiritState.checked = true;
assert.equal(Model.patchValue(spirit, spiritState), 20, "checked spirit trees must offer Travel");
const vine = Data.CACHE.patches.find(p => p.type === "GRAPES");
const grapes = { ...oak, crop: "GRAPE", checked: true, lives: 5 };
assert.equal(Model.patchValue(vine, grapes), 10, "a checked vine starts with grapes, not a dead vine");
grapes.lives = 1;
assert.equal(Model.patchValue(vine, grapes), 14);
grapes.status = "dead";
assert.equal(Model.patchValue(vine, grapes), 15);
const celastrus = Data.CACHE.patches.find(p => p.type === "CELASTRUS");
assert.equal(Model.patchValue(celastrus, { ...oak, crop: "CELASTRUS", checked: true, lives: 0 }), 17, "empty celastrus trees can be chopped before clearing");

assert.equal(Model.diseaseChance(Data.CROPS.get("RANARR"), 0, false, false), 27 / 128);
assert.equal(Model.diseaseChance(Data.CROPS.get("RANARR"), 3, false, false), 3 / 128);
assert.equal(Model.diseaseChance(Data.CROPS.get("RANARR"), 3, false, true), 1 / 128);
assert.equal(Model.diseaseChance(Data.CROPS.get("APPLE"), 0, false, false), 18 / 128, "published fruit-tree rate");
assert.equal(Model.diseaseChance(Data.CROPS.get("MAPLE"), 0, false, false), 13 / 128, "published maple rate");
assert.equal(Model.diseaseChance(Data.CROPS.get("MAGIC"), 0, false, false), 9 / 128, "published magic-tree rate");
assert.equal(Model.diseaseChance(Data.CROPS.get("POTATO"), 0, false, false), 16 / 128, "unpublished crops use the explicit estimate");
assert.equal(Model.saveLifeChance(Data.CROPS.get("RANARR"), 99), 81 / 256);
assert.equal(Model.saveLifeChance(Data.CROPS.get("RANARR"), 99, true, true), 93 / 256);
assert.equal(Model.nextGrowth(now, 20, 7 * Model.MINUTE) - now, 13 * Model.MINUTE);
assert.equal(Data.diseasedMinutes(Data.CROPS.get("RANARR")), 40, "disease pauses an herb for the next slower cycle");
assert.equal(Data.diseasedMinutes(Data.CROPS.get("REDWOOD")), 640, "the slowest cycle has no slower tier");
assert.equal(Data.stageMinutes(Data.CROPS.get("YEW"), 0), 5, "a yew's first stage is five minutes");
assert.equal(Data.stageMinutes(Data.CROPS.get("YEW"), 1), 40, "later yew stages use the tree cycle");

// A protected crop follows the wiki growth-time table exactly: each stage lasts its cycle,
// except a yew's five-minute first stage.
// The wiki schedule is aligned to the 640-minute tier, so every crop's cycle starts on a
// boundary of that base.
const GROWTH_EPOCH = Date.UTC(2025, 5, 9);
function scheduled(key) {
    const crop = Data.CROPS.get(key);
    const base = GROWTH_EPOCH + Math.floor((now - GROWTH_EPOCH) / (640 * Model.MINUTE)) * (640 * Model.MINUTE);
    const patch = Data.CACHE.patches.find(p => p.type === crop.type);
    const farm = { offset: 0, patches: {}, tools: {}, autoWeed: false };
    const state = Model.emptyPatch(base, farm);
    Object.assign(state, { crop: key, stage: 0, status: "growing", protected: true, plantedAt: base,
        plantedTick: Model.tickIndex(base, 0), nextAt: Model.nextGrowth(base, Data.stageMinutes(crop, 0), 0) });
    farm.patches[Data.patchKey(patch)] = state;
    return { farm, state, crop, base };
}
function stageAfter(key, minutes) {
    const planted = scheduled(key);
    Model.advanceFarm(planted.farm, planted.base + minutes * Model.MINUTE, () => 1);
    return planted.state;
}
for (const [key, stageMinutes, grownAt] of [["POTATO", 10, 40], ["RANARR", 20, 80], ["OAK", 40, 160],
    ["YEW", 40, 360], ["APPLE", 160, 960], ["CACTUS", 80, 560], ["POTATO_CACTUS", 10, 70],
    ["GRAPE", 5, 35], ["REDWOOD", 640, 6400]]) {
    const crop = Data.CROPS.get(key);
    const first = key === "YEW" ? 5 : stageMinutes;
    assert.equal(stageAfter(key, first - 1).stage, 0, `${key} does not grow early`);
    assert.equal(stageAfter(key, first).stage, 1, `${key} first stage at ${first} minutes`);
    assert.equal(stageAfter(key, grownAt - 1).status, "growing", `${key} is not grown early`);
    const grown = stageAfter(key, grownAt);
    assert.equal(grown.stage, crop.stages, `${key} reaches its last stage at ${grownAt} minutes`);
    assert.equal(grown.status, "grown", `${key} is grown at ${grownAt} minutes`);
}
const plantedYew = scheduled("YEW");
assert.equal(Model.stageAt(plantedYew.crop, 0, 0), 0);
assert.equal(Model.stageAt(plantedYew.crop, 0, 1), 1, "yew first stage takes one five-minute tick");
assert.equal(Model.stageAt(plantedYew.crop, 0, 8), 2, "yew's second stage lands on the next 40-minute tick");
assert.equal(Model.stageAt(plantedYew.crop, 0, 9 * 8), 10, "yew's later stages take eight five-minute ticks each");
assert.equal(Data.CACHE.patches.filter(p => p.type === "HERB").length, 10);
assert.ok(Data.CACHE.patches.some(p => p.type === "FLOWER" && p.x === 3601 && p.y === 3525), "Port Phasmatys flower patch uses regional weed models");
assert.ok(Data.CACHE.patches.some(p => p.type === "COMPOST" && p.x === 3610 && p.y === 3522), "Port Phasmatys compost bin uses regional models");
assert.equal(Data.CACHE.patches.filter(p => p.type === "REDWOOD").length, 1, "redwood scenery must not become independently plantable patches");
assert.equal(new Set(Data.CACHE.patches.map(Data.patchKey)).size, Data.CACHE.patches.length);
const tithe = { crop: 0, stage: 0, watered: true, dead: false, fertilized: false, nextAt: now + Model.MINUTE };
Model.advanceTithe(tithe, now + Model.MINUTE);
assert.equal(tithe.stage, 1);
Model.advanceTithe(tithe, now + 2 * Model.MINUTE);
assert.equal(tithe.dead, true, "each Tithe growth stage needs watering");
const ripeTithe = { ...tithe, stage: 3, dead: false };
Model.advanceTithe(ripeTithe, now + 100 * Model.MINUTE);
assert.equal(ripeTithe.dead, false, "ripe Tithe fruit does not expire");
for (const xp of [6, 14, 23]) {
    const batch = Model.titheDeposit(0, 100, xp);
    assert.equal(batch.points, 35);
    assert.equal(batch.score, 0);
    assert.equal(batch.xp + batch.bonus + xp * 100, xp * 1610);
    const first = Model.titheDeposit(0, 74, xp), last = Model.titheDeposit(74, 50, xp);
    assert.equal(last.count, 26, "a deposit cannot overflow the sack");
    assert.equal(first.xp + last.xp + last.bonus, batch.xp + batch.bonus);
    assert.equal(first.points + last.points, 35);
}

const core = require("../plugins/skills/farming/Core.Farming");
const Hespori = require("../plugins/skills/farming/Hespori.Farming");
const Patches = require("../plugins/skills/farming/Patches.Farming");
const Services = require("../plugins/skills/farming/Services.Farming");
let engagedResets = 0;
const activeQuestBoss = { quest: true, boss: {
    getHitpoints: () => 79,
    getCombat: () => ({ getLastAttack: () => ({ reset: () => engagedResets++ }) }),
} };
assert.equal(Hespori.keepQuestHesporiEngaged(activeQuestBoss), true);
assert.equal(engagedResets, 1, "the active quest boss cannot regenerate between custom combat hits");
assert.equal(Hespori.keepQuestHesporiEngaged({ ...activeQuestBoss, quest: false }), false, "ordinary farming Hespori keeps its normal regen");
assert.equal(Hespori.keepQuestHesporiEngaged({ ...activeQuestBoss, boss: { getHitpoints: () => 0 } }), false, "a defeated boss is not kept in combat");
const hooks = {};
Patches.attach(new Proxy({}, { get: (_, name) => (...args) => (hooks[name] ??= []).push(args[0]) }));
const login = hooks.onPlayerLogin[0], logout = hooks.onPlayerLogout[0], mapSquareChanged = hooks.onPlayerMapSquareChange[0];
function testPlayer() {
    const attributes = new Map(), varbits = new Map();
    const inventory = { items: [], scans: 0, refreshes: 0,
        getItems() { this.scans++; return this.items; }, refreshItems() { this.refreshes++; } };
    const sender = { getVarbit: id => varbits.get(id) ?? 0, getVarp: () => 0,
        sendVarbit(id, value) { varbits.set(id, value); return this; } };
    return { inventory, banks: Array(core.Bank.TOTAL_BANK_TABS).fill(null), location: new core.Location(3200, 3800, 0),
        getAttribute: key => attributes.get(key), setAttribute: (key, value) => attributes.set(key, value),
        getInventory() { return inventory; }, getBanks() { return this.banks; },
        getLocation() { return this.location; }, getPacketSender: () => sender, getPrivateArea: () => null };
}
const realNow = Date.now, realGetObject = core.MapObjects.get, realAdvance = Model.advanceFarm;
let clock = now, growthCalls = 0;
Date.now = () => clock;
core.MapObjects.get = () => null;
// A fixed roll: no disease, so the timing checks below never meet a dead patch.
Model.advanceFarm = (farm, at) => { growthCalls++; return realAdvance(farm, at, () => 1); };
try {
    const player = testPlayer();
    login({ player });
    assert.equal(growthCalls, 1, "login with uninitialized bank tabs must finish");
    for (let tick = 1; tick <= 8; tick++) {
        clock = now + tick * 600;
        player.location.setX(3200 + tick);
        Patches.tick();
    }
    assert.equal(growthCalls, 1, "movement must not restart growth each tick");
    assert.equal(player.inventory.scans, 1, "nothing due means no bank and inventory scans");
    clock = now + 5 * Model.MINUTE + 600;
    Patches.tick();
    assert.equal(growthCalls, 2, "the five-minute farming tick still checks everyone");
    logout({ player });
    login({ player });
    assert.equal(growthCalls, 3, "relogin grows straight away");

    // A planted patch grows on its own farming tick, not on a poll.
    const farmer = testPlayer();
    const herbFarm = planted();
    const herbState = herbFarm.patches[Data.patchKey(herb)];
    herbState.nextAt = Model.nextGrowth(clock, Data.CROPS.get("RANARR").minutes, herbFarm.offset);
    farmer.setAttribute(Patches.FARM_ATTRIBUTE, herbFarm);
    login({ player: farmer });
    const stage = herbState.stage, dueAt = herbState.nextAt;
    clock = dueAt - 600;
    Patches.tick();
    assert.equal(herbState.stage, stage, "nothing grows before its farming tick");
    clock = dueAt + 600;
    Patches.tick();
    assert.equal(herbState.stage, stage + 1, "growth lands on the farming tick");

    // advance_time skips the farming clock forward and grows as normal.
    const skip = { player: farmer, ms: 3 * Data.CROPS.get("RANARR").minutes * Model.MINUTE, handledBy: [] };
    Patches.advanceTime(skip);
    assert.deepEqual(skip.handledBy, ["Farming"]);
    assert.ok(herbState.stage >= stage + 3 || herbState.status !== "growing", "three growth cycles applied");
    assert.ok(herbState.nextAt > clock, "the next stage is scheduled after the skip");
    logout({ player: farmer });

    // Movement must use the region index, not iterate the entire patch table.
    const iterator = Data.CACHE.patches[Symbol.iterator];
    Data.CACHE.patches[Symbol.iterator] = () => { throw new Error("full patch scan on movement"); };
    try { player.location.setX(3200); mapSquareChanged({ player }); Patches.tick(); }
    finally { Data.CACHE.patches[Symbol.iterator] = iterator; }

    // Compare the indexed selection to the original full scan, including reused varbits.
    for (const base of Data.CACHE.patches) for (const delta of [-65, -64, -1, 0, 64, 65]) {
        const visitor = testPlayer(), nearest = new Map();
        const x = Math.floor((Data.patchMinX(base) + base.maxX) / 2) + delta;
        const y = Math.floor((Data.patchMinY(base) + base.maxY) / 2) + delta;
        visitor.location = new core.Location(x, y, base.z);
        for (const patch of Data.CACHE.patches) {
            const distance = Math.max(Math.abs((Data.patchMinX(patch) + patch.maxX) / 2 - x), Math.abs((Data.patchMinY(patch) + patch.maxY) / 2 - y));
            if (patch.z === base.z && distance <= 64 && (!nearest.has(patch.varbit) || nearest.get(patch.varbit).distance > distance)) {
                nearest.set(patch.varbit, { patch, distance });
            }
        }
        login({ player: visitor });
        assert.deepEqual(Object.keys(Patches.farmFor(visitor).patches).sort(),
            [...nearest.values()].map(({ patch }) => Data.patchKey(patch)).sort(), `nearby patches at ${x},${y},${base.z}`);
    }

    // Issue 6602: Hosidius's north allotment is L-shaped, with locs down to y 3554 below its first loc
    // (1733,3558). A click on the east arm has to find the patch, and the patch keeps its saved key.
    const hosidiusNorth = Data.CACHE.patches.find(p => p.id === 27113);
    assert.equal(Data.patchKey(hosidiusNorth), "27113:1733:3558:0", "saved farms keep finding the patch");
    for (const [x, y] of [[1733, 3558], [1739, 3559], [1738, 3554], [1739, 3555], [1739, 3557]]) {
        assert.equal(Patches.findPatch(27113, { x, y, z: 0 }), hosidiusNorth, `loc ${x},${y} belongs to the north allotment`);
    }
    assert.equal(Data.patchMinY(herb), herb.y, "a patch without minY keeps y as its corner");

    const crop = { wateredSeedling: core.ItemIdentifiers.OAK_SEEDLING_W_, sapling: core.ItemIdentifiers.OAK_SAPLING };
    Data.WATERED_SEEDLINGS.set(crop.wateredSeedling, crop);
    const fresh = new core.Item(crop.wateredSeedling);
    const mature = new core.Item(crop.wateredSeedling).setMetaValue("farming:sapling-at", clock - 1);
    const future = new core.Item(crop.wateredSeedling).setMetaValue("farming:sapling-at", clock + Model.MINUTE);
    const placeholder = new core.Item(crop.wateredSeedling, 0).setMetaValue("farming:sapling-at", clock - 1);
    const bank = { ...player.inventory, items: [mature, future, placeholder], refreshes: 0 };
    player.inventory.items = [null, fresh];
    player.banks[1] = bank;
    Services.humidified({ player });
    const deadline = fresh.getMetaValue("farming:sapling-at");
    assert.equal(deadline, Model.nextGrowth(clock, 5, Patches.farmFor(player).offset));
    assert.equal(mature.getId(), crop.sapling, "seedlings mature in initialized bank tabs");
    assert.equal(mature.getMetaValue("farming:sapling-at"), undefined);
    assert.equal(bank.refreshes, 1);
    assert.equal(future.getId(), crop.wateredSeedling);
    assert.equal(placeholder.getId(), crop.wateredSeedling, "bank placeholders must stay unchanged");
    Services.growSeedlings(player, deadline - 1);
    assert.equal(fresh.getId(), crop.wateredSeedling);
    Services.growSeedlings(player, deadline);
    assert.equal(fresh.getId(), crop.sapling);
    assert.equal(player.inventory.refreshes, 1);
} finally {
    Date.now = realNow;
    core.MapObjects.get = realGetObject;
    Model.advanceFarm = realAdvance;
}
console.log("Farming state and hook checks passed.");

// A quest restriction must run before any patch state, tool or rune mutation.
const originalEmit = core.PluginManager.emitCustomEvent;
const restricted = Data.CACHE.patches.find(p => p.id === 50692);
let patchRequests = 0;
core.PluginManager.emitCustomEvent = (name, request) => {
    if (name !== "farming:can-use-patch") return;
    assert.equal(request.patch, restricted);
    request.allowed = false;
    patchRequests++;
};
try {
    for (const hook of ["onObjectInteraction", "onItemOnObject", "onSpellOnObject"]) {
        const player = testPlayer();
        const event = { player, object: { getId: () => restricted.id }, location: { x: restricted.x, y: restricted.y, z: restricted.z }, itemId: 1, clickType: 1 };
        hooks[hook][0](event);
        assert.equal(event.handled, true);
        assert.equal(player.getAttribute(Patches.FARM_ATTRIBUTE), undefined, `${hook} must not create farming state for a locked patch`);
    }
    assert.equal(patchRequests, 3);
} finally { core.PluginManager.emitCustomEvent = originalEmit; }
