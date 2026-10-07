// Isolated state-machine and hook checks; no running server or sockets.
// From server/: node -r ts-node/register/transpile-only plugins/skills/farming/Model.Farming.test.js
// The plugin hands the farming files api.core; outside the server the test does it.
require("../../../src/main/typescript/elvarg/game/World");
const { PluginManager } = require("../../../src/main/typescript/elvarg/plugins/PluginManager");
require("./Core.Farming").init({ core: PluginManager.getCoreApi() });
const Data = require("./Data.Farming");
const Model = require("./Model.Farming");
const assert = require("node:assert/strict");

const now = Date.UTC(2026, 8, 30);
for (const key of ["RANARR", "APPLE", "OAK", "WHITE_LILY", "ATTAS", "GRAPE", "CELASTRUS", "SPIRIT_TREE"]) {
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
assert.equal(Model.saveLifeChance(Data.CROPS.get("RANARR"), 99), 81 / 256);
assert.equal(Model.saveLifeChance(Data.CROPS.get("RANARR"), 99, true, true), 93 / 256);
assert.equal(Model.nextGrowth(now, 20, 7 * Model.MINUTE) - now, 13 * Model.MINUTE);
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

const core = require("./Core.Farming");
const Patches = require("./Patches.Farming");
const Services = require("./Services.Farming");
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
Model.advanceFarm = (...args) => { growthCalls++; return realAdvance(...args); };
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
        const x = Math.floor((base.x + base.maxX) / 2) + delta;
        const y = Math.floor((base.y + base.maxY) / 2) + delta;
        visitor.location = new core.Location(x, y, base.z);
        for (const patch of Data.CACHE.patches) {
            const distance = Math.max(Math.abs((patch.x + patch.maxX) / 2 - x), Math.abs((patch.y + patch.maxY) / 2 - y));
            if (patch.z === base.z && distance <= 64 && (!nearest.has(patch.varbit) || nearest.get(patch.varbit).distance > distance)) {
                nearest.set(patch.varbit, { patch, distance });
            }
        }
        login({ player: visitor });
        assert.deepEqual(Object.keys(Patches.farmFor(visitor).patches).sort(),
            [...nearest.values()].map(({ patch }) => Data.patchKey(patch)).sort(), `nearby patches at ${x},${y},${base.z}`);
    }

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
