const Data = require("./Data.Farming");

const MINUTE = 60_000;
function advanceTithe(plant, now) {
    while (!plant.dead && plant.stage < 3 && plant.nextAt <= now) {
        if (!plant.watered) { plant.dead = true; break; }
        plant.stage++;
        plant.watered = false;
        plant.nextAt += plant.fertilized ? 30_000 : MINUTE;
    }
}
function titheDeposit(score, amount, harvestXp) {
    const count = Math.min(amount, 100 - score);
    let xp = 0, bonus = 0, points = 0;
    for (let i = score + 1; i <= score + count; i++) {
        xp += harvestXp * (i >= 75 ? 20 : 10);
        if (i % 3 === 0) points++;
        if (i === 75) bonus = harvestXp * 250;
        if (i === 100) points += 2;
    }
    return { count, score: (score + count) % 100, xp, bonus, points };
}
const EPOCH = Date.UTC(2025, 5, 9); // Day 1 of the wiki's four-day growth schedule.
function nextGrowth(now, minutes, offset) {
    const period = minutes * MINUTE;
    return EPOCH + (Math.floor((now - EPOCH + offset) / period) + 1) * period - offset;
}
function emptyPatch(now, farm, weeds = 0) {
    return { stage: 0, weeds, compost: 0, watered: false, status: "growing", checked: false,
        protected: false, lives: 0, nextAt: nextGrowth(now, 5, farm.offset), plantedAt: now };
}
function startingLives(crop, compost) {
    if (Data.COMPOSTABLE_YIELD.has(crop.type)) return 3 + compost;
    if (crop.type === "CORAL") return 4;
    if (crop.type === "GRAPES") return 5;
    return Math.max(1, crop.lives);
}
function diseaseChance(crop, compost, watered, iasor) {
    // Wiki-confirmed numerators. Other crops/watered numerators have not been published.
    // ponytail: 1/8 base risk for unpublished crops; replace with measured per-crop rates when known.
    let numerator = crop.type === "HERB" ? 26 : crop.type === "FRUIT_TREE" ? 17 : crop.type === "CORAL" ? 7 : crop.key === "MAPLE" ? 12 : crop.key === "MAGIC" ? 8 : 15;
    if (watered) numerator = Math.floor(numerator / 2);
    numerator = Math.floor(numerator * [1, 0.5, 0.2, 0.1][compost]);
    if (iasor) numerator = Math.floor(numerator * 0.2);
    return (numerator + 1) / 128;
}

const HERB_LOW = { GUAM: 25, MARRENTILL: 28, TARROMIN: 31, HARRALANDER: 36, GOUTWEED: 39,
    RANARR: 39, TOADFLAX: 43, IRIT: 46, AVANTOE: 50, KWUARM: 54, SNAPDRAGON: 57, HUASCA: 59,
    CADANTINE: 60, LANTADYME: 64, DWARF_WEED: 67, TORSTOL: 71 };
const CROP_LOW = { POTATO: 101, ONION: 105, CABBAGE: 107, TOMATO: 112, SWEETCORN: 88, STRAWBERRY: 103,
    BARLEY: 103, HAMMERSTONE: 104, ASGARNIAN: 108, KRANDORIAN: 120, WILDBLOOD: 128 };
function saveLifeChance(crop, level, secateurs = false, cape = false, diary = 0, attas = false) {
    let low, high;
    if (crop.type === "HERB") { low = HERB_LOW[crop.key]; high = 80; }
    else if (crop.type === "SEAWEED") { low = 150; high = 210; }
    else if (crop.key === "CACTUS") { low = -76; high = 178; }
    else if (crop.key === "GRAPE") { low = -50; high = 180; }
    else if (crop.key === "SNAPE_GRASS") { low = 148; high = 195; }
    else if (crop.key === "WATERMELON") { low = 126; high = 180; }
    else if (crop.key === "YANILLIAN") { low = 116; high = 180; }
    else if (crop.key === "JUTE") { low = 113; high = 180; }
    else if (CROP_LOW[crop.key]) { low = CROP_LOW[crop.key]; high = 180; }
    else {
        // ponytail: unpublished CTS endpoints, estimated from wiki yields; not claimed as exact OSRS rates.
        [low, high] = crop.type === "ALLOTMENT" || crop.type === "HOPS" ? [100, 180]
            : crop.type === "BUSH" || crop.key === "POTATO_CACTUS" ? [90, 190] : [25, 80];
    }
    const items = (secateurs && ["ALLOTMENT", "HERB", "HOPS", "GRAPES", "BUSH", "CELASTRUS", "CORAL"].includes(crop.type) ? 0.10 : 0) + (cape && crop.type === "HERB" ? 0.05 : 0);
    const boost = (value) => Math.floor((Math.floor(value * (1 + items)) + diary) * (attas ? 1.05 : 1));
    level = Math.max(1, Math.min(99, level));
    return Math.max(0, Math.min(255 / 256, (1 + Math.floor((boost(low) * (99 - level) + boost(high) * (level - 1)) / 98 + 0.5)) / 256));
}
function activeAnima(farm, at) {
    return Object.values(farm.patches).find(s => s.crop && Data.CACHE.timing[s.crop]?.type === "ANIMA"
        && at >= s.plantedAt && at < s.nextAt + (8 - s.stage - 1) * 640 * MINUTE && s.status !== "dead")?.crop;
}
function diseaseFree(farm, patch, state, at) {
    const crop = Data.CROPS.get(state.crop);
    if (state.protected || ["POISON_IVY", "HESPORI", "CRYSTAL_TREE"].includes(crop.key) || ["ANIMA", "GRAPES"].includes(crop.type)) return true;
    // Troll Stronghold and Weiss use the same herb growth states, with permanent immunity.
    if (crop.type === "HERB" && ((patch.x >= 2800 && patch.x <= 2840 && patch.y >= 3670 && patch.y <= 3710)
        || (patch.x >= 2830 && patch.x <= 2870 && patch.y >= 3920 && patch.y <= 3950))) return true;
    if (farm.hosidiusProtected && patch.x >= 1720 && patch.x <= 1760 && patch.y >= 3540 && patch.y <= 3565) return true;
    if (farm.faladorProtected && patch.type === "TREE" && patch.x === 3003 && patch.y === 3372) return true;
    if (farm.fortisProtected && patch.type === "HERB" && patch.x === 1581 && patch.y === 3094) return true;
    if (crop.type !== "ALLOTMENT") return false;
    for (const flower of Data.CACHE.patches.filter(p => p.type === "FLOWER" && p.z === patch.z && Math.abs(p.x - patch.x) < 32 && Math.abs(p.y - patch.y) < 32)) {
        const s = farm.patches[Data.patchKey(flower)];
        if (!s || s.plantedAt > at) continue;
        if (s.scarecrow && crop.key === "SWEETCORN") return true;
        if (s.status !== "grown") continue;
        if (s.crop === "WHITE_LILY" || (s.crop === "MARIGOLD" && ["POTATO", "ONION", "TOMATO"].includes(crop.key))
            || (s.crop === "ROSEMARY" && crop.key === "CABBAGE") || (s.crop === "NASTURTIUM" && crop.key === "WATERMELON")) return true;
    }
    return false;
}

/** Process crop events in time order, so offline flower/anima protection has the same lifetime as online. */
function advanceFarm(farm, now, random = Math.random) {
    const kronos = new Map();
    const planted = Data.CACHE.patches.map(patch => ({ patch, state: farm.patches[Data.patchKey(patch)] }))
        .filter(({ state }) => state?.crop && state.status !== "dead");
    for (;;) {
        let due;
        for (const entry of planted) {
            const { state } = entry;
            const crop = Data.CROPS.get(state.crop);
            if (state.status === "dead" || (state.status === "grown" && !crop.regrow && !state.stump)) continue;
            if (state.nextAt <= now && (!due || state.nextAt < due.state.nextAt)) due = entry;
        }
        if (!due) break;
        const { patch, state } = due;
        const crop = Data.CROPS.get(state.crop);
        const at = state.nextAt;
        if (state.status === "grown") {
            if (state.stump) { state.stump = false; continue; }
            const ticks = 1 + Math.floor((now - at) / (crop.regrow * MINUTE));
            state.lives = Math.min(startingLives(crop, state.compost), state.lives + ticks);
            state.nextAt = at + ticks * crop.regrow * MINUTE;
            continue;
        }
        if (state.status === "diseased") { state.status = "dead"; continue; }
        let growth = 1;
        if (crop.type !== "ANIMA" && activeAnima(farm, at) === "KRONOS") {
            const key = `${at}:${crop.minutes}`;
            if (!kronos.has(key)) {
                let extra = 0;
                // ponytail: the wiki describes shared repeatable skips but does not publish the roll; calibrate this estimate when measured.
                while (extra < 12 && random() < 0.1) extra++;
                kronos.set(key, extra);
            }
            growth += kronos.get(key);
        }
        state.stage = Math.min(crop.stages, state.stage + growth);
        if (crop.type === "ANIMA") {
            if (state.stage >= crop.stages) state.status = "dead";
        } else if (state.stage >= crop.stages) {
            state.status = "grown";
            state.lives = startingLives(crop, state.compost);
        } else if (Data.CACHE.states[crop.type][crop.key].DISEASED?.[state.stage] != null
            && state.stage < crop.stages - (crop.type === "FRUIT_TREE" ? 1 : 0)
            && !diseaseFree(farm, patch, state, at)
            && random() < diseaseChance(crop, state.compost, state.watered, activeAnima(farm, at) === "IASOR")) {
            state.status = "diseased";
        }
        state.watered = false;
        state.nextAt = nextGrowth(at, state.status === "diseased" ? crop.minutes * 2
            : state.status === "grown" && crop.regrow ? crop.regrow : crop.minutes, farm.offset);
    }
    for (const patch of Data.CACHE.patches) {
        const state = farm.patches[Data.patchKey(patch)];
        if (!state || ["GRAPES", "CORAL"].includes(patch.type)) continue;
        if (state.crop || state.scarecrow || state.bin || farm.autoWeed) continue;
        if (state.nextAt <= now) {
            state.weeds = Math.min(3, state.weeds + 1 + Math.floor((now - state.nextAt) / (5 * MINUTE)));
            state.nextAt = nextGrowth(now, 5, farm.offset);
        }
    }
}

function patchValue(patch, state) {
    const states = Data.CACHE.states[patch.type];
    if (state.scarecrow) return states.SCARECROW?.GROWING?.[3] ?? 36;
    if (!state.crop) return patch.type === "GRAPES" ? (state.compost ? 1 : 0) : (states.WEEDS?.GROWING?.[state.weeds] ?? 0);
    const crop = Data.CROPS.get(state.crop);
    const visual = states[state.crop];
    if (crop.type === "HESPORI" && state.status === "grown") return state.hesporiLoot ? 8 : state.hesporiFight ? 9 : 7;
    if (crop.type === "CELASTRUS" && state.stump) return 28;
    if (crop.type === "CELASTRUS" && state.status === "grown" && state.checked && !state.lives) return 17;
    // The cache distinguishes these actions even though RuneLite coalesces their timer states.
    if (crop.type === "SPIRIT_TREE" && state.status === "grown") return state.checked ? 20 : 44;
    if (crop.type === "GRAPES" && state.status === "grown" && state.checked) return 15 - Math.max(1, Math.min(5, state.lives));
    if (state.stump) return visual.STUMP?.[0] ?? visual.HARVESTABLE?.[0];
    if (crop.type === "GRAPES" && state.status === "dead") return 15;
    if (state.status === "dead") return (visual.DEAD ?? states.ANYHERB?.DEAD)?.[Math.max(1, state.stage)] ?? visual.GROWING[crop.stages];
    if (state.status === "diseased") return visual.DISEASED?.[state.stage] ?? visual.GROWING[state.stage];
    if (state.status === "grown") {
        if (crop.check && !state.checked) return visual.GROWING[crop.stages];
        const harvest = visual.HARVESTABLE;
        if (!harvest) return visual.GROWING[crop.stages];
        return harvest[Math.min(harvest.length - 1, Math.max(0, state.lives - (crop.regrow ? 0 : 1)))] ?? harvest[0];
    }
    return (state.watered ? visual.WATERED?.[state.stage] : undefined) ?? visual.GROWING[state.stage];
}

Object.assign(module.exports, { MINUTE, advanceTithe, titheDeposit, nextGrowth, emptyPatch, startingLives, diseaseChance, saveLifeChance, activeAnima, advanceFarm, patchValue });
